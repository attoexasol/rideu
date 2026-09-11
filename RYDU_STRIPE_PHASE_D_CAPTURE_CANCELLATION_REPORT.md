# RYDU Stripe Phase D — Capture and Cancellation Report

**Workspace:** `backend_rydu`  
**Date:** 2026-09-02  
**Scope:** Capture the already-authorized **platform** PaymentIntent when a ride completes, and cancel/release that authorization when the **booking** is terminally cancelled. No Connect transfer, commission, application fee, cancellation fee, or refund-after-capture.

**Phase C preserved:** Card booking stays `quoted` until PaymentIntent is authorized (`requires_capture`), then `quoted` → `searching` and existing dispatch runs.

---

## Files changed

### New

| File | Purpose |
|------|---------|
| `src/services/stripeCapture.service.ts` | `captureAuthorizedBookingPayment`, `releaseCardPaymentAuthorization`, `markBookingPaidIfCaptured` |
| `tests/stripe-phase-d.test.ts` | Capture/cancel/webhook/idempotency tests A–M |
| `RYDU_STRIPE_PHASE_D_CAPTURE_CANCELLATION_REPORT.md` | This report |

### Modified

| File | Change |
|------|--------|
| `src/constants/payment.ts` | `FinancialIdempotencyKey.paymentCancel` → `booking:{id}:payment-cancel` |
| `src/services/stripePaymentIntent.service.ts` | Ledger transitions allow `authorized` → `captured` / `cancelled` / `capture_pending`; persist `capturedAt`; export `persistLedgerFromIntent` |
| `src/services/payment.service.ts` | Re-export capture/release. No-arg `capturePayment()` still 501 (use named functions) |
| `src/services/booking.service.ts` | Complete: cash still sets `payment_status=paid`; card captures after ride is persisted. Cancel paths release authorization |
| `src/services/dispatch.service.ts` | Release authorization when booking becomes `no_drivers` only (not on offer expiry) |
| `src/services/stripeWebhook.service.ts` | Activate dispatch only on `authorized`; mark `paid` on `captured` |
| `src/controllers/driverBooking.controller.ts` | Map `PaymentError` (e.g. `STRIPE_CAPTURE_FAILED` 502) |
| `src/controllers/passengerBooking.controller.ts` | Activate dispatch only while `authorized`; map cancel `PaymentError` |
| `tests/stripe-phase-a.test.ts` | Assert `paymentCancel` idempotency key |
| `tests/stripe-phase-c.test.ts` | Authorization source still must not call capture |
| `tests/stripe-webhook.test.ts` | Mock capture service so Phase A webhook tests stay isolated |

### Not modified (frozen)

`fare.service.ts`, quote, Redis eligibility, Driver Connect onboarding, settlement/commission, `booking_settlements` usage, Passenger/Driver app code.

---

## Migration status

**No migration.** Phase A `booking_payments` already has `capture_pending`, `captured`, `cancelled`, `captured_at`, `failure_code`, `failure_message`.

`booking_settlements` is not written in Phase D.

---

## Completion integration point

**Existing path only:** `PATCH /api/v1/driver/bookings/{bookingId}/status` with `status=completed`  
→ `updateBookingStatusByDriver` in `src/services/booking.service.ts`.

There is no parallel completion flow.

Sequence for **card**:

1. Validate `in_progress` → `completed` (or idempotent retry if already `completed`).
2. Persist ride completion (`status=completed`, `completedAt`). **Do not** set `bookings.payment_status = paid` yet.
3. Finalize video, release driver, emit status (existing).
4. `captureAuthorizedBookingPayment(bookingId)` — Stripe network **after** the booking row is committed.

Sequence for **cash** (unchanged):

- Set `payment_status = paid` on the same completion update.
- No Stripe calls.

If the driver repeats `completed` after a capture failure, the handler sees `completed` → `completed`, skips the lifecycle patch, and retries capture only.

---

## Cancellation integration points

Authorization is released **only** when the booking itself is terminal:

| Path | Function | Stripe release? |
|------|----------|-----------------|
| Passenger cancel | `cancelBookingByCustomer` | Yes, after booking is `cancelled` |
| Driver cancel (`driver_en_route` / `arrived`) | `cancelBookingByDriver` | Yes |
| No drivers found | `startDispatch` → `no_drivers` | Yes |
| Offer expired / next driver searched | `processExpiredOffers` / revert to `searching` | **No** — booking remains active |
| Driver declined / offer taken | offer-row only | **No** |

If the booking is already `cancelled`, cancel APIs still call release (idempotent) so a prior Stripe failure can be retried.

Stripe cancel uses idempotency key `booking:{bookingId}:payment-cancel` (not the refund key).

---

## Capture state machine

```
authorized
  → (before Stripe capture) capture_pending
  → Stripe paymentIntents.capture (full amount, key booking:{id}:capture)
  → captured
  → bookings.payment_status = paid
```

Preconditions:

- `booking_payments.payment_method = card`
- `provider_payment_intent_id` present
- Local status `authorized` or `capture_pending`, **or** Stripe already `succeeded`
- PaymentIntent metadata `bookingId` matches when present

Idempotent success if:

- Local status already `captured`
- Stripe PI already `succeeded` (reconcile local `captured` + `paid`, no second capture)

Not capturable (`409 STRIPE_PAYMENT_NOT_CAPTURABLE`):

- No PaymentIntent
- Stripe status is not capturable (`requires_capture` / `amount_capturable > 0`)
- Metadata booking mismatch

Cash / missing ledger: skip Stripe (`skipped: true`).

Capture amount: **full authorized amount**. No partial capture. No `transfer_data` / `application_fee_amount` / `transfers.create`.

---

## Cancellation / release state machine

| Stripe PI status | Action |
|------------------|--------|
| `requires_payment_method` / `requires_confirmation` / `requires_action` / `requires_capture` / `processing` | `paymentIntents.cancel` → ledger `cancelled` |
| already `canceled` | Reconcile ledger `cancelled` (success) |
| already `succeeded` | **Do not cancel. Do not refund.** Return `alreadyCaptured`. Booking cancel still succeeds. Refund is future scope |
| cash / no PI | No Stripe call; card row without PI is marked `cancelled` locally |

`bookings.payment_status` is **not** set to `paid` on release.

---

## Idempotency

| Operation | Mechanism |
|-----------|-----------|
| Capture | Stripe key `booking:{id}:capture` + unique PI + in-process lock + local `captured` short-circuit |
| Duplicate `PATCH completed` | Ride already `completed` → capture-only retry |
| Cancel/release | Stripe key `booking:{id}:payment-cancel` + local `cancelled` short-circuit |
| Duplicate cancel | Already `cancelled` still runs release; Stripe already canceled → success |
| Webhook | Existing `stripe_webhook_events` unique `stripe_event_id` |

---

## Webhook handling

Existing verified/idempotent webhook remains. Phase D additions:

| Event | Ledger | Booking | Dispatch |
|-------|--------|---------|----------|
| `payment_intent.amount_capturable_updated` | `authorized` (Phase C) | unchanged | activate once if `quoted` |
| `payment_intent.succeeded` | `captured` | `payment_status=paid` | **not** activated |
| `payment_intent.canceled` | `cancelled` if not already captured | **ride is not auto-cancelled** | no |
| `payment_intent.payment_failed` | `failed` unless already authorized (Phase C) | unchanged | no |

A Stripe `canceled` event does **not** cancel the booking. If Rydu cancelled first, the webhook only syncs the ledger.

---

## Failure / retry behavior

**Chosen:** ride completion is recorded first. Capture is after commit.

If Stripe/network capture fails:

- Booking stays `completed` (not reverted to `in_progress`)
- Ledger stays **`capture_pending`** with `failure_code` / `failure_message`
- API returns **`502 STRIPE_CAPTURE_FAILED`** (“Ride is completed but card capture could not be confirmed. Retry is safe.”)
- Driver retries the same `PATCH …/status` `completed` → capture-only
- No job queue (none exists)

`bookings.payment_status` remains `pending` until capture (or webhook `succeeded`) succeeds.

If authorization release fails after the booking is already cancelled:

- **`502 STRIPE_PAYMENT_CANCEL_FAILED`**
- Client can retry cancel; release is idempotent
- `no_drivers` logs release failures without blocking dispatch timers (booking is already terminal)

---

## Payment status endpoint

`GET /api/v1/passenger/bookings/{bookingId}/payment` still reconciles from Stripe.

| Ledger | Typical response `status` | `clientSecret` |
|--------|---------------------------|----------------|
| authorized | `authorized` | omitted (Phase C) |
| captured | `captured` | omitted |
| cancelled | `cancelled` | omitted |

Dispatch activation from this endpoint runs only while status is `authorized`, not `captured`.

---

## Error codes

| Code | When |
|------|------|
| `STRIPE_CAPTURE_FAILED` | Capture HTTP/API failure; ride already completed |
| `STRIPE_PAYMENT_NOT_CAPTURABLE` | PI missing, not capturable, or metadata mismatch |
| `STRIPE_PAYMENT_CANCEL_FAILED` | Cancel/release could not be confirmed |

`STRIPE_PAYMENT_ALREADY_CAPTURED` is not thrown: release returns `alreadyCaptured` so booking cancel can still succeed. Refunds remain unimplemented (`refundPayment` → 501).

Logs: `bookingId`, `paymentIntentId`, Stripe status/error type/code. Never secret key, `client_secret`, or card data.

---

## Cash regression

- Instant cash still dispatches immediately.
- Cash completion still sets `payment_status=paid` on the completion update.
- Cash completion/cancel do not create, capture, or cancel a PaymentIntent.
- Duplicate cash `completed` is now idempotent (returns the completed booking) instead of `Cannot transition from completed to completed`.

---

## Test results

`npx tsc --noEmit` — pass.

`tests/stripe-phase-d.test.ts` — 15 passed (A–M plus no-transfer guard).

`tests/stripe-phase-a.test.ts`, `stripe-phase-b.test.ts`, `stripe-phase-c.test.ts`, `stripe-webhook.test.ts` — passed (N, O).

`npm test`: **543 passed**. Three **pre-existing** suites still fail to load (unrelated to Phase D):

- `passenger-ride-push.service.test.ts` / `driver-offer-push.service.test.ts` — duplicate `const mockFindEnabled` across files under ts-jest
- `driver-push-token.service.test.ts` / `legacy-cab-migration.test.ts` — Phase B `stripeAccountId` typing on partial driver fixtures

---

## Sandbox QA checklist

Use **test** keys only (`sk_test_` + `pk_test_` + `whsec_`). Enable `payment_intent.succeeded` and `payment_intent.canceled` on the webhook in addition to Phase C events.

### Happy path

1. Passenger creates a **card** booking.
2. PaymentSheet test card `4242 4242 4242 4242`.
3. Backend authorizes; Stripe Dashboard shows **uncaptured** / `requires_capture`.
4. Driver receives, accepts, Arrived → Start → **Complete**.
5. Backend captures; Dashboard shows **succeeded / captured**.
6. `GET /api/v1/passenger/bookings/{id}/payment` → `status: captured`.
7. Booking `payment_status` → `paid`.
8. No transfer / destination charge on the PaymentIntent.

### Cancellation QA

1. Authorize a card ride.
2. Before completion, passenger (or driver, if `driver_en_route`/`arrived`) **cancels the booking**.
3. Stripe PaymentIntent becomes **canceled**.
4. Passenger charged **0**. Ledger `cancelled`. `payment_status` not `paid`.
5. Driver no longer has that booking as active.

### Capture retry QA

1. Complete a card ride with Stripe briefly unavailable (or force a capture error).
2. Booking remains `completed`; payment `capture_pending`.
3. Retry `PATCH …/status` `completed` → capture succeeds → `paid`.

### Cash QA

Complete a cash ride with or without Stripe keys: no PaymentIntent, `payment_status=paid` as before.

---

## Explicit deferred scope

- Connect **transfer** of driver share
- Commission / `application_fee_amount` / destination charges
- Airport fee allocation
- Cancellation **fee** (passenger pays 0 in Phase D)
- **Refund** after capture (if a captured PI is later cancelled, money stays captured)
- Driver earnings API / Admin payment UI
- Capture/cancel retry **queue**
- Passenger Flutter / Driver app changes

Next recommended phase: settlement rules → platform capture already done → transfer driver share to the connected account.

---

## Final status

**RYDU STRIPE PHASE D COMPLETE — SANDBOX QA REQUIRED**
