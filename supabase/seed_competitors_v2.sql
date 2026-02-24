-- ============================================================
-- MWP Competitor Seed Data v2 — EXPANDED
-- Additional competitors added Feb 2026
-- Run this AFTER seed_competitors.sql (original)
-- These are INSERT OR IGNORE equivalents — safe to re-run
-- ============================================================

-- ============================================================
-- THOMSON BIKE TOURS — ADDITIONAL TBT COMPETITORS
-- ============================================================

-- VeloTours — France specialist, direct TDF competitor
INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern, last_price_usd, is_active, notes
)
SELECT c.id,
  'VeloTours', 'https://www.velotours.com/bike-tours/france/tour-de-france/',
  'Tour de France Cycling Vacation', 'tdf', 'france',
  '[class*="price"], .price, .cost', 'from\s*\$[\d,]+|\$[\d,]+',
  NULL, true,
  'Direct TDF competitor — offers similar roadside spectating + cycling packages to Thomson. Key benchmark for TDF pricing.'
FROM companies c WHERE c.slug = 'tbt'
ON CONFLICT DO NOTHING;

-- Trek Travel — Alps + TDF Official Tour Operator (like Thomson)
INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern, last_price_usd, is_active, notes
)
SELECT c.id,
  'Trek Travel', 'https://trektravel.com/trip/tour-de-france/',
  'Tour de France Experience', 'tdf', 'france',
  '[class*="price"], .price, .trip-price, .starting-at', 'from\s*\$[\d,]+|\$[\d,]+',
  NULL, true,
  'IMPORTANT: Trek Travel is ALSO an Official TDF Tour Operator like Thomson — most direct TDF competitor. Prices often require a form (call for pricing). Check manually if scraper returns null. Typically $7,000–$12,000/person range.'
FROM companies c WHERE c.slug = 'tbt'
ON CONFLICT DO NOTHING;

INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern, last_price_usd, is_active, notes
)
SELECT c.id,
  'Trek Travel', 'https://trektravel.com/trip/alps-classic-cycling/',
  'Alps Classic', 'signature', 'alps',
  '[class*="price"], .price, .starting-at', '\$[\d,]+',
  NULL, true,
  'Trek Travel Alps trip — comparable to Thomson Alps signature. Premium brand, similar demographics.'
FROM companies c WHERE c.slug = 'tbt'
ON CONFLICT DO NOTHING;

-- Backroads — additional trips
INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern, last_price_usd, is_active, notes
)
SELECT c.id,
  'Backroads', 'https://www.backroads.com/trips/france/cycling/pyrenees',
  'Pyrenees Bike Tour', 'signature', 'pyrenees',
  '[class*="price"], .starting-from, .trip-price', '\$[\d,]+',
  4999, true,
  'Backroads Pyrenees — from ~$4,999/person confirmed Feb 2026. Useful floor benchmark vs Thomson Pyrenees.'
FROM companies c WHERE c.slug = 'tbt'
ON CONFLICT DO NOTHING;

INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern, last_price_usd, is_active, notes
)
SELECT c.id,
  'Backroads', 'https://www.backroads.com/trips/france/cycling/dolomites',
  'Dolomites Bike Tour', 'signature', 'dolomites',
  '[class*="price"], .starting-from', '\$[\d,]+',
  5499, true,
  'Backroads Dolomites — from ~$5,499/person confirmed Feb 2026.'
FROM companies c WHERE c.slug = 'tbt'
ON CONFLICT DO NOTHING;

-- DuVine — additional trips
INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern, last_price_usd, is_active, notes
)
SELECT c.id,
  'DuVine Cycling', 'https://www.duvine.com/tour/dolomites-challenge/',
  'Dolomites Challenge — Italian Alps', 'signature', 'dolomites',
  '.tour-price, .price-from, [class*="Price"]', 'From:\s*\$[\d,]+|\$[\d,]+',
  6095, true,
  '6-day Dolomites. From $6,095/person confirmed Feb 2026.'
FROM companies c WHERE c.slug = 'tbt'
ON CONFLICT DO NOTHING;

INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern, last_price_usd, is_active, notes
)
SELECT c.id,
  'DuVine Cycling', 'https://www.duvine.com/tour/savoie-annecy-cycling/',
  'Classic Climbs: The Tour (Alps + Pyrenees + Ventoux)', 'signature', 'alps',
  '.tour-price, .price-from, [class*="Price"]', 'From:\s*\$[\d,]+|\$[\d,]+',
  6795, true,
  'DuVine Alps/Savoie tour. From $6,795/person confirmed Feb 2026. Higher-end tier.'
FROM companies c WHERE c.slug = 'tbt'
ON CONFLICT DO NOTHING;

-- ============================================================
-- AEX — ADDITIONAL COMPETITORS
-- ============================================================

-- RMI Expeditions (Rainier Mountaineering Inc) — Rainier & Denali
INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern, last_price_usd, is_active, notes
)
SELECT c.id,
  'RMI Expeditions', 'https://www.rmiguides.com/mt-rainier/summit-climb',
  'Mt. Rainier Summit Climb', 'advanced', 'washington',
  '[class*="price"], .price, td, .program-fee', '\$[\d,]+',
  NULL, true,
  'RMI is a major Pacific NW guide company. Rainier Summit Climb ~$1,300/person. Key competitor for AEX beginner/intermediate technical climbs.'
FROM companies c WHERE c.slug = 'aex'
ON CONFLICT DO NOTHING;

INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern, last_price_usd, is_active, notes
)
SELECT c.id,
  'RMI Expeditions', 'https://www.rmiguides.com/denali/west-buttress',
  'Denali West Buttress Expedition', 'advanced', 'alaska',
  '[class*="price"], .price, .program-fee, td', '\$[\d,]+',
  NULL, true,
  'RMI Denali — direct competitor to AEX Denali program. Monitor price.'
FROM companies c WHERE c.slug = 'aex'
ON CONFLICT DO NOTHING;

-- Alpenglow Expeditions — premium Himalayan operator
INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern, last_price_usd, is_active, notes
)
SELECT c.id,
  'Alpenglow Expeditions', 'https://alpenglowexpeditions.com/expeditions/everest/',
  'Everest Full Expedition', 'advanced', 'himalaya',
  '[class*="price"], .price, .cost, p, td', '\$[\d,]+',
  NULL, true,
  'Alpenglow is a premium Tahoe/Bay Area based operator known for rapid ascent Everest. Direct AEX competitor. Their rapid-ascent model is a strategic differentiator to monitor.'
FROM companies c WHERE c.slug = 'aex'
ON CONFLICT DO NOTHING;

INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern, last_price_usd, is_active, notes
)
SELECT c.id,
  'Alpenglow Expeditions', 'https://alpenglowexpeditions.com/expeditions/ama-dablam/',
  'Ama Dablam Expedition', 'advanced', 'himalaya',
  '[class*="price"], .price, p', '\$[\d,]+',
  NULL, true,
  'Alpenglow Ama Dablam — direct AEX competitor on this route.'
FROM companies c WHERE c.slug = 'aex'
ON CONFLICT DO NOTHING;

-- International Mountain Guides (IMG) — additional AEX competitors
INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern, last_price_usd, is_active, notes
)
SELECT c.id,
  'IMG Expeditions', 'https://www.mountainguides.com/denali.shtml',
  'Denali Expedition', 'advanced', 'alaska',
  '[class*="price"], .price, td, p', '\$[\d,]+',
  NULL, true,
  'IMG Denali — monitor alongside AAI for AEX Denali pricing context.'
FROM companies c WHERE c.slug = 'aex'
ON CONFLICT DO NOTHING;

-- Madison Mountaineering — Himalayan specialist
INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern, last_price_usd, is_active, notes
)
SELECT c.id,
  'Madison Mountaineering', 'https://madisonmountaineering.com/himalayan-expeditions/',
  'Full Schedule & Pricing', 'advanced', 'himalaya',
  '[class*="price"], .price, td, p', '\$[\d,]+',
  NULL, true,
  'Madison Mountaineering — Himalayan specialist with Everest, Lhotse, Ama Dablam programs. Direct AEX competitor on multiple routes. Check pricing page for current rates.'
FROM companies c WHERE c.slug = 'aex'
ON CONFLICT DO NOTHING;

-- ============================================================
-- END OF SEED V2
-- ============================================================
