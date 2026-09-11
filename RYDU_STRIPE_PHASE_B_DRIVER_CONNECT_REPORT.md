# RYDU Stripe Phase B — Driver Connect Onboarding Report

**Workspace:** `backend_rydu`  
**Date:** 2026-09-01  
**Scope:** Driver Stripe Connect onboarding and payout-readiness only. No passenger card payment, PaymentIntent, authorization, capture, transfer, commission, airport fee, cancellation fee, earnings API, or Admin UI.

**Phase A preserved:** `booking_payments`, `booking_settlements`, and `stripe_webhook_events` are unchanged. Cash bookings still work when Stripe is not configured.

---

## Files changed

### New

| File | Purpose |
|------|---------|
| `src/constants/stripeConnect.ts` | Product status enum and deterministic mapping |
| `src/repositories/driverStripe.repository.ts` | Claim `stripe_account_id` (insert-if-null) and persist sync |
| `src/services/stripeConnect.service.ts` | Account create, Account Link, `syncDriverStripeAccount`, webhook handler |
| `src/controllers/driverPayout.controller.ts` | Authenticated driver adapters |
| `src/routes/v1/driver/payouts.ts` | `POST /onboarding-link`, `GET /status` |
| `src/db/migrations/0028_driver_stripe_connect.sql` | Nullable Connect columns on `drivers` |
| `src/db/migrations/0028_driver_stripe_connect.down.sql` | Drop Connect columns only; does not delete Stripe accounts |
| `tests/stripe-phase-b.test.ts` | Focused Connect tests A–V (mocked Stripe) |
| `RYDU_STRIPE_PHASE_B_DRIVER_CONNECT_REPORT.md` | This report |

### Modified

| File | Change |
|------|--------|
| `src/db/schema/drivers.ts` | Stripe Connect columns; unique on `stripe_account_id` |
| `src/db/migrations/meta/_journal.json` | `0028_driver_stripe_connect` (idx 27) |
| `src/config/stripe.ts` | Connect country + return/refresh URL accessors (SET/NOT SET only) |
| `src/config/env-validator.ts` | Redacted Connect config logs; warnings if secret set without country/URLs |
| `src/constants/payment.ts` | `FinancialIdempotencyKey.connectAccount` |
| `src/services/stripeWebhook.service.ts` | Dispatch `account.updated` / `capability.updated` to Connect sync |
| `src/services/profile.service.ts` | Explicit: deactivation must not delete Stripe accounts |
| `src/routes/v1/index.ts` | Mount `/driver/payouts` |
| `src/middleware/rate-limit-paths.ts` | Skip global limiter for payouts (dedicated `driverGeneralRateLimit`) |
| `.env.example` | Connect env placeholders |
| `tests/stripe-webhook.test.ts` | Duplicate `account.updated` still processed once |
| `tests/rate-limit-config.test.ts` | Payout skip-path assertion |

### Not modified (frozen)

`fare.service.ts`, quote, dispatch, Redis eligibility, sockets, DVR/video, FCM, vehicle assignment/exchange, `booking_payments`, `booking_settlements`, cash `confirmBooking` / complete behavior.

---

## Migration

**Tag:** `0028_driver_stripe_connect` (after `0027_stripe_payment_foundation`).

Adds nullable columns on `drivers`:

- `stripe_account_id` (unique)
- `stripe_account_country`
- `stripe_account_status`
- `stripe_details_submitted` / `stripe_charges_enabled` / `stripe_payouts_enabled` (boolean, default false)
- `stripe_requirements_currently_due` / `stripe_requirements_eventually_due` (jsonb string arrays)
- `stripe_onboarding_completed_at` / `stripe_last_synced_at`

Existing drivers are preserved. No fake Stripe accounts are backfilled. Bookings and fare are not touched.

Down migration drops the columns and indexes only. It does **not** call Stripe Account delete.

Apply with the repo’s usual `npm run db:migrate` (or equivalent) before sandbox QA.

---

## Connected account configuration

Installed SDK: `stripe@^22.6.0` (API version `2026-08-26.dahlia`).

Accounts **v1** with **controller properties**. `type: "express"` is **not** sent (deprecated on this API). Accounts v2 is not used.

Exact create payload:

```ts
{
  country, // from STRIPE_CONNECT_DEFAULT_COUNTRY only
  business_type: 'individual',
  controller: {
    fees: { payer: 'application' },
    losses: { payments: 'application' },
    requirement_collection: 'stripe',
    stripe_dashboard: { type: 'express' },
  },
  capabilities: {
    transfers: { requested: true },
  },
  metadata: { driverId },
}
```

Meaning:

| Property | Choice | Why |
|----------|--------|-----|
| `requirement_collection: 'stripe'` | Stripe-hosted KYC / identity | Platform does not build KYC UI |
| `stripe_dashboard.type: 'express'` | Limited Stripe-hosted dashboard | Driver can manage payout bank details on Stripe |
| `fees.payer: 'application'` | Platform pays Stripe fees | Future platform PaymentIntent + later transfer |
| `losses.payments: 'application'` | Platform liable for negative balances | Marketplace / provider model |
| `capabilities.transfers` | Requested | Future driver earnings transfers into connected-account balance, then Stripe payout |
| `card_payments` | **Not requested** | Passenger charges stay on the platform; driver is not the merchant of record |

Stripe may still attach additional Express-equivalent capabilities internally. Rydu does not request unrelated capabilities.

Account Links: `type: 'account_onboarding'`. Links are single-use and expire. The onboarding-link endpoint is safely re-callable. The URL is **not** persisted.

---

## Endpoints

Both require authenticated **DRIVER**. The connected account is always resolved from the authenticated driver. Client-supplied `accountId` / `driverId` is ignored.

### `POST /api/v1/driver/payouts/onboarding-link`

1. Resolve current driver  
2. Get or create one Stripe connected account  
3. Create a Stripe Account Link  
4. Return hosted URL + expiration + backend status  

```json
{
  "success": true,
  "data": {
    "url": "https://connect.stripe.com/...",
    "expiresAt": "2023-11-14T22:13:20.000Z",
    "accountId": "acct_...",
    "status": "onboarding_required"
  }
}
```

`status` is the live normalized product status (not always `onboarding_required` if the account is already further along).

### `GET /api/v1/driver/payouts/status`

Retrieves the connected account from Stripe when one exists, syncs, and returns:

```json
{
  "success": true,
  "data": {
    "connected": true,
    "accountId": "acct_...",
    "country": "US",
    "detailsSubmitted": true,
    "chargesEnabled": false,
    "payoutsEnabled": true,
    "status": "ready",
    "requirements": { "currentlyDue": [], "eventuallyDue": [] },
    "lastSyncedAt": "..."
  }
}
```

Stripe returning the driver to `return_url` does **not** mean onboarding is complete. Backend status + webhook remain the source of truth.

---

## Country source / validation

**Not hardcoded.** Fare currency BDT does **not** imply a Bangladesh connected account.

Source (first match):

1. `STRIPE_CONNECT_DEFAULT_COUNTRY`
2. alias `CONNECT_DEFAULT_COUNTRY`

Must be ISO 3166-1 alpha-2 (`^[A-Z]{2}$`). Normalized to uppercase.

Not inferred from: device locale, IP, phone, BDT fare, or address.

| Condition | Error |
|----------|--------|
| Missing / invalid format | `STRIPE_CONNECT_COUNTRY_REQUIRED` (400) |
| Stripe rejects the country | `STRIPE_CONNECT_COUNTRY_UNSUPPORTED` (400) — no silent substitute |
| Stripe secret missing | `STRIPE_NOT_CONFIGURED` (503) |
| Return/refresh URL missing | `STRIPE_CONNECT_RETURN_URL_REQUIRED` / `STRIPE_CONNECT_REFRESH_URL_REQUIRED` (503) |

Return/refresh URLs are env-only (`STRIPE_CONNECT_RETURN_URL`, `STRIPE_CONNECT_REFRESH_URL`). Controllers do not hardcode localhost or production domains.

---

## Status normalization

Evaluated in this order (account exists unless noted):

| Status | Rule |
|--------|--------|
| `not_connected` | No `stripe_account_id` |
| `restricted` | `requirements.disabled_reason` is set |
| `ready` | `payouts_enabled === true` **and** transfers capability is `active` or omitted (not `inactive` / `pending` / `unrequested`) |
| `onboarding_required` | `details_submitted === false` **or** `currently_due` is non-empty |
| `verification_pending` | Details submitted, no currently-due items, payouts not enabled, not restricted |

`charges_enabled` is persisted for diagnostics and returned on status. It is **not** the ready signal. Future money movement is platform charge + later transfer; driver readiness is transfer/payout capability.

Central function: `syncDriverStripeAccount` (retrieve → normalize → persist). Used after create, on status refresh, and from webhooks.

---

## `account.updated` handling

Phase A still verifies the signature and claims `stripe_event_id` once.

Phase B dispatcher then:

1. Extracts connected-account id (`acct_...`)  
2. Looks up driver by `stripe_account_id`  
3. If unknown: log and acknowledge — **does not** attach to a random driver  
4. If known: `syncDriverStripeAccount` and mark webhook processed  

`capability.updated` reuses the same sync helper (no duplicated mapping).

No PaymentIntent / Charge / Transfer handling.

---

## Idempotency

1. **Stripe Idempotency-Key:** `driver:{driverId}:stripe-connect-account`  
2. **In-process lock:** concurrent onboarding-link calls share one create promise  
3. **DB claim:** `UPDATE ... WHERE stripe_account_id IS NULL` — never overwrite an existing id  
4. **Webhook:** Phase A unique `stripe_event_id`; duplicate `account.updated` is skipped  

If onboarding is incomplete, the same account is reused. A second connected account is not created.

Account Links expire; requesting a new link is expected and is not treated as account failure.

---

## Ownership / fleet

**This phase:** one Stripe connected account per **authenticated driver** (the payout recipient). No fleet connected accounts.

Schema and ledgers stay on the driver / booking payment tables so a future fleet payout model would not require rewriting `booking_payments` / `booking_settlements`. Fleet attach is out of scope.

---

## Security

- Stripe secret remains backend-only; never returned  
- Connected account id may be returned to the authenticated owner only  
- Bank numbers, KYC documents, tax IDs are not stored or returned  
- Account Link URLs are not logged  
- Secret keys and return/refresh URL **values** are not printed (`[SET]` / `[NOT SET]`)  
- Driver can only query / onboard their own account  
- No client-supplied account id is accepted  
- Logout, session invalidation, and `deactivateDriverAccount` do **not** delete the Stripe account  

**Future offboarding (not Phase B):** when a driver is permanently removed from the platform, define a separate Stripe Account delete/reject/close procedure. Do not couple that to logout or device change.

Existing admin `SELECT * FROM drivers` endpoints will now include Connect columns if they return full rows. Those ids are not secrets; there is still no Admin Stripe UI.

---

## Tests / results

`npx jest tests/stripe-phase-b.test.ts tests/stripe-phase-a.test.ts tests/stripe-webhook.test.ts` — **54 passed**.

Cash / booking regression: `driver-booking-route`, `booking-route.contract`, `active-booking-cancellation`, `rate-limit-config` — **passed**.

| ID | Case | Result |
|----|------|--------|
| A | No account → `not_connected` | pass |
| B | Onboarding creates exactly one connected account (controller + transfers only) | pass |
| C | Duplicate onboarding-link reuses account id | pass |
| D | Parallel race: one Stripe create | pass |
| E | Missing country → `STRIPE_CONNECT_COUNTRY_REQUIRED` | pass |
| F | Stripe country reject → `STRIPE_CONNECT_COUNTRY_UNSUPPORTED` | pass |
| G | Account Link uses env return/refresh URLs | pass |
| H | No secret / link URL in logs; no secret in response | pass |
| I | Incomplete onboarding → `onboarding_required` | pass |
| J | Details submitted, payouts not enabled → `verification_pending` | pass |
| K | `payouts_enabled` + transfers active → `ready` (not via `charges_enabled`) | pass |
| L | `account.updated` persists readiness | pass |
| M | Unknown account acknowledged, not attached | pass |
| N | Duplicate `account.updated` handled once (Phase A idempotency) | pass |
| O | Driver A cannot onboard as driver B | pass |
| P | Deactivation does not delete Stripe account | pass |
| Q | Cash still allowed; card still blocked | pass |
| R | No PaymentIntent created | pass |
| S | No Charge created | pass |
| T | No Transfer created | pass |
| U | No commission calculated | pass |
| V | Boot/validate without Stripe config | pass |

---

## Cash regression

Cash path is unchanged. Stripe remains optional at startup. Payout endpoints return `STRIPE_NOT_CONFIGURED` (503) when the secret is missing. Card bookings still return `CARD_PAYMENTS_NOT_ENABLED`.

---

## Stripe sandbox QA status

**Not executed in this implementation session.** Hosted onboarding was not opened in Stripe test mode; no live `account.updated` webhook from Stripe test was observed against a running server.

### Required sandbox flow (TEST keys only)

1. Set `STRIPE_SECRET_KEY` (`sk_test_...`), `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_DEFAULT_COUNTRY`, `STRIPE_CONNECT_RETURN_URL`, `STRIPE_CONNECT_REFRESH_URL`  
2. Forward `POST /api/v1/webhooks/stripe` to Stripe CLI (`stripe listen --forward-to`)  
3. Authenticate as a driver  
4. `POST /api/v1/driver/payouts/onboarding-link`  
5. Open the returned URL; complete Stripe **test** onboarding  
6. Confirm `account.updated` is recorded and processed  
7. `GET /api/v1/driver/payouts/status` until `status` is `ready` (or `verification_pending` while Stripe reviews)

Do not use live credentials. Driver app UI is not in this repository; Postman/API is sufficient.

### Exact country for sandbox test

**`US`** — set `STRIPE_CONNECT_DEFAULT_COUNTRY=US`.

This is a Stripe-supported Connect test country. **Do not use `BD`** merely because fares are BDT. Bangladesh is not assumed to be a valid connected-account country. Fare currency is unchanged (BDT).

---

## Known restrictions

- One connected account per driver; no fleet payouts  
- No custom KYC; Stripe-hosted onboarding only  
- Platform cannot create a connected account until a country is explicitly configured  
- Stripe Express-equivalent dashboard may still present Stripe-owned flows beyond Rydu’s requested `transfers` capability  
- Account Link expiration is expected; the client must request a new link via refresh  
- Return URL is not completion  
- Driver deactivation does not close the Stripe account (future offboarding)  
- Passenger card payments, capture, transfers, and commission remain unimplemented  
- Existing admin driver list queries that `select()` the full driver row will now include Connect columns  

---

## Recommended next phase

**Phase C — passenger platform PaymentIntent (authorize at booking), still no capture/transfer.**

Prerequisites: Phase B sandbox QA with `payouts_enabled` on a test connected account, webhook `account.updated` verified, and a supported Connect country in env.

Then: authorize-at-booking on the **platform** (booking is created before driver assignment). Capture at complete and driver transfer remain later phases. Do not introduce destination charges at authorize time.

---

**Final status:**

RYDU STRIPE PHASE B CONNECT COMPLETE — SANDBOX QA REQUIRED
