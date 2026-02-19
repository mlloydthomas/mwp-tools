// GET /api/pricing/trips?company=tbt
// Returns all open trips with booking counts and velocity status

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { differenceInDays, parseISO } from "date-fns";

// Expected fill rate by days out (derived from historical AEX data)
// Format: [daysOut, expectedFillPct]
const VELOCITY_BENCHMARKS: Record<string, [number, number][]> = {
  // International/expedition trips book 90-180 days out
  everest:       [[365, 0.20], [270, 0.50], [180, 0.80], [90, 0.95]],
  "8000m":       [[365, 0.20], [270, 0.50], [180, 0.80], [90, 0.95]],
  intermediate:  [[270, 0.15], [180, 0.50], [90, 0.75], [45, 0.90]],
  advanced:      [[270, 0.15], [180, 0.50], [90, 0.75], [45, 0.90]],
  beginner_trek: [[270, 0.10], [180, 0.40], [90, 0.70], [45, 0.90]],
  ski:           [[270, 0.10], [180, 0.40], [90, 0.70], [45, 0.90]],
  // TBT trips
  tdf:           [[365, 0.40], [270, 0.70], [180, 0.90], [90, 0.98]],
  tdf_spectator: [[365, 0.30], [270, 0.60], [180, 0.85], [90, 0.95]],
  signature:     [[270, 0.20], [180, 0.50], [90, 0.75], [60, 0.90]],
  race_trip:     [[270, 0.20], [180, 0.50], [90, 0.75], [60, 0.90]],
  training_camp: [[180, 0.30], [120, 0.60], [60, 0.85], [30, 0.95]],
  gravel:        [[180, 0.20], [120, 0.50], [60, 0.80], [30, 0.95]],
  private:       [[180, 0.50], [90, 0.80], [60, 0.95], [30, 1.00]],
};

function getVelocityStatus(
  tripType: string,
  capacityPct: number,
  daysOut: number
): "ahead" | "on_pace" | "behind" | "critical" {
  const benchmarks = VELOCITY_BENCHMARKS[tripType] || VELOCITY_BENCHMARKS["signature"];
  
  // Find the most relevant benchmark
  let expected = 0.5;
  for (const [days, pct] of benchmarks) {
    if (daysOut <= days) expected = pct;
  }

  const ratio = capacityPct / expected;
  if (daysOut < 45 && capacityPct < 0.30) return "critical";
  if (ratio >= 1.15) return "ahead";
  if (ratio >= 0.85) return "on_pace";
  if (ratio >= 0.50) return "behind";
  return "critical";
}

export async function GET(req: NextRequest) {
  const supabase = createServiceClient();
  const { searchParams } = new URL(req.url);
  const companySlug = searchParams.get("company");

  if (!companySlug) {
    return NextResponse.json({ success: false, error: "company required" }, { status: 400 });
  }

  const { data: company } = await supabase
    .from("companies").select("id").eq("slug", companySlug).single();

  if (!company) {
    return NextResponse.json({ success: false, error: "Company not found" }, { status: 404 });
  }

  const today = new Date().toISOString().split("T")[0];

  // Get all open upcoming trips
  const { data: trips, error } = await supabase
    .from("trips")
    .select("id, name, trip_type, departure_date, capacity_max, current_price_usd, region, is_tdf")
    .eq("company_id", company.id)
    .eq("status", "open")
    .gte("departure_date", today.substring(0, 4) + "-01-01")  // show all trips in current year
    .order("departure_date", { ascending: true });

  if (error || !trips) {
    return NextResponse.json({ success: false, error: error?.message }, { status: 500 });
  }

  // Get booking counts for all trips in one query
  const tripIds = trips.map(t => t.id);
  const { data: bookings } = await supabase
    .from("bookings")
    .select("trip_id, guest_count")
    .in("trip_id", tripIds)
    .eq("status", "confirmed");

  const bookingMap: Record<string, number> = {};
  bookings?.forEach(b => {
    bookingMap[b.trip_id] = (bookingMap[b.trip_id] || 0) + (b.guest_count || 1);
  });

  const tripsWithVelocity = trips.map(trip => {
    const bookingsCount = bookingMap[trip.id] || 0;
    const capacityPct = trip.capacity_max > 0 ? bookingsCount / trip.capacity_max : 0;
    const daysOut = differenceInDays(parseISO(trip.departure_date), new Date());
    const velocityStatus = getVelocityStatus(trip.trip_type, capacityPct, daysOut);

    return { ...trip, bookings_count: bookingsCount, capacity_pct: capacityPct, days_out: daysOut, velocity_status: velocityStatus };
  });

  return NextResponse.json({ success: true, data: tripsWithVelocity });
}
