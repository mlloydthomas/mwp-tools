// POST /api/salesforce/sync?company=tbt
//
// Syncs Thomson Bike Tours booking data from Salesforce into our bookings table.
// Safe to run repeatedly — idempotent (skips bookings already in DB by SF record ID).
//
// Prerequisites:
//   1. Run migration_002_salesforce.sql in Supabase SQL Editor
//   2. Add these to Vercel environment variables (and .env.local for local dev):
//        SF_TBT_INSTANCE_URL   = https://thomsonbiketours.my.salesforce.com
//        SF_TBT_USERNAME       = your-sf-login-email@domain.com
//        SF_TBT_PASSWORD       = your-sf-password
//        SF_TBT_SECURITY_TOKEN = the-token-from-sf-settings-email
//   3. Trips for TBT must exist in the database (upload via Data Import first)
//
// Note: SF_TBT_CLIENT_ID and SF_TBT_CLIENT_SECRET are OPTIONAL.
// If not set, we use Salesforce's built-in CLI app which works for most orgs.
// If auth fails with "invalid_client", Thomson's SF admin needs to create a
// Connected App — see the setup guide.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  authenticateSalesforce,
  fetchTBTBookings,
  extractTourName,
  mapSFStatus,
  type SFOpportunity,
  type SalesforceConfig,
} from "@/lib/salesforce";

function getSalesforceConfig(companySlug: string): SalesforceConfig | null {
  const prefix = `SF_${companySlug.toUpperCase()}`;
  const instanceUrl = process.env[`${prefix}_INSTANCE_URL`];
  const username = process.env[`${prefix}_USERNAME`];
  const password = process.env[`${prefix}_PASSWORD`];
  const securityToken = process.env[`${prefix}_SECURITY_TOKEN`];

  // These three are required
  if (!instanceUrl || !username || !password || !securityToken) {
    return null;
  }

  return {
    instanceUrl,
    username,
    password,
    securityToken,
    // Optional — only needed if the default Salesforce app is blocked
    clientId: process.env[`${prefix}_CLIENT_ID`],
    clientSecret: process.env[`${prefix}_CLIENT_SECRET`],
  };
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const companySlug = searchParams.get("company");

  if (!companySlug) {
    return NextResponse.json(
      { success: false, error: "company param required (e.g. ?company=tbt)" },
      { status: 400 }
    );
  }

  if (companySlug !== "tbt") {
    return NextResponse.json(
      { success: false, error: `Salesforce sync is only configured for TBT. Use Flybook sync for '${companySlug}'.` },
      { status: 400 }
    );
  }

  const sfConfig = getSalesforceConfig(companySlug);
  if (!sfConfig) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Salesforce credentials not fully configured. Add these to your Vercel environment variables:\n" +
          "  SF_TBT_INSTANCE_URL   (e.g. https://thomsonbiketours.my.salesforce.com)\n" +
          "  SF_TBT_USERNAME       (your Salesforce login email)\n" +
          "  SF_TBT_PASSWORD       (your Salesforce password)\n" +
          "  SF_TBT_SECURITY_TOKEN (from SF Settings → Reset My Security Token)\n\n" +
          "See the setup guide for step-by-step instructions.",
      },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  // ── Step 1: Look up TBT in our companies table ────────────────────────────
  const { data: company } = await supabase
    .from("companies")
    .select("id, slug")
    .eq("slug", companySlug)
    .single();

  if (!company) {
    return NextResponse.json(
      { success: false, error: `Company '${companySlug}' not found in database` },
      { status: 404 }
    );
  }

  // ── Step 2: Authenticate with Salesforce ──────────────────────────────────
  let sfAuth;
  try {
    sfAuth = await authenticateSalesforce(sfConfig);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown auth error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 401 }
    );
  }

  // ── Step 3: Load our TBT trips into memory for matching ───────────────────
  const { data: allTrips, error: tripsError } = await supabase
    .from("trips")
    .select("id, name, departure_date, trip_type")
    .eq("company_id", company.id);

  if (tripsError) {
    return NextResponse.json(
      { success: false, error: `Failed to load trips: ${tripsError.message}` },
      { status: 500 }
    );
  }

  if (!allTrips?.length) {
    return NextResponse.json(
      {
        success: false,
        error:
          "No trips found for TBT in the database. " +
          "Upload trips via Data Import first, then sync bookings.",
      },
      { status: 400 }
    );
  }

  // Build lookup maps for trip matching
  // We try three strategies in order:
  //   1. Exact tour name + departure year  (most precise)
  //   2. Exact tour name only              (catches same-name trips across years)
  //   3. Fuzzy core name match             (handles minor naming differences)
  const tripByNameAndYear = new Map<string, string>(); // "name|year" → trip_id
  const tripByName = new Map<string, string>();         // lowercase name → trip_id

  for (const trip of allTrips) {
    const nameLower = trip.name.toLowerCase().trim();
    const year = trip.departure_date?.slice(0, 4);
    if (year) tripByNameAndYear.set(`${nameLower}|${year}`, trip.id);
    // Last-write wins for exact name — year-qualified match above takes priority
    tripByName.set(nameLower, trip.id);
  }

  // ── Step 4: Load existing SF booking IDs to skip duplicates ───────────────
  const { data: existingBookings } = await supabase
    .from("bookings")
    .select("external_booking_id")
    .eq("company_id", company.id)
    .like("external_booking_id", "sf-%"); // only SF-sourced bookings

  const existingIds = new Set(
    (existingBookings || [])
      .map((b: { external_booking_id: string | null }) => b.external_booking_id)
      .filter(Boolean)
  );

  // ── Step 5: Fetch bookings from Salesforce ─────────────────────────────────
  let sfBookings: SFOpportunity[];
  try {
    sfBookings = await fetchTBTBookings(sfAuth, 2, 2);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";

    if (message.includes("INVALID_FIELD") || message.includes("No such column")) {
      return NextResponse.json(
        {
          success: false,
          error: `A field name in our query doesn't exist in this Salesforce org: ${message}`,
          hint:
            "Run POST /api/salesforce/discover?company=tbt to see all available field names. " +
            "Then update the field names in src/lib/salesforce/index.ts to match.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: false, error: `Failed to fetch Salesforce data: ${message}` },
      { status: 500 }
    );
  }

  // ── Step 6: Map SF Opportunities → our booking records ────────────────────
  const toInsert: Record<string, unknown>[] = [];
  let skippedCount = 0;
  const unmatched: string[] = [];

  for (const opp of sfBookings) {
    const externalBookingId = `sf-${opp.Id}`;

    // Skip if already in DB
    if (existingIds.has(externalBookingId)) {
      skippedCount++;
      continue;
    }

    // Get the tour name from this Opportunity
    const tourName = extractTourName(opp);
    if (!tourName) {
      unmatched.push(opp.Name || opp.Id);
      continue;
    }

    // Match to a trip in our DB
    const tourNameLower = tourName.toLowerCase().trim();
    const departureYear = (opp.Departure_Date__c || "").slice(0, 4);

    let tripId: string | null = null;

    // Strategy 1: Exact name + year
    if (departureYear) {
      tripId = tripByNameAndYear.get(`${tourNameLower}|${departureYear}`) || null;
    }

    // Strategy 2: Exact name only
    if (!tripId) {
      tripId = tripByName.get(tourNameLower) || null;
    }

    // Strategy 3: Fuzzy match — strip year prefix and trailing month/day
    // "2026 Trans Dolomites Jun 06" → "trans dolomites"
    if (!tripId) {
      const coreSFName = tourNameLower
        .replace(/^20\d\d\s+/, "")  // strip leading year
        .replace(/\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d*$/i, "")
        .trim();

      for (const [name, id] of tripByName) {
        const coreDBName = name
          .replace(/^20\d\d\s+/, "")
          .replace(/\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d*$/i, "")
          .trim();

        if (
          coreDBName.length > 4 && // avoid matching very short fragments
          (coreDBName === coreSFName ||
            coreDBName.includes(coreSFName) ||
            coreSFName.includes(coreDBName))
        ) {
          tripId = id;
          break;
        }
      }
    }

    if (!tripId) {
      if (!unmatched.includes(tourName)) unmatched.push(tourName);
      continue; // Can't insert without a valid trip_id (FK constraint)
    }

    // Build the booking record — only columns that exist in our schema
    const guestCount = typeof opp.Pax__c === "number" ? Math.max(1, Math.round(opp.Pax__c)) : 1;
    const clientName = opp.Lead_Group_Member_Name__c || opp.Account?.Name || null;
    const status = mapSFStatus(opp);
    const bookingDate = opp.Booking_Date__c || null;
    const pricePaid = typeof opp.Amount === "number" ? opp.Amount : null;

    // Build a readable notes string with SF record details
    const sfRef = opp.Name?.match(/RF-\d+/)?.[0] || opp.Id.slice(-8);
    const noteParts = [
      `SF: ${opp.Booking_Status__c || opp.StageName || "Booked"}`,
      sfRef ? `Ref: ${sfRef}` : null,
      opp.Tour_Type__c ? `Type: ${opp.Tour_Type__c}` : null,
    ].filter(Boolean);

    toInsert.push({
      company_id: company.id,
      trip_id: tripId,
      trip_name: tourName,
      external_booking_id: externalBookingId,
      guest_count: guestCount,
      price_paid_usd: pricePaid,
      booking_date: bookingDate ? new Date(bookingDate).toISOString() : null,
      status,
      client_name: clientName,
      client_email: null, // SF Opportunity doesn't expose email directly
      is_private: (opp.Tour_Type__c || "").toLowerCase().includes("private"),
      notes: noteParts.join(" · "),
      // booking_source will default to 'excel' unless migration_002 has been run
      // to add that column — we set it conditionally below
    });
  }

  // ── Step 7: Insert new bookings in batches of 500 ─────────────────────────
  // Try adding booking_source. If the column doesn't exist yet (migration not run),
  // fall back gracefully without it rather than failing entirely.
  const CHUNK_SIZE = 500;
  let inserted = 0;
  const insertErrors: string[] = [];

  // First, try to insert with booking_source column
  let useBookingSource = true;

  for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
    const chunk = toInsert.slice(i, i + CHUNK_SIZE);

    // Add booking_source if we think it exists
    const chunkWithSource = useBookingSource
      ? chunk.map(r => ({ ...r, booking_source: "salesforce" }))
      : chunk;

    const { error } = await supabase.from("bookings").insert(chunkWithSource);

    if (error) {
      // If failure is because booking_source column doesn't exist, retry without it
      if (
        useBookingSource &&
        (error.message.includes("booking_source") || error.code === "PGRST204")
      ) {
        useBookingSource = false;
        const { error: retryError } = await supabase.from("bookings").insert(chunk);
        if (retryError) {
          insertErrors.push(`Chunk ${Math.floor(i / CHUNK_SIZE) + 1}: ${retryError.message}`);
        } else {
          inserted += chunk.length;
        }
      } else {
        insertErrors.push(`Chunk ${Math.floor(i / CHUNK_SIZE) + 1}: ${error.message}`);
      }
    } else {
      inserted += chunk.length;
    }
  }

  // ── Step 8: Return summary ────────────────────────────────────────────────
  return NextResponse.json({
    success: true,
    summary: {
      sf_records_fetched: sfBookings.length,
      inserted,
      skipped: skippedCount,
      unmatched_tour_names: unmatched,
      insert_errors: insertErrors,
      booking_source_column_active: useBookingSource,
      hint: unmatched.length > 0
        ? `${unmatched.length} Salesforce tour(s) couldn't be matched to a trip in our database. ` +
          "Upload those trips via Data Import, then sync again."
        : undefined,
    },
  });
}
