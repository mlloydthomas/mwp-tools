// POST /api/cron/engagement
// Called daily. Prioritizes clients for outreach and drafts messages.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { generateClientOutreach } from "@/lib/anthropic";
import { formatStravaSummary } from "@/lib/strava";
import { format, differenceInDays, parseISO } from "date-fns";

const OUTREACH_COOLDOWN_DAYS = 30; // don't re-draft for a client we contacted < 30 days ago

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const today = new Date();

  // Get clients eligible for outreach (haven't been contacted recently)
  const cooloffDate = new Date(today);
  cooloffDate.setDate(cooloffDate.getDate() - OUTREACH_COOLDOWN_DAYS);

  const { data: clients, error } = await supabase
    .from("clients")
    .select(`
      *,
      trip_history:client_trips(*)
    `)
    .or(`last_outreach_date.is.null,last_outreach_date.lte.${cooloffDate.toISOString().split("T")[0]}`)
    .gt("total_trips", 0)  // only past clients, not cold leads
    .order("engagement_score", { ascending: false })
    .limit(50); // process top 50 by score per day

  if (error || !clients) {
    return NextResponse.json({ error: "Failed to load clients" }, { status: 500 });
  }

  // Get available upcoming trips (next 6 months)
  const sixMonthsOut = new Date(today);
  sixMonthsOut.setMonth(sixMonthsOut.getMonth() + 6);

  const { data: upcomingTrips } = await supabase
    .from("trips")
    .select("name, trip_type, region, departure_date, current_price_usd, capacity_max, company_id")
    .eq("status", "open")
    .gte("departure_date", today.toISOString().split("T")[0])
    .lte("departure_date", sixMonthsOut.toISOString().split("T")[0])
    .order("departure_date", { ascending: true });

  const availableTripsText = upcomingTrips
    ? upcomingTrips
        .map(
          (t) =>
            `${t.name} (${t.trip_type}, ${t.region || ""}) - ${format(parseISO(t.departure_date), "MMM d, yyyy")} - $${t.current_price_usd.toLocaleString()}`
        )
        .join("\n")
    : "No upcoming trips available";

  let processed = 0;
  let drafts_created = 0;

  // Get companies for name lookup
  const { data: companies } = await supabase.from("companies").select("*");
  const companyMap = Object.fromEntries(companies?.map((c) => [c.id, c]) || []);

  for (const client of clients) {
    try {
      // Skip if already has a pending outreach recommendation
      const { data: existing } = await supabase
        .from("ai_recommendations")
        .select("id")
        .eq("client_id", client.id)
        .eq("status", "pending")
        .eq("tool", "engagement")
        .single();

      if (existing) {
        processed++;
        continue;
      }

      const company = companyMap[client.company_id || ""];
      const tripHistory = client.trip_history || [];

      // Format trip history for Claude
      const tripHistoryText = tripHistory.length
        ? tripHistory
            .sort((a: { trip_date?: string }, b: { trip_date?: string }) =>
              (b.trip_date || "").localeCompare(a.trip_date || "")
            )
            .map(
              (t: { trip_name: string; trip_date?: string; price_paid_usd?: number; nps_score?: number }) =>
                `${t.trip_name} (${t.trip_date ? format(parseISO(t.trip_date), "MMM yyyy") : "date unknown"})${t.price_paid_usd ? ` - $${t.price_paid_usd.toLocaleString()}` : ""}${t.nps_score ? ` - NPS: ${t.nps_score}/10` : ""}`
            )
            .join("\n")
        : "No trip history";

      const stravaSummary = client.strava_athlete_id
        ? formatStravaSummary(client)
        : undefined;

      const result = await generateClientOutreach({
        client_name: `${client.first_name || ""} ${client.last_name || ""}`.trim() || client.email,
        company: company?.name || "Milky Way Park",
        trip_history: tripHistoryText,
        last_trip_date: client.last_trip_date || "unknown",
        total_spend: client.total_spend_usd || 0,
        fitness_level: client.fitness_level,
        strava_summary: stravaSummary,
        available_trips: availableTripsText,
        last_outreach: client.last_outreach_date
          ? `${format(parseISO(client.last_outreach_date), "MMM d, yyyy")} (${client.last_outreach_response || "no response recorded"})`
          : undefined,
      });

      // Only create draft if timing is "today" or "this_week"
      if (
        result.outreach_timing === "today" ||
        result.outreach_timing === "this_week"
      ) {
        drafts_created++;
        await supabase.from("ai_recommendations").insert({
          company_id: client.company_id,
          tool: "engagement",
          status: "pending",
          priority:
            result.priority_score >= 80
              ? "high"
              : result.priority_score >= 60
              ? "normal"
              : "low",
          client_id: client.id,
          title: `Reach out to ${client.first_name || client.email} — ${result.recommended_trip_type}`,
          ai_reasoning: result.reasoning,
          draft_content: JSON.stringify({
            subject: result.subject_line,
            body: result.email_draft,
            recommended_trip_type: result.recommended_trip_type,
            priority_score: result.priority_score,
          }),
        });
      }

      processed++;
    } catch (err) {
      console.error(`Error processing client ${client.email}:`, err);
    }
  }

  return NextResponse.json({
    success: true,
    clients_analyzed: processed,
    drafts_created,
    timestamp: today.toISOString(),
  });
}
