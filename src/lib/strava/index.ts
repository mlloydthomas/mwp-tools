// ============================================================
// Strava Integration
// ============================================================

const STRAVA_BASE = "https://www.strava.com/api/v3";

export type StravaTokens = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
};

/**
 * Exchange authorization code for tokens (OAuth step 2)
 */
export async function exchangeStravaCode(code: string): Promise<StravaTokens & { athlete_id: number }> {
  const response = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    throw new Error(`Strava token exchange failed: ${response.statusText}`);
  }

  const data = await response.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
    athlete_id: data.athlete.id,
  };
}

/**
 * Refresh an expired access token
 */
export async function refreshStravaToken(refreshToken: string): Promise<StravaTokens> {
  const response = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    throw new Error(`Strava token refresh failed: ${response.statusText}`);
  }

  const data = await response.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
  };
}

/**
 * Get athlete stats from Strava
 */
export async function getAthleteStats(athleteId: number, accessToken: string) {
  const [statsRes, activitiesRes] = await Promise.all([
    fetch(`${STRAVA_BASE}/athletes/${athleteId}/stats`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }),
    fetch(`${STRAVA_BASE}/athlete/activities?per_page=5`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }),
  ]);

  if (!statsRes.ok) {
    throw new Error(`Failed to get Strava stats: ${statsRes.statusText}`);
  }

  const stats = await statsRes.json();
  const activities = activitiesRes.ok ? await activitiesRes.json() : [];
  const recent = activities[0];

  return {
    ytd_ride_distance_km: (stats.ytd_ride_totals?.distance || 0) / 1000,
    ytd_ride_elevation_m: stats.ytd_ride_totals?.elevation_gain || 0,
    ytd_run_distance_km: (stats.ytd_run_totals?.distance || 0) / 1000,
    all_time_rides: stats.all_ride_totals?.count || 0,
    biggest_ride_km: (stats.biggest_ride_distance || 0) / 1000,
    recent_activity_date: recent?.start_date_local?.split("T")[0] || null,
    recent_activity_type: recent?.type || null,
    recent_activity_name: recent?.name || null,
    recent_activity_distance_km: recent ? recent.distance / 1000 : null,
    recent_activity_elevation_m: recent?.total_elevation_gain || null,
  };
}

/**
 * Build a human-readable Strava summary for Claude
 */
export function formatStravaSummary(client: {
  strava_ytd_ride_distance_km?: number | null;
  strava_ytd_ride_elevation_m?: number | null;
  strava_biggest_ride_km?: number | null;
  strava_all_time_rides?: number | null;
  strava_recent_activity_date?: string | null;
  strava_recent_activity_name?: string | null;
  strava_recent_activity_distance_km?: number | null;
  strava_recent_activity_elevation_m?: number | null;
}): string {
  const parts: string[] = [];

  if (client.strava_ytd_ride_distance_km) {
    parts.push(`${Math.round(client.strava_ytd_ride_distance_km).toLocaleString()}km ridden this year`);
  }
  if (client.strava_ytd_ride_elevation_m) {
    parts.push(`${Math.round(client.strava_ytd_ride_elevation_m).toLocaleString()}m elevation gained this year`);
  }
  if (client.strava_biggest_ride_km) {
    parts.push(`biggest ride: ${Math.round(client.strava_biggest_ride_km)}km`);
  }
  if (client.strava_all_time_rides) {
    parts.push(`${client.strava_all_time_rides} total rides logged`);
  }
  if (client.strava_recent_activity_name && client.strava_recent_activity_date) {
    const dist = client.strava_recent_activity_distance_km
      ? ` (${Math.round(client.strava_recent_activity_distance_km)}km`
      : "";
    const elev = client.strava_recent_activity_elevation_m
      ? `, ${Math.round(client.strava_recent_activity_elevation_m)}m gain)`
      : dist
      ? ")"
      : "";
    parts.push(
      `most recent: "${client.strava_recent_activity_name}" on ${client.strava_recent_activity_date}${dist}${elev}`
    );
  }

  return parts.length > 0 ? parts.join("; ") : "No Strava data available";
}

/**
 * Build the Strava OAuth URL for client authorization
 */
export function getStravaAuthUrl(clientEmail: string, clientId: string): string {
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/strava/callback`,
    response_type: "code",
    approval_prompt: "auto",
    scope: "read,activity:read",
    state: `${clientId}:${clientEmail}`, // passed back in callback
  });

  return `https://www.strava.com/oauth/authorize?${params.toString()}`;
}
