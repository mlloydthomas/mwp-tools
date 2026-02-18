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
  bookings_count: number;
  capacity_pct: number;
  waitlist_count: number;
  historical_velocity?: string; // e.g. "tracking 40% ahead of last year"
  competitor_prices?: string; // e.g. "Competitor A: $3,200; Competitor B: $2,800"
}): Promise<PricingRecommendation> {
  const prompt = `You are a revenue management expert for Milky Way Park, a premium adventure travel company.
Analyze this trip and provide a pricing recommendation.

TRIP DETAILS:
- Name: ${params.trip_name}
- Type: ${params.trip_type}
- Departure: ${params.departure_date} (${params.days_until_departure} days away)
- Current price: $${params.current_price_usd.toLocaleString()}
- Cost basis: $${params.cost_basis_usd.toLocaleString()}
- Target gross margin: ${(params.target_margin * 100).toFixed(0)}%
- Current margin: ${(((params.current_price_usd - params.cost_basis_usd) / params.current_price_usd) * 100).toFixed(1)}%

CAPACITY:
- Maximum capacity: ${params.capacity_max} guests
- Current bookings: ${params.bookings_count} (${(params.capacity_pct * 100).toFixed(0)}% full)
- Waitlist: ${params.waitlist_count}
${params.historical_velocity ? `- Historical velocity: ${params.historical_velocity}` : ""}

${params.competitor_prices ? `COMPETITOR PRICING:\n${params.competitor_prices}` : ""}

PRICING PRINCIPLES:
- These are premium, word-of-mouth businesses. Price changes should feel considered, not opportunistic.
- TDF trips have inelastic demand and significant waitlists; be more aggressive with pricing.
- Private trips should target 40%+ gross margins.
- Signature/open enrollment trips are more price-sensitive (marketing weakness means we can't easily replace churned customers).
- If a trip is >80% full and >60 days out, a price increase is almost always warranted.
- If a trip is <30% full and <45 days out, consider a modest reduction or promotion.

Respond in this exact JSON format:
{
  "should_change": true/false,
  "recommended_price_usd": number,
  "price_change_pct": number (positive = increase, negative = decrease),
  "urgency": "urgent|high|normal|low",
  "reasoning": "2-3 sentence explanation for the human reviewer",
  "signals": ["signal 1", "signal 2", "signal 3"] (bullet-point observations that drove the recommendation)
}`;

  const response = await anthropic.messages.create({
    model: MODELS.sonnet,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
  return JSON.parse(cleaned) as PricingRecommendation;
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
