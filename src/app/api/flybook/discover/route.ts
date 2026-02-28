/**
 * POST /api/flybook/discover
 *
 * Discovers Flybook event IDs for unmapped trips by fetching the full
 * Flybook reservation history and matching typeAgnosticEventId to trips
 * by departure date + name similarity.
 *
 * Safety guarantees:
 * - Never overwrites an existing flybook_event_id (uses .is("flybook_event_id", null))
 * - Never assigns the same flybook_event_id to two different trips (dedup check)
 * - dry_run: true returns what WOULD be mapped without writing anything
 *
 * Body: { company?: string, months_back?: number, months_forward?: number, dry_run?: boolean }
 */
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { buildMonthRanges, fetchReservationsForMonth } from "@/lib/flybook/client";
interface UnmappedTrip {
  id: string;
  name: string;
  departure_date: string;
}
interface MappedTrip {
  trip_id: string;
  trip_name: string;
  departure_date: string;
  flybook_event_id: string;
  flybook_title: string;
}
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const queryCompany = searchParams.get("company");
  let body: {
    company?: string;
    months_back?: number;
    months_forward?: number;
    dry_run?: boolean;
  } = {};
  try { body = await req.json(); } catch { /* no body is fine */ }
  const company = queryCompany || body.company || "aex";
  const months_back = body.months_back ?? 24;
  const months_forward = body.months_forward ?? 24;
  const dry_run = body.dry_run ?? false;
  const apiKey = process.env.FLYBOOK_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "FLYBOOK_API_KEY not set" }, { status: 500 });
  }
  const supabase = createServiceClient();
  const { data: companyRow } = await supabase
    .from("companies")
    .select("id")
    .eq("slug", company)
    .single();
  if (!companyRow) {
    return NextResponse.json({ error: `Company not found: ${company}` }, { status: 404 });
  }
  // Load all unmapped trips
  const { data: unmappedTrips, error: tripsError } = await supabase
    .from("trips")
    .select("id, name, departure_date")
    .eq("company_id", companyRow.id)
    .is("flybook_event_id", null);
  if (tripsError) {
    return NextResponse.json({ error: tripsError.message }, { status: 500 });
  }
  if (!unmappedTrips?.length) {
    return NextResponse.json({
      message: "All trips already have flybook_event_id mapped",
      mapped: [],
      unresolved: [],
    });
  }
  console.log(`[discover] ${unmappedTrips.length} unmapped trips for ${company}`);
  // Build lookup: "YYYY-MM-DD" → UnmappedTrip[]
  const tripsByDate = new Map<string, UnmappedTrip[]>();
  for (const trip of unmappedTrips) {
    const date = trip.departure_date?.slice(0, 10);
    if (!date) continue;
    if (!tripsByDate.has(date)) tripsByDate.set(date, []);
    tripsByDate.get(date)!.push(trip);
  }
  // Fetch all reservations across the date range
  const now = new Date();
  const s = new Date(now.getFullYear(), now.getMonth() - months_back, 1);
  const e = new Date(now.getFullYear(), now.getMonth() + months_forward, 1);
  const ranges = buildMonthRanges(
    s.getFullYear(), s.getMonth() + 1,
    e.getFullYear(), e.getMonth() + 1
  );
  // Build event index: eventId → { title, startDate }
  const eventIndex = new Map<string, { title: string; startDate: string }>();
  for (const range of ranges) {
    try {
      const reservations = await fetchReservationsForMonth(apiKey, range.start, range.end);
      for (const res of reservations) {
        for (const event of res.events || []) {
          if (!event.typeAgnosticEventId) continue;
          if (!eventIndex.has(event.typeAgnosticEventId)) {
            eventIndex.set(event.typeAgnosticEventId, {
              title: event.title ?? "",
              startDate: event.startTime?.slice(0, 10) ?? "",
            });
          }
        }
      }
    } catch (err) {
      console.warn(`[discover] Failed to fetch ${range.label}:`, err);
    }
  }
  console.log(`[discover] ${eventIndex.size} unique Flybook event IDs discovered`);
  // Match each Flybook event to an unmapped trip
  const mapped: MappedTrip[] = [];
  const usedTripIds = new Set<string>();      // prevent one trip getting two event IDs
  const usedEventIds = new Set<string>();     // prevent two trips getting the same event ID
  for (const [eventId, { title, startDate }] of Array.from(eventIndex.entries())) {
    const candidates = tripsByDate.get(startDate) ?? [];
    for (const trip of candidates) {
      if (usedTripIds.has(trip.id)) continue;
      const flybookTitle = normalizeTitle(title);
      const tripCore = normalizeTitle(stripDateSuffix(trip.name));
      if (!isNameMatch(flybookTitle, tripCore)) continue;
      // SAFETY: if this eventId already matched a different trip, mark both as
      // ambiguous — do not assign to either. Better to leave unresolved than wrong.
      if (usedEventIds.has(eventId)) {
        // Find and remove the previous match for this eventId
        const conflictIndex = mapped.findIndex(m => m.flybook_event_id === eventId);
        if (conflictIndex !== -1) {
          console.warn(
            `[discover] Ambiguous: event ${eventId} matched both "${mapped[conflictIndex].trip_name}" and "${trip.name}" — skipping both`
          );
          usedTripIds.delete(mapped[conflictIndex].trip_id);
          mapped.splice(conflictIndex, 1);
        }
        // Don't add this trip either — leave both unresolved
        break;
      }
      mapped.push({
        trip_id: trip.id,
        trip_name: trip.name,
        departure_date: trip.departure_date,
        flybook_event_id: eventId,
        flybook_title: title,
      });
      usedTripIds.add(trip.id);
      usedEventIds.add(eventId);
      break;
    }
  }
  // Write to database
  if (!dry_run && mapped.length > 0) {
    for (const m of mapped) {
      const { error } = await supabase
        .from("trips")
        .update({ flybook_event_id: m.flybook_event_id })
        .eq("id", m.trip_id)
        .is("flybook_event_id", null); // Never overwrite existing mappings
      if (error) {
        console.error(`[discover] Failed to write ${m.trip_id}:`, error.message);
      }
    }
    console.log(`[discover] Wrote ${mapped.length} event ID mappings`);
  }
  const mappedTripIds = new Set(mapped.map(m => m.trip_id));
  const unresolved = (unmappedTrips as UnmappedTrip[])
    .filter(t => !mappedTripIds.has(t.id))
    .map(t => ({ trip_name: t.name, departure_date: t.departure_date }));
  return NextResponse.json({
    dry_run,
    mapped: mapped.map(m => ({
      trip_name: m.trip_name,
      departure_date: m.departure_date,
      flybook_event_id: m.flybook_event_id,
      flybook_title: m.flybook_title,
    })),
    unresolved,
    summary: `${mapped.length} trips mapped, ${unresolved.length} still unresolved`,
  });
}
// ── Helpers ───────────────────────────────────────────────────────────────────
function stripDateSuffix(name: string): string {
  return name
    .replace(/\s*-\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2}\s+20\d{2}\s*$/i, "")
    .trim();
}
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[™®]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function isNameMatch(flybookTitle: string, tripCore: string): boolean {
  // Exact containment match
  if (flybookTitle.includes(tripCore)) return true;
  if (tripCore.includes(flybookTitle)) return true;
  // Significant word overlap — must share at least 2 meaningful words of 4+ chars
  // Exclude words that appear in almost every trip name (would cause false positives)
  const stopWords = new Set([
    "rapid", "ascent", "expedition", "extension", "climbing", "school",
    "from", "with", "and", "the", "for",
  ]);
  const wordsA = new Set(
    flybookTitle.split(/\s+/).filter(w => w.length >= 4 && !stopWords.has(w))
  );
  const wordsB = tripCore.split(/\s+/).filter(w => w.length >= 4 && !stopWords.has(w));
  const shared = wordsB.filter(w => wordsA.has(w));
  // Require at least 2 shared significant words AND they must represent
  // at least half the words in the shorter string (prevents "Ecuador" alone matching)
  const minWords = Math.min(wordsA.size, wordsB.length);
  return shared.length >= 2 && shared.length >= Math.ceil(minWords * 0.5);
}
