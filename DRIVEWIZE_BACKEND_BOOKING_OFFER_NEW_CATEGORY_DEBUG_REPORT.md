# DriveWize Backend — New Category Booking Offer Debug Report

**Date:** 2026-09-26  
**Scope:** Trace only. No code, migration, or assignment data was changed.  
**Database:** Current environment (`drizzle.__drizzle_migrations` applied count = 33, including `0033_drivewize_service_category_catalog`).

**FINAL STATUS: ROOT CAUSE: DRIVER/VEHICLE CATEGORY ASSIGNMENT MISMATCH**

---

## Traced booking

Latest new-category booking, market BD (the on-duty test driver is in Dhaka, about 7 meters from this pickup).

| Field | Value |
|---|---|
| Booking id | `fadbbacf-8157-4590-b2e2-4aee3bd9e05b` |
| Booking number | `RYD-MUI6YXKV-19F2` |
| `serviceCategoryId` | `1912672d-acaf-4493-b6a1-6a162c698df3` |
| Code / name | `economy` / Economy Sedan (`is_active = true`) |
| Status now | `no_drivers` |
| Scheduling | instant |
| Pickup market | `BD` (`pickup_country_code` BD, currency BDT) |
| Pickup | `23.76386560`, `90.42877060` |
| Created | `2026-09-26T09:32:58.879Z` (event `created`, payload status `quoted`) |
| Payment | method `card`. Event `card_payment_authorized` at `2026-09-26T09:33:27.677Z` moved status `quoted` → `searching`. `authorized_at` is set. Current `booking_payments.status` is `cancelled` (authorization released after terminal `no_drivers`). Booking `payment_status` remains `pending`. |
| Dispatch | `dispatch_batch = 3` (max batches). `offer_count = 0`. |

Booking creation succeeded. Card authorization succeeded and is what starts dispatch for card bookings (`shouldStartDispatchOnBookingCreate` returns false for `card`; `activateAuthorizedCardBooking` calls `startDispatch` after the quoted → searching transition).

Three earlier Economy bookings have the same shape: zero offers, same Economy UUID.

| Booking | Market | Status | Offers |
|---|---|---|---|
| `efd81bca-8e42-4474-b11a-cce549619091` | BD | `cancelled` (passenger cancelled during search, batch 2) | 0 |
| `1af6fadb-30d4-4a26-a74c-b278f2f4d7d1` | US (San Francisco pickup) | `no_drivers` | 0 |
| `cec227b6-eb0c-45a1-a4c1-899b744ef67d` | BD | `cancelled` (batch 1) | 0 |

Prior `ride` bookings for the same driver did create offers. Example: `50f69368-edf7-442f-adf4-25f64edc6680` (completed) has offer `fb00c5cd-9cb0-466d-9806-872de0e1eb45` for driver `281b0d60-71c9-45e3-abcd-0d7c6a590c37`, category UUID `59ab7ef9-0bb3-47c8-8afa-3313b295151e` (`ride`).

---

## 1. Booking creation

`POST` create path is `createBooking` in `src/services/booking.service.ts`.

- Inserts `bookings.service_category_id` from the request UUID. No code rewrite.
- Card bookings are inserted as `quoted` and do not call `startDispatch` in `createBooking`.
- Cash/non-card instant bookings call `startDispatch` immediately.

This booking was created as `quoted`, then authorized, then dispatched. Creation did not fail.

---

## 2. Offer / dispatch

After card authorization, `activateAuthorizedCardBooking` sets `searching` and calls `startDispatch` (`src/services/cardBookingActivation.service.ts`).

`startDispatch` (`src/services/dispatch.service.ts`):

1. Loads the booking. Continues only for `searching` or `offered`.
2. Increments `dispatch_batch`. Stops at `no_drivers` after `DISPATCH_MAX_BATCHES` (3).
3. Calls `findNearbyDriversForCategory(booking.serviceCategoryId, pickup, radius)`.
4. That function reads Redis `location:driver:*` and runs `checkDriverEligibility` per driver.
5. If the eligible list is empty, it logs `[Dispatch] no eligible drivers in batch` and `[Dispatch] driver ineligible`, then retries until batch 3, then sets status `no_drivers` and releases the card authorization. It does not insert a `booking_offers` row.
6. Offers, `booking:offer`, and FCM run only inside the `for (candidate of batchDrivers)` loop, after `createPendingBookingOffer`.

Runtime result for `fadbbacf-8157-4590-b2e2-4aee3bd9e05b`:

- Dispatch started (status left `quoted`, `search_started_at` set, batch advanced to 3, ended `no_drivers`).
- Offer created: **no**. `booking_offers` count for this booking is 0.
- Eligible drivers: **0**.

The live server log buffer no longer contains the `[Dispatch]` lines from 09:33 UTC (it had already rolled to later location traffic). The booking row is the record of that run: batch 3 and zero offers.

---

## 3. Driver eligibility (current code + current runtime)

Test driver seen on the live API (`POST /api/locations`, role `driver`): `281b0d60-71c9-45e3-abcd-0d7c6a590c37` (Rakib Khan).

Re-ran `diagnoseDriverEligibility` and `resolveDriverServiceCategories` against this booking’s Economy UUID and pickup.

| Check | Result now |
|---|---|
| Account | `active` |
| DB status | `online` |
| Redis status | `online` |
| Redis active-driver scan | 1 driver, this id (`location:driver:*`) |
| Active booking | not busy |
| Pending exchange / accept lock | not present |
| Duty | session `cb19aae9-5701-4c3c-893e-7b169feeb9e8` status `active` (not required; see filters) |
| Vehicle | `f46dfcd2-1ce2-4984-bd8c-020021bc7343`, plate `5843`, Ford F-150, status `active` |
| Active assignment | `171b2df3-9105-4611-a3ee-78f20d60beff` → that vehicle, `is_active = true` |
| Location | Redis heartbeat and location timestamp `2026-09-26T09:41:36.991Z`, lat `23.7639006`, lng `90.4288306` |
| Distance to this pickup | **0.007 km** (radius is 15 km) |
| Category match | **false**. Diagnosis reasons: `SERVICE_CATEGORY_MISMATCH` only (the `vehicle_source` / `category_source` strings are labels, not extra failures) |

`checkDriverEligibility` filters, in order, from `src/services/driverAvailability.service.ts`. Runtime config: `QR_DUTY_REQUIRED` unset so `qrDutyRequired = false`, `DISPATCH_RADIUS_KM = 15`, `DRIVER_LOCATION_STALE_SECONDS = 120`.

1. Driver row exists, else `DRIVER_NOT_ELIGIBLE`.
2. Account not deactivated, else `DRIVER_NOT_ELIGIBLE`.
3. No active booking, else `DRIVER_BUSY`.
4. No pending vehicle exchange and dispatch not suspended, else `EXCHANGE_PENDING`.
5. Not mid-accept, else `EXCHANGE_PENDING`.
6. Redis status, or DB status if Redis is empty, must be `online`, else `DRIVER_NOT_ONLINE`.
7. Only if `QR_DUTY_REQUIRED`: active duty session and active vehicle assignment, else `DRIVER_NOT_ON_DUTY`. **Off in this environment, so this filter did not run.**
8. Dispatch vehicle: active assignment vehicle, else `drivers.vehicle_id`, else `NO_ACTIVE_VEHICLE`.
9. Vehicle status in `active` or `approved`, else `VEHICLE_NOT_APPROVED`.
10. `driverServesCategory`: exact UUID membership, else `SERVICE_CATEGORY_MISMATCH`.
11. Redis location present and coordinates valid, else `LOCATION_STALE`.
12. Heartbeat or location timestamp within 120 seconds, else `LOCATION_STALE`.
13. Haversine distance ≤ 15 km, else `DRIVER_NOT_ELIGIBLE` (“outside dispatch radius”).

Category resolution (`resolveDriverServiceCategories` in `src/services/vehicleEligibility.service.ts`):

- If the driver has an active assignment and that vehicle has any `vehicle_service_categories` rows, those UUIDs are the match set (`source: active_assignment`).
- Driver-level `driver_service_categories` are used only when the vehicle has **no** category rows (`source: legacy_driver_vehicle`).
- Match is `categoryIds.includes(serviceCategoryId)`. Codes are not compared.

This driver resolves `source: active_assignment`, vehicle `f46dfcd2-1ce2-4984-bd8c-020021bc7343`. Economy UUID is not in that list.

The candidate pool is only drivers with a Redis location key. One driver is in that pool. That driver fails step 10. Eligible count is 0.

---

## 4. Migration 0033 vs current assignments

`src/db/migrations/0033_drivewize_service_category_catalog.sql`:

- Inserts six new rows (`economy`, `executive`, `suv`, `van`, `minivan`, `ada`) with new UUIDs (`ON CONFLICT (code) DO UPDATE`, `is_active = true`).
- Sets `is_active = false` for `ride`, `bike`, `cng`, `moto`, `premium`, `comfort`.
- Does not delete rows.
- Does not update `bookings.service_category_id`.
- Does not insert or update `driver_service_categories`.
- Does not insert or update `vehicle_service_categories`.

Applied in this database: new rows share `created_at` / legacy `updated_at` `2026-09-24T23:43:46.096Z`.

Current catalog UUIDs:

| Code | UUID | Active |
|---|---|---|
| economy | `1912672d-acaf-4493-b6a1-6a162c698df3` | true |
| executive | `98382f3e-2cf4-4814-9fd9-fcc4c686b38f` | true |
| suv | `5bee5ff4-4009-4256-833c-41916c060439` | true |
| van | `3256463d-92e9-4083-ab95-3dc2eefbd4df` | true |
| minivan | `747034ed-417b-4105-82f6-9f9dcd933033` | true |
| ada | `938612b8-c1a2-4c92-8144-0636a11b4650` | true |
| ride | `59ab7ef9-0bb3-47c8-8afa-3313b295151e` | false |
| bike | `d793ac30-c749-48b9-9c63-0b6b7d50289a` | false |
| cng | `10ef8afd-7e45-4be2-97a4-00303a624cde` | false |
| moto | `264247c5-af89-4fcb-802a-d576791dc300` | false |
| premium | `2d7bcfdd-4343-4a07-b0df-214c807a8e87` | false |
| comfort | `9a9da7dd-f122-4e9c-a351-1c2ab6fe4e00` | false |

Junction counts for the six new codes: **0 vehicle links and 0 driver links each.**

Legacy product links still exist (ride 5 vehicles / 1 driver, bike 2/0, cng 2/0, moto 3/0, premium 2/0, comfort 2/0).

### Test driver assignments

`driver_service_categories` (one row, created `2026-07-11`, before 0033):

| UUID | Code | Active | Primary |
|---|---|---|---|
| `59ab7ef9-0bb3-47c8-8afa-3313b295151e` | ride | false | true |

### Test vehicle assignments

Vehicle `f46dfcd2-1ce2-4984-bd8c-020021bc7343`. All rows `source = admin_update`. Five created `2026-09-15T19:18:07.811Z`. `ride` created `2026-09-17T22:44:45.442Z`. None were written by migration 0033.

| UUID | Code | Active | Primary |
|---|---|---|---|
| `d793ac30-c749-48b9-9c63-0b6b7d50289a` | bike | false | true |
| `10ef8afd-7e45-4be2-97a4-00303a624cde` | cng | false | false |
| `9a9da7dd-f122-4e9c-a351-1c2ab6fe4e00` | comfort | false | false |
| `264247c5-af89-4fcb-802a-d576791dc300` | moto | false | false |
| `2d7bcfdd-4343-4a07-b0df-214c807a8e87` | premium | false | false |
| `59ab7ef9-0bb3-47c8-8afa-3313b295151e` | ride | false | false |

Economy UUID `1912672d-acaf-4493-b6a1-6a162c698df3` is on the booking and on none of these rows.

Admin’s bookable catalog is the six active categories. The test vehicle is still assigned the retired UUIDs. Those are different sets.

Because the vehicle already has category rows, dispatch never consults the driver’s `ride` row. Even if it did, that row is also the legacy `ride` UUID, not Economy.

---

## 5. Socket delivery

Not reached.

`notifyDriverOfPersistedOffer` emits `booking:offer` only after a `booking_offers` insert (`src/services/driverOfferNotify.service.ts` → `emitToDriver` → room `driver-{driverId}`). This booking has no offer row, so there is no emission, no room target, and no success/failure for this booking.

The driver app is connected for other traffic right now (location posts, Redis location fresh, one socket client was authenticated as this driver during the trace). That does not create an offer.

---

## 6. FCM delivery

Not attempted for this booking.

`scheduleDriverOfferPush` runs only from `notifyDriverOfPersistedOffer`, after the offer row exists. No offer means no `booking_offer` FCM send and no FCM error.

The driver does have an enabled push-token row (`token` present, `last_registered_at` `2026-09-26T03:12:33.856Z`). A registered token cannot deliver an offer that was never created.

---

## Answers

1. Test booking id: `fadbbacf-8157-4590-b2e2-4aee3bd9e05b`
2. Category: `1912672d-acaf-4493-b6a1-6a162c698df3` / `economy` / Economy Sedan
3. Booking created: yes (`quoted`, then authorized to `searching`)
4. Dispatch started: yes (batch 3, status `no_drivers`)
5. Offer created: no
6. Eligible drivers: 0 (1 driver in the Redis location pool; that driver fails category match)
7. Eligibility filters: the 13 checks in section 3. The failing check is exact UUID membership (`SERVICE_CATEGORY_MISMATCH`).
8. Duty: active session `cb19aae9-5701-4c3c-893e-7b169feeb9e8`. QR duty is not required for dispatch in this environment. Driver status is `online`.
9. Vehicle: `f46dfcd2-1ce2-4984-bd8c-020021bc7343` (plate 5843), via active assignment and `drivers.vehicle_id`. Status `active`.
10. Driver categories: legacy `ride` only (`59ab7ef9-0bb3-47c8-8afa-3313b295151e`)
11. Vehicle categories: legacy `bike`, `cng`, `comfort`, `moto`, `premium`, `ride` only
12. New Economy UUID matches those assignments: **no**
13. Migration 0033 changed assignments: **no**. It inserted new category rows and soft-retired legacy codes. Junction rows were left as they were. Current vehicle rows predate 0033 and are `admin_update`.
14. Socket `booking:offer`: not emitted (no offer)
15. FCM `booking_offer`: not attempted (no offer)
16. Root cause: **DRIVER/VEHICLE CATEGORY ASSIGNMENT MISMATCH**
17. Smallest safe fix: do not change matching, radius, payment, or apps. On the existing Admin vehicle update (`serviceCategoryIds` in `adminFleetVehicleUpdate.service.ts`), set vehicle `f46dfcd2-1ce2-4984-bd8c-020021bc7343` to the new category UUIDs it should actually serve. For this Economy test, that set must include `1912672d-acaf-4493-b6a1-6a162c698df3`. That update writes `vehicle_service_categories` and removes omitted ids. Updating only `driver_service_categories` will not change this driver’s match set while the vehicle still has category rows. The same gap is fleet-wide: every new category currently has zero vehicle and zero driver links, so any new-category booking will exhaust dispatch the same way until the vehicles that should serve those products are assigned.

---

**ROOT CAUSE: DRIVER/VEHICLE CATEGORY ASSIGNMENT MISMATCH**
