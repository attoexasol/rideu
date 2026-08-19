# Backend Ride History Audit Report

**Scope:** Audit only. No code was changed.  
**Authority:** Implemented code under `src/` (routes, services, repositories, schema, tests). Docs that disagree with code are called out as stale.  
**Date:** 2026-08-17

**Final status:** `AUDIT COMPLETE — BACKEND HISTORY GAPS: passenger list exists but is not a history DTO; driver has no booking-history list; trips cannot be the ride source; several UX fields are missing from current responses.`

---

## Executive summary

The booking lifecycle already lives on `bookings`. Passenger restore (`GET /api/v1/passenger/bookings/active`) and passenger list (`GET /api/v1/passenger/bookings`) already exist. Driver restore (`GET /api/v1/driver/bookings/active`) and driver detail (`GET /api/v1/driver/bookings/:bookingId`) exist. **There is no `GET .../bookings/history` for either app, and no driver booking list at all.**

The existing passenger list cannot be used as Ride History as specified:

- It returns **raw booking rows**, not the passenger snapshot used by active/detail.
- It includes **active/ongoing bookings**, so an active ride would be duplicated if the History screen also shows `GET .../active`.
- It has **no status filters**, **no max page size**, and **no query validation**.

Driver Activity cannot currently be served from this booking API. Legacy `GET /api/trips/me` and `GET /api/trips/:driverId` query the `trips` table, which is only created when a booking reaches `in_progress`. Cancelled / no-driver / pre-start rides would be missing. This backend repo does not contain the mobile apps, so Driver Activity mock-vs-API usage in the Kotlin/Flutter clients cannot be proven here; **there is no booking-shaped driver history API they could be calling.**

**Authoritative history source:** `bookings`, with joins. Do not list `trips` as a second ride record.

**Least disruptive contract:** Option A using the existing split endpoints — keep `GET .../active`, add/adjust a paginated history list that **excludes ongoing statuses**. Do not put the active ride inside a paginated `rides[]` array.

---

## 1. Passenger booking history support

Base path: `/api/v1/passenger` (`src/routes/v1/passenger/index.ts`).  
Auth for all booking routes below: `requireAuth` + `extractUserInfo` + `requireCustomer` (JWT role `customer`). Customer id is `req.user.userId` from the session JWT. Callers cannot pass another customer id.

### 1.1 Existing booking endpoints

| Method | Path | Exists? | Handler |
|--------|------|---------|---------|
| GET | `/api/v1/passenger/bookings/active` | **Yes** | `activeBookingHandler` |
| GET | `/api/v1/passenger/bookings` | **Yes** | `listBookingsHandler` |
| GET | `/api/v1/passenger/bookings/history` | **No** | — |
| GET | `/api/v1/passenger/bookings/:bookingId` | **Yes** | `getBookingHandler` |
| POST | `/api/v1/passenger/bookings` | Yes (create) | `createBookingHandler` |
| POST | `/api/v1/passenger/bookings/quote` | Yes | `quoteHandler` |
| POST | `/api/v1/passenger/bookings/:bookingId/cancel` | Yes | `cancelBookingHandler` |
| POST | `/api/v1/passenger/bookings/:bookingId/recording-consent` | Yes | `consentRecordingHandler` |
| GET | `/api/v1/passenger/bookings/:bookingId/share` | Yes | `shareBookingHandler` |
| GET | `/api/v1/passenger/bookings/:bookingId/live-video` | Yes | `liveVideoHandler` |

Related but not history: places, routes, services, payment-methods, nearby drivers.

### 1.2 `GET /api/v1/passenger/bookings/active`

- **Auth:** customer JWT. Extra `passengerRecoveryRateLimit`.
- **Filters:** none. Server selects the latest booking for `user.userId` whose status is in `PASSENGER_ONGOING_BOOKING_STATUSES`.
- **Statuses included:** `searching`, `offered`, `scheduled`, `accepted`, `driver_en_route`, `arrived`, `in_progress`.
- **Pagination:** none. At most one row (`ORDER BY created_at DESC LIMIT 1`).
- **Empty result:** `{ success: true, data: null }`.
- **Shape:** `formatPassengerBookingSnapshot` (not the raw `getBookingDetail` join documented in older API markdown).

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "searching | offered | scheduled | accepted | driver_en_route | arrived | in_progress",
    "bookingNumber": "RYD-...",
    "pickup": { "latitude": 0, "longitude": 0, "address": "", "spotLabel": null },
    "dropoff": { "latitude": 0, "longitude": 0, "address": "", "placeId": null },
    "service": { "serviceCategoryId": "uuid", "serviceCode": "ride", "serviceName": "Ride" },
    "fare": { "amount": 0, "currency": "BDT", "estimatedAmount": 0, "discountAmount": 0 },
    "route": { "encodedPolyline": null, "distanceKm": 0, "durationMin": 0 },
    "driver": null,
    "createdAt": "ISO-8601",
    "cancelledAt": null,
    "schedulingType": "instant",
    "searchStartedAt": "ISO-8601",
    "acceptedAt": null
  }
}
```

When a driver is assigned, `driver` is:

```json
{ "id": "uuid", "name": "...", "phone": "...", "plateNumber": "..." }
```

**Not in this snapshot:** vehicle make/model/color, payment method/status, `startedAt`, `completedAt`, `arrivedAt`, cancellation reason, driver image/rating, passenger-facing recording status.

**Docs drift:** `PASSENGER_APP_API.md` and `All_APIs_endpoint.md` still show a nested `{ booking, customerName, driverName, ... }` active/detail payload. Implemented code uses the flat snapshot above. `DRIVER_PASSENGER_BOOKING_CONTRACT.md` matches the snapshot.

**One-active rule (application-level only):** `confirmBooking` rejects create if `findActiveBookingByCustomer` finds a row in `PASSENGER_ONGOING_BOOKING_STATUSES`. There is **no unique partial index** enforcing one ongoing booking per customer.

### 1.3 `GET /api/v1/passenger/bookings`

- **Auth:** customer JWT.
- **Query:** `page` (default 1), `limit` (default 20). **Not validated.** No max cap. No `status`, date, or category filter.
- **Source:** `listBookingsByCustomer(customerId, limit, offset)` — all bookings for that customer.
- **Sort:** `created_at DESC`.
- **Statuses included:** **all**, including ongoing (`searching`, `in_progress`, …) and terminal (`completed`, `cancelled`, `no_drivers`). Active ride **is included**.
- **Pagination metadata:** `metadata.pagination = { page, limit, total, totalPages }` via `calculatePagination`.
- **Response `data`:** array of **raw `bookings` rows** (Drizzle camelCase), **not** `formatPassengerBookingSnapshot`.

Representative raw item fields (not a public DTO): `id`, `bookingNumber`, `customerId`, `serviceCategoryId`, `status`, `schedulingType`, `scheduledPickupAt`, pickup/dropoff lat/lng/address fields, `estimatedDistanceKm`, `estimatedDurationMin`, `estimatedFare`, `originalFare`, `promotionId`, `discountAmount`, `finalFare`, `paymentMethodId`, `paymentStatus`, `assignedDriverId`, `assignedVehicleId`, `linkedTripId`, timestamps (`searchStartedAt`, `acceptedAt`, `arrivedAt`, `startedAt`, `completedAt`, `cancelledAt`), `cancelledBy`, `cancellationReason`, `routeEncodedPolyline`, `createdAt`, `updatedAt`, recording-consent columns.

**Joins not applied:** no driver name, no vehicle, no service name/code, no payment method name.

This is the only passenger “history” list today. It is insufficient for the target UX without a DTO, active exclusion, and filters.

### 1.4 `GET /api/v1/passenger/bookings/:bookingId`

- **Auth:** customer JWT.
- **Authorization:** load by id; if `booking.customerId !== user.userId` → `403 FORBIDDEN`; missing → `404 NOT_FOUND`.
- **Shape:** same snapshot as active (`formatPassengerBookingSnapshot`).
- **Works for historical bookings:** yes, any status, as long as it belongs to the customer.
- **Same field gaps as active** (vehicle details, payment, started/completed, cancellation reason, etc.).

### 1.5 Services / repositories

| Function | File | Role |
|----------|------|------|
| `getPassengerActiveBooking` | `booking.service.ts` | Active restore |
| `getCustomerBookings` | `booking.service.ts` | Page/limit list |
| `formatPassengerBookingSnapshot` | `booking.service.ts` | Active + detail DTO |
| `findActiveBookingByCustomer` | `booking.repository.ts` | Ongoing statuses, newest `created_at` |
| `listBookingsByCustomer` | `booking.repository.ts` | All rows, `created_at DESC` |
| `countCustomerBookings` | `booking.repository.ts` | Total for pagination |
| `getBookingDetail` | `booking.repository.ts` | Join customer + category + driver + vehicle plate |

---

## 2. Driver history support

Base path: `/api/v1/driver/bookings` (`src/routes/v1/driver/bookings.ts`).  
Auth: `requireAuth` + `extractUserInfo` + `requireDriver`. Driver row is resolved from JWT `auth0Id` (`driverUtils.findByAuth0Id`). Callers cannot pass another driver id on v1 booking routes.

### 2.1 Existing driver booking endpoints

| Method | Path | Exists? | Purpose |
|--------|------|---------|---------|
| GET | `/api/v1/driver/bookings/active` | **Yes** | Restore assigned in-progress ride |
| GET | `/api/v1/driver/bookings` | **No list** | Router has no collection GET; `GET /` is not registered |
| GET | `/api/v1/driver/bookings/history` | **No** | — |
| GET | `/api/v1/driver/bookings/:bookingId` | **Yes** | Assigned booking **or** current pending offer |
| GET | `/api/v1/driver/bookings/offers` | Yes | Pending offers |
| GET | `/api/v1/driver/bookings/offers/pending` | Yes | Same as offers |
| GET | `/api/v1/driver/bookings/offers/:offerId` | Yes | Single offer |
| POST | `/api/v1/driver/bookings/:bookingId/accept` | Yes | Accept |
| POST | `.../decline` and `.../reject` | Yes | Decline |
| PATCH | `.../:bookingId/status` | Yes | `arrived` → `in_progress` → `completed` |
| POST | `.../:bookingId/cancel` | Yes | Driver cancel before start |
| POST/GET | `.../:bookingId/video/session` | Yes | Recording session |

There is **no** `listBookingsByDriver` (or equivalent) in `booking.repository.ts`.

### 2.2 `GET /api/v1/driver/bookings/active`

- **Statuses:** `ACTIVE_BOOKING_STATUSES` = `accepted`, `driver_en_route`, `arrived`, `in_progress`.
- **Not included:** `searching` / `offered` (those are offers, not assigned rides), `scheduled`, terminal statuses.
- **Empty:** `{ success: true, data: null }`.
- **Query:** `findActiveBookingByDriver` — `assigned_driver_id = driverId` AND status in active set, `LIMIT 1`. **No `ORDER BY`.** Fine if the one-active invariant holds; non-deterministic if a race created two.
- **Shape:** `buildDriverBookingPayload(..., includePassengerContact: true)`.

```json
{
  "success": true,
  "data": {
    "booking": {
      "id": "uuid",
      "bookingNumber": "RYD-...",
      "status": "driver_en_route",
      "recordingConsentedAt": null,
      "pickup": { "latitude": 0, "longitude": 0, "address": "", "spotLabel": null },
      "dropoff": { "latitude": 0, "longitude": 0, "address": "" },
      "route": { "encodedPolyline": "", "distanceKm": 0, "durationMin": 0, "distanceMeters": 0, "durationSeconds": 0, "bounds": {} },
      "fare": { "amount": 0, "currency": "BDT" }
    },
    "passenger": { "name": "...", "phone": null, "rating": null },
    "vehicle": { "id": "uuid", "make": "...", "model": "...", "color": "...", "plateNumber": "..." },
    "service": { "serviceCategoryId": "uuid", "serviceCode": "...", "serviceName": "..." },
    "video": {
      "required": true,
      "sessionId": "uuid | null",
      "nextSegmentIndex": 0,
      "segmentDurationSeconds": 10,
      "active": false
    }
  }
}
```

`video` may be `null` if metadata load fails. `passenger.phone` is **hardcoded `null`**. `passenger.rating` is **hardcoded `null`**. Timestamps other than `recordingConsentedAt` are not in this payload. Cancellation fields are not in this payload.

### 2.3 `GET /api/v1/driver/bookings/:bookingId`

Allowed if:

1. `assignedDriverId ===` authenticated driver (any status, including `completed` / `cancelled` after assignment), **or**
2. Booking is `searching`/`offered` **and** this driver has a pending offer.

Otherwise `404 BOOKING_NOT_ASSIGNED` (not 403), to avoid leaking existence.

This **can** back a history-item tap for rides this driver was assigned to. It cannot load another driver’s ride. It will **not** return pre-assignment passenger cancellations (no `assignedDriverId`). Offer-time access is for live dispatch, not history.

Same payload as active, except unassigned offer preview uses `passenger: { displayName, rating: null }` and does not generate a Google route.

### 2.4 Legacy trip / activity / earnings APIs

These are **not** the v1 booking contract. They query `trips`.

| Method | Path | Auth | What it returns |
|--------|------|------|-----------------|
| GET | `/api/trips/me` | driver JWT | Paginated `trips` rows for that driver. Filters: `status`, `startDate`, `endDate`. Sort: `start_time DESC`. Default page/limit 20. |
| GET | `/api/trips/current` | driver JWT | Active trip with `trips.status = in_progress`, or 404. |
| GET | `/api/trips/:driverId` | own driver or admin | Formatted `{ id, startTime, endTime, distance, status, startLocationId, endLocationId }`. **Pagination metadata uses page/limit, but `tripUtils.getForDriver` ignores offset** (limit only, default 50). Date filters on the count query are incomplete vs the list query. |
| GET | `/api/reports/driver/:id` | **admin only** | Trip stats + up to 100 completed trips. Not a driver-app API. |
| POST/PUT | `/api/trips`, `/api/trips/:id` | legacy start/end | Independent of passenger booking flow. |

Trip row shape does **not** include pickup/dropoff addresses, fare, booking number, passenger, vehicle, or service category.

**Does Driver Activity use mock data, trips, or bookings?**

- **Bookings table via v1:** no list endpoint exists → cannot be the current Activity source.
- **Trips table via `/api/trips/*`:** exists, but only covers rides that reached `in_progress`, and the payload is not ride-history UX.
- **Earnings:** no driver earnings, commission, or payout tables/APIs. `payment_status` is flipped to `paid` on complete with no capture.
- **This repo has no driver-app UI.** If the Kotlin Activity screen already shows a list, it is either local/mock or the incomplete legacy trips API. It is **not** a first-class booking history API.

---

## 3. Current status model

Defined in `src/constants/bookingStatus.ts`. Stored as `bookings.status` (`varchar`, default `'quoted'`).

### 3.1 Actual booking status values

| Value | Constant | Written by current booking flow? |
|-------|----------|----------------------------------|
| `quoted` | `QUOTED` | **No insert uses it.** Quote API does not persist a booking. Schema default only. |
| `searching` | `SEARCHING` | Yes — instant confirm |
| `offered` | `OFFERED` | Yes — dispatch batch with pending offers |
| `accepted` | `ACCEPTED` | In active-status arrays, but **accept writes `driver_en_route`**, skipping `accepted` |
| `driver_en_route` | `DRIVER_EN_ROUTE` | Yes — accept |
| `arrived` | `ARRIVED` | Yes — driver PATCH |
| `in_progress` | `IN_PROGRESS` | Yes — driver PATCH (creates trip) |
| `completed` | `COMPLETED` | Yes — driver PATCH |
| `cancelled` | `CANCELLED` | Yes — passenger or driver cancel |
| `expired` | `EXPIRED` | **Not written on bookings.** Offers expire; failed dispatch uses `no_drivers` |
| `no_drivers` | `NO_DRIVERS` | Yes — max dispatch batches with no accept |
| `scheduled` | `SCHEDULED` | Yes — `schedulingType: scheduled`. **Does not auto-dispatch** (known limitation) |

Offer statuses (table `booking_offers`, not ride history): `pending`, `accepted`, `declined`/`rejected`, `expired`, `taken`/`superseded`, `cancelled`.

Trip statuses (table `trips`): `in_progress` (default), `completed` (on booking complete), `cancelled` allowed by legacy trip end helper. Booking-driven trips are created at `in_progress` and completed with the booking; driver/passenger cannot cancel after `in_progress`, so booking-flow trips should not become `cancelled` through v1 cancel APIs.

### 3.2 Classification for Ride History

Classification below is derived from **code behavior**, not a product doc. Ambiguities are marked.

| Status | Class | Why |
|--------|-------|-----|
| `searching` | **ACTIVE** (passenger) / **NON-RIDE for driver history** | Passenger restore includes it. No driver assigned yet. |
| `offered` | **ACTIVE** (passenger) / **NON-RIDE for driver history** | Same. Drivers see this as an offer, not a ride. |
| `scheduled` | **ACTIVE** (passenger) / **NON-RIDE for driver** | Included in `PASSENGER_ONGOING_BOOKING_STATUSES`; blocks a new booking. Never assigned until dispatch exists. |
| `accepted` | **ACTIVE** | In `ACTIVE_BOOKING_STATUSES` for both. Rare/legacy if present. |
| `driver_en_route` | **ACTIVE** | Assigned, not terminal. |
| `arrived` | **ACTIVE** | Assigned, not terminal. |
| `in_progress` | **ACTIVE** | Trip exists. |
| `completed` | **HISTORICAL_SUCCESS** | Terminal success. `completedAt` set. `paymentStatus` set to `paid`. |
| `cancelled` | **HISTORICAL_CANCELLED** | Terminal. `cancelledAt` / `cancelledBy` / `cancellationReason` set. |
| `no_drivers` | **HISTORICAL_CANCELLED** (failed dispatch) | Terminal for the passenger. Socket event is `booking:expired`. **`cancelledAt` is not set.** Not a user cancel. Product may want a distinct “expired / no driver” label rather than “Cancelled”. |
| `expired` | **Do not use for bookings** | Constant exists; booking rows are not set to `expired`. |
| `quoted` | **NON-RIDE / SHOULD NOT APPEAR** | Not created by confirm. If any leftover rows exist, they are quotes, not rides. |

### 3.3 Edge cases (from code)

**Searching booking cancelled before assignment**  
Passenger may cancel in `searching` or `offered`. Status → `cancelled`, `cancelledBy: 'customer'`. Pending offers → `cancelled`. `assignedDriverId` stays null. **Passenger history: yes. Driver history: no** (never assigned).

**Passenger cancellation after assignment**  
Allowed in `driver_en_route` and `arrived` (`CANCELLABLE_BY_PASSENGER`). Not allowed in `in_progress` (`409 BOOKING_CANCELLATION_NOT_ALLOWED`). Status → `cancelled`, `cancelledBy: 'customer'`. Driver released to `online`. **Both histories: yes** (`assignedDriverId` remains).

**Driver cancellation**  
Allowed only in `driver_en_route` and `arrived`. Status → `cancelled`, `cancelledBy: 'driver'`. **Both histories: yes.**

**Expired dispatch**  
After `DISPATCH_MAX_BATCHES` with no accept: status → `no_drivers`. Passenger gets `booking:expired`. Offers expire independently (`booking_offers.status = expired`). **Passenger history: yes (`no_drivers`). Driver history: no assignment.** Do not look for booking status `expired`.

**Accepted then cancelled**  
Accept stores `driver_en_route` (not `accepted`). Later cancel follows passenger/driver cancel rules above. Ride never started; **no trip row**.

**Completed ride**  
Only via driver `PATCH .../status` `{ "status": "completed" }` from `in_progress`. Sets `completedAt`, `paymentStatus: 'paid'`, trip `status: completed` + `endTime`. **Both histories: yes.**

**In-progress cannot be cancelled** by passenger or driver v1 APIs. History should treat `in_progress` as active until `completed`.

**Scheduled**  
Stays `scheduled` until a future dispatcher exists. It currently occupies the passenger “active” slot and blocks new bookings. History vs active: treat as **active/upcoming**, not previous rides.

---

## 4. Authoritative history source

### 4.1 When a trip row is created

`createTripFromBooking` runs only when the driver transitions the booking to `in_progress` (`booking.service.ts`). Insert:

- `driverId`, `customerId`, `bookingId`, `startTime: now()`, `status: 'in_progress'`, `tripType: 'passenger_ride'`
- Booking `linkedTripId` is set; `startedAt` is set.

Legacy `POST /api/trips` can still create trips **without** a booking.

### 4.2 Does every booking get a trip?

**No.** Trips exist only after `in_progress`. Missing trips for:

- `searching` / `offered` / `scheduled`
- `cancelled` before start
- `no_drivers`
- `completed` is expected to have a trip **if** the ride actually started; a completed booking without `linkedTripId` would be a data anomaly.

### 4.3 Cancelled rides and trips

Cancelled-before-start: **no trip**.  
Cancelled after `in_progress`: **not allowed** by v1 cancel APIs, so booking-flow cancelled trips should not appear.

### 4.4 Where fare / payment / driver / vehicle live

| Data | Table |
|------|--------|
| Fare (estimated/final/discount), pickup/dropoff, timestamps, assignment, cancel, payment method id + payment status | **`bookings`** |
| Driver name/phone | **`drivers`** (via `assigned_driver_id`) |
| Vehicle make/model/color/plate | **`vehicles`** (via `assigned_vehicle_id`); color also denormalized on `drivers.vehicleColor` |
| Service name/code | **`service_categories`** |
| Payment method code/name | **`payment_methods`** |
| Actual GPS distance | **`trips.distance`** — **not written** by the booking complete path |
| Recording | **`video_sessions`** (`booking_id`) |

### 4.5 Recommendation

**Authoritative history query: `bookings`.**

- Passenger: `WHERE customer_id = :id`
- Driver: `WHERE assigned_driver_id = :id` (assigned rides only; do not include declined/expired offers)

Optional `LEFT JOIN trips ON trips.id = bookings.linked_trip_id` (or `trips.booking_id`) for trip id / recording linkage — **not** as a second list.

Do **not** union bookings + trips. That would duplicate completed rides (`bookings.linked_trip_id` + `trips.booking_id`).

---

## 5. Active-first contract

### 5.1 Existing client pattern

Passenger and driver apps are already documented to restore with **a dedicated active endpoint** returning one object or `null`:

- `GET /api/v1/passenger/bookings/active`
- `GET /api/v1/driver/bookings/active`

Passenger list is a **separate** paginated array. Driver has no list.

### 5.2 Option A vs Option B

**Recommend Option A (split: `activeRide` + `history`), implemented as the existing two HTTP resources, not a new combined envelope.**

| | Option A (split endpoints) | Option B (single `rides[]`) |
|--|----------------------------|-----------------------------|
| Matches current restore | Yes | No — would mix restore with paging |
| Active never on page 2 | Natural | Must special-case page 1 |
| Pagination of history | Straightforward | Active item contaminates offsets |
| Driver today | Active exists; add history list | Would invent a new collection shape |

Do **not** return active inside paginated `history`/`rides`. Today `GET /api/v1/passenger/bookings` already mixes them; that is the bug to fix.

**At most one active ride:** enforced in application code for create (`ACTIVE_BOOKING_EXISTS`) and by dispatch busy-state for drivers. **Not enforced by a unique index.** History contract should still assume ≤1 active per user and take `LIMIT 1` newest if duplicates exist.

**History sort:** `created_at DESC, id DESC` (already used for passenger list). Tie-break on `id` for stability. Do not sort only on `completed_at`/`cancelled_at` — `no_drivers` has neither.

**Recommended HTTP (no implementation in this audit):**

Passenger (reuse paths):

1. `GET /api/v1/passenger/bookings/active` — unchanged restore DTO, possibly enriched later.
2. `GET /api/v1/passenger/bookings` — **history only**: exclude `PASSENGER_ONGOING_BOOKING_STATUSES`, same snapshot DTO as detail, `page`/`limit`.

Driver (new collection GET; do not collide with `/:bookingId`):

1. `GET /api/v1/driver/bookings/active` — unchanged.
2. `GET /api/v1/driver/bookings/history` **or** a query on a non-conflicting path such as `GET /api/v1/driver/rides` — because `GET /api/v1/driver/bookings` is not registered today, a list at that exact path is technically free, but `GET /bookings` vs `GET /bookings/:bookingId` is the Express pattern already used on passenger. Prefer `GET /api/v1/driver/bookings` with the same passenger pattern (list registered **before** `/:bookingId`, which is already how passenger is ordered). Filter: `assigned_driver_id = me` AND status **not** in `ACTIVE_BOOKING_STATUSES`.

A combined `{ activeRide, history }` body is optional sugar for the History screen. It is **not** required if apps already call `/active`. Least disruption: **do not replace `/active`**.

---

## 6. Passenger history field availability

Legend: **AVAILABLE** = on `bookings` or already in the snapshot. **AVAILABLE VIA JOIN** = stored, not in current list/snapshot. **NOT CURRENTLY STORED** = no column / always null.

| Field | Status | Notes |
|-------|--------|-------|
| bookingId | AVAILABLE | `bookings.id` |
| booking/reference code | AVAILABLE | `bookings.bookingNumber` |
| status | AVAILABLE | `bookings.status` |
| createdAt | AVAILABLE | In snapshot |
| acceptedAt | AVAILABLE | In snapshot |
| startedAt | AVAILABLE | Column exists; **not in snapshot** |
| completedAt | AVAILABLE | Column exists; **not in snapshot** |
| cancelledAt | AVAILABLE | In snapshot |
| pickup | AVAILABLE | Snapshot object |
| dropoff | AVAILABLE | Snapshot object |
| distance | AVAILABLE | `estimatedDistanceKm` only (snapshot `route.distanceKm`) |
| duration | AVAILABLE | `estimatedDurationMin` only. Actual duration can be **derived** from `startedAt`/`completedAt` when both set; no `actual_duration` column |
| service category | AVAILABLE VIA JOIN | `serviceCategoryId` on row; name/code via `service_categories` (already in snapshot/detail, **not** in raw list) |
| fare | AVAILABLE | `finalFare` → snapshot `fare.amount`; also `estimatedFare` / `discountAmount` |
| currency | AVAILABLE (hardcoded) | Responses use `'BDT'`. **No currency column** |
| payment method | AVAILABLE VIA JOIN | `paymentMethodId` → `payment_methods.code/name`. Not in snapshot |
| payment status | AVAILABLE | `pending` at create; `paid` on complete. Not in snapshot |
| driver.id | AVAILABLE | `assignedDriverId`; snapshot `driver.id` when assigned |
| driver.name | AVAILABLE VIA JOIN | `drivers.name` (in snapshot when assigned) |
| driver.phone | AVAILABLE VIA JOIN | `drivers.phone` (currently returned in passenger snapshot) |
| driver.image/avatar | NOT CURRENTLY STORED | No image column on `drivers` |
| driver.rating | NOT CURRENTLY STORED | Snapshot has no rating field; no ratings table |
| vehicle.make | AVAILABLE VIA JOIN | `vehicles.make` — **not** in passenger snapshot (only `driver.plateNumber`) |
| vehicle.model | AVAILABLE VIA JOIN | `vehicles.model` |
| vehicle.plate | AVAILABLE VIA JOIN | `vehicles.plateNumber` (snapshot puts it under `driver`) |
| vehicle.color | AVAILABLE VIA JOIN | `vehicles.color` and/or `drivers.vehicleColor` |
| cancellation reason | AVAILABLE | `cancellationReason`, `cancelledBy`. **Not in snapshot** (cancel POST returns only id/status/cancelledAt) |

Passenger avatar (`customers.profileImageUrl`) is stored but is not a passenger-history field for the passenger’s own list.

---

## 7. Driver history field availability

| Field | Status | Notes |
|-------|--------|-------|
| bookingId | AVAILABLE | |
| booking/reference | AVAILABLE | `bookingNumber` |
| status | AVAILABLE | |
| date/time | AVAILABLE | `createdAt` / `acceptedAt` / `startedAt` / `completedAt` / `cancelledAt` on booking. **Driver DTO currently omits them** except `recordingConsentedAt` |
| pickup | AVAILABLE | In driver DTO |
| destination | AVAILABLE | In driver DTO |
| distance | AVAILABLE | Estimated on booking / route DTO. Actual `trips.distance` **not populated** on complete |
| duration | AVAILABLE | Estimated; actual derivable from timestamps |
| service category | AVAILABLE VIA JOIN | Already in driver DTO |
| fare | AVAILABLE | `finalFare` in driver DTO |
| driver earnings | NOT STORED | No earnings column or settlement table |
| platform fee / commission | NOT STORED | Confirmed absent in prior platform audit; not in schema |
| payment method | AVAILABLE VIA JOIN | Not in driver DTO |
| payment status | AVAILABLE | Not in driver DTO |
| passenger.id | AVAILABLE | `bookings.customerId` — **not currently returned** |
| passenger.name | AVAILABLE VIA JOIN | Driver DTO `passenger.name` |
| passenger.avatar | AVAILABLE VIA JOIN | `customers.profileImageUrl` — **not selected today** |
| assigned vehicle | AVAILABLE VIA JOIN | Driver DTO already includes vehicle when resolvable |
| cancellation reason | AVAILABLE | `cancellationReason` / `cancelledBy` — **not in driver DTO** |
| recording/video availability | AVAILABLE VIA JOIN | `video_sessions` by `booking_id`. Current driver DTO only loads an **active** session (`findActiveSessionByBooking`), so completed rides look like `video.sessionId: null` |

Passenger phone is stored on `customers` but driver payload **intentionally sets `phone: null`**. Treat as withheld, not missing storage.

---

## 8. Pagination

**Convention across this API:** `page` + `limit` (1-based), `offset = (page - 1) * limit`, metadata:

```json
{ "pagination": { "page": 1, "limit": 20, "total": 45, "totalPages": 3 } }
```

Envelope: `{ success, data, metadata.pagination }` (`src/utils/response.ts`).

| Endpoint | page/limit | Default | Max | Total |
|----------|------------|---------|-----|-------|
| `GET /api/v1/passenger/bookings` | yes | 20 / page 1 | **none** | yes |
| Admin ride videos | yes | 20 | 100 | yes |
| `GET /api/trips/me` | yes (zod) | 20 | none in schema | yes |
| `GET /api/trips/:driverId` | metadata yes | 20 | none | count yes; **offset not applied** |

No cursor pagination in booking APIs.

**Recommend reuse `page`/`limit`.** Suggested defaults for a new/fixed history list: default `20`, max `50` or `100` (match admin ride-video cap). Always return `total` / `totalPages`. Sort `created_at DESC, id DESC`.

Passenger list currently has **no zod query schema** — `Number(req.query.page) || 1` will coerce junk to `1`.

---

## 9. Filters

**Passenger `GET /bookings`:** no filters.  
**Driver booking APIs:** no history filters.  
**Legacy `GET /api/trips/me`:** `status` (`in_progress` \| `completed` \| `cancelled`), `startDate`, `endDate`.

### Recommend for v1 Ride History (product/UI fit)

Implement only what a typical history screen needs:

| Filter | Recommend? | Mapping |
|--------------------|----------|
| all (historical) | **Yes** | Exclude ongoing statuses; include `completed`, `cancelled`, `no_drivers` |
| completed | **Yes** | `status = completed` |
| cancelled | **Yes** | `status IN (cancelled, no_drivers)` unless UI splits “Expired” |
| date range | **No for v1** | No evidence of date chips in the requested UX; trips API has it if needed later |
| service category | **No for v1** | Not required by the stated UX |

Do not add `quoted`. Do not include `searching` in “all history” if it is still active; if a searching row somehow is not the current active (should not happen), it is still ongoing.

Optional later: separate chip for `no_drivers` labeled “Expired” because the socket already calls it expired.

---

## 10. Detail endpoint

**Passenger tap:** `GET /api/v1/passenger/bookings/:bookingId` exists and is correctly scoped to the owner. **It does not currently contain enough history-detail fields** (see §6): missing vehicle make/model/color, payment method/status, `startedAt`/`completedAt`/`arrivedAt`, cancellation reason, recording status.

**Driver tap:** `GET /api/v1/driver/bookings/:bookingId` exists for assigned bookings including completed/cancelled-after-assign. **Gaps:** timestamps, cancellation, passenger id/avatar, payment, historical recording availability (active-session only).

| Need | Passenger detail today | Driver detail today |
|------|------------------------|---------------------|
| Route summary | Partial (`route.distanceKm` / polyline) | Stronger (`resolveBookingRoute`) |
| Timestamps | created/accepted/cancelled only | almost none |
| Fare | yes | yes |
| Driver / passenger | driver id/name/phone/plate | passenger name only |
| Vehicle | plate only, nested under driver | make/model/color/plate |
| Payment | no | no |
| Cancellation | cancelledAt only | no |
| Recording status | no (separate live-video route) | live session only |

`GET /api/v1/passenger/bookings/:bookingId/live-video` lists live segments for the owner; it is not a “recording available” flag for history.

**Verdict:** reuse the same detail URLs, but the DTOs must be extended before History detail screens can render the full card. Do not send the client to `/api/trips/:id` or admin video routes.

---

## 11. Socket / realtime implications

Existing events (do **not** add a history socket):

| Event | To | When |
|-------|----|------|
| `booking:searching` | passenger | Dispatch batch |
| `booking:accepted` | passenger | Driver assigned (`status: driver_en_route` + driver/vehicle) |
| `booking:status` | passenger + assigned driver | Status changes including cancel |
| `booking:expired` | passenger | `no_drivers` |
| `booking:offer` / `offer:cancelled` / `booking:taken` | driver | Dispatch |
| `driver:location` | passenger | During assigned ride |
| recording / video events | both / admin | Consent and segments |

`booking:status` payload: `{ bookingId, status, timestamp, ...extra }`. Cancel extra may include `reason`, `reasonCode`, `cancelledBy`.

### Recommendation

- **While a ride is active:** patch the active card from `booking:accepted` and `booking:status` (`arrived`, `in_progress`). Same as today’s restore model. No history refetch required on every hop.
- **On terminal status** (`completed`, `cancelled`, `no_drivers` via `booking:expired` or `booking:status`): **refetch history page 1** (or prepend the now-terminal item and clear `activeRide`). Do not poll.
- **On History screen open / pull-to-refresh:** `GET .../active` + `GET .../history?page=1`.
- **Socket disconnected:** existing contract already polls `/active` every 10–15s; that is enough for the active card. Do not poll history.

No new socket namespace.

---

## 12. Performance / indexes

From `0011_passenger_booking_system.sql` / `bookings` schema:

| Index | Columns |
|-------|---------|
| `idx_bookings_customer_status` | `(customer_id, status, created_at)` |
| `idx_bookings_driver_status` | `(assigned_driver_id, status)` |
| `idx_bookings_status` | `(status)` |
| `idx_bookings_scheduled` | `(scheduled_pickup_at)` (schema) |
| `idx_bookings_share_token` | `(share_token)` |
| `idx_trips_driver_id` | `(driver_id)` |
| `idx_trips_start_time` | `(start_time DESC)` |
| `idx_trips_booking_id` | `(booking_id)` |
| `idx_video_sessions_booking` | `(booking_id)` |

**Passenger history** (`customer_id` + optional `status` + `ORDER BY created_at DESC`): `idx_bookings_customer_status` is the right shape for filtered queries. Unfiltered “all historical statuses” is a range of statuses; Postgres can still use the leading `customer_id`. Fine for thousands of rows per customer. Global millions of bookings do not hurt if each customer’s slice is small.

**Driver history** (`assigned_driver_id` + status list + `ORDER BY created_at DESC`): `idx_bookings_driver_status` **does not include `created_at`**. Adequate for thousands of assigned rides per driver; **weak for millions of rows newest-first**. No index on `completed_at`.

**No unique partial index** for one ongoing booking per customer or per driver.

**Do not add a migration in this audit.** If history ships, the first index to consider later is `(assigned_driver_id, created_at DESC)` or `(assigned_driver_id, status, created_at DESC)`.

Joining driver/vehicle/category/payment on a page of 20 is cheap. Avoid per-row Google route generation on history list (`driverBooking.service` currently may call Maps for assigned detail). History list should use stored `estimated_*` / `routeEncodedPolyline` only.

---

## 13. Security

**Passenger**

- List and active use JWT `userId` as `customerId`. No customer id parameter.
- Detail compares `detail.booking.customerId !== user.userId` → 403.
- Share/live-video: 404 if not owner (hides existence).

**Driver**

- v1 booking routes resolve the driver from JWT `auth0Id`. No driver id in the path for active/list (list does not exist yet).
- Detail: must be assignee or hold a live pending offer; else 404 `BOOKING_NOT_ASSIGNED`.
- `GET /api/trips/:driverId` checks `driver.auth0Id === user.auth0Id` or admin; others get 404.

**Gaps to keep when adding history**

- Driver history **must** filter `assigned_driver_id = authenticated driver`. Never accept a `driverId` / `customerId` query param for “view as”.
- Do not return other customers’ bookings because a booking UUID was guessed (passenger already 403s; keep that).
- Offer-access on `GET /:bookingId` should **not** be used as the history collection (would leak unassigned searching bookings the driver was merely offered). History list = assigned only.
- Passenger snapshot currently includes **driver phone**. Confirm product still wants that on historical cards.

---

## 14. Test coverage

### Existing (related)

| Test file | What it covers |
|-----------|----------------|
| `tests/active-booking-cancellation.test.ts` | Ongoing status set, snapshot shape, passenger cancel allowed statuses, rate-limit skip for `/bookings/active` |
| `tests/driver-booking-route.test.ts` | Driver detail authorization (no assignment/offer → null); active payload route geometry |
| `tests/accept-cancel-concurrency.test.ts` | Accept vs cancel races |
| `tests/dispatch.contract.test.ts` | Dispatch status constants |
| `tests/booking-route.contract.test.ts` | Route DTO |
| `tests/rate-limit-config.test.ts` | Skips global limiter for passenger `/bookings` and both `/bookings/active` |
| `tests/validators.passenger.test.ts` | Passenger validators (not list query) |

Scripts (not CI unit tests): `verify-active-booking.ts`, `verify-accept-cancel-live.ts`, etc.

### Missing tests required before implementation

- Passenger list: owner-only, pagination metadata, default sort `created_at DESC`.
- Passenger list **excludes** ongoing statuses once history semantics are defined.
- Passenger list does not return another customer’s rows (parameter injection).
- Active ride is **not** duplicated when composing active + history.
- Status classification: `completed` vs `cancelled` vs `no_drivers`.
- Driver history list: assigned only; declined-offer bookings absent; other driver’s assigned ride absent.
- Driver/passenger detail on completed and cancelled bookings returns required timestamps/fare/cancel fields (once DTO is extended).
- Pagination: max limit clamp; invalid page.
- Filter `completed` / `cancelled`.
- Authorization 403/404 matrix for detail.
- One-active invariant: history never contains two actives; create still blocked.

---

## 15. Recommended API contract (design only)

Envelope remains `{ success, data, metadata? }`.

### Passenger

```
GET /api/v1/passenger/bookings/active
Authorization: customer
→ data: PassengerRideSnapshot | null
```

```
GET /api/v1/passenger/bookings?page=1&limit=20&filter=all|completed|cancelled
Authorization: customer
→ data: PassengerRideSnapshot[]
→ metadata.pagination: { page, limit, total, totalPages }
```

Rules:

- History query **excludes** `PASSENGER_ONGOING_BOOKING_STATUSES`.
- `filter=completed` → `completed` only.
- `filter=cancelled` → `cancelled` + `no_drivers` (document the label).
- Same snapshot as detail; extend snapshot before app work (see gaps).
- Sort: `created_at DESC, id DESC`.

```
GET /api/v1/passenger/bookings/:bookingId
```

Unchanged path; extend snapshot.

### Driver

```
GET /api/v1/driver/bookings/active
→ data: DriverRideSnapshot | null
```

```
GET /api/v1/driver/bookings?page=1&limit=20&filter=all|completed|cancelled
```

Register this **GET collection before** `/:bookingId` (same as passenger).  
`WHERE assigned_driver_id = :driverId AND status NOT IN (accepted, driver_en_route, arrived, in_progress)`.

```
GET /api/v1/driver/bookings/:bookingId
```

Keep for taps; restrict history navigation to assigned rides; extend DTO.

### Shared snapshot additions (minimum for History UI)

Passenger + driver list/detail should add, from existing columns/joins:

- `startedAt`, `completedAt`, `arrivedAt`, `cancelledAt`, `cancelledBy`, `cancellationReason`
- `payment: { methodCode, methodName, status }`
- `vehicle: { make, model, color, plateNumber }` (passenger currently only has plate)
- `recording: { available: boolean }` from `video_sessions` existence / terminal status — **join only, no new recording system**

Do **not** add earnings, commission, ratings, or driver avatars until stored.

Do **not** use `/api/trips/*` for this UX.

---

## Gaps (implementation backlog, not done in this audit)

1. No `GET .../history` path; passenger list is not a history DTO and includes active rides.
2. No driver booking history list; legacy trips API is the wrong grain.
3. Snapshot/detail missing timestamps, payment, vehicle, cancel reason, historical recording flag.
4. `no_drivers` vs `cancelled` vs unused `expired` needs a single UI mapping.
5. `GET /bookings` has no query validation or max page size.
6. Driver `GET /:bookingId` still allows pending-offer access — must not become the history query.
7. No unique index for one active booking; `findActiveBookingByDriver` has no `ORDER BY`.
8. Driver history index missing `created_at`.
9. Docs (`PASSENGER_APP_API.md`, `All_APIs_endpoint.md`) disagree with implemented active/detail shapes.
10. No tests for list pagination, history exclusion, or driver history authorization.
11. Earnings/commission/ratings/driver photos are not in the data model.
12. Actual trip distance is not written on complete.

---

## Final status

**AUDIT COMPLETE — BACKEND HISTORY GAPS:** passenger has list+active+detail but the list is a raw unfiltered dump that duplicates the active ride; driver has active+detail but no history list; `trips` must not be the ride source; current DTOs omit several History UI fields that are already stored on `bookings` and related tables.
