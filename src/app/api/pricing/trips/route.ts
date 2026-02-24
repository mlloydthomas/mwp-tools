// GET /api/pricing/trips?company=tbt
// Returns open trips with booking counts, velocity status, and derived capacity

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { differenceInDays, parseISO } from "date-fns";

const EXCLUDED_TYPES = ["local", "via", "rental", "rental_other"];

// Derive correct min/max capacity from trip_type since DB defaults are often wrong
function deriveCapacity(
  tripType: string,
  companySlug: string,
  dbMin: number,
  dbMax: number
): { capacity_min: number; capacity_max: number } {
  if (companySlug === "aex") {
    if (tripType === "8000m" || tripType === "everest") {
      return { capacity_min: 4, capacity_max: 8 };
    }
    // All other AEX trips: min 4, max 12 (use DB max if lower)
    return { capacity_min: 4, capacity_max: dbMax > 0 && dbMax <= 12 ? dbMax : 12 };
  }
  if (companySlug === "tbt") {
    if (tripType === "private") {
      return { capacity_min: 1, capacity_max: dbMax > 0 ? dbMax : 12 };
    }
    // Open enrollment TBT: min 6 (cancellation threshold), no hard ceiling
    return { capacity_min: 6, capacity_max: dbMax > 0 ? dbMax : 40 };
  }
  return { capacity_min: dbMin || 1, capacity_max: dbMax || 12 };
}

// Expected cumulative fill rate [daysBeforeDeparture, expectedFillPct]
// AEX books heavily 90-180 days out; TBT (especially TDF) books 270-365 days out
const VELOCITY_BENCHMARKS: Record<string, [number, number][]> = {
  // AEX expedition segments
  everest:               [[270, 0.05], [180, 0.25], [90, 0.70], [45, 0.90]],
  "8000m":               [[270, 0.05], [180, 0.25], [90, 0.70], [45, 0.90]],
  advanced:              [[270, 0.05], [180, 0.30], [90, 0.70], [45, 0.90]],
  intermediate:          [[270, 0.05], [180, 0.30], [90, 0.70], [45, 0.90]],
  beginner_trek:         [[270, 0.05], [180, 0.30], [90, 0.70], [45, 0.90]],
  ski:                   [[270, 0.05], [180, 0.30], [90, 0.70], [45, 0.90]],
  private_international: [[180, 0.40], [90, 0.80], [60, 1.00]],
  // TBT segments
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
  // For trips further out than any benchmark, use the first (earliest) benchmark value
  let expected = benchmarks[0][1];
  for (const [days, pct] of benchmarks) {
    if (daysOut <= days) expected = pct;
  }
  const ratio = capacityPct / Math.max(expected, 0.01);
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

  const currentYear = new Date().getFullYear();

  const { data: trips, error } = await supabase
    .from("trips")
    .select("id, name, trip_type, departure_date, capacity_min, capacity_max, current_price_usd, region, is_tdf")
    .eq("company_id", company.id)
    .eq("status", "open")
    .gte("departure_date", `${currentYear}-01-01`)
    .order("departure_date", { ascending: true });  // sorted by date, page does not re-sort

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  if (!trips || trips.length === 0) {
    return NextResponse.json({ success: true, data: [] });
  }

  // Filter excluded types in JS (avoids Supabase .not/in syntax issues)
  const filteredTrips = trips.filter(t => !EXCLUDED_TYPES.includes(t.trip_type));

  if (filteredTrips.length === 0) {
    return NextResponse.json({ success: true, data: [] });
  }

  const tripIds = filteredTrips.map(t => t.id);

  const { data: bookings } = await supabase
    .from("bookings")
    .select("trip_id, guest_count")
    .in("trip_id", tripIds)
    .eq("status", "confirmed");

  const bookingMap: Record<string, number> = {};
  bookings?.forEach(b => {
    bookingMap[b.trip_id] = (bookingMap[b.trip_id] || 0) + (b.guest_count || 1);
  });

  const tripsWithVelocity = filteredTrips.map(trip => {
    const { capacity_min, capacity_max } = deriveCapacity(
      trip.trip_type, companySlug, trip.capacity_min || 1, trip.capacity_max || 12
    );
    const bookingsCount = bookingMap[trip.id] || 0;
    const capacityPct = capacity_max > 0 ? bookingsCount / capacity_max : 0;
    const daysOut = differenceInDays(parseISO(trip.departure_date), new Date());
    const velocityStatus = getVelocityStatus(trip.trip_type, capacityPct, daysOut);

    return {
      ...trip,
      capacity_min,
      capacity_max,
      bookings_count: bookingsCount,
      capacity_pct: capacityPct,
      days_out: daysOut,
      velocity_status: velocityStatus,
    };
  });

  return NextResponse.json({ success: true, data: tripsWithVelocity });
}
