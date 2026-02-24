// POST /api/pricing/run?company=tbt
// Manually trigger pricing analysis for a company

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { analyzeTripPricing } from "@/lib/anthropic";
import { differenceInDays, parseISO } from "date-fns";

const EXCLUDED_TYPES = ["local", "via", "rental", "rental_other"];
const MAX_CLAUDE_CALLS = 20;

// Derive correct min/max capacity from trip_type — mirrors logic in trips/route.ts
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
    return { capacity_min: 4, capacity_max: dbMax > 0 && dbMax <= 12 ? dbMax : 12 };
  }
  if (companySlug === "tbt") {
    if (tripType === "private") {
      return { capacity_min: 1, capacity_max: dbMax > 0 ? dbMax : 12 };
    }
    return { capacity_min: 6, capacity_max: dbMax > 0 ? dbMax : 40 };
  }
  return { capacity_min: dbMin || 1, capacity_max: dbMax || 12 };
}

// TBT guide ratio context for the AI prompt
// 8:1 client-to-guide ratio; optimal at multiples of 8
function buildGuideRatioNote(bookings: number, tripType: string): string {
  if (tripType === "private" || bookings <= 0) return "";

  const guides = Math.ceil(bookings / 8);
  const optimal = guides * 8;
  const prevOptimal = (guides - 1) * 8;
  const inflection = bookings - prevOptimal; // 1 or 2 = just crossed a guide threshold
  const slack = optimal - bookings;

  if (slack === 0) {
    return `Guide ratio: ${guides} guide${guides !== 1 ? "s" : ""} for ${bookings} guests — at optimal capacity.`;
  }
  if (inflection === 1 || inflection === 2) {
    return (
      `MARGIN ALERT: ${bookings} guests requires ${guides} guides (same staff cost as ${prevOptimal}). ` +
      `Fill ${slack} more spots to reach ${optimal} guests and significantly improve margin.`
    );
  }
  if (slack <= 3) {
    return `Margin tip: ${slack} more guest${slack !== 1 ? "s" : ""} reaches next guide-optimum (${optimal} guests/${guides} guides).`;
  }
  return `Guide ratio: ${guides} guide${guides !== 1 ? "s" : ""} for ${bookings} guests (next optimum: ${optimal}).`;
}

export async function POST(req: NextRequest) {
  const supabase = createServiceClient();
  const { searchParams } = new URL(req.url);
  const companySlug = searchParams.get("company");

  if (!companySlug) {
    return NextResponse.json({ success: false, error: "company required" }, { status: 400 });
  }

  const { data: company } = await supabase
    .from("companies").select("id, name").eq("slug", companySlug).single();

  if (!company) {
    return NextResponse.json({ success: false, error: "Company not found" }, { status: 404 });
  }

  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const currentYear = today.getFullYear();
  let processed = 0;
  let recommendations = 0;

  const { data: allTrips, error } = await supabase
    .from("trips")
    .select("*")
    .eq("company_id", company.id)
    .eq("status", "open")
    .gte("departure_date", `${currentYear}-01-01`)
    .order("departure_date", { ascending: true });

  if (error || !allTrips?.length) {
    return NextResponse.json({
      success: true, trips_analyzed: 0, recommendations_created: 0, message: "No open trips found",
    });
  }

  const trips = allTrips.filter(t => !EXCLUDED_TYPES.includes(t.trip_type));

  if (!trips.length) {
    return NextResponse.json({
      success: true, trips_analyzed: 0, recommendations_created: 0, message: "No qualifying trips found",
    });
  }

  const tripIds = trips.map(t => t.id);

  const [bookingsRes, waitlistRes, existingRecsRes, competitorsRes] = await Promise.all([
    supabase.from("bookings").select("trip_id, guest_count").in("trip_id", tripIds).eq("status", "confirmed"),
    supabase.from("bookings").select("trip_id, guest_count").in("trip_id", tripIds).eq("status", "waitlist"),
    supabase.from("ai_recommendations").select("trip_id").in("trip_id", tripIds).eq("status", "pending").eq("tool", "pricing"),
    supabase.from("competitor_products").select("*").eq("company_id", company.id).eq("is_active", true).not("last_price_usd", "is", null),
  ]);

  const bookingMap: Record<string, number> = {};
  bookingsRes.data?.forEach(b => {
    bookingMap[b.trip_id] = (bookingMap[b.trip_id] || 0) + (b.guest_count || 1);
  });

  const waitlistMap: Record<string, number> = {};
  waitlistRes.data?.forEach(w => {
    waitlistMap[w.trip_id] = (waitlistMap[w.trip_id] || 0) + (w.guest_count || 1);
  });

  const existingTripIds = new Set((existingRecsRes.data || []).map(r => r.trip_id));
  const competitors = competitorsRes.data || [];

  let claudeCalls = 0;

  for (const trip of trips) {
    try {
      if (!trip.current_price_usd || trip.current_price_usd <= 0) { processed++; continue; }
      if (existingTripIds.has(trip.id)) { processed++; continue; }

      const { capacity_min, capacity_max } = deriveCapacity(
        trip.trip_type, companySlug, trip.capacity_min || 1, trip.capacity_max || 12
      );

      const bookingsCount = bookingMap[trip.id] || 0;
      const waitlistCount = waitlistMap[trip.id] || 0;
      const capacityPct = bookingsCount / capacity_max;
      const daysUntilDeparture = differenceInDays(parseISO(trip.departure_date), today);

      // Determine if this trip warrants AI analysis
      const isTBT = companySlug === "tbt";
      const isPrivate = trip.trip_type === "private" || trip.trip_type === "private_international";

      // TBT: flag cancellation risk (below min with <6 weeks to go)
      const cancellationRisk = isTBT && !isPrivate && bookingsCount < capacity_min && daysUntilDeparture < 42;

      const shouldAnalyze =
        cancellationRisk ||
        waitlistCount > 0 ||
        capacityPct >= 0.60 ||
        (capacityPct < 0.30 && daysUntilDeparture < 60) ||
        (capacityPct < 0.50 && daysUntilDeparture < 180) ||
        (capacityPct < 0.40 && daysUntilDeparture < 270);

      if (!shouldAnalyze) { processed++; continue; }
      if (claudeCalls >= MAX_CLAUDE_CALLS) { processed++; continue; }

      const relevantCompetitors = competitors.filter(c =>
        c.trip_type === trip.trip_type || c.region === trip.region
      );
      const competitorPrices = relevantCompetitors.length
        ? relevantCompetitors.map(c =>
            `${c.competitor_name} (${c.product_name || "similar"}): $${c.last_price_usd?.toLocaleString()}`
          ).join("; ")
        : undefined;

      const guideRatioNote = isTBT && !isPrivate
        ? buildGuideRatioNote(bookingsCount, trip.trip_type)
        : undefined;

      await supabase.from("booking_snapshots").upsert({
        trip_id: trip.id,
        snapshot_date: todayStr,
        bookings_count: bookingsCount,
        waitlist_count: waitlistCount,
        capacity_pct: capacityPct,
        current_price_usd: trip.current_price_usd,
      }, { onConflict: "trip_id,snapshot_date" });

      claudeCalls++;

      const analysis = await analyzeTripPricing({
        trip_name: trip.name,
        trip_type: trip.trip_type,
        departure_date: trip.departure_date,
        days_until_departure: daysUntilDeparture,
        current_price_usd: trip.current_price_usd,
        cost_basis_usd: trip.cost_basis_usd || trip.current_price_usd * 0.6,
        target_margin: trip.target_gross_margin || 0.4,
        capacity_max,
        capacity_min,
        bookings_count: bookingsCount,
        capacity_pct: capacityPct,
        waitlist_count: waitlistCount,
        company_slug: companySlug,
        guide_ratio_note: guideRatioNote,
        competitor_prices: competitorPrices,
      });

      if (analysis.should_change) {
        recommendations++;
        const direction = analysis.price_change_pct > 0 ? "↑" : "↓";
        const pct = Math.abs(analysis.price_change_pct * 100).toFixed(0);
        const word = analysis.price_change_pct > 0 ? "increase" : "reduction";
        await supabase.from("ai_recommendations").insert({
          company_id: company.id,
          tool: "pricing",
          status: "pending",
          priority: analysis.urgency,
          trip_id: trip.id,
          current_price_usd: trip.current_price_usd,
          recommended_price_usd: analysis.recommended_price_usd,
          title: `${trip.name}: ${direction} ${pct}% price ${word} recommended`,
          ai_reasoning: analysis.reasoning,
          draft_content: JSON.stringify(analysis.signals),
        });
      }

      processed++;
    } catch (err) {
      console.error(`Error analyzing trip ${trip.name}:`, err);
      processed++;
    }
  }

  return NextResponse.json({
    success: true,
    trips_analyzed: processed,
    recommendations_created: recommendations,
    claude_calls: claudeCalls,
  });
}
