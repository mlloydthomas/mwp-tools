import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/service";
import { differenceInDays, parseISO } from "date-fns";

const FLAGSHIP_KEYWORDS = ["EVEREST", "LHAKPA RI", "CHO OYU", "AMA DABLAM", "K2"];

interface TripData {
  id: string;
  name: string;
  company_id: string;
  companySlug: string;
  current_price_usd: number;
  departure_date: string;
  days_out: number;
  capacity_max: number;
  bookings: number;
  fill_pct: number;
  band: string;
  urgency: string;
}

interface ClaudeRec {
  trip_id: string;
  title: string;
  reasoning: string;
  recommended_price_usd: number;
  should_change: boolean;
}

function classifyBand(
  trip: Omit<TripData, "band" | "urgency">,
  companySlug: string
): { band: string; urgency: string } {
  const isFlagship =
    companySlug === "aex" &&
    FLAGSHIP_KEYWORDS.some((k) => trip.name.toUpperCase().includes(k));
  if (isFlagship) {
    if (trip.fill_pct < 0.25) return { band: "band_1_early_bird_eligible", urgency: "normal" };
    if (trip.fill_pct < 0.75) return { band: "band_2_standard", urgency: "normal" };
    return { band: "band_3_surge_eligible", urgency: "urgent" };
  }
  if (trip.fill_pct >= 0.75) return { band: "velocity_high_fill", urgency: "normal" };
  if (trip.days_out <= 60 && trip.fill_pct < 0.40) return { band: "velocity_at_risk", urgency: "high" };
  return { band: "velocity_standard", urgency: "normal" };
}

async function buildCompanyMap(supabase: ReturnType<typeof createServiceClient>) {
  const { data } = await supabase.from("companies").select("id, slug");
  const map = new Map<string, string>();
  for (const c of data ?? []) map.set(c.slug, c.id);
  return map;
}

async function loadTripsWithFill(supabase: ReturnType<typeof createServiceClient>): Promise<TripData[]> {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const { data: rawTrips } = await supabase
    .from("trips")
    .select("id, company_id, name, departure_date, capacity_max, current_price_usd, companies(slug)")
    .eq("status", "open")
    .gte("departure_date", todayStr)
    .order("departure_date");
  if (!rawTrips?.length) return [];
  const tripIds = rawTrips.map((t: Record<string, unknown>) => t.id as string);
  const { data: bookings } = await supabase
    .from("bookings")
    .select("trip_id, guest_count")
    .in("trip_id", tripIds)
    .eq("status", "confirmed");
  const bookingMap: Record<string, number> = {};
  (bookings ?? []).forEach((b: Record<string, unknown>) => {
    const tid = b.trip_id as string;
    bookingMap[tid] = (bookingMap[tid] ?? 0) + ((b.guest_count as number) ?? 1);
  });
  return rawTrips.map((t: Record<string, unknown>) => {
    const comp = t.companies as { slug: string } | null;
    const companySlug = comp?.slug ?? "";
    const bookingsCount = bookingMap[t.id as string] ?? 0;
    const capacityMax = (t.capacity_max as number) || 12;
    const fillPct = bookingsCount / capacityMax;
    const daysOut = differenceInDays(parseISO(t.departure_date as string), today);
    const base = { id: t.id as string, name: t.name as string, company_id: t.company_id as string, companySlug, current_price_usd: (t.current_price_usd as number) ?? 0, departure_date: t.departure_date as string, days_out: daysOut, capacity_max: capacityMax, bookings: bookingsCount, fill_pct: fillPct };
    const { band, urgency } = classifyBand(base, companySlug);
    return { ...base, band, urgency };
  });
}

async function callClaude(trips: TripData[]): Promise<ClaudeRec[]> {
  if (!trips.length) return [];
  const client = new Anthropic();
  const payload = trips.map((t) => ({
    id: t.id, name: t.name, price: t.current_price_usd,
    band: t.band, fill: `${(t.fill_pct * 100).toFixed(0)}%`, days_out: t.days_out,
  }));
  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    system: "You are a pricing strategist for premium adventure brands. Analyze trip data and return pricing recommendations. Output JSON array only, no prose, no markdown.",
    messages: [{
      role: "user",
      content: `Return a JSON array where each element is: { trip_id, title, reasoning, recommended_price_usd, should_change }.\n\n${JSON.stringify(payload)}`,
    }],
  });
  const text = msg.content[0].type === "text" ? msg.content[0].text.trim() : "[]";
  return JSON.parse(text);
}

export async function GET() {
  const supabase = createServiceClient();
  const companyMap = await buildCompanyMap(supabase);
  const trips = await loadTripsWithFill(supabase);
  const actionable = trips.filter((t) =>
    t.band === "band_3_surge_eligible" || t.band === "velocity_at_risk" || t.band === "velocity_high_fill"
  );
  const recs = await callClaude(actionable);
  let inserted = 0;
  for (const rec of recs) {
    if (!rec.should_change) continue;
    const trip = trips.find((t) => t.id === rec.trip_id);
    if (!trip) continue;
    const companySlug = trip.companySlug;
    const company_id = companyMap.get(companySlug);
    if (!company_id) continue;
    await supabase.from("ai_recommendations").insert({
      company_id,
      tool: "pricing",
      status: "pending",
      priority: trip.urgency,
      trip_id: trip.id,
      current_price_usd: trip.current_price_usd,
      recommended_price_usd: rec.recommended_price_usd,
      title: rec.title,
      ai_reasoning: rec.reasoning,
    });
    inserted++;
  }
  return NextResponse.json({
    success: true,
    trips_analyzed: trips.length,
    actionable: actionable.length,
    recommendations_created: inserted,
  });
}
