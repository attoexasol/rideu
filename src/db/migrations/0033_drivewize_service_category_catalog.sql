-- DriveWize passenger service category catalog migration.
-- Idempotent: safe to re-run.
--
-- 1) Inserts six NEW DriveWize bookable products (new UUIDs via gen_random_uuid / default).
-- 2) Soft-deactivates legacy Rydu products (ride/bike/cng/moto/premium/comfort).
-- 3) Does NOT delete categories, bookings, market fares, or junction rows.
-- 4) Does NOT remap historical bookings.service_category_id.
-- 5) Does NOT seed market fares — Admin configures production rates afterward.
-- 6) Does NOT create a bookable `bus` service category.
--
-- Catalog base_fare / per_km_rate / min_fare are NOT NULL placeholders (0.00).
-- Live quotes use service_category_market_fares only; do not treat these as production rates.

INSERT INTO "service_categories" (
  "code",
  "name",
  "description",
  "icon_key",
  "capacity",
  "base_fare",
  "per_km_rate",
  "min_fare",
  "sort_order",
  "is_active"
)
VALUES
  (
    'economy',
    'Economy Sedan',
    'Comfortable, cost-effective sedan transportation for individuals and couples.',
    'economy',
    3,
    0.00,
    0.00,
    0.00,
    1,
    true
  ),
  (
    'executive',
    'Executive Sedan',
    'Premium sedan service for executives, airport travelers and business passengers.',
    'executive',
    3,
    0.00,
    0.00,
    0.00,
    2,
    true
  ),
  (
    'suv',
    'SUV',
    'More passenger and luggage capacity with additional comfort for families, executives and small groups.',
    'suv',
    6,
    0.00,
    0.00,
    0.00,
    3,
    true
  ),
  (
    'van',
    'Passenger Van',
    'Ideal for families, groups, airport transportation, events and group travel.',
    'van',
    8,
    0.00,
    0.00,
    0.00,
    4,
    true
  ),
  (
    'minivan',
    'Mini-Van',
    'Comfortable seating and generous luggage room for families and small groups.',
    'minivan',
    5,
    0.00,
    0.00,
    0.00,
    5,
    true
  ),
  (
    'ada',
    'ADA Accessible',
    'Accessible transportation for passengers who require wheelchair-accessible or mobility-accommodating vehicles.',
    'ada',
    4,
    0.00,
    0.00,
    0.00,
    6,
    true
  )
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "icon_key" = EXCLUDED."icon_key",
  "capacity" = EXCLUDED."capacity",
  "sort_order" = EXCLUDED."sort_order",
  "is_active" = true,
  "updated_at" = NOW();

-- Soft-retire legacy passenger catalog. Rows and FKs retained for history.
UPDATE "service_categories"
SET
  "is_active" = false,
  "updated_at" = NOW()
WHERE "code" IN ('ride', 'bike', 'cng', 'moto', 'premium', 'comfort')
  AND "is_active" = true;
