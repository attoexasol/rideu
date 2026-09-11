# RYDU Stripe Accounts v1 Fresh Probe Report

**Date:** 2026-09-09  
**Repository:** `backend_rydu`  
**Platform account (proven):** `acct_1UAA2JQfHXyyPQxt`  
**Dashboard state reported:** Accounts v1 support = **Enabled**

---

## Final status

```
RYDU STRIPE ACCOUNTS V1 FRESH PROBE SUCCESS — STALE IDEMPOTENCY CONFIRMED
```

Accounts v1 create **works** on this platform when a **fresh idempotency key** is used. Prior failures were **not** caused by Dashboard/API feature-state mismatch.

---

## What was tested

Script: `scripts/verify-stripe-accounts-v1-fresh.ts`

Each probe used:
- `getStripeClient()` (backend singleton)
- `buildStripeConnectAccountCreateParams()` (Phase B payload)
- **Fresh** idempotency key: `verify:accounts-v1:<random-uuid>`
- **Fresh** probe driver metadata id: `verify-probe-<random-uuid>`

**Not reused:**
- `debug:debug-driver:...`
- `verify:verify-driver:...`
- `driver:{driverId}:stripe-connect-account`

Configured probe count: **3**  
Actual probes run: **1** (stopped after first success per instructions)

---

## Probe result

### Probe 1 — SUCCESS

```
[STRIPE_V1_VERIFY] platformAccountId=acct_1UAA2JQfHXyyPQxt
[STRIPE_V1_VERIFY] idempotencyKeyFresh=true
[STRIPE_V1_VERIFY] idempotencyKey=verify:accounts-v1:202008d4-899f-48b5-88cc-87ac7e219fe6
[STRIPE_V1_VERIFY] accountsCreateResult=success
[STRIPE_V1_VERIFY] connectedAccountId=acct_1UDXRgH8WFB7v4Sp
[STRIPE_V1_VERIFY] stoppingAfterFirstSuccess=true
```

Probes 2 and 3 were **not run** (success on first attempt).

---

## Interpretation

| Hypothesis | Verdict |
|------------|---------|
| Dashboard shows Enabled but API rejects v1 | **Rejected** — fresh key succeeded |
| Delayed feature propagation | **Unlikely** — success immediate on fresh key |
| Stale Stripe idempotency cache | **Confirmed** — fixed keys replay old errors |

### Why older scripts still fail

| Script / path | Idempotency key | Behavior |
|---------------|-----------------|----------|
| `verify-stripe-runtime.ts` | `verify:verify-driver-...` (fixed) | Replays cached v1-disabled or Connect errors |
| `debug-stripe-connect-create.ts` | `debug:debug-driver-...` (fixed) | Same |
| Real driver HTTP onboarding | `driver:281b0d60-...:stripe-connect-account` | Replays cached **Connect not signed up** error from first Android attempt |
| **Fresh probe (this test)** | `verify:accounts-v1:<uuid>` | **Success** |

Stripe idempotency replays the **first response** for a given key (including failures). Keys expire after ~24 hours, but until then the driver onboarding path remains blocked even though Accounts v1 now works.

---

## Diagnostic account created

One test connected account was created during this probe:

| Field | Value |
|-------|-------|
| Connected account ID | `acct_1UDXRgH8WFB7v4Sp` |
| Purpose | Diagnostic only |
| Persisted in Rydu DB | **No** (probe bypasses `claimDriverStripeAccountId`) |

This account exists in Stripe test mode only. It can be ignored or deleted in Stripe Dashboard → Connect → Accounts.

---

## Code changes (diagnostic only)

| File | Change |
|------|--------|
| `src/services/stripeRuntimeVerify.ts` | Added `buildFreshAccountsV1IdempotencyKey()`, `[STRIPE_V1_VERIFY]` logging |
| `scripts/verify-stripe-accounts-v1-fresh.ts` | **NEW** — 3-probe fresh idempotency runner |
| `scripts/verify-stripe-runtime.ts` | Comment pointing to fresh probe script |
| `scripts/debug-stripe-connect-create.ts` | Comment pointing to fresh probe script |

**Unchanged:** Production Connect service, controller properties, Android, Accounts v2 migration.

---

## Recommended next steps (not implemented in this task)

1. **Driver unblock:** After confirming v1 works, the real driver (`281b0d60-71c9-45e3-abcd-0d7c6a590c37`) still needs either:
   - Wait for Stripe idempotency expiry on `driver:281b0d60-...:stripe-connect-account`, **or**
   - Product-approved idempotency key version bump in backend (e.g. `driver:{id}:stripe-connect-account:v2`)

2. **Retest HTTP:**
   ```bash
   npx tsx scripts/verify-stripe-http-onboarding.ts
   ```
   Expected: still **502** until driver idempotency cache clears or key version bumps.

3. **Retest Android** after driver idempotency issue resolved.

---

## How to re-run

```bash
npx tsx scripts/verify-stripe-accounts-v1-fresh.ts
```

Each run generates new UUID idempotency keys. Stop after first success to avoid creating extra test accounts.

---

**Conclusion:** Accounts v1 is enabled and functional on `acct_1UAA2JQfHXyyPQxt`. The remaining onboarding failure for the real driver is **stale idempotency**, not Stripe Dashboard misconfiguration.
