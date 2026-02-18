// POST /api/cron/pricing
// Called daily by Vercel Cron. Analyzes all open trips and creates recommendations.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { analyzeTripPricing } from "@/lib/anthropic";
import { differenceInDays, parseISO } from "date-fns";

export async function POST(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const today = new Date();
  let processed = 0;
  let recommendations = 0;

  // Get all open trips with bookings data
  const { data: trips, error } = await supabase
    .from("trips")
    .select(`
      *,
      company:companies(slug, name, short_name),
      bookings:bookings(count),
      waitlist:bookings(count)
    `)
    .eq("status", "open")
    .gte("departure_date", today.toISOString().split("T")[0])
    .order("departure_date", { ascending: true });

  if (error || !trips) {
    return NextResponse.json({ error: "Failed to load trips" }, { status: 500 });
  }

  // Get all confirmed booking counts per trip
  const { data: bookingCounts } = await supabase
    .from("bookings")
    .select("trip_id, guest_count, status")
    .in("trip_id", trips.map((t) => t.id))
    .eq("status", "confirmed");

  const { data: waitlistCounts } = await supabase
    .from("bookings")
    .select("trip_id, guest_count")
    .in("trip_id", trips.map((t) => t.id))
    .eq("status", "waitlist");

  // Build lookup maps
  const bookingMap: Record<string, number> = {};
  const waitlistMap: Record<string, number> = {};

  bookingCounts?.forEach((b) => {
    bookingMap[b.trip_id] = (bookingMap[b.trip_id] || 0) + (b.guest_count || 1);
  });
  waitlistCounts?.forEach((w) => {
    waitlistMap[w.trip_id] = (waitlistMap[w.trip_id] || 0) + (w.guest_count || 1);
  });

  // Get competitor pricing context
  const { data: competitors } = await supabase
    .from("competitor_products")
    .select("*")
    .eq("is_active", true)
    .not("last_price_usd", "is", null);

  for (const trip of trips) {
    try {
      const bookingsCount = bookingMap[trip.id] || 0;
      const waitlistCount = waitlistMap[trip.id] || 0;
      const capacityPct = bookingsCount / trip.capacity_max;
      const daysUntilDeparture = differenceInDays(
        parseISO(trip.departure_date),
        today
      );

      // Skip if already has a pending recommendation
      const { data: existing } = await supabase
        .from("ai_recommendations")
        .select("id")
        .eq("trip_id", trip.id)
        .eq("status", "pending")
        .eq("tool", "pricing")
        .single();

      if (existing) continue;

      // Find relevant competitor prices
      const relevantCompetitors = competitors?.filter(
        (c) =>
          c.company_id === trip.company_id &&
          (c.trip_type === trip.trip_type || c.region === trip.region)
      );
      const competitorPrices = relevantCompetitors?.length
        ? relevantCompetitors
            .map((c) => `${c.competitor_name} (${c.product_name || "similar trip"}): $${c.last_price_usd?.toLocaleString()}`)
            .join("; ")
        : undefined;

      // Snapshot today's data
      await supabase.from("booking_snapshots").upsert({
        trip_id: trip.id,
        snapshot_date: today.toISOString().split("T")[0],
        bookings_count: bookingsCount,
        waitlist_count: waitlistCount,
        capacity_pct: capacityPct,
        current_price_usd: trip.current_price_usd,
      });

      // Only analyze trips where action might be warranted
      const shouldAnalyze =
        capacityPct >= 0.6 ||
        waitlistCount > 0 ||
        (capacityPct < 0.3 && daysUntilDeparture < 60);

      if (!shouldAnalyze) {
        processed++;
        continue;
      }

      // Get Claude's analysis
      const analysis = await analyzeTripPricing({
        trip_name: trip.name,
        trip_type: trip.trip_type,
        departure_date: trip.departure_date,
        days_until_departure: daysUntilDeparture,
        current_price_usd: trip.current_price_usd,
        cost_basis_usd: trip.cost_basis_usd || trip.current_price_usd * 0.6,
        target_margin: trip.target_gross_margin || 0.4,
        capacity_max: trip.capacity_max,
        bookings_count: bookingsCount,
        capacity_pct: capacityPct,
        waitlist_count: waitlistCount,
        competitor_prices: competitorPrices,
      });

      // Only create recommendation if Claude thinks we should change
      if (analysis.should_change) {
        recommendations++;
        await supabase.from("ai_recommendations").insert({
          company_id: trip.company_id,
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
    }
  }

  return NextResponse.json({
    success: true,
    trips_analyzed: processed,
    recommendations_created: recommendations,
    timestamp: today.toISOString(),
  });
}
