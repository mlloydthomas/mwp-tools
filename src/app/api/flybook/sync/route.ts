// POST /api/flybook/sync?company=aex
// Syncs Flybook reservation data into our bookings table.
// Safe to run repeatedly — skips any bookings already in the DB.
//
// Trip name matching strategy:
//   Our DB stores trips with combined names like:
//     "ECUADOR CLIMBING SCHOOL EXPEDITION - Feb 07 2026"
//   Flybook sends event titles like:
//     "ECUADOR CLIMBING SCHOOL EXPEDITION"
//   We strip our date suffix and match on core name + departure date.
//
// Matching priority:
//   1. Core name (suffix stripped) + exact departure date  ← most precise
//   2. Core name + departure year                          ← year-level match
//   3. Core name exact match                               ← fallback
//   4. Fuzzy core name match                               ← last resort

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  fetchAllReservations,
  parseGuestCount,
  buildExternalBookingId,
  type FlybookReservation,
} from "@/lib/flybook";

const COMPANY_API_KEYS: Record<string, string | undefined> = {
  aex: process.env.FLYBOOK_AEX_API_KEY,
};

/**
 * Strip the date suffix we append to trip names in our DB.
 * "ECUADOR CLIMBING SCHOOL EXPEDITION - Feb 07 2026" → "ecuador climbing school expedition"
 * "KILIMANJARO EXPEDITION - Jun 14 2026"              → "kilimanjaro expedition"
 * "Japan Backcountry Ski Adventure"                   → "japan backcountry ski adventure"
 * (names without suffix are returned as-is, lowercased)
 */
function stripDateSuffix(name: string): string {
  return name
    .toLowerCase()
    .trim()
    // Strip " - Mon DD YYYY" suffix (e.g. " - Feb 07 2026")
    .replace(/\s*-\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2}\s+20\d{2}\s*$/i, "")
    // Also strip " - YYYY-MM-DD" format just in case
    .replace(/\s*-\s*20\d{2}-\d{2}-\d{2}\s*$/, "")
    .trim();
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const companySlug = searchParams.get("company");

  if (!companySlug) {
    return NextResponse.json({ success: false, error: "company param required" }, { status: 400 });
  }

  const apiKey = COMPANY_API_KEYS[companySlug];
  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        error: `No Flybook API key configured for '${companySlug}'. Add FLYBOOK_${companySlug.toUpperCase()}_API_KEY to your environment variables.`,
      },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  const { data: company } = await supabase
    .from("companies")
    .select("id, slug")
    .eq("slug", companySlug)
    .single();

  if (!company) {
    return NextResponse.json({ success: false, error: `Company '${companySlug}' not found` }, { status: 404 });
  }

  // ── Step 1: Load all trips into memory for matching ───────────────────────
  const { data: allTrips, error: tripsError } = await supabase
    .from("trips")
    .select("id, name, departure_date")
    .eq("company_id", company.id);

  if (tripsError) {
    return NextResponse.json(
      { success: false, error: `Failed to load trips: ${tripsError.message}` },
      { status: 500 }
    );
  }

  if (!allTrips?.length) {
    return NextResponse.json(
      { success: false, error: "No trips found. Upload trips via Data Import before syncing bookings." },
      { status: 400 }
    );
  }

  // Build three lookup maps using the CORE name (date suffix stripped):
  //   Map 1: "core name|YYYY-MM-DD" → trip_id   (most precise — date match)
  //   Map 2: "core name|YYYY"       → trip_id   (year match)
  //   Map 3: "core name"            → trip_id   (name only — last resort)
  const tripByNameAndDate = new Map<string, string>(); // "core|YYYY-MM-DD" → trip_id
  const tripByNameAndYear = new Map<string, string>(); // "core|YYYY"       → trip_id
  const tripByCoreName    = new Map<string, string>(); // "core"            → trip_id

  for (const trip of allTrips) {
    const core = stripDateSuffix(trip.name);
    const depDate = trip.departure_date?.slice(0, 10) || ""; // "YYYY-MM-DD"
    const depYear = trip.departure_date?.slice(0, 4) || "";  // "YYYY"

    if (depDate) tripByNameAndDate.set(`${core}|${depDate}`, trip.id);
    if (depYear) tripByNameAndYear.set(`${core}|${depYear}`, trip.id);
    // Last write wins for core-name-only map — date-qualified maps take priority
    tripByCoreName.set(core, trip.id);
  }

  // ── Step 2: Load existing booking IDs to skip duplicates ─────────────────
  const { data: existingBookings } = await supabase
    .from("bookings")
    .select("external_booking_id")
    .eq("company_id", company.id)
    .not("external_booking_id", "is", null);

  const existingIds = new Set(
    (existingBookings || []).map(b => b.external_booking_id).filter(Boolean)
  );

  // ── Step 3: Fetch all Flybook reservations in monthly batches ─────────────
  const monthProgress: Record<string, number> = {};
  let fetchErrors = 0;

  const reservations = await fetchAllReservations(
    apiKey,
    2,  // years back — cover historical bookings
    2,  // years forward — cover all upcoming trips
    (month, count) => {
      monthProgress[month] = count;
      if (count === -1) fetchErrors++;
    }
  );

  // ── Step 4: Map reservations → booking records ────────────────────────────
  const toInsert: Record<string, unknown>[] = [];
  let skippedCount = 0;
  const unmatched: string[] = [];

  for (const res of reservations) {
    if (!res.events?.length) continue;

    const primaryEvent = res.events[0];
    const externalBookingId = buildExternalBookingId(res);

    if (existingIds.has(externalBookingId)) {
      skippedCount++;
      continue;
    }

    // The Flybook event title is the CORE trip name (no date suffix)
    // e.g. "ECUADOR CLIMBING SCHOOL EXPEDITION"
    const eventTitle = primaryEvent.title?.trim() || "";
    const titleCore = eventTitle.toLowerCase().trim();

    // The Flybook event startTime is the actual departure date
    // e.g. "2026-02-07T00:00:00Z" → "2026-02-07"
    const eventDate = primaryEvent.startTime?.slice(0, 10) || ""; // "YYYY-MM-DD"
    const eventYear = primaryEvent.startTime?.slice(0, 4) || "";  // "YYYY"

    let tripId: string | null = null;

    // Strategy 1: Core name + exact departure date (handles multiple departures per year)
    if (eventDate) {
      tripId = tripByNameAndDate.get(`${titleCore}|${eventDate}`) || null;
    }

    // Strategy 2: Core name + year
    if (!tripId && eventYear) {
      tripId = tripByNameAndYear.get(`${titleCore}|${eventYear}`) || null;
    }

    // Strategy 3: Core name exact match
    if (!tripId) {
      tripId = tripByCoreName.get(titleCore) || null;
    }

    // Strategy 4: Fuzzy — strip season/date artifacts Flybook sometimes appends
    // e.g. "Ecuador Climbing School Expedition - Spring" → "ecuador climbing school expedition"
    if (!tripId) {
      const fuzzyTitle = titleCore
        .replace(/\s*[-–—]\s*(spring|summer|fall|autumn|winter)\s*\d{0,4}.*$/i, "")
        .replace(/\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d*\s*\d{0,4}.*$/i, "")
        .trim();

      if (fuzzyTitle !== titleCore) {
        // Try all three maps with the fuzzy title
        if (eventDate) tripId = tripByNameAndDate.get(`${fuzzyTitle}|${eventDate}`) || null;
        if (!tripId && eventYear) tripId = tripByNameAndYear.get(`${fuzzyTitle}|${eventYear}`) || null;
        if (!tripId) tripId = tripByCoreName.get(fuzzyTitle) || null;
      }

      // Last resort: substring match against all core names
      if (!tripId) {
        for (const [core, id] of tripByCoreName) {
          if (
            core.length > 6 &&
            (core === fuzzyTitle || core.includes(fuzzyTitle) || fuzzyTitle.includes(core))
          ) {
            tripId = id;
            break;
          }
        }
      }
    }

    if (!tripId) {
      if (!unmatched.includes(eventTitle)) unmatched.push(eventTitle);
      // Cannot insert without trip_id — FK constraint requires it
      continue;
    }

    const guestCount = parseGuestCount(primaryEvent.quantityDescription);
    const customer = res.customers?.[0];
    const clientName = customer?.name || res.resName || null;
    const clientEmail = customer?.email?.toLowerCase().trim() || null;

    toInsert.push({
      company_id: company.id,
      trip_id: tripId,
      trip_name: eventTitle,
      external_booking_id: externalBookingId,
      guest_count: guestCount,
      price_paid_usd: res.totalCost || null,
      booking_date: res.dateCreated || null,
      status: "confirmed",
      client_name: clientName,
      client_email: clientEmail,
      notes: res.method === "Backend" ? "Staff booking" : null,
      is_private: false,
    });
  }

  // ── Step 5: Insert new bookings in chunks of 500 ──────────────────────────
  const CHUNK_SIZE = 500;
  let inserted = 0;
  const insertErrors: string[] = [];

  for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
    const chunk = toInsert.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase.from("bookings").insert(chunk);
    if (error) {
      insertErrors.push(`Chunk ${Math.floor(i / CHUNK_SIZE) + 1}: ${error.message}`);
    } else {
      inserted += chunk.length;
    }
  }

  // ── Step 6: Return sync summary ───────────────────────────────────────────
  return NextResponse.json({
    success: true,
    summary: {
      reservations_fetched: reservations.length,
      inserted,
      skipped: skippedCount,
      unmatched_trip_titles: unmatched,
      insert_errors: insertErrors,
      fetch_errors: fetchErrors,
      months_fetched: Object.keys(monthProgress).length,
      hint: unmatched.length > 0
        ? `${unmatched.length} Flybook activity title(s) couldn't be matched to a trip. ` +
          "Check that the trip names in Data Import match exactly what Flybook calls them."
        : undefined,
    },
  });
}
