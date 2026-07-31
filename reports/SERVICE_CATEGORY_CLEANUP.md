# Duplicate Service Category Audit and Cleanup

## Status

**SERVICE CATEGORIES CLEAN**

## Root cause

Test fixture leak in `tests/admin-fleet-vehicle-update.test.ts` `beforeEach`:

- Inserted `BIKE-${uuid.slice(0,8)}` / `Bike ${runId}` every test run
- `cleanupExchangeFixture` only deleted `fixture.ids.serviceCategoryIds` (Ride fixture row)
- Secondary Bike rows were never cleaned from the shared DB
- Quotes/admin listed every `is_active` row → multiple Bike cards with UUID-looking names

No production API creates `service_categories` rows. Seed from `0011_passenger_booking_system.sql` is canonical.

## Canonical categories (active)

| Product | ID | code | name | capacity |
|---------|----|------|------|----------|
| Ride | `59ab7ef9-0bb3-47c8-8afa-3313b295151e` | `ride` | Ride | 4 |
| Bike | `d793ac30-c749-48b9-9c63-0b6b7d50289a` | `bike` | Bike | 1 |
| CNG | `10ef8afd-7e45-4be2-97a4-00303a624cde` | `cng` | CNG | 4 |
| Moto | `264247c5-af89-4fcb-802a-d576791dc300` | `moto` | Moto | 1 |
| Premium | `2d7bcfdd-4343-4a07-b0df-214c807a8e87` | `premium` | Premium | 4 |
| Comfort | `9a9da7dd-f122-4e9c-a351-1c2ab6fe4e00` | `comfort` | Comfort | 4 |

## Cleanup actions completed

1. Report-only audit → `src/scripts/audit-service-categories.ts`
2. Merge script `src/scripts/merge-duplicate-service-categories.ts --apply`
   - Repointed driver/vehicle/promotion links
   - Preserved historical `bookings.service_category_id`
   - Deactivated 42 duplicate orphans (fare columns retained)
3. Quote/admin APIs return canonical active only
4. Partial unique index `idx_service_categories_normalized_code_active` (migration 0018)
5. Fixed tests to reuse seed categories instead of minting `BIKE-*`

## Active quote codes (expected)

`ride`, `bike`, `cng`, `moto`, `premium`, `comfort`

## Prevention

- `listCanonicalActiveServiceCategories()` for UI/quote surfaces
- `assertNoDuplicateServiceCategoryCode()` rejects `BIKE-*` creation
- Migration 0018 blocks a second **active** row in the same product family
- Test fixtures no longer insert suffixed category codes

## Verify

```bash
npx tsx src/scripts/audit-service-categories.ts
npx tsx src/scripts/merge-duplicate-service-categories.ts --report-only
npm run build && npm test -- --forceExit
```
