// /api/pricing/recommendations - GET list, PATCH update status

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const supabase = createServiceClient();
  const { searchParams } = new URL(req.url);
  const tool = searchParams.get("tool");
  const status = searchParams.get("status") || "pending";
  const company = searchParams.get("company");

  let query = supabase
    .from("ai_recommendations")
    .select(`
      *,
      trip:trips(id, name, trip_type, departure_date, capacity_max, current_price_usd, region, company_id),
      client:clients(id, first_name, last_name, email, total_trips, last_trip_date, fitness_level, strava_recent_activity_name, strava_recent_activity_date, strava_ytd_ride_distance_km),
      competitor_product:competitor_products(id, competitor_name, product_name, competitor_url, last_price_usd),
      company:companies(slug, short_name)
    `)
    .eq("status", status)
    .order("created_at", { ascending: false });

  if (tool) query = query.eq("tool", tool);
  if (company) {
    const { data: co } = await supabase
      .from("companies")
      .select("id")
      .eq("slug", company)
      .single();
    if (co) query = query.eq("company_id", co.id);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data });
}

export async function PATCH(req: NextRequest) {
  const supabase = createServiceClient();
  const body = await req.json();
  const { id, status, final_content, reviewed_by } = body;

  if (!id || !status) {
    return NextResponse.json(
      { success: false, error: "id and status required" },
      { status: 400 }
    );
  }

  const update: Record<string, unknown> = {
    status,
    reviewed_at: new Date().toISOString(),
    reviewed_by: reviewed_by || "team",
  };

  if (final_content) update.final_content = final_content;

  // If approving a pricing recommendation, update the trip price
  if (status === "approved" || status === "edited_approved") {
    const { data: rec } = await supabase
      .from("ai_recommendations")
      .select("trip_id, recommended_price_usd, final_content")
      .eq("id", id)
      .single();

    if (rec?.trip_id && rec?.recommended_price_usd) {
      const finalPrice =
        rec.final_content && !isNaN(parseFloat(rec.final_content))
          ? parseFloat(rec.final_content)
          : rec.recommended_price_usd;

      await supabase
        .from("trips")
        .update({
          current_price_usd: finalPrice,
          updated_at: new Date().toISOString(),
        })
        .eq("id", rec.trip_id);
    }
  }

  const { data, error } = await supabase
    .from("ai_recommendations")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data });
}
