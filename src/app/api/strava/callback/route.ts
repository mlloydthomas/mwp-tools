// GET /api/strava/callback
// OAuth callback - exchanges code for tokens, syncs athlete data

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exchangeStravaCode, getAthleteStats } from "@/lib/strava";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state"); // format: "clientId:email"
  const error = searchParams.get("error");

  if (error || !code || !state) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/engagement?strava=error`
    );
  }

  const [clientId] = state.split(":");
  const supabase = await createClient();

  try {
    const tokens = await exchangeStravaCode(code);
    const stats = await getAthleteStats(tokens.athlete_id, tokens.access_token);

    await supabase
      .from("clients")
      .update({
        strava_athlete_id: tokens.athlete_id,
        strava_access_token: tokens.access_token,
        strava_refresh_token: tokens.refresh_token,
        strava_token_expires_at: new Date(tokens.expires_at * 1000).toISOString(),
        strava_last_synced_at: new Date().toISOString(),
        ...stats,
      })
      .eq("id", clientId);

    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/engagement?strava=connected`
    );
  } catch (err) {
    console.error("Strava callback error:", err);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/engagement?strava=error`
    );
  }
}
