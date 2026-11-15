# DriveWize Backend — Vehicle / Service Category Migration Audit

**Workspace:** `backend_rydu`  
**Date:** 2026-09-25  
**Scope:** Read-only audit. No deletes, renames, migrations, API changes, or app changes.

**Final status:** **VEHICLE CATEGORY MIGRATION AUDIT COMPLETE — IMPLEMENTATION PLAN READY**

---

## Executive verdict

The platform has **two separate taxonomies**:

1. **Service categories** (`service_categories`) — the bookable passenger products used for quotes, bookings, market fares, and driver/vehicle eligibility.
2. **Vehicle types** (Postgres enum `vehicle_type` on `drivers`) — physical fleet body classes (`sedan`, `suv`, `van`, `mini_bus`, `coach_bus`).

Passenger-facing “categories” such as BIKE and CNG are **service categories**, not vehicle types. DriveWize’s website fleet list (Economy Sedan, Executive Sedan, SUV, …) aligns more closely with **vehicle types + new service-category products**, not with the current BD-style product set (`ride` / `bike` / `cng` / `moto` / `premium` / `comfort`).

**Do not hard-delete BIKE/CNG.** Soft-deactivate (and remove from the canonical allowlist) so historical bookings remain joinable.

---

## 1. Current category architecture

### 1.1 Concepts are separate (do not conflate)

| Concept | Exists? | Storage | Role |
|--------|---------|---------|------|
| **Service category** | Yes | Table `service_categories` | Bookable product; quote/book/match key |
| **Service type** | Alias only | Same as service category | Admin ride-video filter `serviceType` → category code/name |
| **Vehicle type** | Yes (separate) | PG enum `vehicle_type` on `drivers.vehicle_type` | Fleet body class |
| **Vehicle category** | No table | Junction `vehicle_service_categories` | Links a vehicle to one or more **service** categories |
| **Market fare category** | Per service category × market | `service_category_market_fares` | Live quote rates |
| **Airport fare** | Not per category | `airports.pickup_fee_minor` / `dropoff_fee_minor` | Flat fee layered onto any category quote |

There is **no** `vehicle_categories` table and **no** `service_type` table/column.

### 1.2 Logical relationships

```
ride_markets (BD/BDT, US/USD)
    └── service_category_market_fares ──► service_categories
                                              ▲
              ┌───────────────────────────────┼───────────────────────────────┐
              │                               │                               │
   bookings.service_category_id    driver_service_categories      vehicle_service_categories
                                              │                               │
                                           drivers                         vehicles
                                    (+ optional vehicle_type enum)
                                      sedan|suv|van|mini_bus|coach_bus

airports (fixed pickup/dropoff fees) ── snapshot on bookings (category-agnostic)
```

### 1.3 Authoritative sources (priority order)

| Layer | What it controls | File / location |
|-------|------------------|-----------------|
| **Canonical allowlist (code)** | Which products are bookable in quotes/admin fare UI | `src/utils/serviceCategoryNormalize.ts` → `CANONICAL_SERVICE_CODES` |
| **DB rows** | UUID identity, capacity, description, icon_key, legacy global rates, `is_active` | `service_categories` |
| **Repository filter** | Active **and** exact canonical code | `listCanonicalActiveServiceCategories()` in `src/repositories/serviceCategory.repository.ts` |
| **Market fares** | Live quote pricing per market | `service_category_market_fares` |
| **Seed** | Initial six products | Migration `0011_passenger_booking_system.sql` |
| **Vehicle type enum** | Driver body class (not used for passenger product list) | `0001_flawless_preak.sql`, `src/constants/vehicleTypes.ts` |

**Runtime bookable set** = intersection of:

1. `is_active = true`
2. `code IN ('ride','bike','cng','moto','premium','comfort')` (exact match)
3. For quotes: a market-fare row must exist for that category UUID in the resolved market

---

## 2. Current categories / codes / IDs

### 2.1 Bookable service categories (seed + canonical)

From migration `0011` and `CANONICAL_SERVICE_CODES`:

| sort | code (DB) | public code | display name | icon_key | capacity | legacy base / perKm / min (catalog columns) |
|------|-----------|-------------|--------------|----------|----------|-----------------------------------------------|
| 1 | `ride` | `RIDE` | Ride | `ride` | 4 | 50 / 25 / 80 |
| 2 | `bike` | `BIKE` | Bike | `bike` | 1 | 30 / 15 / 50 |
| 3 | `cng` | `CNG` | CNG | `cng` | 4 | 40 / 20 / 70 |
| 4 | `moto` | `MOTO` | Moto | `moto` | 1 | 35 / 18 / 55 |
| 5 | `premium` | `PREMIUM` | Premium | `premium` | 4 | 120 / 45 / 200 |
| 6 | `comfort` | `COMFORT` | Comfort | `comfort` | 4 | 80 / 35 / 150 |

**Status field:** `is_active` boolean only (no `status` / `deleted_at`).

**Documented local UUIDs** (environment-specific; from `reports/SERVICE_CATEGORY_CLEANUP.md` — stable per DB after seed, not guaranteed identical across every environment):

| Product | ID |
|---------|-----|
| Ride | `59ab7ef9-0bb3-47c8-8afa-3313b295151e` |
| Bike | `d793ac30-c749-48b9-9c63-0b6b7d50289a` |
| CNG | `10ef8afd-7e45-4be2-97a4-00303a624cde` |
| Moto | `264247c5-af89-4fcb-802a-d576791dc300` |
| Premium | `2d7bcfdd-4343-4a07-b0df-214c807a8e87` |
| Comfort | `9a9da7dd-f122-4e9c-a351-1c2ab6fe4e00` |

### 2.2 Vehicle types (separate enum — not passenger quote products)

| value | label | capacity (marketing) | ADA note |
|-------|-------|----------------------|----------|
| `sedan` | Sedans | 3 passengers | — |
| `suv` | SUVs | 5 passengers | — |
| `van` | Vans | 10 passengers | Marketing copy mentions ADA / wheelchair lift |
| `mini_bus` | Mini Buses | 18–24 | — |
| `coach_bus` | Coach Buses | 50–55 | — |

**Not present as vehicle_type:** `bike`, `cng`, `minivan`, `mini-van`, `car`, `ada`.

### 2.3 Schema columns (`service_categories`)

| Column | Meaning |
|--------|---------|
| `id` | UUID PK — FK target for bookings / junctions / market fares |
| `code` | Machine code (unique); public API uppercases |
| `name` | Display name (overridden by canonical display map for bookable list) |
| `description` | Optional description |
| `icon_key` | Client asset key (not a URL) |
| `capacity` | Passenger capacity integer |
| `base_fare` / `per_km_rate` / `min_fare` | Legacy catalog defaults (historically BDT); **live quotes use market fares** |
| `is_active` | Soft status |
| `sort_order` | UI ordering (also re-sorted by `CANONICAL_SORT_ORDER`) |

### 2.4 Related tables

| Table | Column | ON DELETE | Purpose |
|-------|--------|-----------|---------|
| `bookings` | `service_category_id` NOT NULL | Restrict (no cascade) | Booking product |
| `driver_service_categories` | `service_category_id` | CASCADE | Legacy driver ↔ product |
| `vehicle_service_categories` | `service_category_id` | CASCADE | Vehicle ↔ product (preferred for matching) |
| `service_category_market_fares` | `service_category_id` | CASCADE | Per-market rates |
| `promotions` | `service_category_id` nullable | SET NULL | Optional promo scope |

Payments/settlements: **no** `service_category_id` column.

---

## 3. BIKE usage

### 3.1 Definition

- DB code: `bike`
- Public code: `BIKE`
- Display: `Bike`
- Hardcoded in `CANONICAL_SERVICE_CODES` and `CANONICAL_DISPLAY_NAMES`
- Seeded in `0011_passenger_booking_system.sql`

### 3.2 Runtime impact matrix

| Surface | Impact | Mechanism |
|---------|--------|-----------|
| Passenger services list | **Direct** | Appears when active + canonical |
| Passenger multi-quote | **Direct** | Quoted when market fare row exists |
| Passenger booking | **Direct** | `serviceCategoryId` UUID stored on booking |
| Pricing | **Direct** | Market fare for bike UUID |
| Market fares Admin | **Direct** | Editable when bookable |
| Airport fares | **None (category-specific)** | Flat fee applies to all categories equally |
| Driver eligibility | **Direct** | Exact UUID match via vehicle/driver category links |
| Vehicle assignment | **Direct** | `vehicle_service_categories` |
| Duty | **None for BIKE string** | Duty is QR/session; category checked at dispatch |
| Booking history | **Direct** | Join to `service_categories` for code/name |
| Payments | **None on category** | Amounts on booking/payment rows only |
| Admin category list | **Direct** | Canonical active list |
| Sockets | **Indirect** | Offer payload includes `service.serviceCode` / `serviceName` |
| FCM | **None** | Offer push has no category fields |
| Tests | **Direct** | Dedupe, market-fare, fleet fixtures |

### 3.3 Historical orphans

Prior test leak created inactive rows like `BIKE-{8hex}`. Cleanup retained them deactivated; migration `0018` prevents a second **active** row in the same normalized family. Canonical `bike` is the only bookable Bike product.

### 3.4 What breaks if BIKE is hard-deleted

- `bookings.service_category_id` FK **blocks delete** if any booking references the bike UUID.
- CASCADE would wipe vehicle/driver category links and market-fare rows.
- History joins would lose code/name for remapped/deleted IDs.
- Canonical allowlist + tests would still reference `bike` until code changes.

**Safe path:** `is_active = false` + remove from `CANONICAL_SERVICE_CODES` (implementation phase).

---

## 4. CNG usage

Identical pattern to BIKE:

| Item | Value |
|------|-------|
| DB code | `cng` |
| Public code | `CNG` |
| Display | `CNG` |
| Seed capacity | 4 |
| Hardcoded | Yes (`CANONICAL_SERVICE_CODES`) |
| Quote / book / match | Yes (UUID) |
| Airport-specific | No |
| FCM | No |
| Hard-delete risk | Same as BIKE (booking FK restrict) |

Also BD-oriented product (auto-rickshaw style). Same soft-deactivate recommendation.

---

## 5. Passenger quote / category flow

### 5.1 APIs that drive Passenger vehicle/service options

| API | Route | Handler |
|-----|-------|---------|
| Catalog (no fare for route) | `GET /api/v1/passenger/services` | `servicesHandler` |
| Quotes (with fares) | `POST /api/v1/passenger/bookings/quote` | `quoteHandler` |

Both use `listActiveServiceCategories()` → `listCanonicalActiveServiceCategories()`.

### 5.2 `GET /api/v1/passenger/services` — actual fields

Per service object (from controller mapping):

| Field | Source |
|-------|--------|
| `serviceCategoryId` | UUID |
| `code` | Uppercased DB code (`BIKE`, `CNG`, …) |
| `name` | Canonical display name |
| `displayName` | Same as `name` |
| `description` | DB |
| `iconKey` | DB (`bike`, `cng`, …) — **not a URL**; client resolves asset |
| `capacity` | DB integer |
| `baseFare`, `perKmRate`, `minFare` | **Legacy catalog columns** (not market-aware) |
| `sortOrder` | DB |

Also returns `promotions[]` (may include optional `serviceCategoryId`).

### 5.3 `POST /api/v1/passenger/bookings/quote` — actual quote fields

When `serviceCategoryId` omitted → `quoteAllServiceCategories` returns all bookable categories that have market fares.

Per quote (`FareQuote` / controller mapping):

| Field | Notes |
|-------|--------|
| `serviceCategoryId` | UUID used for booking |
| `serviceCode` | Public uppercased (`BIKE`, `CNG`, …) |
| `serviceName` / `displayName` | Cleaned display (`Bike`, `CNG`, …) |
| `description` | DB |
| `iconKey` | DB string key |
| `capacity` | DB |
| `distanceKm`, `durationMin`, `driverEtaMinutes` | Route + nearby ETA |
| `originalFare`, `discountType`, `discountValue`, `discountAmount` | Pre-airport / promo |
| `regularFare`, `airportFee`, `finalFare` | After airport fee |
| `airport` | `{ id, code, name, tripType }` or null |
| `currency`, `marketCode` | From resolved market |
| `promotion` | Object or null |

Top-level: `route`, `quotes[]`, `market: { code, countryCode, currency }`.

**No backend-driven image URL.** Icons are `iconKey` strings for app-local assets.

### 5.4 Important pricing behavior

- Categories **without** a `service_category_market_fares` row for the resolved market are **skipped** (not quoted).
- US market was **not** seeded with fares; quotes fail with `MARKET_PRICING_NOT_CONFIGURED` until Admin configures US rates.
- Airport fee is applied after regular fare for every quoted category (not category-specific).

---

## 6. Admin category flow

### 6.1 Service category list

| API | Behavior |
|-----|----------|
| `GET /api/v1/admin/service-categories` | Hybrid: DB rows filtered to **hardcoded** canonical codes; public payload via `toPublicCategoryPayload` |

Payload fields: `serviceCategoryId`, `id`, `code`, `name`, `displayName`, `capacity`, `description`, `iconKey` (no fare fields).

**No runtime Admin HTTP API to create/update/delete service category rows.** Catalog changes today require seed/migration/scripts + code allowlist updates.

### 6.2 Driver category assignment

| API | Notes |
|-----|-------|
| `GET/POST/DELETE …/admin/drivers/:driverId/service-categories` | Assigns UUID; assignment path does **not** re-validate canonical allowlist |

### 6.3 Market fares

| API | Path |
|-----|------|
| List | `GET /api/v1/admin/markets/:code/fares` |
| Upsert | `PUT /api/v1/admin/markets/:code/fares` |

- Editable set = canonical active categories only.
- Rates stored in `service_category_market_fares`.
- Rejects non-bookable category IDs (`SERVICE_CATEGORY_NOT_BOOKABLE`).
- Admin is **not** hardcoded to BIKE/CNG by name; it follows whatever is currently bookable.

### 6.4 Vehicle management

Fleet vehicle update accepts `serviceCategoryIds[]` (junction rows). Existence check on UUIDs; **not** restricted to canonical allowlist at write time. Matching for dispatch prefers vehicle category links.

### 6.5 Airport pricing

Admin airports APIs configure per-airport fixed fees. **Not** per service category. Unaffected by BIKE/CNG removal except that fewer categories receive the same flat fee.

---

## 7. Driver matching implications

1. Booking stores `bookings.service_category_id` (UUID from passenger).
2. Dispatch finds nearby drivers for that UUID.
3. Eligibility (`driverServesCategory`) requires exact UUID in resolved category set:

   **Resolution order** (`vehicleEligibility.service.ts`):
   1. Active duty vehicle’s `vehicle_service_categories`
   2. Else driver’s vehicle categories
   3. Else legacy `driver_service_categories`

4. No fuzzy match on code (`bike` vs `BIKE-*`).

**If BIKE/CNG are deactivated:** they disappear from new quotes; existing links remain but get no new bookings for those UUIDs.

**If new DriveWize products are added:** every eligible vehicle/driver must be assigned the new category UUIDs, or matching returns empty.

**Sockets:** offer events include service code/name from the booking’s category row. **FCM:** no category fields — Driver apps do not need FCM payload changes for category migration.

---

## 8. Market fare implications

| Fact | Detail |
|------|--------|
| Categories are **global** | Same UUIDs/codes for BD and US |
| Rates are **market-scoped** | `service_category_market_fares` |
| BD | Seeded from all `service_categories` at migration 0031 (including historical inactive orphans historically) |
| US | Empty at seed; Admin must configure |
| Quote gate | At least one bookable category must have a market fare (`assertMarketPricingConfigured`) |
| Admin editor | Shows only current bookable set |

Changing the bookable catalog globally changes which rows Admin configures for **both** BD and US.

---

## 9. Airport fare implications

- Airport fees are **not** keyed by service category.
- Applied uniformly in `fare.service.ts` after regular fare.
- Removing BIKE/CNG does **not** require airport schema changes.
- New categories inherit the same airport fee behavior automatically.

---

## 10. Existing database implications

### 10.1 Known local snapshot (prior audits)

From `RYDU_BACKEND_MARKET_FARE_CATEGORY_DATA_AUDIT_REPORT.md` / cleanup reports (local DB at that time):

| Metric | Count |
|--------|------:|
| `service_categories` total | 48 |
| Active canonical | 6 |
| Inactive orphan `BIKE-*` | 42 |
| BD market fare rows | 48 (incl. orphans) |
| US market fare rows | 0 |

Production counts must be re-verified before migration; do not assume identical UUIDs/counts.

### 10.2 FK / data risk if hard-deleted

| Reference | Risk |
|-----------|------|
| Historical `bookings` | **Blocks DELETE**; history readability depends on row surviving |
| `vehicle_service_categories` | CASCADE wipe of eligibility links |
| `driver_service_categories` | CASCADE wipe |
| `service_category_market_fares` | CASCADE wipe of rates |
| `promotions` | SET NULL (promo becomes unscoped) |
| Payments / settlements | Amounts preserved; no category FK |

### 10.3 Recommended treatment of old categories

| Action | Recommendation |
|--------|----------------|
| Hard delete BIKE/CNG | **No** |
| Soft deactivate (`is_active = false`) | **Yes** |
| Remove from `CANONICAL_SERVICE_CODES` | **Yes** (implementation phase) |
| Hide from new bookings/quotes | Automatic once above done |
| Migrate historical bookings to new UUIDs | **No** — retain original `service_category_id` for audit |
| Keep orphan `BIKE-*` inactive rows | **Yes** — already cleaned; leave for history |
| Also review `moto` (2-wheeler) | Strongly consider same soft-retire for DriveWize US fleet |
| `ride` / `premium` / `comfort` | Replace or remap to DriveWize sedan/SUV-style products — do not silently delete |

---

## 11. ADA capability findings

| Search | Result |
|--------|--------|
| `ADA` / `accessible` / `wheelchair` as DB columns | **None** |
| Dedicated accessibility flags on vehicles/drivers | **None** |
| ADA as service category | **Not present** |
| Existing mention | Marketing description on `vehicle_type = van` in `src/constants/vehicleTypes.ts` and comment in `drivers.ts` |

**Conclusion:** Today ADA can only be represented as a **service category product** (and/or marketing copy). There is **no** dedicated accessibility capability model (`wheelchairAccessible`, lift equipment flags, etc.).

Do not invent accessibility matching logic in the first migration unless product explicitly requires it. A bookable `ada` / `ada_accessible` service category is sufficient to show the option and match assigned vehicles.

---

## 12. Bus / custom-quote capability findings

### 12.1 Current capability

- Instant quote/bookable set = six canonical service codes only. **No `bus` service category.**
- `mini_bus` / `coach_bus` exist only as **vehicle_type** enum values (fleet body class).
- Booking always runs market-fare quote path (`quoteSingleCategory` / `quoteAllServiceCategories`).
- **No** custom-quote / RFQ / “request a quote” booking mode exists in this backend.
- **No** persisted quotes table.

### 12.2 Recommendation for Bus (based on current backend)

| Option | Feasible today? | Notes |
|--------|-----------------|-------|
| **A. Normal instant-quote category** | Technically yes | Would work like any other service category once code + DB + market fares + vehicle links exist |
| **B. Request / custom-quote category** | **Not supported** | Would require new product/backend work (out of scope) |
| **C. Stored fleet class, excluded from instant passenger quotes** | Yes | Keep/use `mini_bus` / `coach_bus` vehicle types; do **not** add `bus` to `CANONICAL_SERVICE_CODES` until product decides |

**Recommended for DriveWize now:** **C**, optionally with a future path to **B**.

Rationale: client website treats large-group / bus transportation differently from ordinary online rides. Making Bus a normal instant-quote product (A) is possible but likely wrong for product. There is no custom-quote backend (B) yet. Therefore Bus should remain a **fleet vehicle type**, not an instant passenger quote card, until a deliberate quote/request flow is designed.

---

## 13. Recommended mapping to DriveWize target products

### 13.1 Target list → architecture layer

| Target product | Map as service category? | Map as vehicle_type? | Notes |
|----------------|--------------------------|----------------------|-------|
| Economy Sedan | **Yes** (new product) | `sedan` | Distinct from Executive; same body class |
| Executive Sedan | **Yes** (new product) | `sedan` | Premium sedan product |
| SUV | **Yes** | `suv` | Aligns with existing enum |
| Passenger Van | **Yes** | `van` | Standard group van product |
| Mini-Van | **Yes** | `van` today (or extend enum later) | Enum has no `minivan`; body class may share `van` initially |
| ADA Accessible | **Yes** (product) | `van` (optional) | Service category for booking; no ADA schema fields |
| Bus | **Not for instant quotes** | `mini_bus` and/or `coach_bus` | See §12 — option C |

### 13.2 Suggested machine codes (consistent with backend conventions)

Existing service codes are **short lowercase tokens** (`ride`, `bike`, `cng`, …). Vehicle types use **snake_case** (`mini_bus`).

Public API uppercases codes (`toPublicServiceCode` → `ECONOMY`, `SUV`, …).

**Recommended service codes (suggestions only — do not apply yet):**

| Target | Recommended `code` | Public code | Rationale |
|--------|---------------------|-------------|-----------|
| Economy Sedan | `economy` | `ECONOMY` | Matches short-token style; avoids underscore family quirks |
| Executive Sedan | `executive` | `EXECUTIVE` | Same |
| SUV | `suv` | `SUV` | Matches vehicle_type vocabulary |
| Passenger Van | `van` | `VAN` | Short token; clear |
| Mini-Van | `minivan` | `MINIVAN` | Single token (avoid `mini_van` family strip) |
| ADA Accessible | `ada` | `ADA` | Short; bookable product |
| Bus | `bus` *(only if ever quoted)* | `BUS` | Prefer **exclude** from canonical allowlist initially |

**Why avoid `economy_sedan` / `passenger_van` initially:** migration `0018` unique index normalizes with `regexp_replace(code, '[-_].+$', '')`, so `economy_sedan` becomes family `economy`. Underscored codes also complicate `normalizeServiceCategoryBase` unless added carefully to the exact allowlist. Short tokens match `ride`/`premium` style.

### 13.3 Conceptual remap from legacy products (not an automatic rename)

| Legacy | DriveWize disposition |
|--------|------------------------|
| `bike` | Soft-retire (BD 2-wheeler) |
| `cng` | Soft-retire (BD) |
| `moto` | Soft-retire (BD 2-wheeler) |
| `ride` | Closest to Economy Sedan — **prefer new `economy` row** rather than renaming in place (preserves history labels) |
| `comfort` | Possibly fold into Economy or SUV — product decision |
| `premium` | Closest to Executive Sedan — prefer new `executive` row |
| — | Add `suv`, `van`, `minivan`, `ada` as new rows |

**Do not rename existing codes/UUIDs in place** until App/Admin contracts and historical display are explicitly accepted. Prefer: new active rows + deactivate legacy bookable set.

### 13.4 Partial unique index caveat

`idx_service_categories_normalized_code_active` allows only one **active** row per normalized family. New codes must not collide with active legacy families when using suffixes (`economy-xxx` would collide with family `economy`).

---

## 14. Exact backend changes recommended (implementation phase — not now)

Ordered plan for a future implementation PR series:

1. **Decide US product catalog** (confirm Bus = non-instant; confirm Mini-Van vs Passenger Van capacities).
2. **Extend `CANONICAL_SERVICE_CODES` / display names / sort order** in `serviceCategoryNormalize.ts`.
3. **Insert new `service_categories` rows** (migration or controlled seed) with capacities, descriptions, `icon_key`, `sort_order`, `is_active = true`.
4. **Soft-deactivate** `bike`, `cng`, and likely `moto` (and optionally `ride`/`premium`/`comfort` once replacements are live).
5. **Do not DELETE** legacy category rows referenced by bookings.
6. **Upsert US (and BD if still needed) market fares** for new category UUIDs via Admin API or migration.
7. **Reassign fleet:** `vehicle_service_categories` (and driver links if used) to new UUIDs.
8. **Align `vehicle_type` usage** on drivers where helpful (sedan/suv/van/bus); consider enum extension for `minivan` only if product requires distinct body class.
9. **Update tests** that hardcode bike/cng IDs or expect six BD products.
10. **Leave airport schema unchanged.**
11. **Optional later:** Admin CRUD for categories; ADA equipment fields; Bus custom-quote flow.

---

## 15. Exact DB migration / data strategy recommended

| Step | Strategy |
|------|----------|
| New products | `INSERT` new `service_categories` with new codes |
| Legacy BIKE/CNG/Moto | `UPDATE … SET is_active = false` |
| Historical bookings | **Keep** original `service_category_id` |
| Market fares | Insert US (and BD) rows for **new** IDs; leave old fare rows for audit |
| Orphan `BIKE-*` | Leave inactive; do not resurrect |
| Vehicle/driver junctions | Repoint/add links to new IDs; remove primary links to deactivated products as operational cleanup |
| Payments | No rewrite |
| Destructive delete | **Forbidden** for categories with booking FKs |

**Multi-market safety:** treat catalog as global. If Bangladesh operations must keep Bike/CNG temporarily, options are:

- Keep them active globally (DriveWize US simply omits US market fares for them → they won’t quote in US), **or**
- Introduce market-scoped bookability (does **not** exist today — would be new work).

**Current behavior:** a category is bookable everywhere it is canonical+active **and** has market fares. Soft-retiring Bike/CNG globally removes them from BD quotes too. Confirm with product before deactivating if BD still needs them.

---

## 16. What Admin will need afterward

1. Refresh Market Fares for **US** (and BD if retained) for each new category UUID — enter base / per-km / min.
2. Reassign **vehicle service categories** on fleet vehicles to the new products.
3. Reassign **driver service categories** where legacy links are still used.
4. Stop expecting Bike/CNG cards once deactivated (Admin lists follow canonical active set — no hardcoded Admin category enum beyond backend allowlist).
5. Airport fee screens: no category change required.
6. No Admin category “create” UI exists today — ops depends on backend migration/seed until CRUD is built.

---

## 17. What Passenger app will need afterward

1. Consume new `code` / `displayName` / `iconKey` values from `GET /services` and quote responses.
2. Provide local assets for new `iconKey`s (`economy`, `executive`, `suv`, `van`, `minivan`, `ada`, …).
3. Remove or stop hardcoding BIKE/CNG UI assumptions if any exist client-side.
4. Booking still sends `serviceCategoryId` UUID — must use IDs from quote response, not invented codes.
5. Capacity/copy will change with new catalog — UI should not assume bike capacity=1 forever.
6. If Bus is excluded from quotes, Passenger should **not** show a Bus instant-ride card unless a future custom-quote API exists.

---

## 18. Whether Android / iOS Driver apps require changes

| Area | Change needed? |
|------|----------------|
| FCM offer push | **No** — no category fields in payload |
| Socket `booking:offer` | **Possibly display-only** — payload includes `service.serviceCode` / `serviceName` from booking; UI strings/icons may need new mappings |
| Eligibility / matching | **Backend-driven** — drivers match when vehicle/driver categories include the booking UUID; apps don’t choose category codes at dispatch |
| Duty / QR | **No** category-specific duty logic found |
| Hardcoded BIKE/CNG filters in Driver apps | Audit mobile repos separately; backend will stop sending those products once deactivated |

**Backend conclusion:** Driver apps are not blocked on FCM changes. They may need UI asset/label updates if they map service codes to icons locally.

---

## Appendix A — Primary file index

| File | Role |
|------|------|
| `src/utils/serviceCategoryNormalize.ts` | Canonical codes / display / public uppercasing |
| `src/repositories/serviceCategory.repository.ts` | Bookable list + public payload |
| `src/services/fare.service.ts` | Quote engine |
| `src/controllers/passengerBooking.controller.ts` | `servicesHandler`, `quoteHandler` |
| `src/services/rideMarket.service.ts` | Market resolve + Admin fares |
| `src/services/vehicleEligibility.service.ts` | Category matching |
| `src/constants/vehicleTypes.ts` | Vehicle type marketing (+ ADA copy on van) |
| `src/db/schema/service_categories.ts` | Product catalog schema |
| `src/db/schema/service_category_market_fares.ts` | Per-market rates |
| `src/db/schema/vehicle_service_categories.ts` | Vehicle ↔ product |
| `src/db/schema/driver_service_categories.ts` | Driver ↔ product |
| `src/db/migrations/0011_passenger_booking_system.sql` | Create + seed categories |
| `src/db/migrations/0018_service_category_normalized_unique.sql` | Active family uniqueness |
| `src/db/migrations/0031_ride_markets_and_booking_currency.sql` | Markets + market fares |
| `reports/SERVICE_CATEGORY_CLEANUP.md` | Canonical UUID snapshot |
| `RYDU_BACKEND_MARKET_FARE_CATEGORY_DATA_AUDIT_REPORT.md` | BD/US fare data audit |

## Appendix B — Explicit non-actions (this audit)

- Did **not** delete BIKE/CNG
- Did **not** rename DB records
- Did **not** add categories
- Did **not** run migrations
- Did **not** modify Passenger / Admin / Android / iOS
- Did **not** change APIs or pricing

---

**VEHICLE CATEGORY MIGRATION AUDIT COMPLETE — IMPLEMENTATION PLAN READY**
