// POST /api/itinerary/generate
// Takes an inquiry and generates a draft itinerary

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { generateItinerary } from "@/lib/anthropic";

export async function POST(req: NextRequest) {
  const supabase = createServiceClient();
  const body = await req.json();

  const {
    inquiry_id,
    raw_inquiry_text,
    group_size,
    duration_days,
    region,
    cycling_ability,
    budget_per_person,
    special_requests,
    requested_dates_start,
    requested_dates_end,
  } = body;

  // Get TBT company ID
  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .eq("slug", "tbt")
    .single();

  if (!company) {
    return NextResponse.json({ success: false, error: "Company not found" }, { status: 400 });
  }

  // Find relevant trip templates
  const { data: templates } = await supabase
    .from("trip_templates")
    .select("*")
    .eq("company_id", company.id)
    .ilike("region", `%${region}%`)
    .order("times_booked", { ascending: false })
    .limit(5);

  // Find hotels in the region
  const { data: hotels } = await supabase
    .from("hotels")
    .select("*")
    .ilike("region", `%${region}%`)
    .order("is_preferred", { ascending: false });

  const templateSummary = templates?.length
    ? JSON.stringify(
        templates.map((t) => ({
          name: t.name,
          region: t.region,
          duration: t.duration_days,
          difficulty: t.difficulty,
          highlights: t.highlights,
          base_price: t.base_price_per_person_usd,
          itinerary: t.itinerary_json,
          times_booked: t.times_booked,
        })),
        null,
        2
      )
    : "No template trips available for this region yet.";

  const hotelSummary = hotels?.length
    ? JSON.stringify(
        hotels.map((h) => ({
          id: h.id,
          name: h.name,
          city: h.city,
          stars: h.stars,
          cost_per_room: h.cost_per_room_usd,
          routes: h.route_tags,
          notes: h.notes,
          preferred: h.is_preferred,
        })),
        null,
        2
      )
    : "No hotels in database for this region yet. Use known quality hotels.";

  // Generate the itinerary
  const result = await generateItinerary({
    inquiry_text: raw_inquiry_text || `Group of ${group_size}, ${duration_days} days, ${region}, ability: ${cycling_ability}`,
    group_size: group_size || 2,
    duration_days: duration_days || 7,
    region: region || "Alps",
    cycling_ability: cycling_ability || "intermediate",
    budget_per_person,
    special_requests,
    template_trips: templateSummary,
    available_hotels: hotelSummary,
    target_margin: 0.42,
  });

  // Create or update the inquiry
  let inquiryId = inquiry_id;
  if (!inquiryId) {
    const { data: newInquiry } = await supabase
      .from("inquiries")
      .insert({
        company_id: company.id,
        raw_inquiry_text,
        requested_dates_start,
        requested_dates_end,
        group_size,
        cycling_ability,
        preferred_region: region,
        budget_per_person_usd: budget_per_person,
        special_requests,
        status: "new",
      })
      .select()
      .single();
    inquiryId = newInquiry?.id;
  }

  // Create recommendation in inbox
  const { data: recommendation } = await supabase
    .from("ai_recommendations")
    .insert({
      company_id: company.id,
      tool: "itinerary",
      status: "pending",
      priority: "high",
      inquiry_id: inquiryId,
      title: `${result.title} — ${group_size} guests, ${duration_days} days`,
      ai_reasoning: result.summary,
      draft_content: JSON.stringify(result),
    })
    .select()
    .single();

  // Also save itinerary record
  if (inquiryId && recommendation) {
    await supabase.from("itineraries").insert({
      inquiry_id: inquiryId,
      company_id: company.id,
      recommendation_id: recommendation.id,
      title: result.title,
      duration_days: result.duration_days,
      group_size,
      region: result.region,
      itinerary_json: result.itinerary,
      hotels_json: null,
      cost_breakdown_json: result.cost_breakdown,
      total_cost_usd: result.cost_breakdown.total_cost_usd,
      quoted_price_per_person_usd: result.cost_breakdown.recommended_price_per_person_usd,
      gross_margin: result.cost_breakdown.gross_margin,
      status: "draft",
    });
  }

  return NextResponse.json({
    success: true,
    data: { result, inquiry_id: inquiryId, recommendation_id: recommendation?.id },
  });
}
