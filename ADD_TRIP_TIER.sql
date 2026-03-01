-- Step 1: Add trip_tier column
ALTER TABLE trips ADD COLUMN IF NOT EXISTS trip_tier TEXT;

-- Step 2: Create index
CREATE INDEX IF NOT EXISTS trips_trip_tier_idx ON trips(trip_tier);

-- Step 3: Seed trip_tier values based on trip names

-- 8000m tier
UPDATE trips SET trip_tier = '8000m' WHERE name ILIKE '%EVEREST%' OR name ILIKE '%LHAKPA RI%' OR name ILIKE '%CHO OYU%';

-- Advanced tier
UPDATE trips SET trip_tier = 'advanced' WHERE name ILIKE '%AMA DABLAM%' OR name ILIKE '%ALPAMAYO%';

-- Intermediate tier
UPDATE trips SET trip_tier = 'intermediate' WHERE
  name ILIKE '%BOLIVIA%' OR
  name ILIKE '%ILLIMANI%' OR
  name ILIKE '%COTOPAXI%' OR
  name ILIKE '%CHIMBORAZO%' OR
  name ILIKE '%PEAK LENIN%' OR
  name ILIKE '%ARTESONRAJU%' OR
  name ILIKE '%ACONCAGUA%' OR
  name ILIKE '%PERU CLIMBING%' OR
  name ILIKE '%HUAYHUASH%';

-- Beginner tier
UPDATE trips SET trip_tier = 'beginner' WHERE
  name ILIKE '%ECUADOR CLIMBING SCHOOL%' OR
  name ILIKE '%KILIMANJARO%' OR
  name ILIKE '%VOLCANOES OF MEXICO%';

-- Ski tier
UPDATE trips SET trip_tier = 'ski' WHERE
  name ILIKE '%PATAGONIA%' OR
  name ILIKE '%RING OF FIRE%' OR
  name ILIKE '%JAPAN BACKCOUNTRY%';

-- Verify — run this after and paste results back
SELECT trip_tier, COUNT(*) as count
FROM trips
WHERE company_id IN (SELECT id FROM companies WHERE slug = 'aex')
GROUP BY trip_tier
ORDER BY trip_tier;
