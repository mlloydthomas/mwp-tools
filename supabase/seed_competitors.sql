-- ============================================================
-- MWP Competitor Seed Data
-- Real URLs + current 2026 pricing (researched Feb 2026)
-- Run AFTER schema.sql in Supabase SQL Editor
-- ============================================================

-- ============================================================
-- THOMSON BIKE TOURS (TBT) COMPETITORS
-- ============================================================

-- Butterfield & Robinson — Alps/Pyrenees cycling, premium competitor
-- Price discovery note: B&R does not publish prices on listing pages;
-- pricing is quote-on-request. We scrape their trip pages for any
-- "from" price that appears. Selector may need tuning.
INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern,
  last_price_usd, is_active, notes
)
SELECT
  c.id,
  'Butterfield & Robinson',
  'https://www.butterfield.com/biking/europe/alps',
  'Alps Biking Collection',
  'signature',
  'alps',
  '.price, .trip-price, [class*="price"], [data-price]',
  '\$[\d,]+',
  NULL,  -- no public price yet; scraper will find it
  true,
  'Premium competitor. Prices are often quote-on-request; scraper will capture any "from" price shown. Check manually if scraper returns null.'
FROM companies c WHERE c.slug = 'tbt';

INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern,
  last_price_usd, is_active, notes
)
SELECT
  c.id,
  'Butterfield & Robinson',
  'https://www.butterfield.com/biking/europe/pyrenees',
  'Pyrenees Biking Collection',
  'signature',
  'pyrenees',
  '.price, .trip-price, [class*="price"]',
  '\$[\d,]+',
  NULL,
  true,
  'Pyrenees trips — direct competitor to Thomson Pyrenees signature.'
FROM companies c WHERE c.slug = 'tbt';

-- DuVine — most directly comparable to Thomson on Alps/Pyrenees
-- Prices confirmed from duvine.com Feb 2026:
--   Alps Challenge (6 days): from $5,595/person
--   Pyrenees Journey (7 days): from $5,995/person  
--   Dolomites Challenge (6 days): from $6,095/person
--   Savoie/Annecy (6 days): from $6,795/person
INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern,
  last_price_usd, is_active, notes
)
SELECT
  c.id,
  'DuVine Cycling',
  'https://www.duvine.com/tour/alps-challenge/',
  'Alps Challenge — HC Climbs & Cols',
  'signature',
  'alps',
  '.tour-price, .price-from, [class*="Price"], h2 + p',
  'From:\s*\$[\d,]+|\$[\d,]+',
  5595,
  true,
  '6-day Alps climbing trip. From $5,595/person confirmed Feb 2026. Includes Alpe d''Huez, Colnago V4 bike.'
FROM companies c WHERE c.slug = 'tbt';

INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern,
  last_price_usd, is_active, notes
)
SELECT
  c.id,
  'DuVine Cycling',
  'https://www.duvine.com/tour/pyrenees-journey-bike-tour/',
  'Pyrenees Journey — Med to Atlantic',
  'signature',
  'pyrenees',
  '.tour-price, .price-from, [class*="Price"]',
  'From:\s*\$[\d,]+|\$[\d,]+',
  5995,
  true,
  '7-day Pyrenees traverse. From $5,995/person confirmed Feb 2026. Includes Tourmalet, Aubisque.'
FROM companies c WHERE c.slug = 'tbt';

INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern,
  last_price_usd, is_active, notes
)
SELECT
  c.id,
  'DuVine Cycling',
  'https://www.duvine.com/tour/dolomites-challenge/',
  'Dolomites Challenge — Italian Alps',
  'signature',
  'dolomites',
  '.tour-price, .price-from, [class*="Price"]',
  'From:\s*\$[\d,]+|\$[\d,]+',
  6095,
  true,
  '6-day Dolomites. From $6,095/person confirmed Feb 2026. Includes Stelvio.'
FROM companies c WHERE c.slug = 'tbt';

-- Trek Travel — Official TDF tour operator (direct TDF competitor)
-- Note: Trek Travel is also an Official TDF Tour Operator — important context for pricing
-- Their TDF trips use "call for pricing" but Alps/Pyrenees classics are published
INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern,
  last_price_usd, is_active, notes
)
SELECT
  c.id,
  'Trek Travel',
  'https://trektravel.com/tour/cycling/classic-climbs-alps/',
  'Classic Climbs: The Alps',
  'signature',
  'alps',
  '.price, [class*="price"], .trip-cost',
  '\$[\d,]+',
  NULL,
  true,
  'IMPORTANT: Trek Travel is also an Official TDF Tour Operator like Thomson — direct competitor for TDF trips. Alps trip pricing not published (call for pricing). Monitor for any price disclosure.'
FROM companies c WHERE c.slug = 'tbt';

INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern,
  last_price_usd, is_active, notes
)
SELECT
  c.id,
  'Trek Travel',
  'https://trektravel.com/tour/cycling/classic-climbs-tour/',
  'Classic Climbs: The Tour (Alps + Pyrenees + Ventoux)',
  'signature',
  'alps',
  '.price, [class*="price"], .trip-cost',
  '\$[\d,]+',
  NULL,
  true,
  '9-day epic — Alps, Provence, Pyrenees + Mont Ventoux. Direct TDF competitor. Monitor for pricing.'
FROM companies c WHERE c.slug = 'tbt';

-- Backroads — Largest competitor by volume; more mass-market but useful benchmark
-- Prices confirmed from backroads.com Feb 2026:
--   France (various): $4,649–$6,899/person for 6-day trips
--   Alps/Dolomites: $5,499–$6,099 range
INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern,
  last_price_usd, is_active, notes
)
SELECT
  c.id,
  'Backroads',
  'https://www.backroads.com/award-winning-tours/biking/france',
  'France Biking — Full Collection',
  'signature',
  'france',
  '[class*="price"], .trip-price, .from-price',
  '\$[\d,]+(?:/person)?',
  5899,
  true,
  'Backroads France collection. Prices range $4,649–$6,899 confirmed Feb 2026. Lower service level than Thomson but massive brand awareness. Useful floor/ceiling benchmark.'
FROM companies c WHERE c.slug = 'tbt';

INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern,
  last_price_usd, is_active, notes
)
SELECT
  c.id,
  'Backroads',
  'https://www.backroads.com/trips/BDXI/dordogne-bordeaux-france-biking-tour',
  'Bordeaux & Dordogne Bike Tour',
  'signature',
  'france',
  '[class*="price"], .trip-price, .from-price',
  '\$[\d,]+',
  5999,
  true,
  '6-day Bordeaux. From $5,999–$6,849/person confirmed Feb 2026. Useful price benchmark for wine country trips.'
FROM companies c WHERE c.slug = 'tbt';

-- ============================================================
-- ALPENGLOW EXPEDITIONS (AEX) COMPETITORS
-- ============================================================

-- Alpine Ascents International — Seattle-based, most direct AEX competitor
-- Prices confirmed from alpineascents.com Feb 2026:
--   Kilimanjaro (8-day Lemosho): $6,900
--   Kilimanjaro (9-day Lemosho + Safari): $10,350
INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern,
  last_price_usd, is_active, notes
)
SELECT
  c.id,
  'Alpine Ascents International',
  'https://www.alpineascents.com/alpine-ascents-calendar/',
  'Full Schedule & Pricing',
  'international',
  'himalaya',
  '[class*="price"], .expedition-price, td',
  '\$[\d,]+',
  NULL,
  true,
  'Primary AEX competitor — Seattle-based, similar market. Calendar page has all pricing. Denali, Everest, Ama Dablam. Monitor for price changes across all products.'
FROM companies c WHERE c.slug = 'aex';

INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern,
  last_price_usd, is_active, notes
)
SELECT
  c.id,
  'Alpine Ascents International',
  'https://www.alpineascents.com/climbs/denali/price-schedule/',
  'Denali Expedition',
  'advanced',
  'alaska',
  '[class*="price"], .price, td, p',
  '\$[\d,]+',
  NULL,
  true,
  'AAI Denali price page. Multiple dates with capacity noted (e.g. "3 spaces left" = useful demand signal). Monitor both price and availability language.'
FROM companies c WHERE c.slug = 'aex';

-- Mountain Trip — Denali specialist, AEX Denali competitor
INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern,
  last_price_usd, is_active, notes
)
SELECT
  c.id,
  'Mountain Trip',
  'https://www.mountaintrip.com/climb/denali',
  'Denali Expedition',
  'advanced',
  'alaska',
  '[class*="price"], .price, .cost',
  '\$[\d,]+',
  NULL,
  true,
  'Denali specialist. Direct competitor to AEX Denali program. Monitor pricing.'
FROM companies c WHERE c.slug = 'aex';

INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern,
  last_price_usd, is_active, notes
)
SELECT
  c.id,
  'Mountain Trip',
  'https://www.mountaintrip.com/expeditions',
  'Full Expedition Schedule',
  'international',
  'himalaya',
  '[class*="price"], .price, .expedition-price',
  '\$[\d,]+',
  NULL,
  true,
  'Full schedule page — monitor for price changes across Himalayan expeditions.'
FROM companies c WHERE c.slug = 'aex';

-- IMG Expeditions — Major Everest operator, AEX Everest competitor
INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern,
  last_price_usd, is_active, notes
)
SELECT
  c.id,
  'IMG Expeditions',
  'https://www.mountainguides.com/everest-south.shtml',
  'Everest South Col Expedition',
  'advanced',
  'himalaya',
  '[class*="price"], .price, td, p',
  '\$[\d,]+',
  NULL,
  true,
  'IMG is one of the largest Everest operators — important benchmark for AEX Everest pricing. Also runs Ama Dablam.'
FROM companies c WHERE c.slug = 'aex';

INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern,
  last_price_usd, is_active, notes
)
SELECT
  c.id,
  'IMG Expeditions',
  'https://www.mountainguides.com/ama-dablam.shtml',
  'Ama Dablam Expedition',
  'advanced',
  'himalaya',
  '[class*="price"], .price, td, p',
  '\$[\d,]+',
  NULL,
  true,
  'IMG Ama Dablam — direct AEX competitor on one of AEX core advanced products.'
FROM companies c WHERE c.slug = 'aex';

-- Adventure Consultants — NZ-based, premium Himalayan guiding
-- Prices confirmed from adventureconsultants.com Feb 2026:
--   Luxury EBC Trek (2 pax private): $23,700/person
--   Three Peaks Nepal expedition: $9,900 ex-Kathmandu
INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern,
  last_price_usd, is_active, notes
)
SELECT
  c.id,
  'Adventure Consultants',
  'https://adventureconsultants.com/expeditions/himalayan-climbs/ama-dablam',
  'Ama Dablam Expedition',
  'advanced',
  'himalaya',
  '[class*="price"], .price, .cost, p',
  'US\$[\d,]+|\$[\d,]+',
  NULL,
  true,
  'Premium NZ operator — direct AEX Ama Dablam competitor. Prices on trip notes PDFs (linked from page). Their Lobuche East warm-up structure similar to AEX approach.'
FROM companies c WHERE c.slug = 'aex';

INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern,
  last_price_usd, is_active, notes
)
SELECT
  c.id,
  'Adventure Consultants',
  'https://adventureconsultants.com/expeditions/seven-summits/everest',
  'Everest South Col Expedition',
  'advanced',
  'himalaya',
  '[class*="price"], .price, .expedition-cost, p',
  'US\$[\d,]+|\$[\d,]+',
  NULL,
  true,
  'AC Everest — premium competitor to AEX Everest. Founded by the late Rob Hall (Into Thin Air). 30th Everest expedition in 2026. Pricing typically $65,000+ but rarely published on-page.'
FROM companies c WHERE c.slug = 'aex';

-- Furtenbach Adventures — Austrian ultra-premium operator, Everest specialist
-- Key differentiator: Flash™ Expedition (3 weeks home-to-summit via hypoxic pre-acclimatization)
-- Signature Expedition: ~€200,000 (~$222,000) per person — highest price point in industry
-- Classic/Flash Everest: pricing contact-only, not published on site
-- AEX positioning note: Furtenbach targets the ultra-HNW client willing to pay 3-4x premium
-- for maximum oxygen, private Sherpa, heated tents, live vital monitoring by expedition doctor
INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern,
  last_price_usd, is_active, notes
)
SELECT
  c.id,
  'Furtenbach Adventures',
  'https://www.furtenbachadventures.com/en/trips/mount-everest-south/',
  'Everest South Col — Classic Expedition',
  'advanced',
  'himalaya',
  '[class*="price"], .price, .expedition-price, .cost, p',
  '€[\d,]+|\$[\d,]+|EUR\s*[\d,]+',
  NULL,
  true,
  'Austrian ultra-premium operator. Classic Everest South. Pricing is contact-only — scraper unlikely to find price on page. Monitor manually. Known price tier: Classic ~$65-85K, Flash ~$85-110K, Signature ~$222K. Flash™ model (hypoxic pre-acclimatization) is a key differentiator AEX should be aware of.'
FROM companies c WHERE c.slug = 'aex';

INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern,
  last_price_usd, is_active, notes
)
SELECT
  c.id,
  'Furtenbach Adventures',
  'https://www.furtenbachadventures.com/en/trips/everest-flash-south/',
  'Everest South Flash™ Expedition',
  'advanced',
  'himalaya',
  '[class*="price"], .price, .expedition-price, p',
  '€[\d,]+|\$[\d,]+',
  NULL,
  true,
  'Flash™ = home to summit in 3 weeks using hypoxic tent pre-acclimatization (6-8 wks at home). 100% summit success rate claimed 2018-2022. Innovative model that reduces icefall crossings and basecamp infection risk. Relevant to AEX product development.'
FROM companies c WHERE c.slug = 'aex';

INSERT INTO competitor_products (
  company_id, competitor_name, competitor_url, product_name,
  trip_type, region, scrape_selector, price_pattern,
  last_price_usd, is_active, notes
)
SELECT
  c.id,
  'Furtenbach Adventures',
  'https://www.furtenbachadventures.com/en/trips/everest-signature-north/',
  'Everest Signature Expedition (North)',
  'advanced',
  'himalaya',
  '[class*="price"], .price, .expedition-price, p',
  '€[\d,]+|\$[\d,]+',
  222000,  -- ~€200,000 confirmed via third-party sources Feb 2026
  true,
  'Ultra-premium tier: ~€200,000 (~$222,000). Includes private IFMGA guide, 2 dedicated Sherpas, private luxury tent with bathroom, unlimited O2, live vital sign monitoring by expedition doctor, personal documentary filming. Highest price point in the industry. Defines the ceiling of what the market will bear.'
FROM companies c WHERE c.slug = 'aex';

-- ============================================================
-- NOTES FOR MANUAL MONITORING
-- ============================================================
-- Several competitors above (B&R, Trek Travel, AC Everest) use
-- quote-on-request pricing that won't appear in scraped HTML.
-- For these, set a quarterly calendar reminder to check manually
-- and update last_price_usd directly in Supabase:
--
-- UPDATE competitor_products
-- SET last_price_usd = 68000, last_scraped_at = now()
-- WHERE competitor_name = 'Adventure Consultants'
-- AND product_name = 'Everest South Col Expedition';
-- ============================================================
