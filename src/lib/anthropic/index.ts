import Anthropic from "@anthropic-ai/sdk";

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export const MODELS = {
  // Complex reasoning: pricing analysis, itinerary generation, engagement drafting
  sonnet: "claude-sonnet-4-6",
  // Fast + cheap: classification, extraction, simple tasks
  haiku: "claude-haiku-4-5-20251001",
} as const;

// ---- PRICING AGENT ----

export type PricingRecommendation = {
  should_change: boolean;
  recommended_price_usd: number;
  price_change_pct: number;
  urgency: "urgent" | "high" | "normal" | "low";
  reasoning: string;
  signals: string[];
};

export async function analyzeTripPricing(params: {
  trip_name: string;
  trip_type: string;
  departure_date: string;
  days_until_departure: number;
  current_price_usd: number;
  cost_basis_usd: number;
  target_margin: number;
  capacity_max: number;
  capacity_min: number;
  bookings_count: number;
  capacity_pct: number;
  waitlist_count: number;
  company_slug: string;           // "tbt" or "aex"
  guide_ratio_note?: string;      // TBT guide ratio context
  historical_velocity?: string;
  competitor_prices?: string;
}): Promise<PricingRecommendation> {
  const isTBT = params.company_slug === "tbt";
  const isPrivate = params.trip_type === "private" || params.trip_type === "private_international";
  const is8000m = params.trip_type === "8000m" || params.trip_type === "everest";

  const prompt = `You are a revenue management expert for a premium adventure travel company.
Analyze this trip and provide a pricing recommendation.

TRIP DETAILS:
- Name: ${params.trip_name}
- Type: ${params.trip_type}
- Company: ${isTBT ? "Thomson Bike Tours (TBT)" : "Alpenglow Expeditions (AEX)"}
- Departure: ${params.departure_date} (${params.days_until_departure} days away)
- Current price: $${params.current_price_usd.toLocaleString()}
- Cost basis: $${params.cost_basis_usd.toLocaleString()}
- Target gross margin: ${(params.target_margin * 100).toFixed(0)}%
- Current margin: ${(((params.current_price_usd - params.cost_basis_usd) / params.current_price_usd) * 100).toFixed(1)}%

CAPACITY:
- Minimum to run: ${params.capacity_min} guests${isTBT && !isPrivate ? " (trip cancels if not met 6 weeks out)" : ""}
- Maximum capacity: ${params.capacity_max} guests
- Current bookings: ${params.bookings_count} (${(params.capacity_pct * 100).toFixed(0)}% of max)
- Waitlist: ${params.waitlist_count}
${params.historical_velocity ? `- Historical velocity: ${params.historical_velocity}` : ""}
${params.guide_ratio_note ? `\nGUIDE RATIO CONTEXT:\n${params.guide_ratio_note}` : ""}
${params.competitor_prices ? `\nCOMPETITOR PRICING:\n${params.competitor_prices}` : ""}

PRICING PRINCIPLES:
- Both companies are premium, word-of-mouth businesses. Price changes must feel considered, not opportunistic.
- Recommend no change unless there is a clear, defensible reason.
${isTBT ? `
TBT-SPECIFIC:
- TDF trips have inelastic demand and frequent waitlists — be more aggressive with increases.
- Open enrollment trips run on an 8:1 client-to-guide ratio. Margins are best at exactly 8, 16, 24, 32, 40 guests.
- A trip at 9, 17, 25, or 33 guests pays the same staff cost as 8, 16, 24, 32 — flag this.
- If a trip risks falling below 6 guests with <6 weeks to go, flag cancellation risk.
- Training camps and gravel are more price-sensitive than TDF.` : `
AEX-SPECIFIC:
- 8000m and Everest trips (max 8 guests) command premium pricing — scarcity is a feature.
- Most AEX bookings arrive 90-180 days before departure. Low fill at 270+ days is normal.
- If a trip is under 50% full within 6 months of departure, that warrants attention.`}
${isPrivate ? `\nPRIVATE TRIP: Target 40%+ gross margin. Higher pricing flexibility than open enrollment.` : ""}

Respond ONLY in this exact JSON format (no markdown, no preamble):
{
  "should_change": true or false,
  "recommended_price_usd": number,
  "price_change_pct": number,
  "urgency": "urgent" or "high" or "normal" or "low",
  "reasoning": "2-3 sentence explanation for the human reviewer",
  "signals": ["signal 1", "signal 2", "signal 3"]
}`;

  const response = await anthropic.messages.create({
    model: MODELS.sonnet,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();

  try {
    return JSON.parse(cleaned) as PricingRecommendation;
  } catch {
    console.error("analyzeTripPricing: failed to parse Claude response:", cleaned);
    return {
      should_change: false,
      recommended_price_usd: params.current_price_usd,
      price_change_pct: 0,
      urgency: "low",
      reasoning: "Analysis failed to parse — review manually.",
      signals: [],
    };
  }
}

// ---- ENGAGEMENT AGENT ----

export type EngagementRecommendation = {
  priority_score: number; // 0-100
  outreach_timing: "today" | "this_week" | "next_month" | "hold";
  recommended_trip_type: string;
  subject_line: string;
  email_draft: string;
  reasoning: string;
};

export async function generateClientOutreach(params: {
  client_name: string;
  company: string;
  trip_history: string; // formatted list of past trips
  last_trip_date: string;
  total_spend: number;
  fitness_level?: string;
  strava_summary?: string;
  available_trips: string; // formatted list of upcoming trips
  last_outreach?: string;
}): Promise<EngagementRecommendation> {
  const prompt = `You are writing personalized outreach for ${params.company}, a premium adventure travel company.
Your goal is to reconnect with past clients in a way that feels personal, not like a newsletter blast.

CLIENT PROFILE:
- Name: ${params.client_name}
- Trip history: ${params.trip_history}
- Last trip: ${params.last_trip_date}
- Lifetime value: $${params.total_spend.toLocaleString()}
${params.fitness_level ? `- Self-reported fitness: ${params.fitness_level}` : ""}
${params.strava_summary ? `- Recent Strava activity: ${params.strava_summary}` : ""}
${params.last_outreach ? `- Last outreach: ${params.last_outreach}` : ""}

AVAILABLE UPCOMING TRIPS:
${params.available_trips}

TONE GUIDELINES:
- Write like a trusted guide reaching out to a client they know personally, not a salesperson.
- Reference their specific past trips by name when relevant.
- If there's Strava data, use it — but naturally, not creepily ("I saw you've been training..." not "According to your Strava data...").
- Keep emails concise: 4-6 sentences max.
- End with a single, clear call to action.

Respond in this exact JSON format:
{
  "priority_score": number (0-100),
  "outreach_timing": "today|this_week|next_month|hold",
  "recommended_trip_type": "string",
  "subject_line": "string",
  "email_draft": "string (the full email body, personalized)",
  "reasoning": "1-2 sentences explaining why this client and why now"
}`;

  const response = await anthropic.messages.create({
    model: MODELS.sonnet,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
  return JSON.parse(cleaned) as EngagementRecommendation;
}

// ---- ITINERARY AGENT ----

export type GeneratedItineraryContent = {
  title: string;
  summary: string;
  duration_days: number;
  region: string;
  difficulty: string;
  highlights: string[];
  itinerary: {
    day: number;
    title: string;
    description: string;
    distance_km?: number;
    elevation_m?: number;
    hotel: string;
    hotel_id?: string;
    meals: string[];
  }[];
  cost_breakdown: {
    hotels_usd: number;
    guides_usd: number;
    transport_usd: number;
    meals_usd: number;
    other_usd: number;
    total_cost_usd: number;
    recommended_price_per_person_usd: number;
    gross_margin: number;
  };
  proposal_intro: string; // opening paragraph for the client email
};

export async function generateItinerary(params: {
  inquiry_text: string;
  group_size: number;
  duration_days: number;
  region: string;
  cycling_ability: string;
  budget_per_person?: number;
  special_requests?: string;
  template_trips: string; // JSON summary of relevant past trips
  available_hotels: string; // JSON summary of hotels in the region
  target_margin: number;
}): Promise<GeneratedItineraryContent> {
  const prompt = `You are the head of trip planning at Thomson Bike Tours, a premium cycling travel company.
Generate a detailed private trip itinerary based on this inquiry.

INQUIRY:
${params.inquiry_text}

KEY REQUIREMENTS:
- Group size: ${params.group_size} guests
- Duration: ${params.duration_days} days
- Region: ${params.region}
- Cycling ability: ${params.cycling_ability}
${params.budget_per_person ? `- Budget: ~$${params.budget_per_person.toLocaleString()}/person` : ""}
${params.special_requests ? `- Special requests: ${params.special_requests}` : ""}

RELEVANT PAST TRIPS (use as templates):
${params.template_trips}

AVAILABLE HOTELS IN REGION:
${params.available_hotels}

FINANCIAL TARGETS:
- Target gross margin: ${(params.target_margin * 100).toFixed(0)}%
- Pricing note: Private trips should price confidently. This is a premium product.

ITINERARY GUIDELINES:
- Start with an arrival day (transfers, bike fitting, welcome dinner)
- End with a departure day
- Riding days should have realistic distances given the ability level
- Vary the days: not every day should be maximum effort
- Hotel selections should reflect the Thomson standard (3-4 star minimum, ideally places with character)
- Include iconic climbs and destinations specific to the region

Generate a complete, client-ready itinerary in this JSON format:
{
  "title": "trip title",
  "summary": "2-3 sentence overview for client",
  "duration_days": number,
  "region": "string",
  "difficulty": "easy|moderate|challenging|epic",
  "highlights": ["highlight 1", "highlight 2", ...],
  "itinerary": [
    {
      "day": 1,
      "title": "Arrival in [City]",
      "description": "Full description of the day",
      "distance_km": null or number,
      "elevation_m": null or number,
      "hotel": "Hotel name",
      "meals": ["Breakfast", "Dinner"]
    }
  ],
  "cost_breakdown": {
    "hotels_usd": number,
    "guides_usd": number,
    "transport_usd": number,
    "meals_usd": number,
    "other_usd": number,
    "total_cost_usd": number,
    "recommended_price_per_person_usd": number,
    "gross_margin": number (0-1)
  },
  "proposal_intro": "Warm, personalized opening paragraph for the client email"
}`;

  const response = await anthropic.messages.create({
    model: MODELS.sonnet,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
  return JSON.parse(cleaned) as GeneratedItineraryContent;
}

// ---- COMPETITOR ALERT ----

export async function analyzeCompetitorPriceChange(params: {
  our_trip_name: string;
  our_current_price: number;
  competitor_name: string;
  competitor_product: string;
  old_price: number;
  new_price: number;
  change_pct: number;
}): Promise<{ title: string; reasoning: string; recommended_action: string }> {
  const prompt = `A competitor has changed their price for a product that competes with one of our trips.
Analyze this and provide a brief recommendation.

OUR PRODUCT: ${params.our_trip_name} at $${params.our_current_price.toLocaleString()}
COMPETITOR: ${params.competitor_name} - "${params.competitor_product}"
PRICE CHANGE: $${params.old_price.toLocaleString()} → $${params.new_price.toLocaleString()} (${params.change_pct > 0 ? "+" : ""}${(params.change_pct * 100).toFixed(1)}%)

Respond in JSON:
{
  "title": "one-line summary for the inbox",
  "reasoning": "2-3 sentence analysis of what this means for us",
  "recommended_action": "specific recommendation (hold price / consider increase / investigate / etc.)"
}`;

  const response = await anthropic.messages.create({
    model: MODELS.haiku,
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
  return JSON.parse(cleaned);
}
