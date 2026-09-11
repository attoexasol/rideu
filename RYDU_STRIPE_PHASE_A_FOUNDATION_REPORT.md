# RYDU Stripe Phase A — Foundation Report

**Workspace:** `backend_rydu`  
**Date:** 2026-09-01  
**Scope:** Infrastructure only. No Passenger card UI, no authorize/capture, no Connect onboarding, no transfers, no commission formula, no earnings API, no Admin Stripe screens.

**Charge model correction (documented, not implemented):**  
Passenger payment is authorized **before** a driver is assigned. Phase A prepares **platform PaymentIntent + later connected-account transfer**, not destination charges at booking time.

---

## Packages added

| Package | Version | Role |
|---------|---------|------|
| `stripe` | `^22.6.0` | Official Stripe Node server SDK (Node ≥ 18, matches engines) |

No other dependencies. Secret keys are never returned by APIs.

---

## Files changed

### New

| File | Purpose |
|------|---------|
| `src/config/stripe.ts` | Read-only env accessors; redacted `describeStripeConfig()` |
| `src/constants/payment.ts` | cash/card, ledger statuses, financial idempotency key helpers, webhook path |
| `src/utils/money.ts` | Integer minor-unit conversion (no float math) |
| `src/db/schema/booking_payments.ts` | Payment ledger |
| `src/db/schema/booking_settlements.ts` | Future settlement (splits nullable) |
| `src/db/schema/stripe_webhook_events.ts` | Webhook event idempotency |
| `src/db/migrations/0027_stripe_payment_foundation.sql` | Forward migration |
| `src/db/migrations/0027_stripe_payment_foundation.down.sql` | Reverse: drop new tables; delete inactive `card` catalog row |
| `src/services/payment.errors.ts` | `PaymentError`, `SettlementRulesNotConfiguredError` |
| `src/services/stripe.service.ts` | Lazy singleton Stripe client + webhook signature verify |
| `src/services/payment.service.ts` | Future payment boundary (throws, no fake success) |
| `src/services/settlement.service.ts` | Contract only; throws until rules exist |
| `src/services/stripeWebhook.service.ts` | Verify → claim → dispatch (no money) → mark processed |
| `src/repositories/stripeWebhookEvent.repository.ts` | Idempotent claim / processed / failed |
| `src/repositories/bookingPayment.repository.ts` | Insert/find helpers for later phases |
| `src/controllers/stripeWebhook.controller.ts` | HTTP adapter |
| `src/routes/v1/webhooks/stripe.ts` | `POST /` |
| `tests/stripe-phase-a.test.ts` | Config, money, cash, uniqueness, no commission |
| `tests/stripe-webhook.test.ts` | Signature, duplicate event, unknown event, retry |

### Modified

| File | Change |
|------|---------|
| `package.json` / `package-lock.json` | `stripe` dependency |
| `src/db/schema/index.ts` | Export new tables |
| `src/db/migrations/meta/_journal.json` | `0027_stripe_payment_foundation` |
| `src/index.ts` | Mount webhook **before** `express.json()` |
| `src/middleware/rate-limit-paths.ts` | Skip global limiter for webhook |
| `src/config/env-validator.ts` | Redacted Stripe SET/NOT SET; warn if secret without webhook secret; **does not require Stripe to boot** |
| `.env.example` | Placeholder names only |
| `src/services/booking.service.ts` | Reject `card` with `CARD_PAYMENTS_NOT_ENABLED` (cash path unchanged) |
| `src/controllers/passengerBooking.controller.ts` | Map `PaymentError` status/code |
| `tests/rate-limit-config.test.ts` | Webhook skip-path assertion |

### Not modified (frozen)

`fare.service.ts`, quote response shape, dispatch, Redis eligibility, sockets, DVR/video, FCM, vehicle exchange, `bookings.payment_status` cash complete behavior.

---

## Stripe config structure

Environment names (never commit live values):

- `STRIPE_SECRET_KEY` — backend only, optional
- `STRIPE_WEBHOOK_SECRET` — backend only, optional; required for webhook route to succeed
- `STRIPE_PUBLISHABLE_KEY` — optional, **no mobile config endpoint**

Behavior:

- Cash server boot: Stripe vars may be absent.
- `printEnvironmentInfo()` logs `[SET]` / `[NOT SET]` and `STRIPE_MODE: test|live|unknown|not_configured`. Values are never printed.
- `getStripeClient()` throws `STRIPE_NOT_CONFIGURED` (503) if secret missing.
- Webhook without secret: `STRIPE_WEBHOOK_NOT_CONFIGURED` (503).
- If secret is set and webhook secret is not, startup **warns**; process still starts (cash).

---

## Payment method / type model

Existing `payment_methods` catalog remains the discriminator.

| Code | Active | Visible on `GET /payment-methods` |
|------|--------|--------------------------------------|
| `cash` | true (unchanged) | Yes |
| `card` | **false** (new seed) | No — Passenger UI unchanged |

`confirmBooking` still defaults to cash. If a client sends `card`, it is rejected with `CARD_PAYMENTS_NOT_ENABLED`. Historical cash bookings are not converted.

---

## Payment ledger design

Table `booking_payments`:

- One row per booking (`uq_booking_payments_booking_id`)
- `gross_amount` **bigint** integer minor units (BDT poisha)
- `currency` (expected `BDT`)
- `payment_method` `cash` \| `card`
- `provider` `none` \| `cash` \| `stripe`
- Stripe ids nullable (cash does not use Stripe)
- Unique `provider_payment_intent_id` (PostgreSQL allows multiple NULLs)
- Status is **ledger** status, not `bookings.payment_status`

Ledger statuses:  
`pending`, `requires_payment_method`, `requires_action`, `authorized`, `capture_pending`, `captured`, `failed`, `cancelled`, `refund_pending`, `refunded`

Phase A **does not insert** payment rows on cash create/complete. Cash still sets `bookings.payment_status = paid` on complete with no Stripe.

---

## Settlement schema

Table `booking_settlements`:

- Unique `booking_id`
- `gross_amount` integer minor units
- `driver_amount`, `platform_amount`, `airport_fee` **nullable**
- `provider_transfer_id` nullable
- `calculation_version` nullable
- Statuses: `unresolved`, `pending`, `processing`, `settled`, `failed`, `skipped_cash`

**No percentages.** `calculateSettlement()` throws:

`COMMISSION BUSINESS RULES NOT YET CONFIGURED`

`unresolvedSettlementPlaceholder()` returns null splits only for tests/docs.

---

## Webhook raw-body implementation

`src/index.ts` order:

1. helmet / cors / global rate limiter  
2. `app.use('/api/v1/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookRoutes)`  
3. `express.json()` for all other routes  

Route: **`POST /api/v1/webhooks/stripe`**  
No Auth0. Signature via `Stripe.webhooks.constructEvent` + `STRIPE_WEBHOOK_SECRET`.  
Unsigned / invalid signature → 400. Missing secret → 503.

Global rate-limit skip: `/api/v1/webhooks/stripe`.

---

## Webhook idempotency

`stripe_webhook_events.stripe_event_id` UNIQUE.

Flow:

1. Verify signature  
2. Claim insert `received` (`ON CONFLICT DO NOTHING`)  
3. If already `processed` → 200 `duplicate: true`  
4. If `failed` → reclaim and process (retry)  
5. If `received` in-flight → 503 (Stripe retry)  
6. Dispatch **without financial side effects**  
7. Mark `processed`  
8. On handler error → `failed` + 500  

Payload bodies are **not** stored (card/PII). Only id, type, status, truncated error.

Known families (logged only): `payment_intent.*`, `charge.*`, `transfer.*`, `account.*`, `capability.*`.  
Unknown types: 200 after record.

---

## Payment service boundary (Phase A)

Methods exist and **throw** `PAYMENT_NOT_IMPLEMENTED` (501):

- `preparePayment`
- `authorizePayment`
- `capturePayment`
- `cancelAuthorization`
- `refundPayment`
- `settleCompletedBooking`

No fake success. No Stripe charge/transfer APIs called.

Future transaction pattern (documented in `payment.service.ts`):

```
DB claim/pending → COMMIT
Stripe HTTP
DB persist provider ids → COMMIT
Webhook reconciles
```

Intended Stripe Idempotency-Key values:

- `booking:{bookingId}:payment`
- `booking:{bookingId}:capture`
- `booking:{bookingId}:transfer`
- `booking:{bookingId}:refund:{version}`

Plus DB unique constraints on payment/settlement/webhook rows.

---

## Tests / results

| ID | Case | Result |
|----|------|--------|
| A | Cash quote/history/validators/driver booking DTOs | **PASS** (existing suites) |
| B | Env validation / boot without Stripe keys | **PASS** |
| C | Secrets never logged | **PASS** |
| D | Minor-unit integer amounts | **PASS** |
| E | Webhook missing signature | **PASS** 400 |
| F | Invalid signature | **PASS** 400 |
| G | Valid signed webhook | **PASS** 200 |
| H | Same `stripe_event_id` processed once | **PASS** |
| I | Unknown event acknowledged | **PASS** |
| J | Processing failure 500 + retry | **PASS** |
| K | Unique booking_id / event_id in schema + migration | **PASS** |
| L | No commission calculated | **PASS** |
| M | No driver transfer | **PASS** (501 / unused) |
| N | No card payment in Phase A | **PASS** |

Cash regression suites run: `fare.service`, `ride-history`, `active-booking-cancellation`, `validators.passenger`, `driver-booking-route` — all **passed**.

`npx tsc --noEmit` — **passed**.

---

## Cash regression

Unchanged:

- Quote `finalFare` / `BDT`
- Create booking default `paymentMethodCode=cash`
- Dispatch / accept / status lifecycle
- Complete still sets `bookings.payment_status = paid` without Stripe
- `GET /payment-methods` still returns only **active** methods (cash)

Stripe is not required for cash.

---

## Security findings

- Secrets stay on the server. No publishable-key endpoint.
- Webhook requires signature; unsigned bodies rejected.
- Webhook payloads not persisted.
- Logger logs event **id/type** only.
- `.env.example` has placeholders only.
- **Still true from prior audit:** `RAILWAY_ENV_VARS.md` contains committed non-Stripe secrets; do not add Stripe keys there.

---

## Remaining product blockers (unresolved)

1. Driver vs platform commission formula  
2. Airport fee behavior/ownership  
3. Cancellation fee rules  
4. Driver vs fleet as payout recipient  
5. Stripe Connect account type (Standard / Express / Custom)  
6. Supported Stripe countries / payout regions  
7. Whether **BDT** card processing and settlement is valid for this Stripe platform account  

Do **not** resolve these by assumption.

---

## Exact recommended Phase B

**Driver Stripe Connect onboarding (no passenger charges yet).**

1. Add `drivers` Connect fields (`stripe_account_id`, capability flags).  
2. `POST /api/v1/driver/payouts/onboarding-link` → Stripe Account Link (hosted).  
3. `GET /api/v1/driver/payouts/status` from DB + `account.updated` webhook (already dispatched as a no-op family in Phase A).  
4. Still **no** PaymentIntent, capture, or transfer.  
5. Keep cash booking/dispatch frozen.  
6. Do not expose Connect to Passenger or Admin UI in this repo except new driver endpoints.

Apply migration before Phase B webhooks need persistence:

```
npm run db:migrate
```

(`0027_stripe_payment_foundation`)

---

## Apply locally

After deploy/restart, existing `npm run dev` cash rides continue. Set Stripe test keys only when exercising the webhook. Never put live keys in git.
