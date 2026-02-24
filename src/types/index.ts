// ============================================================
// MWP Tools - Core Types
// ============================================================

export type Company = {
  id: string;
  slug: "tbt" | "aex" | string;
  name: string;
  short_name: string;
  currency: string;
};

// ---- PRICING ----

export type Trip = {
  id: string;
  company_id: string;
  external_id?: string;
  name: string;
  trip_type: TripType;
  region?: string;
  departure_date: string;
  return_date?: string;
  capacity_max: number;
  capacity_min: number;
  base_price_usd: number;
  current_price_usd: number;
  cost_basis_usd?: number;
  target_gross_margin?: number;
  status: "open" | "sold_out" | "cancelled" | "completed";
  is_tdf: boolean;
  notes?: string;
  // Joined
  company?: Company;
  bookings_count?: number;
  capacity_pct?: number;
};

export type TripType =
  | "tdf"
  | "signature"
  | "private"
  | "training_camp"
  | "gravel"
  | "international"
  | "beginner_trek"
  | "advanced"
  | "race"
  | string;

export type BookingSnapshot = {
  id: string;
  trip_id: string;
  snapshot_date: string;
  bookings_count: number;
  waitlist_count: number;
  capacity_pct: number;
  current_price_usd: number;
};

export type CompetitorProduct = {
  id: string;
  company_id: string;
  competitor_name: string;
  competitor_url: string;
  product_name?: string;
  trip_type?: string;
  region?: string;
  scrape_selector?: string;
  price_pattern?: string;
  last_price_usd?: number;
  last_scraped_at?: string;
  is_active: boolean;
  notes?: string;
};

export type CompetitorPriceHistory = {
  id: string;
  competitor_product_id: string;
  price_usd: number;
  scraped_at: string;
  raw_text?: string;
  change_pct?: number;
};

// ---- RECOMMENDATIONS (shared inbox) ----

export type RecommendationTool =
  | "pricing"
  | "engagement"
  | "itinerary"
  | "competitor_alert";

export type RecommendationStatus =
  | "pending"
  | "approved"
  | "dismissed"
  | "edited_approved";

export type AiRecommendation = {
  id: string;
  company_id?: string;
  tool: RecommendationTool;
  status: RecommendationStatus;
  priority: "urgent" | "high" | "normal" | "low";
  // Pricing
  trip_id?: string;
  current_price_usd?: number;
  recommended_price_usd?: number;
  // Competitor
  competitor_product_id?: string;
  // Engagement
  client_id?: string;
  // Itinerary
  inquiry_id?: string;
  // Common
  title: string;
  ai_reasoning?: string;
  draft_content?: string;
  final_content?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  created_at: string;
  // Joined
  trip?: Trip;
  client?: Client;
  inquiry?: Inquiry;
  competitor_product?: CompetitorProduct;
  company?: { short_name: string; name: string };
};

// ---- CLIENT ENGAGEMENT ----

export type FitnessLevel = "beginner" | "intermediate" | "advanced" | "elite";

export type Client = {
  id: string;
  company_id?: string;
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  country?: string;
  city?: string;
  fitness_level?: FitnessLevel;
  experience_notes?: string;
  // Strava
  strava_athlete_id?: number;
  strava_ytd_ride_distance_km?: number;
  strava_ytd_ride_elevation_m?: number;
  strava_ytd_run_distance_km?: number;
  strava_all_time_rides?: number;
  strava_biggest_ride_km?: number;
  strava_recent_activity_date?: string;
  strava_recent_activity_type?: string;
  strava_recent_activity_name?: string;
  strava_recent_activity_distance_km?: number;
  strava_recent_activity_elevation_m?: number;
  // Engagement
  engagement_score?: number;
  last_trip_date?: string;
  total_trips?: number;
  total_spend_usd?: number;
  likely_next_trip_type?: string;
  last_outreach_date?: string;
  last_outreach_response?: string;
  is_cross_company?: boolean;
  notes?: string;
  source?: string;
  created_at: string;
  // Joined
  company?: Company;
  trip_history?: ClientTrip[];
};

export type ClientTrip = {
  id: string;
  client_id: string;
  trip_id?: string;
  company_id: string;
  trip_name: string;
  trip_date?: string;
  price_paid_usd?: number;
  trip_type?: string;
  region?: string;
  nps_score?: number;
  review_text?: string;
};

// ---- ITINERARY ----

export type Hotel = {
  id: string;
  name: string;
  region: string;
  country: string;
  city?: string;
  route_tags?: string[];
  stars?: number;
  cost_per_room_usd?: number;
  rooms_available?: number;
  lead_time_days?: number;
  notes?: string;
  contact_name?: string;
  contact_email?: string;
  is_preferred: boolean;
};

export type TripTemplate = {
  id: string;
  company_id: string;
  name: string;
  region: string;
  trip_type: string;
  duration_days: number;
  difficulty?: string;
  min_pax?: number;
  max_pax?: number;
  base_cost_per_person_usd?: number;
  base_price_per_person_usd?: number;
  gross_margin?: number;
  highlights?: string[];
  itinerary_json?: ItineraryDay[];
  tags?: string[];
  times_booked: number;
  source_document_name?: string;
};

export type ItineraryDay = {
  day: number;
  title: string;
  description: string;
  distance_km?: number;
  elevation_m?: number;
  difficulty?: string;
  hotel?: string;
  meals?: string[];
  highlights?: string[];
};

export type Inquiry = {
  id: string;
  company_id: string;
  client_id?: string;
  raw_inquiry_text?: string;
  requested_dates_start?: string;
  requested_dates_end?: string;
  group_size?: number;
  cycling_ability?: string;
  preferred_region?: string;
  preferred_trip_type?: string;
  budget_per_person_usd?: number;
  special_requests?: string;
  parsed_requirements?: Record<string, unknown>;
  status: "new" | "draft_sent" | "proposal_sent" | "booked" | "lost" | "stale";
  assigned_to?: string;
  source?: string;
  created_at: string;
  client?: Client;
};

export type GeneratedItinerary = {
  id: string;
  inquiry_id: string;
  company_id: string;
  recommendation_id?: string;
  version: number;
  status: "draft" | "approved" | "sent" | "accepted" | "rejected";
  title?: string;
  duration_days?: number;
  group_size?: number;
  region?: string;
  itinerary_json?: ItineraryDay[];
  hotels_json?: HotelSelection[];
  cost_breakdown_json?: CostBreakdown;
  total_cost_usd?: number;
  quoted_price_per_person_usd?: number;
  gross_margin?: number;
};

export type HotelSelection = {
  hotel_id: string;
  hotel_name: string;
  nights: number;
  cost_per_room_usd: number;
  rooms_needed: number;
  total_cost_usd: number;
  notes?: string;
};

export type CostBreakdown = {
  hotels_usd: number;
  guides_usd: number;
  transport_usd: number;
  meals_usd: number;
  equipment_usd: number;
  other_usd: number;
  total_cost_usd: number;
  recommended_price_per_person_usd: number;
  gross_margin: number;
};

// ---- API RESPONSES ----

export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string };
