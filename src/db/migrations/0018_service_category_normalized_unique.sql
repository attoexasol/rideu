-- Prevent future active product-family duplicates (bike vs BIKE-xxxx).
-- Apply AFTER merge-duplicate-service-categories.ts --apply.
-- Inactive orphan rows may keep their original codes for audit/fare history.

CREATE UNIQUE INDEX IF NOT EXISTS idx_service_categories_normalized_code_active
ON service_categories (
  (lower(regexp_replace(code, '[-_].+$', '')))
)
WHERE is_active = true;

COMMENT ON INDEX idx_service_categories_normalized_code_active IS
  'One active row per product family (ride/bike/cng/moto/premium/comfort); blocks active BIKE-uuid orphans';
