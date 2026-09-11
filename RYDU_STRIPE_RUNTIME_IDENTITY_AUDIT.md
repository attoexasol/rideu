# RYDU Stripe Runtime Identity Audit

**Date:** 2026-09-09  
**Repository:** `backend_rydu`  
**Goal:** Prove whether debug script and real backend use the same Stripe platform account, and identify the true `accounts.create` failure.

---

## Final status

```
RYDU STRIPE PLATFORM IDENTITY MATCHED — STRIPE CONNECT ENROLLMENT STILL BLOCKING
```

Also: **debug script reliability issue fixed** (it previously duplicated Stripe client/payload instead of using backend runtime helpers).

---

## Executive summary

| Question | Answer |
|----------|--------|
| Wrong Stripe key / wrong Dashboard account? | **No** — API proves platform account `acct_1UAA2JQfHXyyPQxt` |
| Debug script vs backend env mismatch? | **No** — same `.env`, same secret fingerprint `bd89b6873332` |
| Debug script vs backend Stripe client? | **Was mismatched; now fixed** — script now uses `getStripeClient()` + shared payload builder |
| Why Android still gets 502? | **Stripe-side** — real driver idempotency key returns cached old error; fresh keys return **Accounts v1 disabled** on this Developer sandbox |
| Is Connect visible in Dashboard? | **Consistent** — platform has Connect, but **Accounts v1 create is blocked** unless `feat_accounts_v1_support` is enabled |

**Compare this platform account ID in Dashboard (test mode):** `acct_1UAA2JQfHXyyPQxt`

---

## Comparison table

| Field | Backend runtime (HTTP + service) | Debug script (after fix) | Verify script |
|-------|----------------------------------|--------------------------|---------------|
| **platformAccountId** | `acct_1UAA2JQfHXyyPQxt` | `acct_1UAA2JQfHXyyPQxt` | `acct_1UAA2JQfHXyyPQxt` |
| **secret mode** | `test` | `test` | `test` |
| **secret fingerprint** | `bd89b6873332` | `bd89b6873332` | `bd89b6873332` |
| **env source** | `.env` (cwd=`backend_rydu`) | `.env` | `.env` |
| **secretMatchesEnvFile** | `true` | `true` | `true` |
| **shell override (PowerShell pre-check)** | `false` | `false` | `false` |
| **Stripe client** | `getStripeClient()` singleton | `getStripeClient()` (after fix) | `new Stripe(secret)` |
| **API version** | Stripe SDK default (`stripe@22.6.0`) | same | same |
| **configured country** | `US` | `US` | `US` |
| **accounts.create payload** | Phase B controller + transfers | same shared builder | same shared builder |
| **idempotency key (real driver)** | `driver:281b0d60-...:stripe-connect-account` | `debug:debug-driver-...` (script-only key) | `verify:verify-driver-...` |
| **accounts.create result (real driver key)** | **failed** | n/a | n/a |
| **Stripe error (real driver key)** | `You can only create new accounts if you've signed up for Connect...` | n/a | n/a |
| **Stripe requestId (real driver key)** | `req_Z5sOro7fUsD8bE` | n/a | n/a |
| **accounts.create result (fresh key)** | **failed** | **failed** | **failed** |
| **Stripe error (fresh key)** | `Stripe no longer recommends Accounts v1... enable feat_accounts_v1_support` | same (with fresh keys) | same |
| **HTTP POST onboarding-link** | **502** `STRIPE_CONNECT_ACCOUNT_CREATE_FAILED` | n/a | n/a |

---

## 1. Debug script audit (`scripts/debug-stripe-connect-create.ts`)

### Original behavior (unreliable)

| Aspect | Original script |
|--------|-----------------|
| dotenv | `import 'dotenv/config'` at top (loads `path.resolve(process.cwd(), '.env')`) |
| Secret read | Direct `process.env.STRIPE_SECRET_KEY?.trim()` **and** `classifyStripeSecretMode(secret)` |
| Stripe client | **`new Stripe(secret)` — separate instance, not backend singleton** |
| Payload | **Duplicated inline** (copied from service, not imported) |
| Idempotency | Script-only key `debug:debug-driver-...` (different from backend per-driver key) |
| Service import | Did **not** call `createDriverOnboardingLink` / `getOrCreateDriverStripeAccountId` |

### Fixed behavior (current)

| Aspect | Current script |
|--------|----------------|
| dotenv | still `import 'dotenv/config'` |
| Secret read | via `getStripeSecretKey()` / `describeStripeRuntimeEnv()` |
| Stripe client | **`getStripeClient()` — same as backend** |
| Payload | **`buildStripeConnectAccountCreateParams()` shared helper** |
| Platform proof | **`retrieveStripePlatformSnapshot()`** logs `[STRIPE_RUNTIME_VERIFY]` |

**Reliability issue confirmed:** the old script was not wrong about the key, but it was **not equivalent to backend runtime** (separate client construction + duplicated payload + non-production idempotency key).

---

## 2. Backend runtime Stripe initialization

| Step | Backend (`npm run dev` / HTTP handlers) |
|------|----------------------------------------|
| Env load | `import 'dotenv/config'` first line of `src/index.ts` |
| Secret accessor | `getStripeSecretKey()` → `trimEnv('STRIPE_SECRET_KEY')` |
| Client | `getStripeClient()` → lazy `new Stripe(secret)` once |
| Connect create | `createConnectedAccountForDriver()` in `stripeConnect.service.ts` |
| Idempotency | `driver:{driverId}:stripe-connect-account` |
| HTTP route | `POST /api/v1/driver/payouts/onboarding-link` → `createDriverOnboardingLink()` |

No Railway loader, no `.env.local`, no `.env.development` in repo — only `.env` + `.env.example`.

---

## 3. Platform account proof (Stripe API)

Retrieved with `stripe.accounts.retrieve()` using active secret (no account id — returns platform for key):

```
[STRIPE_RUNTIME_VERIFY] platformAccountId=acct_1UAA2JQfHXyyPQxt
[STRIPE_RUNTIME_VERIFY] country=US
[STRIPE_RUNTIME_VERIFY] chargesEnabled=false
[STRIPE_RUNTIME_VERIFY] payoutsEnabled=false
```

**Action for you:** In Stripe Dashboard → **Test mode** → Settings → Account details, confirm platform account ID is exactly `acct_1UAA2JQfHXyyPQxt`.

If Dashboard shows a **different** account ID, keys were copied from another sandbox — but API evidence says the active `.env` key belongs to `acct_1UAA2JQfHXyyPQxt`.

---

## 4. Three-path test results

### A. Debug script (fixed)

```bash
npx tsx scripts/debug-stripe-connect-create.ts
```

- platformAccountId: `acct_1UAA2JQfHXyyPQxt`
- With script idempotency key `debug:debug-driver-...`: may still return **cached** older Connect error
- With fresh idempotency keys: **Accounts v1 disabled** error (current Stripe policy)

### B. Verify script

```bash
npx tsx scripts/verify-stripe-runtime.ts
```

- platformAccountId: `acct_1UAA2JQfHXyyPQxt`
- Fresh idempotency key: **Accounts v1 disabled**

### C. Real HTTP endpoint (Android driver)

Driver: `281b0d60-71c9-45e3-abcd-0d7c6a590c37` (`auth0|6a350be063741e31d649fd65`, `r@gmail.com`)

```bash
npx tsx scripts/verify-stripe-http-onboarding.ts
```

| Result | Value |
|--------|-------|
| HTTP status | **502** |
| errorCode | `STRIPE_CONNECT_ACCOUNT_CREATE_FAILED` |
| platformAccountId | `acct_1UAA2JQfHXyyPQxt` |
| Direct probe (same driver idempotency key) | **failed** |
| Stripe message (cached idempotency) | `You can only create new accounts if you've signed up for Connect...` |
| requestId | `req_Z5sOro7fUsD8bE` |

**HTTP endpoint and backend service behave identically.** Android symptom is reproduced.

---

## 5. Stale environment override (Windows)

PowerShell check **before** Node (no secret printed):

```
shellStripeSecretPresent=False
shellStripePublishablePresent=False
shellNodeEnv=(empty)
```

dotenv behavior (`override: false` by default): existing shell vars win; `.env` fills missing vars.

Fingerprint proof after load:

```
secretFingerprint=bd89b6873332
envFileSecretFingerprint=bd89b6873332
secretMatchesEnvFile=true
```

**No environment mismatch.**

Note: In-process `shellStripeSecretPresent` inside scripts reads `true` because `import 'dotenv/config'` is hoisted before the check — use PowerShell pre-check + fingerprint match instead.

---

## 6. Env files in repository

| File | Present | Used by |
|------|---------|---------|
| `.env` | yes (gitignored) | `npm run dev`, all `tsx` scripts with `dotenv/config` |
| `.env.example` | yes | documentation only |
| `.env.local` / `.env.development` | **not found** | — |
| Railway loader | **none in code** | production would use host env vars |

Tests: `NODE_ENV=test`, Stripe usually mocked; env from Jest process unless test sets vars.

---

## 7. Two Stripe errors — both real, different causes

### Error A — **Current policy (fresh idempotency keys)**

```
Stripe no longer recommends Accounts v1 for new Connect integrations...
enable Accounts v1 support in the Dashboard:
https://dashboard.stripe.com/settings/features/feat_accounts_v1_support
```

Interpretation: Connect **is** present on Developer sandbox, but **POST /v1/accounts** (Accounts v1 + controller properties used by Phase B) is **disabled** until feature flag enabled **or** code migrates to Accounts v2.

### Error B — **Cached idempotency (real Android driver)**

```
You can only create new accounts if you've signed up for Connect...
```

Idempotency key: `driver:281b0d60-71c9-45e3-abcd-0d7c6a590c37:stripe-connect-account`

Stripe replays the **first failed response** for this key (from an earlier attempt before Connect/v1 state changed). This is why the HTTP endpoint still shows the older message while fresh probes show the v1 error.

Idempotency entries expire after ~24 hours, but **enabling v1 support alone may not unblock this driver immediately**.

---

## 8. Required actions (Stripe Dashboard — test mode)

1. Confirm platform account ID = **`acct_1UAA2JQfHXyyPQxt`**
2. Enable **Accounts v1 support**:  
   https://dashboard.stripe.com/test/settings/features/feat_accounts_v1_support
3. Retest with fresh probe:
   ```bash
   npx tsx scripts/verify-stripe-runtime.ts
   ```
4. Retest HTTP:
   ```bash
   npx tsx scripts/verify-stripe-http-onboarding.ts
   ```
5. If driver still fails with cached Connect message after v1 enabled, wait for idempotency expiry **or** request a controlled idempotency-key version bump in backend (not done in this audit — needs product approval).

**Not recommended without evidence:** migrating to Accounts v2 in code (separate project).

---

## 9. Code changes in this audit

| File | Change |
|------|--------|
| `src/services/stripeRuntimeVerify.ts` | **NEW** — platform retrieve, env fingerprint, shared create probe |
| `scripts/verify-stripe-runtime.ts` | **NEW** — platform identity script |
| `scripts/verify-stripe-http-onboarding.ts` | **NEW** — HTTP + direct probe for real driver |
| `scripts/debug-stripe-connect-create.ts` | **FIXED** — uses `getStripeClient()` + shared helpers (no duplicated payload) |
| `src/services/stripeConnect.debug.ts` | Detect/log Accounts v1 disabled dashboard action |
| `src/services/stripeConnect.service.ts` | Log `stripeAccountsV1Disabled` flag |

**Unchanged:** Connect account model, controller properties, API version, Android, settlement/transfers.

---

## 10. Test results

| Command | Result |
|---------|--------|
| `npm run build` | ✅ Pass |
| `npm test -- --testPathPattern="stripe-phase-b\|stripe-connect-debug"` | ✅ Pass (prior run) |

---

## 11. Device retest checklist

After enabling Accounts v1 support in Dashboard:

1. `npx tsx scripts/verify-stripe-runtime.ts` → expect `accountsCreateResult=success`
2. `npx tsx scripts/verify-stripe-http-onboarding.ts` → expect HTTP **200** + onboarding URL
3. Driver Android → Payouts → onboarding link → Stripe hosted flow opens
4. Confirm `[STRIPE_RUNTIME_VERIFY] platformAccountId=acct_1UAA2JQfHXyyPQxt` in logs matches Dashboard

If step 1 passes but step 2 still fails with old Connect message → idempotency cache for driver `281b0d60-...` — wait or bump idempotency key version.

---

**Audit complete. Platform identity proven. Failure is Stripe account configuration (Accounts v1 disabled + stale idempotency cache), not Android and not env/key mismatch.**
