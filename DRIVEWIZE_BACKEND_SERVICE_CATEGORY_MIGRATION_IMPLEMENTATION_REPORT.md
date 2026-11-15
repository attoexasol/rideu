# DriveWize Backend — Service Category Migration Implementation Report

**Workspace:** `backend_rydu`  
**Date:** 2026-09-25  
**Scope:** Backend only. No Admin / Passenger Flutter / Android Driver / iOS Driver changes.

**Final status:** **DRIVEWIZE SERVICE CATEGORY BACKEND MIGRATION IMPLEMENTED — DATABASE/APPS QA REQUIRED**

---

## 1. Files changed

| File | Change |
|------|--------|
| `src/utils/serviceCategoryNormalize.ts` | New canonical allowlist + display/sort/capacities; legacy codes retained for history normalize only |
| `src/repositories/serviceCategory.repository.ts` | Duplicate-guard uses known exact product codes (canonical + legacy) |
| `src/db/migrations/0033_drivewize_service_category_catalog.sql` | **New** — insert DriveWize products; soft-deactivate legacy |
| `src/db/migrations/meta/_journal.json` | Registered migration `0033_drivewize_service_category_catalog` |
| `src/scripts/audit-service-categories.ts` | Known product families include DriveWize + legacy |
| `src/scripts/merge-duplicate-service-categories.ts` | Merge across all known families; do not reactivate legacy |
| `tests/drivewize-service-category-catalog.test.ts` | **New** targeted catalog contract tests |
| `tests/service-category-dedupe.test.ts` | Updated for new canonical set |
| `tests/market-fare-admin.test.ts` | Bookable catalog mocks → DriveWize products |
| `tests/fare.service.test.ts` | Quote mock category → `economy` |
| `tests/admin-fleet-vehicle-update.test.ts` | Secondary category reuse → `suv` |
| `tests/helpers/vehicleExchange.fixtures.ts` | Fixture primary → `economy`; protect new + legacy codes from cleanup deletes |

---

## 2. Migration filename

`src/db/migrations/0033_drivewize_service_category_catalog.sql`

Journal tag: `0033_drivewize_service_category_catalog` (idx 32)

**Not applied** by this task. Apply explicitly to the intended environment (see §14).

---

## 3. New categories / codes / capacities

| sort | code | public | display name | icon_key | capacity |
|------|------|--------|--------------|----------|----------|
| 1 | `economy` | `ECONOMY` | Economy Sedan | `economy` | 3 |
| 2 | `executive` | `EXECUTIVE` | Executive Sedan | `executive` | 3 |
| 3 | `suv` | `SUV` | SUV | `suv` | 6 |
| 4 | `van` | `VAN` | Passenger Van | `van` | 8 |
| 5 | `minivan` | `MINIVAN` | Mini-Van | `minivan` | 5 |
| 6 | `ada` | `ADA` | ADA Accessible | `ada` | 4 |

- New rows get **new UUIDs** (`gen_random_uuid` / column default).
- Catalog `base_fare` / `per_km_rate` / `min_fare` set to `0.00` placeholders (NOT production rates).
- Live pricing remains `service_category_market_fares` (Admin-configured).

---

## 4. Legacy categories soft-retired

| code | Action |
|------|--------|
| `ride` | `is_active = false` |
| `bike` | `is_active = false` |
| `cng` | `is_active = false` |
| `moto` | `is_active = false` |
| `premium` | `is_active = false` |
| `comfort` | `is_active = false` |

- **No DELETE** of category rows, bookings, market fares, or junctions.
- **No remapping** of `bookings.service_category_id`.

---

## 5. Canonical allowlist before / after

| | Codes |
|--|-------|
| **Before** | `ride`, `bike`, `cng`, `moto`, `premium`, `comfort` |
| **After (bookable)** | `economy`, `executive`, `suv`, `van`, `minivan`, `ada` |

Legacy codes remain in `LEGACY_SERVICE_CODES` for historical display / orphan cleanup only. They are **not** returned by `listCanonicalActiveServiceCategories()`.

`bus` is **not** in the bookable allowlist.

---

## 6. Passenger API compatibility

Response **shape unchanged**.

| Endpoint | Behavior after migration + deploy |
|----------|-----------------------------------|
| `GET /api/v1/passenger/services` | Returns the six DriveWize products (when active in DB) |
| `POST /api/v1/passenger/bookings/quote` | Same contract; `serviceCode` values `ECONOMY`…`ADA` when market fares exist |

Quotes still skip categories without market-fare rows. Unconfigured markets still raise `MARKET_PRICING_NOT_CONFIGURED` when no bookable fare exists.

---

## 7. Admin API compatibility

| Endpoint | Behavior |
|----------|----------|
| `GET /api/v1/admin/service-categories` | Six new canonical active products |
| `GET/PUT /api/v1/admin/markets/:code/fares` | Editable set = new six UUIDs; legacy IDs rejected as not bookable |

No category CRUD added.

---

## 8. Market fare implications

- Migration does **not** seed `service_category_market_fares` for new products.
- Legacy fare rows remain for audit; they no longer appear in Admin editable bookable set.
- Until Admin upserts US/BD fares for the new UUIDs, quotes for those products will not appear (or market may report pricing not configured).

---

## 9. Vehicle / driver assignment implications

- Existing junction rows preserved.
- **No automatic remapping** of vehicles/drivers to Economy/Executive/SUV/etc.
- After migration, Admin must assign new category UUIDs to vehicles/drivers or new bookings will not match.

---

## 10. Historical booking protection

- Soft-deactivate only.
- Booking FKs untouched.
- History still joins legacy category rows for code/name.
- Payments/settlements have no category FK to rewrite.

---

## 11. ADA behavior

- `ada` is a **service category** product only.
- No wheelchair / lift / mobility schema fields added.
- Matching = exact UUID via `vehicle_service_categories` / `driver_service_categories`.

---

## 12. Bus behavior

- No `bus` service category created.
- `mini_bus` / `coach_bus` vehicle types unchanged.
- No custom-quote API.

---

## 13. Targeted test results

Command:

```bash
npx jest tests/drivewize-service-category-catalog.test.ts tests/service-category-dedupe.test.ts tests/market-fare-admin.test.ts tests/fare.service.test.ts --forceExit
```

**Result:** 4 suites passed, **34 tests passed**.

(Redis “Cannot log after tests are done” noise is pre-existing teardown leak; does not fail assertions.)

---

## 14. Exact migration command

Do **not** run against unknown/shared/live DB until intentionally chosen.

From the backend repo root, with `DATABASE_URL` pointing at the **intended** environment:

```bash
npm run db:migrate
```

Equivalent:

```bash
npx tsx src/db/migrate.ts
```

This applies all pending journal migrations, including `0033_drivewize_service_category_catalog`.

---

## 15. Anything Admin must do after migration

1. Run / confirm migration on the target DB.
2. Open **Market Fares** for US (and BD if needed) and set base / per-km / min for all six new categories.
3. Assign **vehicle** (and driver, if used) service-category links to the new UUIDs.
4. Verify Admin service-category list shows Economy Sedan … ADA Accessible only (bookable).
5. Confirm Bike/CNG/Ride/etc. no longer appear as bookable fare rows.

---

## 16. Anything Passenger must do after migration

1. Map new `iconKey` values (`economy`, `executive`, `suv`, `van`, `minivan`, `ada`) to local assets.
2. Stop assuming BIKE/CNG/RIDE labels or capacities.
3. Continue booking with `serviceCategoryId` from quote/services responses (new UUIDs).
4. Do not show Bus as an instant-quote option (backend will not offer it).

Driver apps: FCM unchanged; socket offer labels may show new service names when bookings use new categories. Fleet matching depends on Admin vehicle category assignments.

---

**DRIVEWIZE SERVICE CATEGORY BACKEND MIGRATION IMPLEMENTED — DATABASE/APPS QA REQUIRED**
