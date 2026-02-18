-- ============================================================
-- MWP Tools - Complete Database Schema
-- Run this in your Supabase SQL editor to set up all tables
-- ============================================================

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ============================================================
-- CORE: Companies (TBT and AEX, plus future acquisitions)
-- ============================================================
create table companies (
  id uuid primary key default uuid_generate_v4(),
  slug text unique not null,          -- 'tbt', 'aex', etc.
  name text not null,                  -- 'Thomson Bike Tours'
  short_name text not null,            -- 'Thomson'
  currency text not null default 'USD',
  created_at timestamptz default now()
);

insert into companies (slug, name, short_name, currency) values
  ('tbt', 'Thomson Bike Tours', 'Thomson', 'USD'),
  ('aex', 'Alpenglow Expeditions', 'Alpenglow', 'USD');

-- ============================================================
-- TOOL 1: PRICING AGENT
-- ============================================================

-- Master trip catalog
create table trips (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid references companies(id) not null,
  external_id text,                    -- ID from your booking system
  name text not null,
  trip_type text not null,             -- 'tdf', 'signature', 'private', 'training_camp', 'gravel', 'international', 'beginner_trek', 'advanced'
  region text,                         -- 'alps', 'pyrenees', 'dolomites', 'himalaya', 'ecuador', etc.
  departure_date date not null,
  return_date date,
  capacity_max integer not null,
  capacity_min integer default 1,
  base_price_usd numeric(10,2) not null,
  current_price_usd numeric(10,2) not null,
  cost_basis_usd numeric(10,2),        -- estimated total cost (guides, hotels, logistics)
  target_gross_margin numeric(5,4),    -- e.g. 0.40 for 40%
  status text default 'open',          -- 'open', 'sold_out', 'cancelled', 'completed'
  is_tdf boolean default false,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Bookings (imported from your booking system)
create table bookings (
  id uuid primary key default uuid_generate_v4(),
  trip_id uuid references trips(id) not null,
  company_id uuid references companies(id) not null,
  external_booking_id text,
  guest_count integer not null default 1,
  price_paid_usd numeric(10,2),
  booking_date timestamptz,
  status text default 'confirmed',     -- 'confirmed', 'waitlist', 'cancelled', 'inquiry'
  client_email text,
  client_name text,
  is_private boolean default false,
  notes text,
  created_at timestamptz default now()
);

-- Booking snapshots (daily record of capacity fill per trip - drives velocity analysis)
create table booking_snapshots (
  id uuid primary key default uuid_generate_v4(),
  trip_id uuid references trips(id) not null,
  snapshot_date date not null,
  bookings_count integer not null,
  waitlist_count integer default 0,
  capacity_pct numeric(5,4),           -- bookings / capacity_max
  current_price_usd numeric(10,2),
  created_at timestamptz default now(),
  unique(trip_id, snapshot_date)
);

-- Competitor products to monitor
create table competitor_products (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid references companies(id) not null,    -- which of our businesses this competes with
  competitor_name text not null,
  competitor_url text not null,
  product_name text,
  trip_type text,
  region text,
  scrape_selector text,                -- CSS selector or XPath to find price on the page
  price_pattern text,                  -- regex to extract price from scraped text
  last_price_usd numeric(10,2),
  last_scraped_at timestamptz,
  is_active boolean default true,
  notes text,
  created_at timestamptz default now()
);

-- Competitor price history
create table competitor_price_history (
  id uuid primary key default uuid_generate_v4(),
  competitor_product_id uuid references competitor_products(id) not null,
  price_usd numeric(10,2),
  scraped_at timestamptz default now(),
  raw_text text,                       -- the raw scraped text for debugging
  change_pct numeric(6,4)              -- % change from previous price
);

-- ============================================================
-- SHARED: AI Recommendations Inbox (all three tools use this)
-- ============================================================
create table ai_recommendations (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid references companies(id),
  tool text not null,                  -- 'pricing', 'engagement', 'itinerary', 'competitor_alert'
  status text default 'pending',       -- 'pending', 'approved', 'dismissed', 'edited_approved'
  priority text default 'normal',      -- 'urgent', 'high', 'normal', 'low'
  
  -- Pricing-specific
  trip_id uuid references trips(id),
  current_price_usd numeric(10,2),
  recommended_price_usd numeric(10,2),
  
  -- Competitor alert-specific
  competitor_product_id uuid references competitor_products(id),
  
  -- Engagement-specific
  client_id uuid,                      -- references clients(id) added below
  
  -- Itinerary-specific
  inquiry_id uuid,                     -- references inquiries(id) added below
  
  -- Common fields
  title text not null,
  ai_reasoning text,                   -- Claude's explanation
  draft_content text,                  -- email draft, itinerary draft, etc.
  final_content text,                  -- human-edited version
  
  -- Metadata
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz default now()
);

-- ============================================================
-- TOOL 2: CLIENT ENGAGEMENT
-- ============================================================

create table clients (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid references companies(id),            -- primary company relationship
  email text not null,
  first_name text,
  last_name text,
  phone text,
  country text,
  city text,
  
  -- Fitness / experience profile
  fitness_level text,                  -- 'beginner', 'intermediate', 'advanced', 'elite'
  experience_notes text,               -- freeform notes on their background
  
  -- Strava integration
  strava_athlete_id bigint,
  strava_access_token text,
  strava_refresh_token text,
  strava_token_expires_at timestamptz,
  strava_last_synced_at timestamptz,
  
  -- Strava stats (cached from last sync)
  strava_ytd_ride_distance_km numeric(10,2),
  strava_ytd_ride_elevation_m numeric(10,2),
  strava_ytd_run_distance_km numeric(10,2),
  strava_all_time_rides integer,
  strava_biggest_ride_km numeric(10,2),
  strava_recent_activity_date date,
  strava_recent_activity_type text,
  strava_recent_activity_name text,
  strava_recent_activity_distance_km numeric(8,2),
  strava_recent_activity_elevation_m numeric(8,2),
  
  -- Engagement scoring
  engagement_score integer default 50,  -- 0-100, updated by AI
  last_trip_date date,
  total_trips integer default 0,
  total_spend_usd numeric(12,2) default 0,
  likely_next_trip_type text,
  last_outreach_date date,
  last_outreach_response text,          -- 'positive', 'negative', 'no_response'
  
  -- Cross-company (MWP customer, not just TBT or AEX)
  is_cross_company boolean default false,
  notes text,
  
  source text,                          -- 'booking', 'inquiry', 'manual', 'import'
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(email)
);

-- Add FK now that clients table exists
alter table ai_recommendations add constraint fk_client
  foreign key (client_id) references clients(id);

-- Client trip history (links clients to trips they've taken)
create table client_trips (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) not null,
  trip_id uuid references trips(id),
  company_id uuid references companies(id) not null,
  trip_name text not null,             -- denormalized for speed
  trip_date date,
  price_paid_usd numeric(10,2),
  trip_type text,
  region text,
  nps_score integer,                   -- 1-10
  review_text text,
  created_at timestamptz default now()
);

-- Outreach log
create table outreach_log (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) not null,
  company_id uuid references companies(id),
  recommendation_id uuid references ai_recommendations(id),
  sent_at timestamptz,
  channel text default 'email',        -- 'email', 'phone', 'sms'
  subject text,
  body text,
  response text,                       -- 'positive', 'booked', 'negative', 'no_response'
  response_at timestamptz,
  created_at timestamptz default now()
);

-- ============================================================
-- TOOL 3: PRIVATE TRIP ITINERARY (Thomson)
-- ============================================================

-- Knowledge base: past trips that Claude uses as templates
create table trip_templates (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid references companies(id) not null,
  name text not null,
  region text not null,
  trip_type text default 'private',
  duration_days integer not null,
  difficulty text,                     -- 'easy', 'moderate', 'challenging', 'epic'
  min_pax integer,
  max_pax integer,
  base_cost_per_person_usd numeric(10,2),
  base_price_per_person_usd numeric(10,2),
  gross_margin numeric(5,4),
  highlights text[],                   -- array of key selling points
  itinerary_json jsonb,                -- full day-by-day structure
  tags text[],                         -- ['climbing', 'tdf', 'gravel', 'training']
  times_booked integer default 1,
  source_document_name text,
  created_at timestamptz default now()
);

-- Hotel database
create table hotels (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  region text not null,
  country text not null,
  city text,
  route_tags text[],                   -- which routes/stages this hotel serves
  stars integer,
  cost_per_room_usd numeric(10,2),     -- typical Thomson rate
  rooms_available integer,             -- typical block size we can get
  lead_time_days integer,              -- how far ahead we need to book
  notes text,                          -- special notes (breakfast included, bike storage, etc.)
  contact_name text,
  contact_email text,
  is_preferred boolean default false,
  created_at timestamptz default now()
);

-- Private trip inquiries
create table inquiries (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid references companies(id) not null,
  client_id uuid references clients(id),
  
  -- What they asked for
  raw_inquiry_text text,               -- original email/form submission
  requested_dates_start date,
  requested_dates_end date,
  group_size integer,
  cycling_ability text,
  preferred_region text,
  preferred_trip_type text,
  budget_per_person_usd numeric(10,2),
  special_requests text,
  
  -- Parsed by AI
  parsed_requirements jsonb,
  
  status text default 'new',           -- 'new', 'draft_sent', 'proposal_sent', 'booked', 'lost', 'stale'
  assigned_to text,
  
  source text default 'email',         -- 'email', 'website_form', 'phone', 'referral'
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Add FK now that inquiries table exists
alter table ai_recommendations add constraint fk_inquiry
  foreign key (inquiry_id) references inquiries(id);

-- Generated itineraries
create table itineraries (
  id uuid primary key default uuid_generate_v4(),
  inquiry_id uuid references inquiries(id) not null,
  company_id uuid references companies(id) not null,
  recommendation_id uuid references ai_recommendations(id),
  
  version integer default 1,
  status text default 'draft',         -- 'draft', 'approved', 'sent', 'accepted', 'rejected'
  
  title text,
  duration_days integer,
  group_size integer,
  region text,
  
  itinerary_json jsonb,                -- full day-by-day structure
  hotels_json jsonb,                   -- selected hotels with costs
  
  cost_breakdown_json jsonb,           -- itemized costs
  total_cost_usd numeric(12,2),
  quoted_price_per_person_usd numeric(10,2),
  gross_margin numeric(5,4),
  
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- INDEXES for performance
-- ============================================================
create index idx_trips_company on trips(company_id);
create index idx_trips_departure on trips(departure_date);
create index idx_trips_status on trips(status);
create index idx_bookings_trip on bookings(trip_id);
create index idx_bookings_client_email on bookings(client_email);
create index idx_booking_snapshots_trip_date on booking_snapshots(trip_id, snapshot_date);
create index idx_clients_email on clients(email);
create index idx_clients_company on clients(company_id);
create index idx_clients_strava on clients(strava_athlete_id);
create index idx_ai_recommendations_status on ai_recommendations(status);
create index idx_ai_recommendations_tool on ai_recommendations(tool);
create index idx_competitor_products_active on competitor_products(is_active);
create index idx_inquiries_status on inquiries(status);

-- ============================================================
-- ROW LEVEL SECURITY (basic - expand as needed)
-- ============================================================
alter table companies enable row level security;
alter table trips enable row level security;
alter table bookings enable row level security;
alter table clients enable row level security;
alter table ai_recommendations enable row level security;
alter table competitor_products enable row level security;
alter table competitor_price_history enable row level security;

-- For now: authenticated users can read/write everything
-- Tighten this per-company once you add user roles
create policy "authenticated full access" on companies for all using (auth.role() = 'authenticated');
create policy "authenticated full access" on trips for all using (auth.role() = 'authenticated');
create policy "authenticated full access" on bookings for all using (auth.role() = 'authenticated');
create policy "authenticated full access" on clients for all using (auth.role() = 'authenticated');
create policy "authenticated full access" on ai_recommendations for all using (auth.role() = 'authenticated');
create policy "authenticated full access" on competitor_products for all using (auth.role() = 'authenticated');
create policy "authenticated full access" on competitor_price_history for all using (auth.role() = 'authenticated');

-- Service role bypasses RLS (used by cron jobs and server-side agent code)
-- This is automatic in Supabase when using the service role key
