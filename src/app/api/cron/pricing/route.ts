/**
 * GET /api/cron/pricing
 *
 * Pricing analysis cron for AEX trips only.
 * Runs on schedule (or manually via "Run Analysis" button).
 *
 * CLASSIFICATION BY trip_tier:
 *   8000m    — Everest, Lhakpa Ri, Cho Oyu ($50k–$100k+)
 *   advanced — Ama Dablam, Alpamayo ($7k–$25k)
 *   intermediate — Bolivia, Cotopaxi, Peak Lenin, Artesonraju, Aconcagua, Peru ($3k–$16k)
 *   beginner — Ecuador Climbing School, Kilimanjaro, Volcanoes of Mexico ($3k–$6k)
 *   ski      — Patagonia, Ring of Fire, Japan Backcountry ($4k–$10k)
 *   null     — unclassified, skipped with warning
 *
 * RECOMMENDATION TYPES:
 *   surge    — trip is filling faster than expected → recommend price increase (5–15%)
 *   review   — trip is behind expected pace and within 120 days → flag for human review only
 *
 * ABSOLUTE RULES:
 *   - Never recommend price decrease
 *   - Never give extension trips independent recommendations
 *   - Never process TBT trips
 *   - At-risk trips get human review flag only, no AI price suggestion
 *   - All recommended prices must be >= current price
 *   - Price changes capped at 15% maximum
 */
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

// ─── Types ───────────────────────────────────────────────────────────────────

type TripTier = "8000m" | "advanced" | "intermediate" | "beginner" | "ski";

interface TripRow {
  id: string;
  company_id: string;
  company_slug: string;
  name: string;
  departure_date: string;
  days_out: number;
  capacity_max: number;
  current_price_usd: number;
  trip_tier: TripTier | null;
  pax: number;
  fill_pct: number;
  is_extension: boolean;
}

interface TierConfig {
  surge_fill_pct: number;       // fill % above which to recommend price increase
  at_risk_fill_pct: number;     // fill % below which to flag as at-risk
  at_risk_days_out: number;     // only flag at-risk if within this many days
  max_price_increase_pct: number; // cap on recommended price increase
}

interface RecommendationInsert {
  company_id: string;
  trip_id: string;
  tool: string;
  status: string;
  priority: string;
  title: string;
  current_price_usd: number;
  recommended_price_usd: number | null;
  ai_reasoning: string;
}

// ─── Tier Configuration ───────────────────────────────────────────────────────

const TIER_CONFIG: Record<TripTier, TierConfig> = {
  "8000m": {
    surge_fill_pct: 75,
    at_risk_fill_pct: 25,
    at_risk_days_out: 120,
    max_price_increase_pct: 10,
  },
  advanced: {
    surge_fill_pct: 75,
    at_risk_fill_pct: 33,
    at_risk_days_out: 120,
    max_price_increase_pct: 10,
  },
  intermediate: {
    surge_fill_pct: 75,
    at_risk_fill_pct: 33,
    at_risk_days_out: 120,
    max_price_increase_pct: 10,
  },
  beginner: {
    surge_fill_pct: 83,
    at_risk_fill_pct: 25,
    at_risk_days_out: 120,
    max_price_increase_pct: 8,
  },
  ski: {
    surge_fill_pct: 75,
    at_risk_fill_pct: 33,
    at_risk_days_out: 120,
    max_price_increase_pct: 10,
  },
};

// ─── Main Handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = createServiceClient();
  const start = Date.now();

  // Get AEX company ID only — TBT is excluded until Salesforce integration
  const { data: aexCompany } = await supabase
    .from("companies")
    .select("id, slug")
    .eq("slug", "aex")
    .single();

  if (!aexCompany) {
    return NextResponse.json({ error: "AEX company not found" }, { status: 500 });
  }

  // Load all open future AEX trips with booking counts
  const { data: tripsRaw, error: tripsError } = await supabase
    .from("trips")
    .select(`
      id,
      name,
      departure_date,
      capacity_max,
      current_price_usd,
      trip_tier,
      status
    `)
    .eq("company_id", aexCompany.id)
    .eq("status", "open")
    .gte("departure_date", new Date().toISOString().slice(0, 10))
    .order("departure_date");

  if (tripsError) {
    return NextResponse.json({ error: tripsError.message }, { status: 500 });
  }

  // Load booking pax counts for all these trips
  const tripIds = (tripsRaw ?? []).map((t: any) => t.id);

  const { data: bookings } = await supabase
    .from("bookings")
    .select("trip_id, guest_count")
    .in("trip_id", tripIds)
    .eq("status", "confirmed");

  // Build pax map
  const paxMap = new Map<string, number>();
  for (const b of bookings ?? []) {
    paxMap.set(b.trip_id, (paxMap.get(b.trip_id) ?? 0) + (b.guest_count ?? 0));
  }

  // Build enriched trip rows
  const today = new Date();
  const trips: TripRow[] = (tripsRaw ?? []).map((t: any) => {
    const departure = new Date(t.departure_date);
    const days_out = Math.ceil((departure.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const pax = paxMap.get(t.id) ?? 0;
    const capacity = t.capacity_max ?? 12;
    const fill_pct = capacity > 0 ? (pax / capacity) * 100 : 0;
    const is_extension = t.name.toLowerCase().includes("extension");

    return {
      id: t.id,
      company_id: aexCompany.id,
      company_slug: aexCompany.slug,
      name: t.name,
      departure_date: t.departure_date,
      days_out,
      capacity_max: capacity,
      current_price_usd: t.current_price_usd ?? 0,
      trip_tier: t.trip_tier as TripTier | null,
      pax,
      fill_pct,
      is_extension,
    };
  });

  // Warn about unclassified trips
  const unclassified = trips.filter(t => !t.trip_tier && !t.is_extension);
  if (unclassified.length > 0) {
    console.warn(`[pricing] ${unclassified.length} trips have no trip_tier and will be skipped:`,
      unclassified.map(t => t.name));
  }

  // Check for existing pending recommendations to avoid duplicates
  const { data: existingRecs } = await supabase
    .from("ai_recommendations")
    .select("trip_id")
    .eq("company_id", aexCompany.id)
    .eq("status", "pending")
    .eq("tool", "pricing");

  const existingTripIds = new Set((existingRecs ?? []).map((r: any) => r.trip_id));

  // Classify each trip and build recommendation list
  const surgeTrips: TripRow[] = [];
  const reviewTrips: TripRow[] = [];

  for (const trip of trips) {
    // Skip extensions — their fill is derivative of the primary trip
    if (trip.is_extension) continue;

    // Skip unclassified trips
    if (!trip.trip_tier) continue;

    // Skip if already has a pending recommendation
    if (existingTripIds.has(trip.id)) continue;

    // Skip if price is not set
    if (!trip.current_price_usd || trip.current_price_usd <= 0) continue;

    const config = TIER_CONFIG[trip.trip_tier];

    if (trip.fill_pct >= config.surge_fill_pct) {
      surgeTrips.push(trip);
    } else if (
      trip.fill_pct < config.at_risk_fill_pct &&
      trip.days_out <= config.at_risk_days_out &&
      trip.days_out > 0
    ) {
      reviewTrips.push(trip);
    }
  }

  console.log(`[pricing] ${surgeTrips.length} surge trips, ${reviewTrips.length} review trips`);

  const recommendations: RecommendationInsert[] = [];

  // ── Process surge trips with Claude ────────────────────────────────────────

  for (const trip of surgeTrips) {
    try {
      const config = TIER_CONFIG[trip.trip_tier!];
      const remainingSeats = trip.capacity_max - trip.pax;

      const systemPrompt = `You are a pricing strategist for AEX (Alpine Ascents International / American Alpine Institute equivalent), a premium adventure travel company specializing in high-altitude mountaineering expeditions.

CORE PRINCIPLE: AEX never discounts. Scarcity is a feature, not a problem. When trips fill early, that validates premium pricing and justifies modest increases for remaining seats.

YOUR TASK: Analyze this trip's booking velocity and recommend a specific price increase for the remaining ${remainingSeats} seat(s).

CONSTRAINTS:
- Recommended price must be HIGHER than current price
- Maximum increase is ${config.max_price_increase_pct}% above current price
- Increase should be a round number (nearest $50 or $100)
- Consider that remaining buyers are late-deciders who value availability over price sensitivity
- For 8000m expeditions, even a $500–$1000 increase is modest relative to total cost

OUTPUT: Return valid JSON only, no prose, no markdown fences:
{
  "recommended_price_usd": <number>,
  "price_change_pct": <number between 0 and ${config.max_price_increase_pct}>,
  "reasoning": "<2-3 sentences explaining the recommendation>",
  "confidence": "<high|medium|low>"
}`;

      const userPrompt = `Trip: ${trip.name}
Departure: ${trip.departure_date} (${trip.days_out} days from now)
Tier: ${trip.trip_tier}
Current price: $${trip.current_price_usd.toLocaleString()}
Capacity: ${trip.capacity_max} seats
Booked: ${trip.pax} pax (${trip.fill_pct.toFixed(1)}% full)
Remaining: ${remainingSeats} seat(s)

This trip is at or above the surge threshold for its tier (${TIER_CONFIG[trip.trip_tier!].surge_fill_pct}% fill).
Recommend a price increase for the remaining seats.`;

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 512,
        messages: [{ role: "user", content: userPrompt }],
        system: systemPrompt,
      });

      const text = response.content
        .filter(b => b.type === "text")
        .map(b => (b as { type: "text"; text: string }).text)
        .join("");

      let parsed: {
        recommended_price_usd: number;
        price_change_pct: number;
        reasoning: string;
        confidence: string;
      };

      try {
        parsed = JSON.parse(text);
      } catch {
        console.error(`[pricing] Failed to parse Claude response for ${trip.name}:`, text);
        continue;
      }

      // Validate output — hard rules
      if (parsed.recommended_price_usd <= trip.current_price_usd) {
        console.warn(`[pricing] Discarding recommendation for ${trip.name}: recommended price ${parsed.recommended_price_usd} is not higher than current ${trip.current_price_usd}`);
        continue;
      }

      const changePercent = ((parsed.recommended_price_usd - trip.current_price_usd) / trip.current_price_usd) * 100;
      if (changePercent > config.max_price_increase_pct || changePercent <= 0) {
        console.warn(`[pricing] Discarding recommendation for ${trip.name}: ${changePercent.toFixed(1)}% change is outside allowed range (0–${config.max_price_increase_pct}%)`);
        continue;
      }

      const remainingAfter = trip.capacity_max - trip.pax;
      recommendations.push({
        company_id: trip.company_id,
        trip_id: trip.id,
        tool: "pricing",
        status: "pending",
        priority: trip.fill_pct >= 90 ? "urgent" : "high",
        title: `${trip.name}: ${trip.fill_pct.toFixed(0)}% full — consider raising price for ${remainingAfter} remaining seat${remainingAfter !== 1 ? "s" : ""}`,
        current_price_usd: trip.current_price_usd,
        recommended_price_usd: parsed.recommended_price_usd,
        ai_reasoning: parsed.reasoning,
      });
    } catch (err) {
      console.error(`[pricing] Error processing surge trip ${trip.name}:`, err);
    }
  }

  // ── Process at-risk trips — human review flags only, no AI price suggestion ─

  for (const trip of reviewTrips) {
    const config = TIER_CONFIG[trip.trip_tier!];
    recommendations.push({
      company_id: trip.company_id,
      trip_id: trip.id,
      tool: "pricing",
      status: "pending",
      priority: trip.days_out <= 60 ? "urgent" : "high",
      title: `${trip.name}: ${trip.fill_pct.toFixed(0)}% full with ${trip.days_out} days to departure — review marketing strategy`,
      current_price_usd: trip.current_price_usd,
      recommended_price_usd: null,
      ai_reasoning: `This trip is at ${trip.fill_pct.toFixed(1)}% fill (${trip.pax}/${trip.capacity_max} seats) with ${trip.days_out} days until departure. The expected fill rate for a ${trip.trip_tier} tier trip at this point is above ${config.at_risk_fill_pct}%. No price change is recommended — this flag is for marketing review only.`,
    });
  }

  // ── Write recommendations to database ──────────────────────────────────────

  let inserted = 0;
  if (recommendations.length > 0) {
    const { error: insertError } = await supabase
      .from("ai_recommendations")
      .insert(recommendations);

    if (insertError) {
      console.error("[pricing] Failed to insert recommendations:", insertError.message);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
    inserted = recommendations.length;
  }

  const duration = Date.now() - start;
  console.log(`[pricing] Complete in ${duration}ms. Analyzed ${trips.length} trips. ${surgeTrips.length} surge, ${reviewTrips.length} at-risk. Inserted ${inserted} recommendations.`);

  return NextResponse.json({
    analyzed: trips.length,
    surge_trips: surgeTrips.length,
    review_trips: reviewTrips.length,
    recommendations_inserted: inserted,
    unclassified_trips: unclassified.length,
    duration_ms: duration,
  });
}
