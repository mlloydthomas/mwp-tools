import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  buildMonthRanges,
  buildExternalBookingId,
  fetchReservationsForMonth,
  parsePaxCount,
  type FlybookReservation,
} from "@/lib/flybook/client";

interface TripRow {
  id: string;
  name: string;
  flybook_event_id: string;
}

interface BookingUpsert {
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

interface UnmatchedEvent {
  eventId: string;
  title: string;
  startTime: string;
  flybookResId: number;
  reason: string;
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

export async function POST(req: NextRequest) {
  const start = Date.now();
  // Support both query param (?company=aex) and JSON body ({ company: "aex" })
  const { searchParams } = new URL(req.url);
  const queryCompany = searchParams.get("company");
  let body: { company?: string; months_back?: number; months_forward?: number; dry_run?: boolean } = {};
  try { body = await req.json(); } catch { /* no body is fine */ }
  const company = queryCompany || body.company || "aex";
  const months_back = body.months_back ?? 24;
  const months_forward = body.months_forward ?? 18;
  const dry_run = body.dry_run ?? false;
  const supabase = createServiceClient();
  const { data: companyRow } = await supabase.from("companies").select("id").eq("slug", company).single();
  if (!companyRow) {
    return NextResponse.json({ status: "error", error: `Company not found: ${company}` }, { status: 404 });
  }
  const apiKey = process.env.FLYBOOK_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ status: "error", error: "FLYBOOK_API_KEY not set" }, { status: 500 });
  }
  const tripMap = await buildTripMap(supabase, companyRow.id);
  const { reservations, monthsCovered } = await fetchAllMonths(apiKey, months_back, months_forward);
  const { matched, unmatched } = processReservations(reservations, tripMap, companyRow.id);
  let inserted = 0;
  if (!dry_run && matched.length > 0) {
    const { error } = await supabase.from("bookings").upsert(matched, { onConflict: "external_booking_id" });
    if (error) throw new Error(`Upsert: ${error.message}`);
    inserted = matched.length;
  }
  const durationMs = Date.now() - start;
  const syncStatus = unmatched.length > 0 ? "partial" : "success";
  if (!dry_run) {
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
  const result = {
    status: syncStatus,
    reservations_fetched: reservations.length,
    bookings_matched: matched.length,
    bookings_inserted: inserted,
    unmatched_events: unmatched,
    months_covered: monthsCovered,
    duration_ms: durationMs,
    dry_run: dry_run,
  };
  return NextResponse.json({
    // New format (for SyncStatus component and direct API calls)
    ...result,
    // Legacy format (for pricing page sync button)
    success: result.status !== "error",
    summary: {
      inserted: result.bookings_inserted,
      skipped: result.reservations_fetched - result.bookings_matched,
      unmatched_trip_titles: result.unmatched_events.map((e: { title: string }) => e.title),
    },
  });
}
