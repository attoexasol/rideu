# RYDU Backend — Stripe / Payment / Commission Architecture Audit

**Project:** `drivewize-backend` (workspace `backend_rydu`)  
**Branch:** `main`  
**Audit date:** 2026-09-01  
**Scope:** Audit only. No code, migration, Admin, or mobile changes.  
**Authority:** Current source, schema, migrations, tests, and env templates. Prior docs used only as cross-check.

**Headline:** Stripe is not installed, not configured, and not referenced. The live product is **cash-only**. Fare is quoted and stored at booking create, then treated as the passenger total. Completion marks `payment_status = paid` with **no money movement**. There is **no commission engine, no driver earnings API, and no airport fee**.

---

## 1. Current Stripe / payment code inventory

### 1.1 Stripe SDK / Connect

| Item | Finding | Status |
|------|---------|--------|
| npm package `stripe` | Not in `package.json` or `package-lock.json` | **absent** |
| Stripe client init | No `new Stripe(...)` / `stripe` import | **absent** |
| `STRIPE_SECRET_KEY` | Not in `.env.example`, `src/config/env-validator.ts`, or source | **absent** |
| Publishable key exposure | No backend endpoint returns a Stripe publishable key | **absent** |
| Webhook secret | No `STRIPE_WEBHOOK_SECRET` | **absent** |
| Stripe Connect | No connected accounts, Account Links, Transfers, Application Fees | **absent** |
| Webhook handlers | No `/webhooks` Stripe route | **absent** |

### 1.2 Relevant routes

| Method | Path | File | Role | Status |
|--------|------|------|------|--------|
| GET | `/api/v1/passenger/payment-methods` | `src/routes/v1/passenger/index.ts` → `paymentMethodsHandler` | Lists active `payment_methods` rows | **active** — currently Cash only |
| POST | `/api/v1/passenger/bookings/quote` | same → `quoteHandler` | Fare quote; no payment | **active** |
| POST | `/api/v1/passenger/bookings` | same → `createBookingHandler` | Creates booking with `paymentMethodCode` default `cash` | **active** — no card/PI |
| POST | `/api/v1/passenger/bookings/:bookingId/cancel` | same → `cancelBookingHandler` | Passenger cancel | **active** — no refund |
| PATCH | `/api/v1/driver/bookings/:bookingId/status` | `src/routes/v1/driver/bookings.ts` | Lifecycle including `completed` | **active** — sets `payment_status=paid` |
| POST | `/api/v1/driver/bookings/:bookingId/cancel` | same | Driver cancel | **active** — no fee/refund |
| GET | `/api/v1/driver/bookings` | same | Driver ride history (fare snapshot, no earnings) | **active** |
| GET | `/api/v1/driver/profile` | `src/routes/v1/driver/profile.ts` | Name/email/phone/avatar | **active** — no payouts |
| GET | `/api/trips/me` | `src/routes/trips.ts` | Legacy trip list | **stale vs booking product** — no fare/earnings |
| GET | `/api/reports/driver/:id` | `src/routes/reports.ts` | Admin trip stats | **active admin** — no payments |
| Socket | `booking:cancel` | `src/websocket/handlers/booking.ts` | Passenger cancel via socket | **active** — same service as REST |

**No routes exist for:** payment intents, checkout, cards, wallets, payouts, Stripe onboarding, refunds, settlements.

### 1.3 Controllers / services / helpers

| File | Function | Status |
|------|---------|--------|
| `src/controllers/passengerBooking.controller.ts` | `paymentMethodsHandler`, `quoteHandler`, `createBookingHandler`, `cancelBookingHandler` | **active** |
| `src/controllers/driverBooking.controller.ts` | `updateStatusHandler`, `cancelBookingHandler`, `listBookingsHandler` | **active** |
| `src/services/fare.service.ts` | `quoteAllServiceCategories`, `quoteSingleCategory`, `calculateFareFromRates`, `applyPromotion` | **active** — only fare engine |
| `src/services/booking.service.ts` | `createBookingQuote`, `confirmBooking`, `updateBookingStatusByDriver`, cancel functions | **active** |
| `src/services/dispatch.service.ts` | `startDispatch`, `acceptBookingOffer` | **active** — offer payload includes `finalFare` |
| `src/services/rideHistory.service.ts` | `formatPayment`, fare snapshots | **active** — payment is method+status only |
| `src/services/driverBooking.service.ts` | `fare.amount` / `payment` on driver DTOs | **active** |
| `src/repositories/serviceCategory.repository.ts` | `findPaymentMethodByCode`, `listPaymentMethods`, `findActivePromotion` | **active** |
| `src/repositories/booking.repository.ts` | Joins `payment_methods`; `updateBooking` (no row lock) | **active** |
| `src/utils/booking-idempotency.ts` | `scopeCancelIdempotencyKey` | **active** for passenger cancel only |
| `src/utils/db-transaction.ts` | `withTransactionTimeout` | **active** on accept + passenger cancel; **not** on complete |

### 1.4 Models / tables / migrations

| Entity | File | Status |
|-------|------|--------|
| `payment_methods` | `src/db/schema/payment_methods.ts` | **active** — lookup table |
| `bookings` fare + payment columns | `src/db/schema/bookings.ts` | **active** |
| `promotions` | `src/db/schema/promotions.ts` | **active** (discount only) |
| `service_categories` rate columns | `src/db/schema/service_categories.ts` | **active** fare inputs |
| `booking_idempotency_keys` | `src/db/schema/booking_idempotency.ts` | **active** create/cancel, not payments |
| `booking_events` | `src/db/schema/booking_events.ts` | **active** audit log, not financial ledger |
| `drivers` | `src/db/schema/drivers.ts` | **active** — no Stripe fields |
| `customers` | `src/db/schema/customers.ts` | **active** — no Stripe customer id |
| Migration seed Cash | `src/db/migrations/0011_passenger_booking_system.sql` | **active** |

**Tables that do not exist:** payments, payment_attempts, settlements, stripe_webhook_events, driver_payouts, wallets.

### 1.5 Environment variables (names only)

Stripe-related names: **none**.

Current payment-adjacent env: none. Fare uses hardcoded `BDT`. Maps region default is `BD` (`GOOGLE_MAPS_REGION` in `.env.example`).

`src/config/env-validator.ts` required/optional lists have **no** Stripe keys.

### 1.6 Packages

`package.json` dependencies: Express, Drizzle, Auth0, Redis, Firebase Admin, Google Maps via axios, etc. **No Stripe.**

### 1.7 Tests

| Test | What it covers | Status |
|------|----------------|--------|
| `tests/fare.service.test.ts` | Distance + min fare + promotion → `finalFare`, currency `BDT` | **active** |
| `tests/ride-history.test.ts` | History DTO has `payment` method/status; **explicitly no `earnings` / `commission`** | **active** |
| `tests/active-booking-cancellation.test.ts` | Cancel statuses and snapshot fare currency | **active** |
| `tests/driver-booking-route.test.ts` | Driver detail includes `payment: { methodCode: cash }` | **active** |
| `tests/validators.passenger.test.ts` | Quote coordinate validation | **active** |

**No Stripe / PaymentIntent / refund / payout tests.**

### 1.8 Inventory classification

| Area | Classification |
|------|----------------|
| Cash `payment_methods` + booking `payment_method_id` | **active/current** |
| `bookings.payment_status` `pending` → `paid` on complete | **placeholder** — label only, no capture |
| Quote / fare engine | **active/current** |
| Promotion discount | **active** (optional overlay) |
| Stripe SDK / Connect / webhooks | **unused / not present** |
| Driver earnings / commission | **absent** |
| Airport fee | **absent** |
| Cancellation fee | **absent** |
| Wallet | **absent** |
| `BookingStatus.QUOTED` schema default | **stale** — quote API does not persist a booking |
| `BookingStatus.ACCEPTED` | **partial/stale** — accept writes `driver_en_route` directly |
| Legacy `/api/trips/*` | **stale** for financial product; still used for GPS trips |

---

## 2. Current booking / fare lifecycle

### 2.1 End-to-end path (exact)

```
POST /api/v1/passenger/bookings/quote
  quoteHandler → fare.service (quoteAll or quoteSingle)
       ↓  (stateless; no booking row)
POST /api/v1/passenger/bookings
  createBookingHandler → confirmBooking
       → createBookingQuote (recalculates; does not reuse the prior quote payload)
       → findPaymentMethodByCode (default cash)
       → db.transaction insert bookings + stops + booking_events + optional idempotency
       → startDispatch (instant only)
       ↓
dispatch.service.startDispatch
  searching → offered (batches) → driver offer sockets/FCM
       ↓
POST /api/v1/driver/bookings/:bookingId/accept  (or socket booking:accept)
  acceptBookingOffer (FOR UPDATE transaction)
  writes status = driver_en_route, assignedDriverId, acceptedAt
       ↓
PATCH /api/v1/driver/bookings/:bookingId/status
  body.status ∈ { driver_en_route, arrived, in_progress, completed }
  updateBookingStatusByDriver
    driver_en_route → arrived
    arrived → in_progress  (creates trips row; recording consent gate)
    in_progress → completed  (payment_status=paid; video finalize; driver online)
       ↓  or cancel paths (section 8)
```

Exact files:

- Quote: `src/controllers/passengerBooking.controller.ts` `quoteHandler`
- Create: `src/services/booking.service.ts` `confirmBooking`
- Dispatch: `src/services/dispatch.service.ts` `startDispatch`, `acceptBookingOffer`
- Status: `src/services/booking.service.ts` `updateBookingStatusByDriver`
- Driver route: `src/routes/v1/driver/bookings.ts` `PATCH /:bookingId/status`

### 2.2 Where fare is calculated

`src/services/fare.service.ts`:

```
originalFare = max(minFare, round(baseFare + perKmRate * distanceKm, 2))
finalFare    = max(0, originalFare - promotionDiscount)
currency     = 'BDT'   // hardcoded in code, not a DB column
```

Distance/duration come from `previewRoute` → Google Maps (`src/services/route.service.ts`).

`confirmBooking` **recalculates** at insert time. The passenger quote response is **not** a stored quote id. Fare shown in the app can differ from stored fare if rates, promo, or route change between quote and create.

### 2.3 Stored fare fields (`bookings`)

| Column | Written at create | Recalculated later? |
|--------|-------------------|---------------------|
| `estimated_distance_km` | quote `distanceKm` | **No** |
| `estimated_duration_min` | quote `durationMin` | **No** |
| `estimated_fare` | quote `finalFare` | **No** |
| `original_fare` | quote `originalFare` (pre-discount) | **No** |
| `discount_amount` | quote `discountAmount` | **No** |
| `promotion_id` | quote promotion | **No** |
| `final_fare` | quote `finalFare` | **No** |
| `payment_method_id` | resolved from code | **No** |
| `payment_status` | `'pending'` | **Yes** — set to `'paid'` on complete only |

There is **no `currency` column** on `bookings`. APIs hardcode `'BDT'`.

### 2.4 Immutability

Fare is **immutable after insert**. Completion does not re-price on actual GPS distance. `trips.distance` is unrelated to `bookings.final_fare`.

### 2.5 When the booking becomes financially “final” today

Operationally final at **`completed`**: passenger can no longer cancel once `in_progress`; driver PATCH to `completed` sets `payment_status = 'paid'`.

That `paid` flag is **not** a Stripe settlement. Cash is assumed collected offline.

### 2.6 Earnings on complete

**None.** `updateBookingStatusByDriver` on `completed`:

1. Sets `completedAt`, `paymentStatus = 'paid'`
2. Marks linked `trips` completed
3. `finalizeRideVideoSessionsForBooking`
4. `releaseDriverAvailability` (driver `online`)
5. `updateBooking` (no `FOR UPDATE`)
6. `insertBookingEvent` `status_change`
7. `emitBookingStatus` (`booking:status` to passenger, driver, admin)
8. FCM `notifyPassengerOfRideEvent`

No driver share, platform share, transfer, or ledger insert.

---

## 3. Quote / fare data model

### 3.1 Quote request

`POST /api/v1/passenger/bookings/quote`  
Validator: `bookingQuoteSchema` (`src/validators/index.ts`)

- `pickup` / `dropoff` lat/lng (optional address)
- optional `stops` (max 3)
- optional `serviceCategoryId`

### 3.2 Quote response — all categories (typical Passenger home quote)

`quoteAllServiceCategories` returns:

**`route`** (`toRouteSummary`):

- `distanceMeters`, `distanceKm`, `durationSeconds`, `durationMin`
- `encodedPolyline`, `routeBounds`

**Each quote (`FareQuote`):**

- `serviceCategoryId`, `serviceCode`, `serviceName`, `displayName`, `code`
- `description`, `iconKey`, `capacity`
- `distanceKm`, `durationMin`, `driverEtaMinutes`
- `originalFare`, `discountType`, `discountValue`, `discountAmount`, `finalFare`
- `currency` (`'BDT'`)
- `promotion` `{ id, title, discountType, discountValue }` or `null`

### 3.3 Quote response — single category

When `serviceCategoryId` is sent, `quoteHandler` **omits** `displayName` and `code` from the JSON (those exist on the service object but are not copied into the response array).

### 3.4 Passenger-facing total

**`finalFare`** is the passenger total.

History/active ride APIs expose the same number as `fare.amount` (`src/services/rideHistory.service.ts`, `src/services/driverBooking.service.ts`).

### 3.5 Fields that are **not** present

Confirmed **absent** from quote and booking fare:

- tax / VAT
- surge / multiplier
- airport fee / surcharge
- platform fee / service fee
- tip
- currency as a stored/configurable field (always `BDT` in code)

Promo: **yes**, percent or fixed, from `promotions` via `findActivePromotion`. Seed migration inserts a global `30% OFF` row (`0011_passenger_booking_system.sql`).

Service/category: quoted per `service_categories` row (`ride`, `bike`, `cng`, `moto`, `premium`, `comfort`; `rental` skipped). Rates: `base_fare`, `per_km_rate`, `min_fare`.

---

## 4. Airport fee findings

Searched: `airport fee`, `airport_fee`, airport pickup/dropoff, airport surcharge.

**Result:** No fare logic, column, or quote field.

The only “airport” mention is marketing copy for mini-bus vehicle type (`src/constants/vehicleTypes.ts`).

**AIRPORT FEE OWNERSHIP NOT DEFINED IN CURRENT CODE**

If a future product needs it, it must be a new quote component plus an explicit ownership rule (platform / driver / third party). Do not infer from older business examples.

---

## 5. Current commission findings

Searched: driver earnings, driver share, platform share, commission, take rate, service fee, platform fee, application_fee, settlement, payout.

**NO CURRENT DRIVER/PLATFORM COMMISSION ENGINE FOUND**

- No formula, percentage, or fixed fee in code or env.
- No per-service commission config.
- `payment_status = paid` is not a split.
- Prior project audit (`RYDU_backEnd_Full_project_audit.md`) listed commissions as not implemented; this re-audit confirms that is still true.

Do **not** hardcode driver/platform percentages until a business decision exists.

---

## 6. Current driver earnings APIs

### 6.1 Driver v1 endpoints (current)

Under `/api/v1/driver`:

| Path | Behavior vs earnings |
|------|----------------------|
| `GET /bookings` | Ride history: `fare.amount` + `payment.{methodCode,methodName,status}`. **No earnings, balance, or net.** |
| `GET /bookings/active` | Active ride + quoted `fare.amount` |
| `GET /bookings/:bookingId` | Same fare/payment snapshot |
| `GET /profile` | Identity + vehicle summary. **No Stripe / bank / payoutsEnabled** |
| Duty, video, vehicle-exchanges, push-token | Unrelated |

**No** `GET /earnings`, `/balance`, `/payouts`, `/wallet`, `/stripe`, `/bank`.

### 6.2 Legacy

`GET /api/trips/me` returns GPS `trips` rows (time, distance, status). **No fare.**

Admin `GET /api/reports/driver/:id` is trip counts, not payouts.

### 6.3 iOS Driver Earnings screen

Backend **does not** provide enough data for a real Earnings screen.

Available today: gross `finalFare` on completed assigned bookings, plus a fake `payment.status = paid`.

Missing: driver net, platform fee, period totals, pending vs paid out, payout destination, Stripe onboarding status.

`tests/ride-history.test.ts` asserts driver history **must not** include `earnings` / `commission`.

---

## 7. Passenger payment state

**Passengers currently create bookings without any card payment.**

Flow:

1. `GET /api/v1/passenger/payment-methods` → active rows from `payment_methods`.
2. Seeded method: `code = cash`, `name = Cash` (`0011_passenger_booking_system.sql`).
3. `POST /bookings` `paymentMethodCode` defaults to `'cash'` (`createBookingSchema`).
4. `confirmBooking` stores `paymentMethodId` and `paymentStatus: 'pending'`.
5. Dispatch starts immediately. **No authorization, no PaymentIntent, no checkout.**

There is no passenger Payment Method object in Stripe terms. `payment_methods` is a **platform catalog** (cash vs future codes), not a saved card.

---

## 8. Cancellation / payment findings

### 8.1 Passenger cancel

| Item | Current behavior |
|------|-------------------|
| REST | `POST /api/v1/passenger/bookings/:bookingId/cancel` |
| Socket | `booking:cancel` (customer only) |
| Allowed statuses | `searching`, `offered`, `driver_en_route`, `arrived` (`CANCELLABLE_BY_PASSENGER`) |
| **Not allowed** | `accepted` (unused persist), `in_progress`, `completed`, `scheduled` (not in list), `no_drivers` |
| Concurrency | `withTransactionTimeout` + `SELECT … FOR UPDATE`; already-cancelled is idempotent |
| Idempotency | Optional `Idempotency-Key` scoped as `cancel:{bookingId}:{key}` |
| Fee | **None. CANCELLATION FEE BUSINESS RULES ARE ABSENT.** |
| Fare change | Fare columns unchanged |
| Payment/refund | **None** |
| Reason stored | `cancelled_by = 'customer'`, `cancellation_reason` from `reason` or `reasonCode`; event payload `{ reason, reasonCode }` |
| Side effects | Offers cancelled, driver set online if assigned, dispatch timer cleared, video finalized, sockets |

Passenger **cannot** cancel after the ride starts (`in_progress`). That is the natural capture boundary.

**Gap:** `scheduled` is not in `CANCELLABLE_BY_PASSENGER`. Scheduled bookings have no payment either.

### 8.2 Driver cancel

| Item | Current behavior |
|------|-------------------|
| REST | `POST /api/v1/driver/bookings/:bookingId/cancel` |
| Allowed | `driver_en_route`, `arrived` only |
| Transaction | **No** `FOR UPDATE` / no timeout wrapper (unlike passenger cancel) |
| Idempotency | **None** |
| Fee | **None** |
| Refund | **None** |
| Reason | Optional `reason` → `cancellation_reason`, `cancelled_by = 'driver'` |

### 8.3 System / admin

| Source | Behavior |
|--------|-------------------|
| Dispatch exhaustion | `startDispatch` sets `no_drivers` (not `cancelled`). No `cancelled_by`. No payment action. |
| Admin booking cancel | **No admin cancel booking endpoint** (`src/routes/v1/admin/booking.ts` is categories + video) |
| Socket driver cancel | Not provided (`booking:cancel` is customer-only) |

### 8.4 Payment implication

All current cancels are **operational only**. Future Stripe must add void/refund **without** inventing a cancellation fee unless product defines one.

---

## 9. Completion settlement hook

### 9.1 Exact path

`PATCH /api/v1/driver/bookings/:bookingId/status`  
body: `{ "status": "completed" }`  
`driverBookingStatusSchema` → `updateStatusHandler` → `updateBookingStatusByDriver`.

**Validation:**

- Booking exists
- `assignedDriverId ===` authenticated driver
- Allowed transition map only: `in_progress` → `completed`
- Duplicate `completed` → `Cannot transition from completed to completed` (**400**, not idempotent 200)

**Not done:** row lock, unique settlement insert, Stripe, fare recompute.

**Order of operations (current):**

```
read booking (no lock)
if completed:
  trip update, video finalize, releaseDriverAvailability   // BEFORE status write
updateBooking(status, completedAt, paymentStatus=paid)     // no WHERE status=in_progress
event + sockets + FCM
```

### 9.2 Safest future hook (do not implement now)

**Do not** call Stripe inside the existing `updateBooking` line.

Recommended boundary:

1. **New function** e.g. `settleCompletedBooking(bookingId)` in a new `src/services/settlement.service.ts` (or `payment.service.ts`).
2. **Call site:** `updateBookingStatusByDriver` **after** a **committed**, **conditional** status transition `in_progress → completed` (see §10–13).
3. Skip entirely when payment method is `cash` (preserve current cash lifecycle).
4. Keep video finalize, driver availability, and sockets on the **booking status** path; treat money as a **separate state machine** (`payment_status` / settlement row), so a Stripe outage does not roll back a completed ride.

That split is required because mobile already treats `completed` as the ride-end event.

---

## 10. Idempotency findings

### 10.1 What exists today

| Mechanism | Where | Protects |
|----------|--------|----------|
| `Idempotency-Key` header | `POST /passenger/bookings` | Duplicate **create** (`booking_idempotency_keys` unique `(customer_id, idempotency_key)`) |
| `Idempotency-Key` | Passenger **cancel** | Duplicate cancel; key scoped per booking |
| `FOR UPDATE` + status guards | Accept + passenger cancel | Concurrent assign/cancel |
| Unique `booking_number`, `share_token` | bookings | Identity, not money |
| Unique offer `(booking_id, driver_id)` | `booking_offers` | Offers, not payments |
| Vehicle exchange `Idempotency-Key` | Exchange APIs | Unrelated |

### 10.2 Completion is **not** financially idempotent

- No `Idempotency-Key` on `PATCH .../status`.
- No `WHERE status = 'in_progress'` on the complete update.
- Two concurrent complete requests can both pass the in-memory transition check.
- Side effects (video, availability) run **before** the status write.

Mobile duplicate socket/status events are therefore a **real double-capture risk** once Stripe exists.

### 10.3 Recommended future financial keys (names only)

Use **server-generated** Stripe `Idempotency-Key` values derived from `booking.id`, never client-supplied complete keys:

| Operation | Suggested key |
|----------|----------------|
| PaymentIntent create | `pi_create:{bookingId}` |
| Capture | `pi_capture:{bookingId}` |
| Transfer / destination application fee | `settle:{bookingId}` |
| Refund / void on cancel | `refund:{bookingId}:{cancelEventId}` |
| Webhook processing | Stripe `event.id` unique table |

DB: unique `booking_id` on settlement/payment rows so a second complete cannot insert a second settlement.

---

## 11. Stripe Connect readiness

**Nothing for Connect exists.** Missing:

- create connected account
- Account Link / onboarding URL
- account refresh / return URLs
- `payouts_enabled` / `charges_enabled` / `details_submitted` persistence
- webhooks `account.updated`
- driver “Set up payouts” API

### 11.1 Driver data model (current)

`drivers` (`src/db/schema/drivers.ts` + `0025_driver_profile_account.sql`): identity, duty/status, vehicle/QR, session, `profile_image_url`, `account_status`.

**Absent:** `stripeAccountId`, `stripe_account_id`, `payoutsEnabled`, `chargesEnabled`, `detailsSubmitted`, `stripeOnboardingStatus`.

**Best existing association:** columns on **`drivers`** (1:1 with the person receiving payouts). Do not hang Connect on `vehicles` or `fleets` until product says fleet operators are the payee.

`organizations` / `fleets` / `driver_fleet_memberships` exist for multi-fleet structure but have **no payment fields**. Future fleet-level connected accounts would be a separate decision.

`customers` has no `stripe_customer_id`.

### 11.2 Account type (not chosen here)

Do **not** pick Standard vs Express vs Custom from this codebase. Backend requirements that any hosted-onboarding model must meet:

| Requirement | Why |
|-------------|-----|
| Stripe-hosted onboarding | Driver app should open an Account Link; backend must not collect bank details |
| Platform-controlled commission | Platform must be able to take an `application_fee` (or equivalent) from **`final_fare`** via `calculateSettlement` — formula TBD |
| Driver bank payouts | Connected account must reach `payouts_enabled` before (or as a hold-then-transfer policy) card rides settle to the driver |
| Webhook + refresh | Apps cannot trust client “onboarding done”; `account.updated` is source of truth |
| Cash unchanged | Cash rides must not require Connect |

Country/currency fit (BDT, BD maps defaults) vs Stripe’s supported Connect countries is a **business/legal decision**, not a code fact.

---

## 12. Recommended payment timing

Compared **only** to the current lifecycle.

### A. Charge immediately at booking create

- Dispatch starts in the same `confirmBooking` call; many bookings die as `no_drivers` or passenger cancel during search/en-route/arrived.
- Immediate capture forces a **refund for every failed dispatch and every allowed cancel**.
- Conflicts with cash-first UX unless gated on a new method code.
- **Poor fit** unless product wants prepay and accepts refund volume.

### B. Authorize at booking, capture at completion

- Amount is known at create (`final_fare`, already server-calculated).
- Passenger cancel is allowed until `arrived` inclusive; auth can be **released/voided** with no cancellation-fee product.
- Capture aligns with the first moment the ride is operationally complete and passenger **cannot** cancel.
- Failed auth can block **card** bookings before `startDispatch`, leaving cash path untouched.
- **Best fit** for this architecture.

### C. Create/confirm payment only after completion

- Driver already completed the trip; card decline leaves an uncollectible completed ride.
- Duplicate complete events would retry charges without a prior hold.
- **Worst fit** for driver trust and current complete hook.

**Recommendation: Model B for card/Stripe methods. Cash stays as today (no Stripe).**

Authorize **after** the booking row exists (so `bookingId` is the idempotency key) and **before** `startDispatch` for instant card bookings. If auth fails: do not dispatch; mark payment failed; do not leave a searching booking.

Scheduled card bookings: authorize at create or at dispatch-start — **product decision** (scheduled cancel is currently not even in the passenger cancel list).

---

## 13. Recommended Connect charge model

| Model | Passenger pays Rydu? | Platform commission | Driver payout | Refunds | Admin trace | One ride = one settlement |
|-------|----------------------|---------------------|---------------|---------|-------------|---------------------------|
| Destination charges | Yes (platform PI, `transfer_data.destination`) | `application_fee_amount` | Remainder to connected account | Platform refunds, Stripe reverses transfer per rules | Charge lives on platform | Strong |
| Separate charges and transfers | Yes | Hold then `Transfer` | Separate transfer | More moving parts; refund-after-transfer is harder | Two objects to reconcile | Weaker unless tightly keyed |
| Direct charges | Charge on **driver** account | Application fee to platform | Driver is merchant of record | Worse passenger UX/brand | Split across driver accounts | Weak for “Rydu collected this ride” |

**Recommend destination charges** (platform PaymentIntent + `application_fee_amount` from `calculateSettlement` + destination = driver’s connected account).

Why it matches current requirements:

- Passenger pays **Rydu** (platform is merchant of record).
- Commission is a single fee on the same charge.
- Driver share is the destination remainder (or explicit transfer amount if Stripe API shape requires it).
- One `booking.id` ↔ one PaymentIntent ↔ one settlement row.
- Refunds/voids before capture are natural for cancel-before-complete.
- Admin can list platform charges by `booking_id`.

**Caveat:** If airport fee later belongs to a **third party**, destination charges with a single destination are insufficient; that would push toward **separate charges and transfers** (or multiple transfers). Ownership is **undefined today**, so do not pick the more complex model yet.

Do **not** use direct charges: they invert “passenger pays Rydu” and scatter admin traceability.

---

## 14. Required DB changes (recommendations only — no migrations)

Only what is missing.

### 14.1 `drivers` — Stripe Connect fields

**Why:** “Set up payouts” and settlement need a connected account id and capability flags. Refresh from webhooks, not from the app.

Suggested columns (names illustrative):

- `stripe_account_id` (unique, nullable)
- `stripe_onboarding_status` (e.g. `not_started | pending | complete | restricted`)
- `stripe_payouts_enabled`, `stripe_charges_enabled`, `stripe_details_submitted` (booleans)
- `stripe_account_updated_at`

### 14.2 `customers` — optional `stripe_customer_id`

**Why:** reuse PaymentMethods / off-session capture. Can wait until saved cards exist. Not required for first authorize-on-booking if using one-off PaymentIntents.

### 14.3 `payment_methods` catalog row

**Why:** `confirmBooking` already keys off `paymentMethodCode`. Add an active code such as `card` / `stripe` **without removing `cash`**. Cash must remain default until apps opt in.

### 14.4 `bookings` payment state expansion

**Why:** `pending` | `paid` cannot represent authorized, capture_failed, refunded.

Suggested: keep `payment_status` but document a closed set, e.g. `pending | authorized | paid | failed | refunded | cancelled` — **or** stop overloading it and use a payment row as source of truth.

Optional `currency` column (currently implied BDT) so Stripe amounts are not guessed.

### 14.5 `booking_payments` (one current intent per booking, or 1:N attempts)

**Why:** Stripe PaymentIntent id, amount, capture state, and method must outlive a retry. Do not put PI ids only in `booking_events` JSON.

Suggested fields: `booking_id` (unique for “current” or unique on successful PI), `payment_method_id` (catalog FK), `provider`, `provider_payment_intent_id` (unique), `amount`, `currency`, `status`, `idempotency_key`.

### 14.6 `booking_payment_attempts` (optional if 14.5 is 1:N)

**Why:** declined cards, 3DS, retries. Needed before blaming a single PI column.

### 14.7 `booking_settlements`

**Why:** persist `calculateSettlement` output **before** Stripe calls; unique on `booking_id`.

Conceptual columns: `gross_amount`, `driver_amount`, `platform_amount`, `airport_fee` (nullable until defined), `currency`, `status` (`pending | processing | settled | failed | skipped_cash`), `stripe_transfer_id` / charge ids, `settled_at`.

### 14.8 `stripe_webhook_events`

**Why:** Stripe at-least-once delivery. Unique `event_id`. Store `type`, `processed_at`. Replay = no-op.

### 14.9 What not to add yet

- Wallet tables (no wallet product)
- Cancellation-fee columns (no business rule)
- Airport fee columns (no logic)
- Hardcoded commission percentages

---

## 15. Webhook design

### 15.1 Events for the recommended architecture (B + destination charges)

| Stripe event | Why |
|--------------|-----|
| `payment_intent.succeeded` | Auth/capture confirmation (mode-dependent) |
| `payment_intent.payment_failed` | Decline / auth fail |
| `payment_intent.canceled` | Void after passenger/driver/system cancel |
| `charge.refunded` | Refund after capture |
| `account.updated` | Connect onboarding / `payouts_enabled` |
| `account.application.deauthorized` | Driver disconnected Stripe |
| `capability.updated` | Payout/charge capability changes |

**Do not need yet** (unless implementation uses them): `transfer.created` as a primary control plane (destination charges already move funds); `payout.*` on connected accounts is useful for **Earnings UI later (Phase F)**, not for ride completion.

If separate charges and transfers were chosen later, add `transfer.created`, `transfer.failed`, `transfer.reversed`.

### 15.2 Route / Express raw body

**Current problem:** `src/index.ts` applies global `app.use(express.json())` **before** all routes. Stripe signature verification requires the **raw** body.

`express.raw` is used only for video upload (`src/routes/v1/driver/video.ts`) on `video/mp4`. That pattern does **not** help Stripe (`application/json`).

**Required future design:**

1. Mount `POST /api/v1/webhooks/stripe` **before** `express.json()`, with `express.raw({ type: 'application/json' })`, **or**
2. Use `express.json({ verify: (req, res, buf) => { req.rawBody = buf } })` and verify `Stripe-Signature` against `rawBody`.

Also:

- **No Auth0 JWT** on this route (Stripe cannot send it).
- **Skip global rate limiter** (`src/middleware/rate-limit-paths.ts` does not skip `/webhooks` today).
- Verify with `STRIPE_WEBHOOK_SECRET` (test vs live secrets separated by env).
- Idempotency: insert `event.id` first; duplicate → 200 empty success.
- If webhook arrives **before** API persist of PI id: upsert by `provider_payment_intent_id`, do not fail the webhook with 500 forever; use 200 after storing “unmatched” or retry-safe pending row.

`helmet()` does not block `Stripe-Signature`. CORS is irrelevant for Stripe server callbacks.

---

## 16. Security findings

| Check | Finding |
|-------|---------|
| Stripe secret backend-only | N/A today; **must remain server-only** when added. Never return `STRIPE_SECRET_KEY` to apps. |
| Publishable key | Not exposed today. Publishable key may be given to **Passenger/Driver apps** later; **secret must not**. |
| Mobile apps | This repo is backend-only; no mobile Stripe secret in this tree. |
| Env handling | `dotenv` + `env-validator`. No Stripe vars. Test/live Stripe separation **does not exist**. |
| Webhook verification | **Does not exist** |
| Request logger | Logs method/path/status, not bodies — **good**. `createBookingHandler` logs booking id, not fare cards. |
| `printEnvironmentInfo` | Prints whether keys are `[SET]`, not values — **good**. |
| Committed secrets | `RAILWAY_ENV_VARS.md` contains **live-looking Auth0 Management and Mapbox secrets in git**. Unrelated to Stripe but a **concrete secret-hygiene issue**. Rotate those credentials; do not add Stripe secrets to markdown. |
| Test/live | `NODE_ENV` exists; no `STRIPE_SECRET_KEY_TEST` vs live pattern. |

**Do not log** PaymentIntent client_secrets, webhook payloads with PANs, or `Stripe-Signature` headers.

---

## 17. Failure / recovery strategy

| Case | Recommended behavior (future) |
|------|--------------------------------|
| Card decline / auth failure at booking | Do **not** `startDispatch`. Persist payment `failed`. Return 402/402-equivalent to Passenger. Cash bookings unaffected. |
| Authorization failure (3DS abandoned) | Same; booking should not stay `searching`. |
| Capture failure at complete | Ride **stays `completed`** (ops truth). Settlement `failed` / `processing`. Retry with `pi_capture:{bookingId}`. Driver already released — do not un-complete the ride. |
| Driver not Stripe-onboarded | **Business rule required.** Options: (1) card offers only to `payouts_enabled` drivers; (2) capture to platform and pay out later. Cash: no block. |
| Onboarding incomplete | `GET` payouts status returns `pending`; no Account Link reuse until webhook says otherwise. |
| Duplicate completion | Conditional DB update + unique settlement row; Stripe idempotency key `pi_capture:{bookingId}`. Second PATCH returns existing completed booking (make complete **read-idempotent**). |
| Transfer failure | Destination charge: treat as Stripe-side; settlement `failed`; support retry; do not create a second PI. |
| Refund after transfer | Prefer **void before capture**. After capture: Stripe refund on platform charge (destination reversal rules). Record refund on payment row. |
| Webhook twice | Unique `event_id`; 200. |
| Webhook before API response | Lookup by PI id; if booking payment row missing, store event and reconcile, or 200 + async match. Never 500-loop. |
| Stripe unavailable at auth | Fail booking create for **card** only; passenger can retry or choose cash. |
| Stripe unavailable at capture | Complete ride; queue settlement retry. |
| App closes during payment | Client uses PaymentSheet/PaymentIntent `client_secret`; server state is `authorized` only after PI success webhook or retrieve. Booking create should wait for auth success before dispatch. |
| Ride completes while financial processing pending | Allowed: `bookings.status=completed`, `payment_status=authorized` or `capture_pending`. Earnings UI shows pending. |

---

## 18. Sandbox test matrix

Use **test-mode** keys only. No live credentials in CI or this repo.

| Scenario | How to prove |
|----------|----------------|
| Successful passenger payment | Test card; booking created `authorized`; dispatch starts |
| Declined card | Generic decline test card; no dispatch; no `searching` leak |
| Insufficient funds | `insufficient_funds` test card; same as decline |
| Incomplete authentication (3DS) | Auth required test card; abandon → no dispatch |
| Successful driver onboarding | Account Link test; webhook `account.updated`; flags true |
| Incomplete driver onboarding | Return from Stripe before complete; `payouts_enabled=false` |
| Completed ride settlement | Complete ride; PI captured; settlement row unique; `payment_status=paid` for card meaning real capture |
| Passenger cancellation | Cancel while authorized; PI canceled/voided; no capture |
| Driver cancellation | Same void; driver online |
| Refund | Captured then refund test; payment `refunded` |
| Duplicate completion | Two parallel PATCH completed; one settlement; one capture |
| Duplicate webhook | Replay `event.id`; one DB row |
| Transfer/destination failure | Stripe test / simulated; settlement `failed`; ride still `completed` |
| Cash regression | `paymentMethodCode=cash`; no Stripe calls; complete still sets local `paid` |
| Dispatch / eligibility / video / Redis / exchange | Unchanged on cash path |

---

## 19. Phased implementation plan

Adapt phases to **this** repo. Keep dispatch, eligibility, Android/iOS driver ride loop, Passenger quote, Active Ride, DVR, notifications, Redis presence, and vehicle exchange **frozen** except listed call sites.

### Phase A — Backend Stripe foundation

**Affects:** `package.json` (add `stripe`); `src/config/stripe.ts`; `src/config/env-validator.ts`; `.env.example`; `src/index.ts` (raw webhook mount); new `src/routes/v1/webhooks/stripe.ts`; new `stripe_webhook_events` table; `payment_methods` catalog code for card.

**Depends on:** test-mode secret + webhook secret; business: currency (see blockers).

**Acceptance:** Webhook signature verified in test mode; unknown events 200; cash quote/booking/complete unchanged.

**Frozen:** All booking status transitions, dispatch, video.

### Phase B — Driver Stripe Connect onboarding

**Affects:** `drivers` columns; new `src/services/stripeConnect.service.ts`; new driver routes e.g. `POST /api/v1/driver/payouts/onboarding-link`, `GET /api/v1/driver/payouts/status`; `account.updated` webhook; `profile` **read-only additive** fields only if needed.

**Depends on:** Phase A; Connect platform enabled in Stripe test.

**Acceptance:** Driver can obtain hosted onboarding URL; webhook updates flags; no bank data stored locally.

**Frozen:** Booking create, fare, complete.

### Phase C — Passenger payment authorization

**Affects:** `confirmBooking` (card branch only); `passengerBooking.controller`; new payment tables; optional `GET` PaymentIntent client_secret endpoint; Passenger **later** (out of scope here).

**Depends on:** Phase A; `final_fare` as authorize amount; method code ≠ cash.

**Acceptance:** Card booking does not dispatch until PI authorized; cash path identical to today; Idempotency-Key still prevents double booking.

**Frozen:** Fare formula, quote contract field names (`finalFare` remains total).

### Phase D — Completion capture + settlement

**Affects:** `updateBookingStatusByDriver` complete branch; new `settlement.service.ts` `calculateSettlement` + `settleCompletedBooking`; unique settlement row; Stripe capture idempotency.

**Depends on:** C; commission **formula still placeholder** (amounts may be 100% platform or 100% driver until decided — must not ship live split without a decision).

**Acceptance:** Duplicate complete → one capture; cash skips Stripe; ride `completed` even if capture retries.

**Frozen:** Transition map, video finalize, `releaseDriverAvailability`, socket event names.

### Phase E — Cancellation / refund

**Affects:** `cancelBookingByCustomer`, `cancelBookingByDriver`, dispatch `no_drivers` (void auth if any).

**Depends on:** C.

**Acceptance:** Authorized card + cancel → void; no cancellation fee unless product adds one; passenger cancel idempotency preserved.

**Frozen:** `CANCELLABLE_BY_PASSENGER` set unless product explicitly changes it.

### Phase F — Driver earnings / payout status

**Affects:** new `GET /api/v1/driver/earnings` (or similar); settlement reads; Connect payouts_enabled for “Set up payouts” UI; **does not** invent weekly totals without stored settlements.

**Depends on:** B + D.

**Acceptance:** iOS Earnings can show per-ride gross + net **from settlement rows**; empty state if none.

**Frozen:** History DTO without earnings remains valid; do not break `tests/ride-history.test.ts` until the new endpoint exists.

### Phase G — Admin payment visibility

**Affects:** new admin read APIs only (`src/routes/v1/admin/...`). No Admin UI in this repo.

**Depends on:** D–E.

**Acceptance:** Admin can see PI id, settlement split, payment status per `booking_id`.

**Frozen:** Existing admin video/fleet routes.

---

## 20. Blockers / business decisions still required

These are **not** inventable from code:

1. **Commission formula** — driver vs platform amounts; per-category or global; promo discount funded by whom.
2. **Airport fee** — whether it exists; amount; **AIRPORT FEE OWNERSHIP NOT DEFINED IN CURRENT CODE**.
3. **Cancellation fee** — **absent**; charging one would change passenger cancel semantics.
4. **Stripe Connect account type** — Standard / Express / Custom; hosted onboarding vs custom forms.
5. **Who is the connected account?** — individual `drivers` vs fleet `organizations` (schema supports fleets but payouts are undefined).
6. **Card vs cash coexistence** — when card is required; whether un-onboarded drivers still receive **card** offers.
7. **Currency / country** — fares are **BDT**; maps defaults **BD**. Stripe Connect + BDT presentment/payout eligibility must be confirmed with Stripe + legal. Sandbox can proceed; **production cannot** without this.
8. **Authorize amount** — always `finalFare` at create, or recapture if product later changes in-ride adjustments (today fare is immutable).
9. **Scheduled rides** — not passenger-cancellable today; when to authorize.
10. **Promo 30% seed** — who absorbs `discount_amount` in settlement.

---

## 21. Safe integration boundaries (do not break)

| System | Boundary |
|--------|----------|
| Dispatch / eligibility | `dispatch.service.ts` / `driverAvailability.service.ts` — card auth **before** `startDispatch`; do not change radius, batches, Redis presence |
| Android / iOS Driver | Keep `PATCH .../status` statuses and payloads; additive payment fields only |
| Passenger quote | Keep `finalFare` as total; do not rename fare fields |
| Active Ride | `GET .../bookings/active` + `booking:status` sockets |
| Recording / DVR | Stay in complete/cancel side effects; not inside Stripe HTTP calls |
| Notifications | Existing FCM/socket events; do not block them on Stripe |
| Vehicle assignment / exchange | No payment coupling |
| Cash | Default `paymentMethodCode=cash` must keep working with **zero** Stripe |

---

## 22. Recommended `calculateSettlement` home

**File (future):** `src/services/settlement.service.ts`

**Signature (conceptual):** `calculateSettlement(booking, fare) → { grossAmount, driverAmount, platformAmount, airportFee, currency }`

- Inputs: stored `final_fare`, `original_fare`, `discount_amount`, payment method, service category — **not** live GPS reprice.
- Percentages: **configuration** (env or `service_categories` later), **not hardcoded** in the first PR.
- `airportFee`: `0` / `null` until ownership exists.
- Called from settlement persist **inside** the DB transaction that claims the booking; Stripe capture **after** commit.

---

## 23. Database transaction safety (future)

**Inside a short DB transaction (pattern already used by accept/cancel):**

- `SELECT bookings … FOR UPDATE`
- Transition `in_progress → completed` **only if still `in_progress`**
- Insert settlement row unique on `booking_id` (`pending`)
- Update `payment_status` to `capture_pending` / keep `authorized`

**Must not sit inside a long DB transaction:**

- Stripe HTTP (PaymentIntent, capture, Account Link)
- Video finalize, FCM, Socket.IO, Redis (already mostly after-commit on accept)

**Persist pending financial state first, then call Stripe, then update from response + webhook.** Stripe is source of truth for money; Postgres is source of truth for ride status.

Current complete path **violates** this (external I/O before status write, no lock). Phase D must fix that **at the booking-status boundary** without changing client-visible success shape more than making duplicate complete return 200.

---

## Audit completeness checklist

| # | Section | Status |
|---|---------|--------|
| 1 | Stripe/payment inventory | Done |
| 2 | Booking/fare lifecycle | Done |
| 3 | Quote/fare data model | Done |
| 4 | Airport fee | Absent; ownership undefined |
| 5 | Commission | No engine |
| 6 | Driver earnings APIs | Insufficient for Earnings UI |
| 7 | Passenger payment | Cash-only, no PI |
| 8 | Cancellation | No fee/refund |
| 9 | Completion settlement hook | Identified |
| 10 | Idempotency | Create/cancel yes; complete no |
| 11 | Connect readiness | Missing |
| 12 | Payment timing | Recommend authorize-at-book, capture-at-complete |
| 13 | Connect charge model | Destination charges |
| 14 | DB changes | Recommended, not applied |
| 15 | Webhooks | Designed; raw-body conflict documented |
| 16 | Security | No Stripe yet; Railway markdown secret hygiene |
| 17 | Failure/recovery | Defined |
| 18 | Sandbox matrix | Defined |
| 19 | Phased plan | A–G adapted to repo |
| 20 | Business blockers | Listed |

**Code, migrations, Admin, and mobile: not modified** (this document only).
