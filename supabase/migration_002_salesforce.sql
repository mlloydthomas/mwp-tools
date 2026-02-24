-- ============================================================
-- Migration 002: Add columns needed for Salesforce sync
-- 
-- Run this in Supabase SQL Editor BEFORE running the Salesforce sync.
-- Safe to run multiple times — uses ADD COLUMN IF NOT EXISTS.
-- ============================================================

-- Add 'status' column to bookings (was missing from original schema)
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'confirmed';

-- Add 'booking_source' column to track where each booking came from
-- Values: 'salesforce', 'flybook', 'excel', 'manual'
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS booking_source text DEFAULT 'excel';

-- Confirm the final bookings table structure
SELECT
  column_name,
  data_type,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'bookings'
ORDER BY ordinal_position;
