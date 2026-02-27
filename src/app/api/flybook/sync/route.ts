import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
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
  price_paid_usd: number;
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
        price_paid_usd: res.totalCost,
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
  let body: { company?: string; months_back?: number; months_forward?: number; dry_run?: boolean } = {};
  try {
    body = await req.json();
  } catch { /* use defaults */ }
  const companySlug = body.company ?? "aex";
  const monthsBack = body.months_back ?? 1;
  const monthsForward = body.months_forward ?? 18;
  const dryRun = body.dry_run ?? false;
  const supabase = createServiceClient();
  const { data: company } = await supabase.from("companies").select("id").eq("slug", companySlug).single();
  if (!company) {
    return NextResponse.json({ status: "error", error: `Company not found: ${companySlug}` }, { status: 404 });
  }
  const apiKey = process.env.FLYBOOK_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ status: "error", error: "FLYBOOK_API_KEY not set" }, { status: 500 });
  }
  const tripMap = await buildTripMap(supabase, company.id);
  const { reservations, monthsCovered } = await fetchAllMonths(apiKey, monthsBack, monthsForward);
  const { matched, unmatched } = processReservations(reservations, tripMap, company.id);
  let inserted = 0;
  if (!dryRun && matched.length > 0) {
    const { error } = await supabase.from("bookings").upsert(matched, { onConflict: "external_booking_id" });
    if (error) throw new Error(`Upsert: ${error.message}`);
    inserted = matched.length;
  }
  const durationMs = Date.now() - start;
  const syncStatus = unmatched.length > 0 ? "partial" : "success";
  if (!dryRun) {
    await writeSyncLog(supabase, {
      company_id: company.id,
      reservations_fetched: reservations.length,
      bookings_matched: matched.length,
      bookings_inserted: inserted,
      unmatched_events: unmatched,
      status: syncStatus,
      months_covered: monthsCovered,
      duration_ms: durationMs,
    });
  }
  return NextResponse.json({
    status: syncStatus,
    reservations_fetched: reservations.length,
    bookings_matched: matched.length,
    bookings_inserted: inserted,
    unmatched_events: unmatched,
    months_covered: monthsCovered,
    duration_ms: durationMs,
    dry_run: dryRun,
  });
}
