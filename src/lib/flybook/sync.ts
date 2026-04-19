import { createServiceClient } from "@/lib/supabase/server";
import {
  buildMonthRanges,
  buildExternalBookingId,
  fetchReservationsForMonth,
  parsePaxCount,
  type FlybookReservation,
} from "@/lib/flybook/client";

export interface TripRow {
  id: string;
  name: string;
  flybook_event_id: string;
}

export interface BookingUpsert {
  trip_id: string;
  company_id: string;
  external_booking_id: string;
  guest_count: number;
  price_paid_usd: number | null;
  booking_date: string;
  status: string;
  client_name: string;
  client_email: string | null;
  trip_name: string;
}

export interface UnmatchedEvent {
  eventId: string;
  title: string;
  startTime: string;
  flybookResId: number;
  reason: string;
}

export interface FlybookSyncOptions {
  company?: string;
  monthsBack?: number;
  monthsForward?: number;
  dryRun?: boolean;
}

export interface FlybookSyncResult {
  status: "success" | "partial" | "error";
  error?: string;
  reservations_fetched: number;
  bookings_matched: number;
  bookings_inserted: number;
  unmatched_events: UnmatchedEvent[];
  months_covered: string;
  duration_ms: number;
  dry_run: boolean;
}

async function buildTripMap(
  supabase: ReturnType<typeof createServiceClient>,
  companyId: string
): Promise<Map<string, TripRow>> {
  const { data, error } = await supabase
    .from("trips")
    .select("id, name, flybook_event_id")
    .eq("company_id", companyId)
    .not("flybook_event_id", "is", null);
  if (error) throw new Error(`buildTripMap: ${error.message}`);
  const map = new Map<string, TripRow>();
  for (const trip of data ?? []) map.set(trip.flybook_event_id, trip);
  return map;
}

function processReservations(
  reservations: FlybookReservation[],
  tripMap: Map<string, TripRow>,
  companyId: string
): { matched: BookingUpsert[]; unmatched: UnmatchedEvent[] } {
  const matched: BookingUpsert[] = [];
  const unmatched: UnmatchedEvent[] = [];
  for (const res of reservations) {
    for (const event of res.events) {
      const trip = tripMap.get(event.typeAgnosticEventId);
      if (!trip) {
        unmatched.push({
          eventId: event.typeAgnosticEventId,
          title: event.title,
          startTime: event.startTime,
          flybookResId: res.flybookResId,
          reason: "no_flybook_event_id_match",
        });
        continue;
      }
      matched.push({
        trip_id: trip.id,
        company_id: companyId,
        external_booking_id: buildExternalBookingId(res.flybookResId, event.startTime),
        guest_count: parsePaxCount(event.quantityDescription),
        price_paid_usd: (event.eventCost != null && event.eventCost !== 0) ? event.eventCost : null,
        booking_date: res.dateCreated,
        status: "confirmed",
        client_name: res.resName,
        client_email: res.customers?.[0]?.email ?? null,
        trip_name: trip.name,
      });
    }
  }
  return { matched, unmatched };
}

async function fetchAllMonths(
  apiKey: string,
  monthsBack: number,
  monthsForward: number
): Promise<{ reservations: FlybookReservation[]; monthsCovered: string }> {
  const now = new Date();
  const s = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  const e = new Date(now.getFullYear(), now.getMonth() + monthsForward, 1);
  const ranges = buildMonthRanges(s.getFullYear(), s.getMonth() + 1, e.getFullYear(), e.getMonth() + 1);
  const all: FlybookReservation[] = [];
  for (const r of ranges) {
    all.push(...(await fetchReservationsForMonth(apiKey, r.start, r.end)));
  }
  return { reservations: all, monthsCovered: ranges.map((r) => r.label).join(", ") };
}

async function writeSyncLog(
  supabase: ReturnType<typeof createServiceClient>,
  log: {
    company_id: string;
    reservations_fetched: number;
    bookings_matched: number;
    bookings_inserted: number;
    unmatched_events: UnmatchedEvent[];
    status: string;
    months_covered: string;
    duration_ms: number;
  }
): Promise<void> {
  await supabase.from("sync_log").insert({
    company_id: log.company_id,
    run_at: new Date().toISOString(),
    reservations_fetched: log.reservations_fetched,
    bookings_matched: log.bookings_matched,
    bookings_inserted: log.bookings_inserted,
    unmatched_events: log.unmatched_events,
    status: log.status,
    months_covered: log.months_covered,
    duration_ms: log.duration_ms,
  });
}

export interface LatestSyncStatus {
  runAt: string | null;
  status: string | null;
  reservationsFetched: number | null;
  bookingsMatched: number | null;
  bookingsInserted: number | null;
  unmatchedCount: number | null;
  error?: string;
}

/**
 * Fetch the most recent sync_log entry for a company. Returns null on any failure
 * (callers should treat null as "no banner"). Does not throw.
 */
export async function getLatestSyncStatus(companySlug: string): Promise<LatestSyncStatus | null> {
  try {
    const supabase = createServiceClient();
    const { data: company } = await supabase
      .from("companies")
      .select("id")
      .eq("slug", companySlug)
      .single();
    if (!company) return null;

    const { data: log } = await supabase
      .from("sync_log")
      .select("run_at, status, reservations_fetched, bookings_matched, bookings_inserted, unmatched_events")
      .eq("company_id", company.id)
      .order("run_at", { ascending: false })
      .limit(1)
      .single();
    if (!log) return null;

    return {
      runAt: log.run_at,
      status: log.status,
      reservationsFetched: log.reservations_fetched,
      bookingsMatched: log.bookings_matched,
      bookingsInserted: log.bookings_inserted,
      unmatchedCount: Array.isArray(log.unmatched_events) ? log.unmatched_events.length : 0,
    };
  } catch (err) {
    return { runAt: null, status: null, reservationsFetched: null, bookingsMatched: null, bookingsInserted: null, unmatchedCount: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Core Flybook sync. Fetches reservations, matches to trips, upserts bookings,
 * and writes to sync_log (unless dryRun). Throws on fatal errors (missing env, DB failure).
 */
export async function runFlybookSync(opts: FlybookSyncOptions = {}): Promise<FlybookSyncResult> {
  const start = Date.now();
  const company = opts.company ?? "aex";
  const monthsBack = opts.monthsBack ?? 24;
  const monthsForward = opts.monthsForward ?? 18;
  const dryRun = opts.dryRun ?? false;

  const supabase = createServiceClient();
  const { data: companyRow } = await supabase.from("companies").select("id").eq("slug", company).single();
  if (!companyRow) {
    throw new Error(`Company not found: ${company}`);
  }

  const apiKey = process.env.FLYBOOK_API_KEY;
  if (!apiKey) {
    throw new Error("FLYBOOK_API_KEY not set");
  }

  const tripMap = await buildTripMap(supabase, companyRow.id);
  const { reservations, monthsCovered } = await fetchAllMonths(apiKey, monthsBack, monthsForward);
  const { matched, unmatched } = processReservations(reservations, tripMap, companyRow.id);

  let inserted = 0;
  if (!dryRun && matched.length > 0) {
    const { error } = await supabase.from("bookings").upsert(matched, { onConflict: "external_booking_id" });
    if (error) throw new Error(`Upsert: ${error.message}`);
    inserted = matched.length;
  }

  const durationMs = Date.now() - start;
  const syncStatus: "success" | "partial" = unmatched.length > 0 ? "partial" : "success";

  if (!dryRun) {
    await writeSyncLog(supabase, {
      company_id: companyRow.id,
      reservations_fetched: reservations.length,
      bookings_matched: matched.length,
      bookings_inserted: inserted,
      unmatched_events: unmatched,
      status: syncStatus,
      months_covered: monthsCovered,
      duration_ms: durationMs,
    });
  }

  return {
    status: syncStatus,
    reservations_fetched: reservations.length,
    bookings_matched: matched.length,
    bookings_inserted: inserted,
    unmatched_events: unmatched,
    months_covered: monthsCovered,
    duration_ms: durationMs,
    dry_run: dryRun,
  };
}
