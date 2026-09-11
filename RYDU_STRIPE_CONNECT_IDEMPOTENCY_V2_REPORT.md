# RYDU Stripe Connect Idempotency v2 Report

**Date:** 2026-09-09  
**Repository:** `backend_rydu`  
**Platform account:** `acct_1UAA2JQfHXyyPQxt`  
**Real sandbox driver:** `281b0d60-71c9-45e3-abcd-0d7c6a590c37` (`auth0|6a350be063741e31d649fd65`)

---

## Final status

```
RYDU STRIPE CONNECT IDEMPOTENCY V2 COMPLETE — ANDROID DEVICE RETEST REQUIRED
```

---

## Why the bump was required

Stripe caches `accounts.create` responses per idempotency key for 24 hours. The real driver’s original key was created **before** Stripe Connect and Accounts v1 were correctly enabled on the platform. Stripe continued replaying that cached failure:

| Key | Result |
|-----|--------|
| `driver:281b0d60-71c9-45e3-abcd-0d7c6a590c37:stripe-connect-account` (v1, no suffix) | Cached failure replay |
| Fresh diagnostic keys | Success (Accounts v1 verified) |

**Solution:** Bump to a new deterministic version namespace so only drivers **without** a persisted `stripe_account_id` get a fresh Stripe create attempt.

---

## Idempotency keys

| | Value |
|---|-------|
| **Old key** | `driver:{driverId}:stripe-connect-account` |
| **New key** | `driver:{driverId}:stripe-connect-account:v2` |
| **Version constant** | `STRIPE_CONNECT_ACCOUNT_CREATE_IDEMPOTENCY_VERSION = 'v2'` |
| **Centralized builder** | `buildDriverStripeAccountCreateIdempotencyKey(driverId)` in `src/constants/stripeConnect.ts` |

Properties preserved:
- Same driver + same version → same Stripe idempotency key
- Different driver → different key
- No random keys in production paths

---

## Duplicate-account protections

### 1. Persisted account always wins

`getOrCreateDriverStripeAccountId()` checks `driver.stripeAccountId` **before** any Stripe call:

```typescript
if (driver.stripeAccountId) {
  return driver.stripeAccountId;  // skip accounts.create entirely
}
```

If `stripe_account_id` exists in DB:
- `accounts.create` is **NOT** called
- The v2 idempotency key is **NOT** used
- Onboarding continues with the existing connected account (new Account Link only)

### 2. DB claim guard (`claimDriverStripeAccountId`)

```sql
UPDATE drivers SET stripe_account_id = $1
WHERE id = $driverId AND stripe_account_id IS NULL
```

Never overwrites an existing connected-account ID.

### 3. In-process concurrency lock

Per-`driverId` promise lock in `getOrCreateDriverStripeAccountId()` ensures simultaneous requests share one create path.

### 4. Race after Stripe create

If request A creates account X and request B’s claim finds account Y already persisted:
- Logs `stripe.connect.account_id_race`
- Returns persisted account Y as source of truth
- **No orphan cleanup** — current code does not delete Stripe accounts; the extra account remains in Stripe but is not attached to the driver

---

## Real HTTP verification

**Endpoint:** `POST /api/v1/driver/payouts/onboarding-link`  
**Script:** `scripts/verify-stripe-http-onboarding.ts`

| Check | Result |
|-------|--------|
| HTTP status | **200** |
| `success` | **true** |
| `accounts.create` with v2 key | **Executed** |
| Connected account persisted | **Yes** — `acct_1UDXYoHoSi3e1NGe` |
| Diagnostic probe account attached | **No** — `acct_1UDXRgH8WFB7v4Sp` not in DB |

**Status after creation:** `GET /api/v1/driver/payouts/status` → HTTP 200, status **`restricted`** (no longer `not_connected`; reflects fresh Express account pre-onboarding)

**Repeat onboarding:** `POST /api/v1/driver/payouts/onboarding-link` again → HTTP 200, `success=true`, new Account Link generated, **`stripeAccountId` unchanged** (`acct_1UDXYoHoSi3e1NGe`)

Script: `scripts/verify-stripe-idempotency-v2-result.ts`

---

## Tests

**Build:** `npm run build` — pass

**Focused suites (43 tests):**

```
npm test -- --testPathPattern="stripe-phase-b|stripe-connect-idempotency|stripe-connect-debug|stripe-runtime-verify"
```

| Test | Coverage |
|------|----------|
| A | Driver without Stripe account → uses `:v2` creation key |
| B | Repeated request → same connected account |
| C | Existing `stripeAccountId` → `accounts.create` NOT called |
| D | Concurrent onboarding → one persisted account |
| E | Race claim → persisted account wins |
| F | Status works after account creation |
| G | Phase B tests + alias consistency |

All **43 passed**.

New file: `tests/stripe-connect-idempotency-v2.test.ts`

---

## Diagnostic scripts

Scripts with **fixed keys** (may replay cached Stripe responses) are documented:

| Script | Key pattern | Note |
|--------|-------------|------|
| `scripts/debug-stripe-connect-create.ts` | `debug:{driverId}:stripe-connect-account` | Fixed; may replay cache |
| `scripts/verify-stripe-runtime.ts` | `verify:{driverId}:stripe-connect-account` | Fixed; may replay cache |
| `scripts/verify-stripe-accounts-v1-fresh.ts` | `verify:accounts-v1:{uuid}` | **Fresh keys only** — explicit account-creation probe |
| `scripts/verify-stripe-http-onboarding.ts` | Uses production v2 builder | Real service path |
| `scripts/verify-stripe-idempotency-v2-result.ts` | N/A (HTTP + DB check) | Post-v2 verification |

Production paths never use random idempotency keys.

---

## Debug logging cleanup

- `[STRIPE_CONNECT_DEBUG]` console output: **development and test only** (not production)
- Structured `logger.warn` / `logger.info` in `stripeConnect.service.ts` retained for operations
- Never logged: Stripe secret, onboarding URL, bank/identity/tax data

---

## Files changed (idempotency v2 scope)

| File | Change |
|------|--------|
| `src/constants/stripeConnect.ts` | v2 version constant + `buildDriverStripeAccountCreateIdempotencyKey()` |
| `src/constants/payment.ts` | `FinancialIdempotencyKey.connectAccount` → `:v2` |
| `src/services/stripeConnect.service.ts` | Uses centralized v2 builder |
| `src/services/stripeRuntimeVerify.ts` | Default probe uses v2 builder |
| `src/services/stripeConnect.debug.ts` | Console debug gated to dev/test |
| `scripts/verify-stripe-http-onboarding.ts` | v2 builder import |
| `scripts/verify-stripe-idempotency-v2-result.ts` | **New** — post-v2 HTTP/DB verification |
| `tests/stripe-phase-b.test.ts` | v2 key expectations |
| `tests/stripe-connect-idempotency-v2.test.ts` | **New** — focused v2 tests A–G |

Unchanged (safety logic preserved):
- `src/repositories/driverStripe.repository.ts` — `claimDriverStripeAccountId`
- Controller `accounts.create` payload properties
- No Accounts v2 migration
- No Android / Passenger changes

---

## Android device retest checklist

- [ ] Log in as real sandbox driver (`r@gmail.com` / device session)
- [ ] Open Driver payout / Connect onboarding screen
- [ ] Tap “Set up payouts” (or equivalent) → should **not** get HTTP 502 `STRIPE_CONNECT_ACCOUNT_CREATE_FAILED`
- [ ] Expect HTTP 200 with onboarding WebView / browser flow
- [ ] Complete Stripe Express onboarding (test data)
- [ ] Return to app → `GET /api/v1/driver/payouts/status` should progress toward `onboarding_required` → `verification_pending` → `ready`
- [ ] Tap onboarding again → should open **new** link, **same** connected account (no duplicate)
- [ ] Confirm no secrets or full onboarding URLs in device logs

---

## Summary

| Item | Value |
|------|-------|
| Old idempotency key | `driver:{driverId}:stripe-connect-account` |
| New idempotency key | `driver:{driverId}:stripe-connect-account:v2` |
| Real driver connected account | `acct_1UDXYoHoSi3e1NGe` |
| Persisted to DB | **Yes** |
| Status after create | `restricted` (not `not_connected`) |
| Duplicate account risk | Mitigated by DB check + claim + in-process lock |
| Diagnostic account ignored | `acct_1UDXRgH8WFB7v4Sp` |
