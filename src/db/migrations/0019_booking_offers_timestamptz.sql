-- Convert booking_offers time columns to timestamptz and repair malformed pending offers.
--
-- Historical interpretation (do NOT blindly treat all naive values as one zone):
--   offered_at   : written by SQL DEFAULT now() under session TZ Asia/Dhaka
--                  → interpret wall-clock as Asia/Dhaka
--   expires_at   : written by Drizzle Date.toISOString() into timestamp-without-tz
--                  → interpret wall-clock as UTC
--   responded_at : written by Drizzle Date.toISOString()
--                  → interpret wall-clock as UTC
--
-- Pre-migration report: see src/scripts/audit-offer-timestamps.ts / offer-ts-audit.json

-- 1) Dev/staging safety: expire pending offers that were born already expired
UPDATE booking_offers
SET
  status = 'expired',
  responded_at = COALESCE(responded_at, now())
WHERE status = 'pending'
  AND expires_at <= offered_at;

-- 2) Clear stale offered bookings that no longer have a live pending offer
UPDATE bookings b
SET
  status = 'searching',
  updated_at = now()
WHERE b.status = 'offered'
  AND b.assigned_driver_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM booking_offers o
    WHERE o.booking_id = b.id
      AND o.status = 'pending'
      AND o.expires_at > o.offered_at
      AND o.expires_at > now()
  );

-- 3) Convert columns with explicit timezone interpretation
ALTER TABLE booking_offers
  ALTER COLUMN offered_at TYPE timestamptz
    USING offered_at AT TIME ZONE 'Asia/Dhaka',
  ALTER COLUMN expires_at TYPE timestamptz
    USING expires_at AT TIME ZONE 'UTC',
  ALTER COLUMN responded_at TYPE timestamptz
    USING CASE
      WHEN responded_at IS NULL THEN NULL
      ELSE responded_at AT TIME ZONE 'UTC'
    END;

-- Keep SQL default as timestamptz-aware now()
ALTER TABLE booking_offers
  ALTER COLUMN offered_at SET DEFAULT now();

COMMENT ON COLUMN booking_offers.offered_at IS
  'Offer creation instant (timestamptz / UTC). Legacy naive values migrated as Asia/Dhaka wall-clock.';
COMMENT ON COLUMN booking_offers.expires_at IS
  'Offer expiry instant (timestamptz / UTC). Legacy naive values migrated as UTC wall-clock from JS toISOString().';
COMMENT ON COLUMN booking_offers.responded_at IS
  'Offer response/expiry mark instant (timestamptz / UTC). Legacy naive values migrated as UTC wall-clock.';
