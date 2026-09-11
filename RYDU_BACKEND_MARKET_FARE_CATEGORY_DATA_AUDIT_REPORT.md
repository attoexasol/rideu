# RYDU Backend — Market Fare Category Data Audit

**Workspace:** `backend_rydu` only  
**Date:** 2026-09-11  
**Scope:** Bangladesh Admin market-fare UUID rows. No Admin frontend or mobile app changes. No destructive deletes.

**Final status:** **RYDU BACKEND MARKET FARE CATEGORY DATA AUDIT COMPLETE**

---

## 1. Exact root cause

Two stacked facts:

1. **Legacy `service_categories` rows already existed.** Local DB has **48** category rows: **6** current products and **42** inactive `BIKE-{hex}` orphans from an earlier test-fixture leak (documented in the duplicate-category cleanup). There is no `deleted_at` / `status` / `archived` column — only `is_active`.

2. **Migration `0031_ride_markets_and_booking_currency.sql` copied every `service_categories` row into Bangladesh market fares**, with no `is_active` filter:

```sql
FROM "ride_markets" m
JOIN "service_categories" c ON true
WHERE m.code = 'BD'
```

That is equivalent to `SELECT … FROM service_categories` for the BD market. Historical/inactive categories were copied into `service_category_market_fares`. US was **not** seeded.

`GET /api/v1/admin/markets/BD/fares` then returned **all stored fare rows** (48). Admin resolves names from the current catalog (6 IDs). The other 42 IDs have no catalog match, so the UI showed raw UUIDs. US looked correct because it had **0** stored fare rows and the UI fell through to the current 6-category catalog.

Passenger/Driver quotes were already using `listCanonicalActiveServiceCategories()` (`is_active = true` **and** exact codes `ride|bike|cng|moto|premium|comfort`). The 42 orphans were never bookable for new rides; they only polluted Admin fare configuration.

---

## 2. Category counts (local DB, read-only)

| Metric | Count |
|--------|------:|
| `service_categories` total | **48** |
| active / current (`is_active = true`) | **6** |
| inactive / legacy (`is_active = false`) | **42** |
| BD market fare rows | **48** |
| BD rows matching active category | **6** |
| BD rows matching inactive/legacy category | **42** |
| BD orphan rows with no `service_categories` match | **0** |
| US market fare rows | **0** |
| Duplicate product family | `bike` = **43** rows (1 active + 42 `BIKE-*`) |

Schema flags on `service_categories`: `is_active` only. No `status`, `deleted_at`, or archive column.

---

## 3. Active / current category list

Authoritative bookable catalog (seed `0011`, exact codes, `is_active = true`):

| sort | code | name | id |
|------|------|------|----|
| 1 | `ride` | Ride | `59ab7ef9-0bb3-47c8-8afa-3313b295151e` |
| 2 | `bike` | Bike | `d793ac30-c749-48b9-9c63-0b6b7d50289a` |
| 3 | `cng` | CNG | `10ef8afd-7e45-4be2-97a4-00303a624cde` |
| 4 | `moto` | Moto | `264247c5-af89-4fcb-802a-d576791dc300` |
| 5 | `premium` | Premium | `2d7bcfdd-4343-4a07-b0df-214c807a8e87` |
| 6 | `comfort` | Comfort | `9a9da7dd-f122-4e9c-a351-1c2ab6fe4e00` |

BD market-fare amounts for those six (preserved, copied from global rates by 0031):

| Category | base | per km | min |
|----------|------|--------|-----|
| Ride | 50.00 | 25.00 | 80.00 |
| Bike | 30.00 | 15.00 | 50.00 |
| CNG | 40.00 | 20.00 | 70.00 |
| Moto | 35.00 | 18.00 | 55.00 |
| Premium | 120.00 | 45.00 | 200.00 |
| Comfort | 80.00 | 35.00 | 150.00 |

Inactive sample: `BIKE-004c9e7f` / `Bike 3db90f70`, `BIKE-15f7b27f` / `Bike f1eadf32`, … (42 total).

---

## 4. Orphan / legacy category count

- **42** inactive `service_categories` (legacy Bike test rows).
- **42** BD `service_category_market_fares` pointing at those inactive IDs.
- **0** fare rows whose `service_category_id` is missing from `service_categories` (FK holds).
- **0** active non-canonical categories.

---

## 5. Migration 0031 behavior

Confirmed from the SQL, not inferred:

- Inserts BD and US into `ride_markets`.
- Creates `service_category_market_fares`.
- Seeds BD fares from **all** `service_categories` (`JOIN … ON true`, no `c.is_active = true`).
- Explicitly does **not** copy rates to US (`Do not copy them to US`).
- Does not rewrite historical booking/payment/settlement amounts.

That seed is why BD has 48 fare rows after the earlier 42 inactive categories were left in place.

---

## 6. Historical references

| Table | Result |
|-------|--------|
| `bookings` | **127** total. **124** Ride (active), **1** Bike (active), **2** on inactive `BIKE-15f7b27f` (`0f28ee39-d7f0-450f-8fa8-a797e164e4e2`) |
| `bookings` with missing category | **0** |
| `booking_payments` / `booking_settlements` | **no** `service_category_id` (amounts live on the booking / ledger) |
| `driver_service_categories` on inactive IDs | **0** |
| `vehicle_service_categories` on inactive IDs | **0** |
| `promotions` on inactive IDs | **0** |

Ride history uses `INNER JOIN service_categories`. Those **2** bookings remain readable **only if** the inactive category row is kept.

**Do not DELETE those 42 `service_categories` rows.** At least one is still referenced by bookings.

Deleting the 42 inactive **market-fare** rows would not break bookings/payments/settlements (history does not read that table). It is still unnecessary if the Admin API is filtered.

---

## 7. Recommended cleanup / filter strategy

**Filter the Admin market-fare API. Do not delete category or fare rows in this change.**

Product rule already used by Passenger quotes, Driver-facing category lists, and Admin vehicle category pickers:

```
is_active = true
AND code IN ('ride','bike','cng','moto','premium','comfort')
```

via `listCanonicalActiveServiceCategories()`.

`GET /api/v1/admin/markets/{code}/fares` now returns that same catalog for every market, overlaying stored fare amounts when present. Historical fare rows remain in the database.

`PUT` rejects `SERVICE_CATEGORY_NOT_BOOKABLE` if a client tries to write fares for a non-bookable ID.

`assertMarketPricingConfigured` now requires at least one fare row for a **bookable** category (legacy-only rows no longer count as “configured”).

---

## 8. Whether DB cleanup is required

**Not required for Admin UUID rows.** API filter is sufficient and safer.

Optional later (not done): delete BD `service_category_market_fares` whose category is inactive. Safe for money history, but not needed for the UI. Never delete `service_categories` that bookings still reference.

---

## 9. Whether Admin frontend requires any additional change

**No additional Admin frontend change is required** for this bug.

The frontend already resolves names from the catalog. After the backend returns only the 6 bookable IDs (plus `code` / `name`), UUID-only rows stop appearing. Additive `code` / `name` / nullable amounts help US show the same catalog before fares are saved.

Admin should refresh against `GET /api/v1/admin/markets/BD/fares` and expect **6** rows, not 48.

---

## 10. Tests / build

| Check | Result |
|-------|--------|
| A bookable categories in market fare config | pass |
| B inactive/historical IDs omitted from editor | pass |
| C historical booking snapshot still readable | pass |
| D payments/settlements have no category column to rewrite | pass |
| E BD expected current count = 6 | pass |
| F US uses the same 6-category catalog | pass |
| G no UUID-only names in Admin fare response | pass |
| H valid BD fare amounts preserved | pass |
| `npx tsc --noEmit` | pass |
| `npm run build` | pass |

Files:

- `src/services/rideMarket.service.ts` — Admin GET/PUT filter; bookable pricing check
- `tests/market-fare-admin.test.ts` — coverage A–H
- this report

No `service_categories` or `service_category_market_fares` rows were deleted.

---

**RYDU BACKEND MARKET FARE CATEGORY DATA AUDIT COMPLETE**
