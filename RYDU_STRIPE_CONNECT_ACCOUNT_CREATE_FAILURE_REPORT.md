# RYDU Stripe Connect Account Create Failure Report

**Date:** 2026-09-09  
**Repository:** `backend_rydu`  
**Device symptom:** `POST /api/v1/driver/payouts/onboarding-link` → HTTP 502, `STRIPE_CONNECT_ACCOUNT_CREATE_FAILED`  
**Prior status:** `GET /api/v1/driver/payouts/status` → HTTP 200, `not_connected` (expected — no account yet)

---

## Final status

```
RYDU STRIPE CONNECT ACCOUNT CREATE BLOCKED — Stripe Connect is not enabled on the platform Stripe account (test mode)
```

No code change can fix this. Enable Connect in the Stripe Dashboard (test mode), then retest from the Driver app.

---

## 1. Exact Stripe error returned

Reproduced locally with the same `accounts.create` payload the backend sends, using the configured `sk_test_...` key:

| Field | Value |
|-------|-------|
| **operation** | `accounts.create` |
| **stripeErrorType** | `StripeInvalidRequestError` |
| **stripeErrorCode** | *(null — no Stripe error code)* |
| **stripeErrorParam** | *(null — no rejected parameter)* |
| **stripeErrorMessage** | `You can only create new accounts if you've signed up for Connect, which you can do at https://dashboard.stripe.com/connect.` |
| **stripeHttpStatus** | `400` |
| **requestId** | `req_rTGhn9Z5q9LEQ4` |

This error occurs **before** Stripe validates individual controller fields or country support. The platform account has not enrolled in Connect.

---

## 2. Root cause

| Question | Answer |
|----------|--------|
| **Code bug?** | **No** — payload matches Phase B spec; SDK call is correct |
| **Wrong country?** | **No** — `STRIPE_CONNECT_DEFAULT_COUNTRY=US` is set and sent correctly |
| **Wrong API parameters?** | **Not evidenced** — Stripe never reached parameter validation |
| **Actual blocker** | **Stripe Dashboard** — Connect not signed up on the platform account tied to `sk_test_...` |

The Android client is working correctly. The backend reaches `stripe.accounts.create(...)` and Stripe rejects the request because the **platform** has not enabled Connect.

---

## 3. Environment verified (no secrets logged)

Values read from the running backend `.env`:

| Variable | Status |
|----------|--------|
| `STRIPE_SECRET_KEY` | present, prefix `sk_test_` → **test mode** |
| `STRIPE_PUBLISHABLE_KEY` | present, prefix `pk_test_` (irrelevant to `accounts.create`) |
| `STRIPE_WEBHOOK_SECRET` | present |
| `STRIPE_CONNECT_DEFAULT_COUNTRY` | `US` |
| `STRIPE_CONNECT_RETURN_URL` | `http://localhost:3000/stripe/connect/return` |
| `STRIPE_CONNECT_REFRESH_URL` | `http://localhost:3000/stripe/connect/refresh` |

Debug log lines now emitted on failure:

```
[STRIPE_CONNECT_DEBUG] stripeSecretPresent=true
[STRIPE_CONNECT_DEBUG] stripeSecretMode=test
[STRIPE_CONNECT_DEBUG] configuredCountry=US
```

**Note:** Return/refresh URLs are only used for Account Links (step 2). They are **not** involved in this failure, which happens at account creation (step 1).

---

## 4. Current implementation inspected

**File:** `src/services/stripeConnect.service.ts` → `createConnectedAccountForDriver()`  
**SDK:** `stripe@^22.6.0` (default API version `2026-08-26.dahlia`)  
**Account model:** Accounts v1 with **controller properties** (no legacy `type: "express"`)

### Exact `accounts.create` parameters (unchanged)

```typescript
{
  country: 'US',                    // from STRIPE_CONNECT_DEFAULT_COUNTRY
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
  metadata: {
    driverId: '<authenticated-driver-uuid>',
  },
}
```

Idempotency key: `driver:{driverId}:stripe-connect-account`

**No parameter changes were made** — the Stripe error does not implicate any field.

---

## 5. Controller / capability validation

Because Stripe returned a Connect-enrollment error with **no `param`**, none of these were rejected:

- `controller.fees.payer`
- `controller.losses.payments`
- `controller.requirement_collection`
- `controller.stripe_dashboard.type`
- `capabilities.transfers.requested`
- `business_type`
- `country`

Do **not** downgrade to legacy `type: "express"` — there is no evidence the controller-property model is unsupported.

---

## 6. Required Stripe Dashboard action

1. Log in to [Stripe Dashboard](https://dashboard.stripe.com) using the **same account** that owns the `sk_test_...` key.
2. Ensure **Test mode** is toggled on (top-right).
3. Go to **Connect** → [https://dashboard.stripe.com/test/connect](https://dashboard.stripe.com/test/connect)
4. Complete **Connect signup / onboarding** for the platform.
5. Confirm Connect shows as active for the test account.
6. Optionally verify in Dashboard → **Connect → Accounts** that you can see the Connect section without enrollment prompts.

After Connect is enabled, re-run:

```bash
npx tsx scripts/debug-stripe-connect-create.ts
```

Expected: `[STRIPE_CONNECT_DEBUG] success accountId=acct_...`

---

## 7. Code changes made

No account-creation logic or limits were changed. Added **safe debug logging only**:

| File | Change |
|------|--------|
| `src/services/stripeConnect.debug.ts` | **NEW** — `[STRIPE_CONNECT_DEBUG]` helpers, Connect-not-enabled detection |
| `src/services/stripeConnect.service.ts` | Call debug logger in `mapStripeAccountCreateError`; pass `driverId` + `country` |
| `scripts/debug-stripe-connect-create.ts` | **NEW** — one-off CLI to reproduce `accounts.create` safely |
| `tests/stripe-connect-debug.test.ts` | **NEW** — debug helper tests |
| `tests/stripe-phase-b.test.ts` | Regression test for Connect-not-enabled → `STRIPE_CONNECT_ACCOUNT_CREATE_FAILED` + debug logs |

### Public API unchanged

Android still receives:

```json
{
  "success": false,
  "error": {
    "code": "STRIPE_CONNECT_ACCOUNT_CREATE_FAILED",
    "message": "Unable to create a Stripe connected account."
  }
}
```

Raw Stripe messages are **server-log only**.

### Example server log after fix (on next device attempt)

```
[STRIPE_CONNECT_DEBUG] operation=accounts.create
[STRIPE_CONNECT_DEBUG] driverId=<uuid>
[STRIPE_CONNECT_DEBUG] configuredCountry=US
[STRIPE_CONNECT_DEBUG] stripeSecretPresent=true
[STRIPE_CONNECT_DEBUG] stripeSecretMode=test
[STRIPE_CONNECT_DEBUG] stripeErrorType=StripeInvalidRequestError
[STRIPE_CONNECT_DEBUG] stripeErrorMessage=You can only create new accounts if you've signed up for Connect...
[STRIPE_CONNECT_DEBUG] stripeHttpStatus=400
[STRIPE_CONNECT_DEBUG] requestId=req_...
[STRIPE_CONNECT_DEBUG] dashboardAction=Enable Stripe Connect at https://dashboard.stripe.com/connect ...
```

---

## 8. Test results

| Command | Result |
|---------|--------|
| `npm test -- --testPathPattern="stripe-phase-b\|stripe-connect-debug"` | ✅ **33/33 passed** |
| `npm run build` | ✅ Passed |
| `npx tsx scripts/debug-stripe-connect-create.ts` | ❌ Reproduces Connect-not-enabled (expected until Dashboard fix) |

Full `npm test`: 2 pre-existing suite compile failures (`legacy-cab-migration.test.ts`, `driver-push-token.service.test.ts` — Stripe schema type drift, unrelated to this work).

---

## 9. Device retest steps (after Connect enabled)

1. **Enable Connect** in Stripe test Dashboard (§6).
2. Restart backend: `npm run dev` (picks up debug logging).
3. On Driver Android:
   - `GET /api/v1/driver/payouts/status` → expect `not_connected` (if no prior account)
   - `POST /api/v1/driver/payouts/onboarding-link` → expect **HTTP 200** with:
     ```json
     {
       "success": true,
       "data": {
         "url": "https://connect.stripe.com/setup/...",
         "expiresAt": "...",
         "accountId": "acct_...",
         "status": "onboarding_required"
       }
     }
     ```
4. Tap onboarding link → complete Stripe test onboarding.
5. Repeat `POST onboarding-link` → same `accountId`, new URL (idempotent account, new link).
6. `GET /status` → should progress toward `onboarding_required` / `verification_pending` / `ready`.
7. Confirm server logs show `stripe.connect.account_created` — **not** `account_create_failed`.

---

## 10. What was ruled out

| Hypothesis | Result |
|------------|--------|
| Android bug | Ruled out — correct endpoint, auth, error handling |
| Missing country | Ruled out — `US` configured |
| Wrong secret mode | Ruled out — `sk_test_...` in test |
| Controller params invalid | Not reached — Connect gate failed first |
| Duplicate account race | N/A — create never succeeded |
| Publishable key mismatch | Irrelevant to `accounts.create` |

---

**After Dashboard Connect enrollment, update final status to:**

`RYDU STRIPE CONNECT ACCOUNT CREATE FIXED — DEVICE RETEST REQUIRED`
