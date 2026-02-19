// POST /api/pricing/run?company=tbt
// Manually trigger pricing analysis for a company

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { analyzeTripPricing } from "@/lib/anthropic";
import { differenceInDays, parseISO } from "date-fns";

const EXCLUDED_TYPES = ["local", "via", "rental", "rental_other"];
const MAX_CLAUDE_CALLS = 20; // Safety cap to avoid timeout

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

  // Get all open trips for current year
  const { data: allTrips, error } = await supabase
    .from("trips")
    .select("*")
    .eq("company_id", company.id)
    .eq("status", "open")
    .gte("departure_date", `${currentYear}-01-01`)
    .order("departure_date", { ascending: true });

  if (error || !allTrips?.length) {
    return NextResponse.json({ success: true, trips_analyzed: 0, recommendations_created: 0, message: "No open trips found" });
  }

  // Filter excluded types in JS
  const trips = allTrips.filter(t => !EXCLUDED_TYPES.includes(t.trip_type));

  if (!trips.length) {
    return NextResponse.json({ success: true, trips_analyzed: 0, recommendations_created: 0, message: "No qualifying trips found" });
  }

  const tripIds = trips.map(t => t.id);

  // Bulk fetch bookings, waitlist, existing recs in parallel
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
      // Skip trips with no price set
      if (!trip.current_price_usd || trip.current_price_usd <= 0) { processed++; continue; }

      const bookingsCount = bookingMap[trip.id] || 0;
      const waitlistCount = waitlistMap[trip.id] || 0;
      const capacityPct = bookingsCount / (trip.capacity_max || 12);
      const daysUntilDeparture = differenceInDays(parseISO(trip.departure_date), today);

      // Skip if already has a pending recommendation
      if (existingTripIds.has(trip.id)) { processed++; continue; }

      // Only analyze where action might be warranted
      const shouldAnalyze =
        capacityPct >= 0.6 ||
        waitlistCount > 0 ||
        (capacityPct < 0.3 && daysUntilDeparture < 90);

      if (!shouldAnalyze) { processed++; continue; }

      // Safety cap on Claude calls
      if (claudeCalls >= MAX_CLAUDE_CALLS) { processed++; continue; }

      // Build competitor context
      const relevantCompetitors = competitors.filter(c =>
        c.trip_type === trip.trip_type || c.region === trip.region
      );
      const competitorPrices = relevantCompetitors.length
        ? relevantCompetitors.map(c => `${c.competitor_name} (${c.product_name || "similar"}): $${c.last_price_usd?.toLocaleString()}`).join("; ")
        : undefined;

      // Snapshot today
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
        capacity_max: trip.capacity_max || 12,
        bookings_count: bookingsCount,
        capacity_pct: capacityPct,
        waitlist_count: waitlistCount,
        competitor_prices: competitorPrices,
      });

      if (analysis.should_change) {
        recommendations++;
        await supabase.from("ai_recommendations").insert({
          company_id: company.id,
          tool: "pricing",
          status: "pending",
          priority: analysis.urgency,
          trip_id: trip.id,
          current_price_usd: trip.current_price_usd,
          recommended_price_usd: analysis.recommended_price_usd,
          title: `${trip.name}: ${analysis.price_change_pct > 0 ? "↑" : "↓"} ${Math.abs(analysis.price_change_pct * 100).toFixed(0)}% price ${analysis.price_change_pct > 0 ? "increase" : "reduction"} recommended`,
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
