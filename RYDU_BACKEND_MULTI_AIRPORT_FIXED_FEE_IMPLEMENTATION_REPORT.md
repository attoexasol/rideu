# RYDU Backend — Multi-Airport Geofence + Fixed Airport Fees

**Workspace:** `backend_rydu`  
**Date:** 2026-09-11  
**Scope:** Backend-only. No Passenger Flutter, Driver Android/iOS, or Admin frontend changes.

**Final status:** **RYDU BACKEND MULTI-AIRPORT FIXED-FEE IMPLEMENTATION COMPLETE**

---

## 1. Previous implementation audit

Inspected before changing financial behavior. Existing fields/functions were reused; nothing equivalent was duplicated.

### Booking schema (`bookings`)

Already present and reused:

| Column | Role before this task |
|--------|------------------------|
| `final_fare` | Authoritative passenger amount for card PI + cash ledger |
| `original_fare` | Pre-promo regular fare |
| `estimated_fare` | Quote-time estimated amount |
| `discount_amount` | Promo reduction of regular fare |
| `pickup_latitude` / `pickup_longitude` / `pickup_address` | Pickup location |
| `dropoff_latitude` / `dropoff_longitude` / `dropoff_address` / `dropoff_place_id` | Drop-off location + optional Place ID |

Gaps:

- No `pickup_place_id`
- No airport snapshot columns
- No airport fee / regular-trip-fare split

### Quote / fare / booking create

- `fare.service.ts` computed regular fare from category rates + promo. `finalFare` was post-promo regular only. Currency hardcoded `BDT`.
- Quote/create already accepted optional drop-off `placeId`. Pickup `placeId` was not on the booking DTO.
- Route preview used Google Directions. Address text was never a fare classifier (and is still not used for airport matching).
- `confirmBooking` wrote `finalFare` from the server quote. Card PI and cash ledger already read that same `finalFare`.

### Payments / settlements

- `booking_payments.gross_amount` = passenger charge in minor units (card PI amount or cash `final_fare`).
- `booking_settlements` already had `gross_amount`, `driver_amount`, `platform_amount`, `airport_fee`, percentage snapshot columns, `status`, `provider_transfer_id`.
- Migration `0029` added `settlement_settings` with `airport_fee_percentage` + `driver_percentage` + `company_percentage` = 100. Seed was 0 / 25 / 75.
- `calculateSettlement` previously split **gross** by those three percentages. That is now incorrect for airport trips.
- Driver Payment History already returned `passengerPayment.amount`, `settlement.driverAmount`, `settlement.platformAmount`, `settlement.airportFee`.
- `calculatedDriverEarnings` already summed `booking_settlements.driver_amount` only.

### Geo / place models

- Trusted Haversine already existed: `haversineKm` in `src/utils/geo.ts`.
- No airport table, no generic geofence model, no SAN coordinates/fees/Place ID in repo data.

---

## 2. Final airport schema

Table `airports` (generic; no SAN-specific columns or code paths):

| Column | Type | Notes |
|--------|------|--------|
| `id` | uuid PK | |
| `code` | varchar(16) UNIQUE | Normalized uppercase |
| `name` | varchar(255) | |
| `google_place_id` | varchar(255) NULL | Unique when not null |
| `country_code` | varchar(2) | |
| `currency` | varchar(10) | Stored for reporting |
| `is_active` | boolean | Detection loads active only |
| `geofence_type` | `radius` \| `polygon` | v1 uses `radius` only |
| `center_latitude` / `center_longitude` | numeric | Required for radius v1 |
| `radius_meters` | integer > 0 | |
| `geofence_polygon` | jsonb NULL | Reserved for later polygon support |
| `pickup_fee_minor` / `dropoff_fee_minor` | bigint ≥ 0 | Fixed amounts, not percentages |
| `created_at` / `updated_at` | timestamptz | |

Disable/archive is `is_active = false`. No destructive delete API.

---

## 3. Geofence algorithm

v1 is a production-safe **radius geofence**.

- Distance = Haversine meters (`haversineMeters` wrapping existing `haversineKm`).
- A point is inside airport A when `distance(point, A.center) <= A.radius_meters`.
- Detection never subtracts raw lat/lng.
- `geofence_type = polygon` is reserved. Polygon matching can be added inside `pointMatchesAirport()` without changing quote/booking APIs.

---

## 4. Place ID behavior

- Airport may store `google_place_id`.
- If the request already has pickup/drop-off `placeId`, an **exact** match is an additional **positive** inside signal.
- Place ID is **not** required (pin-drops may omit it).
- No Google Places API call is made just to classify an airport.
- Typed address strings are **not** inputs to `detectAirportTrip`. `"SAN"`, `"Terminal 1"`, `"San Diego Airport"` cannot classify a trip.

---

## 5. Multi-airport matching rules

Single service: `detectAirportTrip({ pickupLatitude, pickupLongitude, pickupPlaceId?, dropoffLatitude, dropoffLongitude, dropoffPlaceId? })`.

Loads **active** airports only. Returns a structured result (id/code/name/tripType/fee/currency/matchedBy plus internal flags), not a boolean.

Normal rules:

| Condition | Result |
|-----------|--------|
| Pickup inside airport A, drop-off outside A | Airport pickup, pickup fee |
| Drop-off inside airport A, pickup outside A | Airport drop-off, drop-off fee |
| Neither inside any airport | Regular trip, fee = 0 |
| Pickup airport A and drop-off airport B, A ≠ B | **Cross-airport**: fee = 0, `crossAirport: true`, logged. Does **not** add two fees or pick an arbitrary row. |

Public quote/booking clients receive only `{ id, code, name, tripType }` or `null`.

---

## 6. Same-airport both-inside rule

**Policy assumption — needs client confirmation.**

If pickup and drop-off are both inside the **same** airport:

- Classify as **airport pickup**
- Charge **pickup fee once**
- Do **not** charge drop-off fee
- Do **not** sum fees
- Set `bothEndsSameAirport: true` and log `airport.detection.both_inside_same_airport`

This is the deterministic non-double-charge rule compatible with “pickup inside → apply pickup fee.” If the client later wants zero fee or drop-off fee for this rare case, only the detection policy needs to change; historical bookings keep their snapshot.

---

## 7. Overlapping-geofence behavior

Does **not** use query/order position.

When multiple airports match one point:

1. Exact Google Place ID match wins **if exactly one** matching airport has that Place ID.
2. Otherwise choose the **nearest center** only if it is **strictly closer** than the next match.
3. Otherwise fail safe: `ambiguous: true`, fee = 0, no airport charged. Logged as `airport.detection.ambiguous`.

Equal-distance overlaps therefore never invent a fee.

---

## 8. Admin airport APIs

Admin auth: existing `requireAuth` + `extractUserInfo` + `requireAdmin`.

| Method | Path |
|--------|------|
| GET | `/api/v1/admin/airports` |
| GET | `/api/v1/admin/airports/{id}` |
| POST | `/api/v1/admin/airports` |
| PATCH | `/api/v1/admin/airports/{id}` |

Create/update body: `code`, `name`, `googlePlaceId` optional, `countryCode`, `currency`, `latitude`, `longitude`, `radiusMeters`, `pickupFee`, `dropoffFee`, `isActive`. Fees use existing major-unit money convention and are stored as minor units.

Validation (backend is authoritative; Admin UI is not trusted):

- code non-empty, 2–16 alphanumeric, normalized uppercase
- valid coordinates (`latitudeSchema` / `longitudeSchema`)
- radius > 0
- pickup/drop-off fees ≥ 0, ≤ 2 decimal places
- currency 3–10 chars, uppercased
- duplicate code → 409
- duplicate non-null Google Place ID → 409

No DELETE. Deactivate with `isActive: false`.

---

## 9. SAN seeding / config status

**SAN was not seeded.**

The repository and current project data do **not** contain authoritative San Diego International Airport coordinates, Google Place ID, radius, or fee amounts. Those values were not invented.

`0030` creates the empty `airports` table only.

**SAN configuration must be entered through Admin/API after deployment.** Later airports (LAX, JFK, etc.) use the same API with no mobile or backend code changes.

---

## 10. Fare formula

Existing regular fare remains authoritative and is calculated **first**:

```
regularTripFare = max(minFare, baseFare + perKm * distance) − promo
airportFee      = matched pickup fee OR matched drop-off fee OR 0
passengerTotal  = regularTripFare + airportFee
```

Airport fee is **not** applied before regular fare, **not** included in distance/time/base-fare math, and **not** commissioned at quote time.

Quote currency remains `BDT` (existing fare contract). `airports.currency` is stored for Admin/reporting; no FX conversion was invented.

---

## 11. Booking snapshot

Written once at `confirmBooking` from the server quote:

| Column | Source |
|--------|--------|
| `pickup_place_id` | request pickup Place ID (new, optional) |
| `airport_id` | detected airport id or null |
| `airport_code_snapshot` | code at booking time |
| `airport_name_snapshot` | name at booking time |
| `airport_trip_type` | `pickup` \| `dropoff` \| null |
| `airport_fee_amount` | charged fee (major units, default 0) |
| `regular_trip_fare` | post-promo regular fare |
| `final_fare` | passenger total (regular + airport) |
| `estimated_fare` | same passenger total (existing column) |
| `original_fare` / `discount_amount` | unchanged regular-fare promo fields |

Later Admin airport-fee edits do **not** change this booking.

---

## 12. `final_fare` semantics

**`final_fare` = total passenger charge INCLUDING airport fee.**

Compatible with current card PI and cash ledger, which already charge `bookings.final_fare`.

```
final_fare = regular_trip_fare + airport_fee_amount
           = commissionable fare + airport fee
```

Passenger booking/history `fare.amount` continues to read `finalFare`, so it now includes the airport fee when present. Quote responses additionally expose `regularFare`, `airportFee`, and `airport`.

Existing non-airport bookings: `airport_fee_amount = 0`, so `final_fare` behavior is unchanged.

---

## 13. Card behavior

- One PaymentIntent. Amount = passenger total (`final_fare` → minor units).
- Example: regular 4000 + airport 500 → PI gross **4500**.
- No second PI for the airport fee.
- Airport fee is not transferred to the driver.
- Manual capture lifecycle unchanged.
- Card settlement status remains `pending`.
- `provider_transfer_id` remains null. **No Stripe Transfer** in this task.

---

## 14. Cash behavior

- Completed cash ledger `gross_amount` = passenger total from `final_fare`.
- Example: 4000 + 500 → ledger gross **4500**.
- Provider remains `cash`. No Stripe interaction.
- Cash settlement status remains `skipped_cash`, but amounts are still calculated with the same allocation.

---

## 15. Corrected settlement formula

```
passengerGross     = booking_payments.gross_amount
airportFee         = booking snapshot airport_fee_amount (0 if missing)
commissionableFare = passengerGross − airportFee   (must be >= 0)
driverAmount       = floor(commissionableFare * driverPercentage)
platformAmount     = commissionableFare − driverAmount   (company keeps remainder)
```

Guarantee:

```
driverAmount + platformAmount + airportFee = passengerGross
```

Example: regular 4000, airport 500, 25/75:

| Line | Amount |
|------|--------|
| Driver | 1000 |
| Company | 3000 |
| Airport | 500 |
| Passenger | 4500 |

Rejected (old percentage-of-gross behavior): 1125 / 3375 / 0-or-500.

Commission percentages apply **only** to regular fare. Airport fee is a separate line item and is **not** auto-paid to the airport.

Helper: `allocateCommissionableByPercentages` replaced `allocateGrossByPercentages`.

---

## 16. Settlement-settings migration / change

`airport_fee_percentage` was **removed** from `settlement_settings` (smallest safe correction; it is unused in all calculation paths).

Final commission model:

| Column | Rule |
|--------|------|
| `driver_percentage` | 0–100 |
| `company_percentage` | 0–100 |
| **sum** | **exactly 100.00** |
| `version` / `is_active` / timestamps | unchanged |

Current defaults remain driver `25.00` / company `75.00`.

Admin `GET/PATCH /api/v1/admin/settings/settlement` no longer accepts or returns `airportFeePercentage`.

`booking_settlements.airport_fee_percentage` is **left in place** as a legacy nullable snapshot so historical rows are not rewritten. New settlements write `null` there. `booking_settlements.airport_fee` is now the **fixed charged amount**, not a percentage of gross.

---

## 17. Driver API impact

No Android/iOS changes.

Existing Driver Payment History continues to return:

- passenger payment gross
- `settlement.driverAmount`
- `settlement.platformAmount`
- `settlement.airportFee`

Airport fee is **not** labeled as driver earnings.

`calculatedDriverEarnings` sums `driver_amount` only.

`driverEarningsAvailable` stays `false` (Stripe Transfer still not implemented).

---

## 18. Backward compatibility

- Existing non-airport rides: snapshot fee defaults to 0 → commissionable = gross → same 25/75 split.
- Existing captured payments/settlements were **not** recalculated.
- Migration `0030` has no `UPDATE`/`DELETE` of `booking_payments` or `booking_settlements`.
- Quote adds `regularFare`, `airportFee`, `airport` without removing existing Passenger fields.
- Pickup `placeId` is optional on quote/create.

Airport financial reporting foundation (persisted, no Admin report UI in this task):

- Airport identity: `airport_id` + code/name snapshots
- Trip type: `airport_trip_type`
- Trip fare: `regular_trip_fare`
- Airport fee: `airport_fee_amount` and settlement `airport_fee`
- Passenger total: `final_fare` / payment `gross_amount`
- Driver / company: settlement `driver_amount` / `platform_amount`
- Payment method / status: existing `booking_payments`

---

## 19. Files changed (this task)

**New**

- `src/db/schema/airports.ts`
- `src/db/migrations/0030_airports_and_commission_only.sql`
- `src/db/migrations/0030_airports_and_commission_only.down.sql`
- `src/repositories/airport.repository.ts`
- `src/services/airportDetection.service.ts`
- `src/services/airportAdmin.service.ts`
- `src/controllers/adminAirport.controller.ts`
- `src/routes/v1/admin/airports.ts`
- `tests/airport-fixed-fee.test.ts`
- `tests/admin-airport-routes.test.ts`
- `RYDU_BACKEND_MULTI_AIRPORT_FIXED_FEE_IMPLEMENTATION_REPORT.md`

**Updated**

- `src/db/schema/settlement_settings.ts` — commission-only
- `src/db/schema/bookings.ts` — pickup Place ID + airport snapshot
- `src/db/schema/index.ts`
- `src/db/migrations/meta/_journal.json`
- `src/utils/geo.ts` — `haversineMeters`
- `src/utils/money.ts` — `allocateCommissionableByPercentages`
- `src/services/settlementSettings.service.ts`
- `src/services/settlement.service.ts`
- `src/services/fare.service.ts`
- `src/services/booking.service.ts`
- `src/controllers/passengerBooking.controller.ts` — quote breakdown
- `src/validators/index.ts` — airport CRUD + pickup `placeId`
- `src/routes/v1/index.ts` — mount Admin airports
- `tests/fare.service.test.ts`
- `tests/settlement-configuration.test.ts`
- `tests/admin-settlement-settings-routes.test.ts`
- `tests/driver-payment-history.test.ts`

Passenger Flutter / Driver Android / Driver iOS / Admin frontend were not modified.

---

## 20. Migrations

| Migration | Purpose |
|-----------|---------|
| `0029_settlement_settings` | Prior commission table (now superseded for airport %) |
| `0030_airports_and_commission_only` | Drop settings airport %; add `airports`; add booking snapshot columns |

`0030` applied successfully on local/dev `localhost:5432/ryd_u`.

No SAN seed. No historical settlement backfill.

---

## 21. Tests / build

Focused coverage maps to the requested cases:

| Case | Coverage |
|------|----------|
| A regular trip fee 0 | `airport-fixed-fee` + fare service |
| B pickup fee | detection + fare add-on |
| C drop-off fee | detection |
| D pickup ≠ drop-off fee | detection + airport record |
| E inactive ignored | detection loads active only |
| F coordinates primary | Haversine radius |
| G Place ID positive validation | place_id match outside radius |
| H typed address does not classify | detection has no address inputs |
| I same-airport both-inside no double charge | pickup fee once |
| J overlapping fail-safe | equal distance → fee 0 |
| K multiple airports | independent TESTA / TESTB |
| L Admin create | service + route tests |
| M Admin update fee | service + route tests |
| N fee change does not rewrite booking snapshot | confirmBooking writes quote snapshot |
| O 4000 + 500 = 4500 | fare + settlement |
| P 25% of 4000, not 4500 | settlement |
| Q 1000 + 3000 + 500 = 4500 | settlement |
| R card PI uses 4500 | `finalFare` → PI amount |
| S cash ledger uses 4500 | `finalFare` → gross |
| T card settlement `pending` | `ensureSettlementForCapturedPayment` |
| U cash settlement `skipped_cash` | same |
| V airport not in `calculatedDriverEarnings` | sums `driver_amount` only |
| W non-airport 25/75 unchanged | settlement |
| X no Stripe Transfer | settlement + cash + PI source |
| Y driver + company = 100 | settings parser + Admin PATCH |
| Z historical settlement not recalculated | existing row returned; migration has no settlement UPDATE |

Also run: fare, cash booking payment, driver payment history, Stripe phases A–D, booking route contract.

```
npx tsc --noEmit   # pass
npm run build      # pass
npm run db:migrate # 0030 applied on ryd_u
```

---

## 22. Exact remaining work

1. **Enter SAN (and later airports) via Admin API** after deploy: code, name, Place ID, country, currency, center, radius, pickup/drop-off fees. Values were not invented here.
2. **Admin frontend** airport CRUD / reporting UI (backend APIs and persisted report columns are ready).
3. **Passenger app** should later display `regularFare`, `airportFee`, `airport`, and optionally persist/show the booking snapshot. Quote contract is additive; booking/history `fare.amount` is already the passenger total.
4. **Client confirmation** of the both-inside-same-airport rule (currently pickup fee once) and the cross-airport rule (currently no airport fee).
5. **Polygon geofence** when needed (`geofence_polygon` + `geofence_type = polygon` are reserved).
6. **Stripe Transfer** of `driver_amount` only — still not implemented. Airport fee must stay out of that transfer.
7. Optional later cleanup of leftover `booking_settlements.airport_fee_percentage` (legacy unused snapshot; new writes are `null`).
8. If an airport currency ever differs from fare `BDT`, FX rules must be specified; none were added.

---

**RYDU BACKEND MULTI-AIRPORT FIXED-FEE IMPLEMENTATION COMPLETE**
