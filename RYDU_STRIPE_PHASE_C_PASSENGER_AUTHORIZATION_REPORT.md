# RYDU Stripe Phase C — Passenger Card Authorization Report

**Workspace:** `backend_rydu`  
**Date:** 2026-09-02  
**Scope:** Passenger card **authorization** at booking time on a **platform** PaymentIntent (`capture_method: manual`). Dispatch starts only after authorization. No capture, transfer, commission, airport fee, cancellation fee, refund, driver earnings, or Admin payment UI.

**Phase A / B preserved:** Ledger tables, webhook signature/idempotency, Driver Connect onboarding. Cash bookings still work when Stripe is not configured.

---

## Files changed

### New

| File | Purpose |
|------|---------|
| `src/services/stripePaymentIntent.service.ts` | Platform PaymentIntent create/reuse, status normalize, ledger persist, webhook PI handler, GET reconcile |
| `src/services/cardBookingActivation.service.ts` | `shouldStartDispatchOnBookingCreate`, idempotent `activateAuthorizedCardBooking` |
| `src/routes/v1/config/index.ts` | `GET /api/v1/config/payments` |
| `tests/stripe-phase-c.test.ts` | Phase C tests A–V (mocked Stripe) |
| `RYDU_STRIPE_PHASE_C_PASSENGER_AUTHORIZATION_REPORT.md` | This report |

### Modified

| File | Change |
|------|--------|
| `src/config/stripe.ts` | Publishable key mode classification; `areStripeCardPaymentsEnabled()` |
| `src/config/env-validator.ts` | Throws `STRIPE_MODE_MISMATCH` when secret and publishable modes differ |
| `src/constants/payment.ts` | `STRIPE_PAYMENTS_CONFIG_PATH` |
| `src/constants/bookingStatus.ts` | `quoted` in ongoing + passenger-cancellable sets |
| `src/repositories/bookingPayment.repository.ts` | `claimPendingCardPayment`, `updateBookingPayment`, find-by-PI |
| `src/services/payment.service.ts` | Card enablement overlay; `prepareCardPaymentForBooking`; capture/refund/settle still throw |
| `src/services/booking.service.ts` | Card create stays `quoted` (or `scheduled`); cash dispatch unchanged; returns `{ booking, payment? }` |
| `src/services/stripeWebhook.service.ts` | PI events → ledger; activate dispatch when authorized |
| `src/controllers/passengerBooking.controller.ts` | Card create wrapper, payment status, payments config, owner-only access |
| `src/routes/v1/passenger/index.ts` | `GET /bookings/:bookingId/payment` before `GET /bookings/:bookingId` |
| `src/routes/v1/index.ts` | Mount `/config` |
| `src/middleware/rate-limit-paths.ts` | Skip global limiter for config + booking payment |
| `tests/stripe-phase-a.test.ts` | Card blocked only when Stripe unset; skip-path assertions |
| `tests/stripe-phase-b.test.ts` | Card gated by Stripe config (Phase C enablement) |
| `tests/stripe-webhook.test.ts` | Mock PI/activation so Phase A webhook tests stay isolated |
| `tests/rate-limit-config.test.ts` | Config/payment skip-path assertions |

### Not modified (frozen)

`fare.service.ts`, quote calculations, dispatch internals, Redis eligibility, sockets, DVR/video, FCM, vehicle exchange, Driver APIs, `bookings.payment_status` cash completion (`paid` on ride complete).

---

## Migrations

**None.** Phase C reuses Phase A tables:

- `booking_payments` unique on `booking_id` and `provider_payment_intent_id`
- Ledger statuses already include `requires_payment_method`, `requires_action`, `authorized`, `failed`, `cancelled`
- `card` catalog row remains `is_active = false` in the database

Card is enabled at **runtime** when Stripe keys are present and test/live modes match. Do not blindly flip `payment_methods.card.is_active`.

Apply existing `0027` + `0028` if this environment has not already.

---

## API contract changes (Passenger only)

Driver APIs are unchanged.

### `GET /api/v1/passenger/payment-methods`

Cash if the catalog row is active. `card` is appended only when Stripe card payments are enabled (secret + publishable + aligned modes). If Stripe is missing or mismatched, `card` is not returned.

### `GET /api/v1/config/payments` (passenger-authenticated)

```json
{
  "success": true,
  "data": {
    "stripeEnabled": true,
    "cardEnabled": true,
    "publishableKey": "pk_test_..."
  }
}
```

- Publishable key is returned only when `cardEnabled` is true.
- Secret key and webhook secret are never returned.
- Mismatched test/live keys → `503 STRIPE_MODE_MISMATCH`.

### `POST /api/v1/passenger/bookings`

Request: existing `createBookingSchema`. `paymentMethodCode` defaults to `cash`. Client `amount` / `finalFare` are **not** in the schema and are ignored.

**Cash (unchanged):** `201` body is the booking object. Instant cash is `searching` and dispatch starts immediately.

**Card:**

```json
{
  "success": true,
  "data": {
    "booking": { "id": "...", "status": "quoted", "paymentStatus": "pending", "...": "..." },
    "payment": {
      "method": "card",
      "paymentIntentId": "pi_...",
      "clientSecret": "pi_..._secret_...",
      "status": "requires_payment_method"
    }
  }
}
```

Instant card bookings are created as `quoted` with `searchStartedAt = null`. They are **not** offered to drivers until authorization.

Scheduled card bookings stay `scheduled` after authorization (no dispatch), same as cash scheduled.

### `GET /api/v1/passenger/bookings/{bookingId}/payment`

Owner only. Other passengers receive `404 NOT_FOUND`.

Normalized body (not the raw Stripe object):

```json
{
  "success": true,
  "data": {
    "paymentMethod": "card",
    "status": "requires_payment_method",
    "paymentIntentId": "pi_...",
    "amount": 12050,
    "currency": "BDT",
    "clientSecret": "pi_..._secret_..."
  }
}
```

`clientSecret` is included only while status is `pending`, `requires_payment_method`, or `requires_action`. After authorization it is omitted.

This endpoint **reconciles** from Stripe (so mobile can succeed if the webhook is delayed) and calls `activateAuthorizedCardBooking` exactly once when authorized. If Stripe create failed after booking insert, this endpoint retries PaymentIntent creation on the same booking.

---

## Card payment enablement

`areStripeCardPaymentsEnabled()` requires:

1. `STRIPE_SECRET_KEY` set
2. `STRIPE_PUBLISHABLE_KEY` set
3. Both test (`sk_test_` + `pk_test_`) or both live (`sk_live_` + `pk_live_`)

`GET /payment-methods` overlays `card` even if the DB row is inactive. Cash remains listed independently of Stripe.

If Stripe is absent: `assertCardPaymentAllowed('card')` → `400 CARD_PAYMENTS_NOT_ENABLED`.  
If modes mismatch: `503 STRIPE_MODE_MISMATCH` (API + `validateEnvironment` at boot). Cash still works if Stripe keys are removed.

---

## PaymentIntent configuration

Created on the **Rydu platform account** only. Not on the driver’s connected account. No destination charges.

```ts
{
  amount,                          // integer minor units from server finalFare
  currency: 'bdt',                 // fare currency, lowercased
  capture_method: 'manual',
  payment_method_types: ['card'],
  metadata: { bookingId, passengerId }
}
```

Stripe Idempotency-Key: `booking:{bookingId}:payment`.

Not sent: `transfer_data`, `on_behalf_of`, `application_fee_amount`, test PaymentMethod IDs.

Successful PaymentSheet confirmation with manual capture yields Stripe status `requires_capture` (amount capturable). Phase C maps that to ledger `authorized`. **No capture call is made.**

---

## Amount / currency handling

- Source of truth: server-recalculated `bookings.final_fare` (fare.service unchanged).
- Converted with `majorToMinorUnits()` in `src/utils/money.ts` (integer poisha; no float Stripe amounts).
- Currency is the quote currency (currently `BDT`).
- Client-supplied amounts are not accepted on booking create.

If Stripe rejects the currency, the API returns `400 STRIPE_CURRENCY_UNSUPPORTED`. Fare currency is **not** changed. Sandbox accounts must support BDT (or the platform account’s enabled currencies).

---

## Client secret handling

- Returned only to the authenticated owning passenger (create response + payment status while confirmation is still required).
- Never logged. Logs include `paymentIntentId`, amount, currency, capture method only.
- Never returned: `STRIPE_SECRET_KEY`, webhook secret, Connect credentials.

---

## Webhook events

Phase A verification + `stripe_event_id` idempotency is unchanged. Signature is still mandatory.

Handled via `handleStripePaymentIntentEvent` (Stripe API `2026-08-26.dahlia`, SDK `stripe@^22.6.0`):

| Event | Ledger | Dispatch |
|-------|--------|----------|
| `payment_intent.requires_action` | `requires_action` | No |
| `payment_intent.amount_capturable_updated` (and/or PI `requires_capture` / `amount_capturable > 0`) | `authorized` | Yes, once |
| `payment_intent.payment_failed` | `failed` | No |
| `payment_intent.canceled` | `cancelled` | No |

Manual-capture success signal: PaymentIntent is **authorized and capturable** (`requires_capture`), **not** `succeeded`. `succeeded` means captured (dashboard or a later phase). Phase C still does not capture and still does not set `bookings.payment_status = paid`.

Duplicate events cannot dispatch twice: webhook claim is unique, and activation is status-guarded (`quoted` → `searching` once).

---

## Dispatch gating

| Path | Booking status at create | Dispatch |
|------|--------------------------|----------|
| Instant cash | `searching` | `startDispatch` immediately |
| Instant card | `quoted` | After authorization only |
| Scheduled cash/card | `scheduled` | None at create / none after card auth |

`activateAuthorizedCardBooking(bookingId)`:

- Requires `booking_payments.payment_method = card` and status `authorized` (or `captured` if already captured outside this phase).
- `SELECT … FOR UPDATE` on the booking.
- Transitions **only** `quoted` → `searching`, sets `searchStartedAt`, writes `card_payment_authorized` event, then calls existing `startDispatch`.
- If already `searching` / later: `alreadyActive`, no second dispatch.
- If still `scheduled`: no dispatch.
- Safe if webhook and GET payment reconcile race.

`startDispatch` already no-ops unless status is `searching` or `offered`, so a `quoted` card booking cannot be offered to drivers.

---

## Booking status while payment is pending

**No new booking status.** Payment state lives on `booking_payments.status`.

Pending instant card bookings reuse existing enum **`quoted`**:

- Included in `PASSENGER_ONGOING_BOOKING_STATUSES` so a second booking is blocked and `GET /bookings/active` can resume PaymentSheet.
- Included in `CANCELLABLE_BY_PASSENGER` so the passenger can abandon an unpaid card booking.
- Not in driver offer / `startDispatch` eligible statuses.

`bookings.payment_status` stays `pending` on authorization. Authorization is not capture. Cash completion still sets `paid` on ride complete.

---

## Abandoned card booking

If the passenger never confirms the PaymentIntent:

- Booking remains `quoted`; not dispatched.
- Ledger stays `pending` / `requires_payment_method` / `requires_action`.
- If Stripe cancels/expires the PaymentIntent, webhook/reconcile sets ledger `cancelled`.
- **No expiry job and no cancellation fee in Phase C.** Future cleanup: cancel uncaptured PaymentIntents and expire stale `quoted` bookings.

---

## Idempotency

- One PaymentIntent per booking: Stripe key `booking:{bookingId}:payment` + unique `booking_payments.booking_id` + unique `provider_payment_intent_id`.
- In-process lock per `bookingId` during create.
- Duplicate create / idempotent POST reuses the existing PI (does not take a new client amount).
- Dispatch activation is status-guarded; duplicate webhook and repeated GET payment cannot start dispatch twice.

---

## Reconciliation

Two channels, one normalizer (`normalizePaymentIntentStatus`):

1. Stripe webhook
2. Authenticated `GET …/payment` retrieves the PaymentIntent and persists the ledger, then may activate dispatch

Mobile must not be trusted as the source of truth. “Payment succeeded” from the SDK is only a hint to poll the backend.

---

## Transaction boundary

Same Phase A pattern:

1. Insert booking (`quoted`) — COMMIT  
2. Claim `booking_payments` pending — COMMIT  
3. Stripe PaymentIntent create/retrieve (no open DB transaction)  
4. Persist PI id + status — COMMIT  
5. After authorized: status-guarded transaction then `startDispatch` outside the Stripe call

---

## Security

- Amount always server-calculated.
- Authenticated passenger only; owner check on payment status.
- Client secret only to the owning passenger, only while confirmation is required.
- No Stripe secret, webhook secret, or raw card data in Rydu APIs or logs.
- Card details stay in Stripe SDK / PaymentSheet.
- Webhook signature still mandatory.
- Stripe IDs (`pi_…`) are stored; mixed test/live keys fail closed.

---

## Tests

`tests/stripe-phase-c.test.ts` plus existing A/B/webhook/rate-limit suites.

| ID | Coverage |
|----|----------|
| A | Cash still allowed; instant cash still dispatches on create |
| B | Card hidden / rejected when Stripe unset |
| C | Card listed when Stripe config valid |
| D | Create schema ignores client amount; fare via `majorToMinorUnits` |
| E | One platform PaymentIntent |
| F | `capture_method = manual` |
| G | No destination / `transfer_data` / `on_behalf_of` |
| H | No transfer |
| I | Commission still throws |
| J | Client secret not logged; owner can read PI id |
| K | Duplicate request reuses same PI |
| L | Card does not dispatch before authorization |
| M | `requires_action` does not dispatch |
| N | `payment_failed` does not dispatch |
| O | `amount_capturable_updated` / `requires_capture` → `authorized` |
| P | Authorized booking dispatches exactly once |
| Q | Duplicate webhook/activation does not dispatch twice |
| R | GET reconcile can authorize if webhook is delayed |
| S | Passenger cannot read another passenger’s payment (`404`) |
| T | `bookings.payment_status` not marked `paid` on authorization |
| U | No capture/transfer in Phase C source; `capturePayment()` still throws |
| V | Stripe key mode mismatch detected (API + env validator) |
| W | `npx tsc --noEmit` passes |
| X | Phase A, Phase B, webhook, and rate-limit tests pass |

---

## Cash regression

- Quote unchanged.
- `POST /bookings` with cash (default) returns the booking object, status `searching`, immediate `startDispatch`.
- Accept / arrived / in_progress / completed unchanged.
- `bookings.payment_status = paid` still only on cash (and later card) **ride completion**, not on card authorization.
- Backend boots and cash works with no Stripe keys.

---

## Sandbox QA steps (Stripe test mode only)

Use `sk_test_` + `pk_test_` + `whsec_` from the same Stripe test account. Dashboard webhook URL: `POST /api/v1/webhooks/stripe`. Enable at least:

- `payment_intent.requires_action`
- `payment_intent.amount_capturable_updated`
- `payment_intent.payment_failed`
- `payment_intent.canceled`

1. `GET /api/v1/config/payments` → `cardEnabled: true`, `publishableKey` starts with `pk_test_`.
2. `GET /api/v1/passenger/payment-methods` includes `cash` and `card`.
3. `POST /api/v1/passenger/bookings` with `paymentMethodCode: "card"`.
4. Response includes `booking.status = quoted`, `booking.paymentStatus = pending`, `payment.clientSecret`, `payment.paymentIntentId`.
5. Confirm with Stripe PaymentSheet / test card `4242424242424242`. For 3DS use `4000002500003155` and confirm `requires_action` does **not** dispatch.
6. Webhook `payment_intent.amount_capturable_updated` arrives (or poll `GET …/payment` if delayed).
7. Ledger status `authorized`; booking becomes `searching`; driver offers start.
8. Stripe Dashboard: PaymentIntent is **uncaptured** (`requires_capture`). Rydu must not have called capture.
9. Failed card (e.g. `4000000000000002`): ledger `failed`, booking still `quoted`, no dispatch. Retry on the **same** PaymentIntent / booking.
10. Repeat the cash path with Stripe keys removed (or left in place): cash create still dispatches immediately.

---

## Exact Passenger app changes required next

1. Load `GET /api/v1/config/payments`. If `cardEnabled`, initialize Stripe SDK with `publishableKey`.
2. Show `card` from `GET /payment-methods` only when present.
3. On card booking create, read `data.booking` **and** `data.payment` (cash responses remain a flat booking object).
4. Present PaymentSheet / PaymentIntent confirmation with `clientSecret`. Handle `requires_action` (3DS) in the SDK. Do not send card numbers to Rydu.
5. After SDK confirmation, poll `GET /api/v1/passenger/bookings/{id}/payment` until `status = authorized` (do not treat SDK success as dispatch-ready).
6. Treat `booking.status = quoted` as payment-pending restore: `GET /bookings/active` plus payment status + `clientSecret` if still required.
7. Do not send amounts to booking create. Do not assume `paymentStatus = paid` after authorization.
8. Cancel unpaid `quoted` bookings with the existing cancel endpoint if the user abandons PaymentSheet.

---

## Recommended next phase

**Phase D — Capture at ride completion** (still no driver transfer until a later settlement phase):

- On ride complete, capture the platform PaymentIntent (idempotent `booking:{bookingId}:capture`).
- Then map `bookings.payment_status` for card only after **capture**.
- Keep commission / `application_fee` / connected-account **transfer** out of capture until business rules exist.
- Add PaymentIntent / authorization expiry cleanup for abandoned `quoted` bookings.
- Optional: cancel the uncaptured PaymentIntent when the passenger cancels before dispatch.

---

## Final status

**RYDU STRIPE PHASE C COMPLETE — READY FOR PASSENGER APP INTEGRATION**
