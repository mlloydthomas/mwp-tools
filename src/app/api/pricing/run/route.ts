// POST /api/pricing/run?company=tbt
// Manually trigger pricing analysis for a company (same logic as cron but scoped to one company)

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { analyzeTripPricing } from "@/lib/anthropic";
import { differenceInDays, parseISO } from "date-fns";

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
  let processed = 0;
  let recommendations = 0;

  // Get open upcoming trips
  const { data: trips, error } = await supabase
    .from("trips")
    .select("*")
    .eq("company_id", company.id)
    .eq("status", "open")
    .gte("departure_date", todayStr.substring(0, 4) + "-01-01")
    .order("departure_date", { ascending: true });

  if (error || !trips?.length) {
    return NextResponse.json({ success: true, trips_analyzed: 0, recommendations_created: 0, message: "No open trips found" });
  }

  // Get booking counts in one query
  const { data: bookings } = await supabase
    .from("bookings")
    .select("trip_id, guest_count")
    .in("trip_id", trips.map(t => t.id))
    .eq("status", "confirmed");

  const bookingMap: Record<string, number> = {};
  bookings?.forEach(b => {
    bookingMap[b.trip_id] = (bookingMap[b.trip_id] || 0) + (b.guest_count || 1);
  });

  // Get waitlist counts
  const { data: waitlist } = await supabase
    .from("bookings")
    .select("trip_id, guest_count")
    .in("trip_id", trips.map(t => t.id))
    .eq("status", "waitlist");

  const waitlistMap: Record<string, number> = {};
  waitlist?.forEach(w => {
    waitlistMap[w.trip_id] = (waitlistMap[w.trip_id] || 0) + (w.guest_count || 1);
  });

  // Get competitor pricing
  const { data: competitors } = await supabase
    .from("competitor_products")
    .select("*")
    .eq("company_id", company.id)
    .eq("is_active", true)
    .not("last_price_usd", "is", null);

  for (const trip of trips) {
    try {
      const bookingsCount = bookingMap[trip.id] || 0;
      const waitlistCount = waitlistMap[trip.id] || 0;
      const capacityPct = bookingsCount / (trip.capacity_max || 12);
      const daysUntilDeparture = differenceInDays(parseISO(trip.departure_date), today);

      // Skip trips more than 2 years out
      if (daysUntilDeparture > 730) { processed++; continue; }

      // Skip if already has a pending recommendation
      const { data: existing } = await supabase
        .from("ai_recommendations")
        .select("id")
        .eq("trip_id", trip.id)
        .eq("status", "pending")
        .eq("tool", "pricing")
        .maybeSingle();

      if (existing) { processed++; continue; }

      // Only analyze where action might be warranted
      const shouldAnalyze =
        capacityPct >= 0.6 ||
        waitlistCount > 0 ||
        (capacityPct < 0.3 && daysUntilDeparture < 90);

      if (!shouldAnalyze) { processed++; continue; }

      // Build competitor context
      const relevantCompetitors = competitors?.filter(c =>
        c.trip_type === trip.trip_type || c.region === trip.region
      );
      const competitorPrices = relevantCompetitors?.length
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
      }, { onConflict: "trip_id, snapshot_date" });

      // Run Claude analysis
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

  return NextResponse.json({ success: true, trips_analyzed: processed, recommendations_created: recommendations });
}
