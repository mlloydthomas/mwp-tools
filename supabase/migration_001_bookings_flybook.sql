-- ============================================================
-- Migration 001: Add trip_name column and unique index to bookings
-- 
-- Run this if you already ran schema.sql previously.
-- If you're running schema.sql fresh for the first time, skip this file
-- (these changes are already included in schema.sql).
--
-- Safe to run multiple times — uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
-- ============================================================

-- Add trip_name column to bookings (stores the Flybook event title)
ALTER TABLE bookings 
  ADD COLUMN IF NOT EXISTS trip_name text;

-- Add unique index on external_booking_id to prevent Flybook duplicate inserts
-- Only indexes rows where external_booking_id is not null (partial index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_external_id 
  ON bookings(external_booking_id) 
  WHERE external_booking_id IS NOT NULL;

-- Confirm what we just did
SELECT 
  column_name, 
  data_type, 
  is_nullable
FROM information_schema.columns
WHERE table_name = 'bookings'
ORDER BY ordinal_position;
