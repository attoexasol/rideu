# Backend FCM Real-Device Runtime Audit

**Date:** 2026-08-18  
**Scope:** Audit only. No application code, env, credentials, or schema were changed.  
**Method:** Inspect local `.env` (redacted), process/listen state, Postgres (`driver_push_tokens`, `drivers`, `bookings`, `booking_offers`), FCM send path in `src/`, and health probes. FCM tokens and service-account secrets were not printed.

**Final status:** `FCM_NOT_TRIGGERED — FCM_ENABLED unset/false; Firebase Admin never initialized; sendDriverOfferPush is a no-op (pushAttempted=false, FCM_DISABLED)`

---

## Verdict

A ride-request FCM message was **not sent**. Socket.IO `booking:offer` is a separate path and is **not** evidence of FCM.

The Driver “DriveWize — Last update: …” banner is the Android **LocationService foreground notification**. It is not `type=booking_offer`.

Independent blockers (in code order):

1. **FCM is off** in the backend environment that this repo loads (`FCM_ENABLED` missing → `isFcmEnabled()` is `false`).
2. **No Firebase credentials** (`GOOGLE_APPLICATION_CREDENTIALS` and `FIREBASE_SERVICE_ACCOUNT_JSON` both unset).
3. **No FCM registration row** for the logged-in Driver (`driver_push_tokens` total = 0). If FCM were enabled, the next failure would be `NO_TOKEN`.

There is **no API process listening** on `127.0.0.1:3000` or `http://103.208.181.253:3000` at audit time, so a brand-new Passenger booking could not be executed through HTTP. The newest persisted offer in this database was reconstructed instead.

---

## 1. Is `FCM_ENABLED=true` in the running backend process?

**No. There is no running backend process to sample.**

| Check | Result |
|-------|--------|
| `GET http://127.0.0.1:3000/health` | Connection refused |
| TCP listen on port 3000 | None |
| `GET http://103.208.181.253:3000/health` | Connection refused |
| Node processes | Cursor/tsserver, jest, `prove-manifest.ts`, unrelated Vite — **no** `src/index.ts` / `tsx watch` API |

What the process **would** load from this checkout:

| Source | `FCM_ENABLED` |
|--------|----------------|
| `.env` | **Key absent** (`NO_FCM_KEYS_IN_ENV`) |
| Shell / user process env | Empty |
| `.env.example` | `FCM_ENABLED=false` |
| Code default | `getEnvVarAsBoolean('FCM_ENABLED', false)` → **false** |

Startup printer uses `process.env.FCM_ENABLED \|\| 'false'`, so a start with this env would log `FCM_ENABLED: false`.

On that path `sendDriverOfferPush` returns immediately:

- `pushAttempted: false`
- `pushSent: false`
- `pushFailureCode: 'FCM_DISABLED'`
- `fcm.config.unavailable` reason: `FCM_ENABLED is false; offer push is a no-op`

Firebase `messaging.send` is **not called**.

---

## 2. Did Firebase Admin initialize successfully?

**No.**

`logFcmStartupState()` → `isFcmReady()` → if disabled, **does not** call `initializeApp`.

There is no `fcm.initialized` evidence:

- No running process stdout
- Pino has **no log file** (pretty transport to stdout in `NODE_ENV=development` only)
- Recursive `*.log` search in the repo: **none**
- Credentials missing even if the flag were flipped (`fcm.init.failed` / `fcm.config.unavailable` would apply)

---

## 3. Same Firebase project as Driver Android `google-services.json`?

**Cannot confirm. Configuration is absent.**

| Artifact | Present in this backend tree / env |
|----------|-------------------------------------|
| `FIREBASE_PROJECT_ID` | No |
| `GOOGLE_APPLICATION_CREDENTIALS` path | No |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | No |
| Service-account JSON file on disk (search) | None |
| Driver `google-services.json` | **Not in this repo** (Android-only) |

`GOOGLE_MAPS_API_KEY` is unrelated and must not be treated as FCM credentials.

There is **no** proof the backend can authenticate to the same Firebase project as the Driver app.

---

## 4. Logged-in Driver vs `driver_push_tokens`

Table `driver_push_tokens` **exists** (migration `0024`). Row count: **0 enabled, 0 total**.

Most recently active Driver (offers still target this id):

| Field | Value |
|-------|--------|
| driverId | `4d8d26f0-cee9-4575-8331-ae64b072f42c` |
| name | Shamim Khan |
| status (DB) | `online` |
| activeDeviceId (`drivers.active_device_id`) | `d725a38017ab2be6` |
| activeSessionId (`drivers.active_session_id`) | `sess_1787008455956_jkwzbga2d8` |
| lastLoginAt | `2026-08-17T17:14:15.971Z` |
| lastSeen | `2026-08-17T17:41:09.234Z` |
| **token row exists** | **false** |
| deviceId (token) | n/a |
| sessionId (token) | n/a |
| enabled | n/a |
| lastRegisteredAt | n/a |

`PUT /api/v1/driver/push-token` is implemented. Zero rows means the Driver app has **not** successfully registered an FCM token against this database (or never called the endpoint after the table was created).

FCM token values were not read/printed.

---

## 5. Fresh booking / offer trace

API is down, so a **new** Passenger create could not be issued. Newest booking that produced an offer:

| Field | Value |
|-------|--------|
| bookingId | `dd1bca45-8d11-467d-993f-25991cabb501` |
| booking status | `cancelled` |
| createdAt | `2026-08-17T23:18:52.658Z` |
| offerId | `31b93ddd-57f6-459f-91ad-beebc903b79f` |
| driverId | `4d8d26f0-cee9-4575-8331-ae64b072f42c` |
| offer status | `expired` |
| offeredAt | `2026-08-17T23:18:52.676Z` |
| expiresAt | `2026-08-17T23:19:22.676Z` |
| remainingTtlSeconds (at insert) | **30** (`DISPATCH_OFFER_TIMEOUT_SECONDS=30` in `.env`; matches 30s window) |

Dispatch code after `createPendingBookingOffer` (persist **then** notify):

1. **Offer inserted** — proven (`booking_offers` row above).
2. **Socket emit** — `notifyDriverOfPersistedOffer` always `emitToDriver(..., 'booking:offer', ...)`. Persist success does **not** prove the Driver process received it; it also does **not** prove FCM.
3. **FCM send attempted** — **no** (`pushAttempted` would be `false` because `FCM_ENABLED` is false; token lookup is never reached).
4. **FCM send result** — **not sent**. No Firebase `messageId`.

| Field | Result |
|-------|--------|
| pushAttempted | **false** (reconstructed from env + `sendDriverOfferPush` order) |
| pushSent | **false** |
| pushFailureCode | `FCM_DISABLED` |
| Firebase messageId | none |

If FCM were enabled with working Admin SDK, this Driver would still fail with **`NO_TOKEN`** (zero `driver_push_tokens` rows, so `findEnabledPushTokenForDriverDevice` returns null).

---

## 6. Runtime log search

Searched for:

`fcm.config.unavailable`, `pushAttempted`, `pushSent`, `pushFailureCode`, `NO_TOKEN`, `UNREGISTERED`, `INVALID_ARGUMENT`, `SENDER_ID_MISMATCH`, `THIRD_PARTY_AUTH_ERROR`, `UNAVAILABLE`

| Location | Hits |
|----------|------|
| Repo `*.log` files | none |
| Running API stdout / terminal capture | none (API not running; Cursor terminal idle) |
| Code (would log if a process ran) | `fcm.config.unavailable`, `driver.push.offer` with `pushAttempted` / `pushSent` / `pushFailureCode` |

**No live log line proves an FCM send.** Absence of `UNREGISTERED` / `SENDER_ID_MISMATCH` is **not** success; those codes only appear after `messaging.send` throws.

---

## 7. Push target vs active device/session

Intended match (code):

- `drivers.active_device_id`
- `drivers.active_session_id`
- `driver_push_tokens` row: `driver_id` + `device_id` + `enabled=true` + `session_id === active_session_id`

Observed:

| Check | Result |
|-------|--------|
| Driver has active device + session | **yes** |
| Matching token row | **no** (table empty) |
| Target usable for FCM | **no** |

---

## 8. FCM payload (`type` / `offerId` / `bookingId`)

**Code contract is exact.** No live message was sent, so this is compile-time / unit-test proof only.

`buildOfferPushDataPayload` / `buildAndroidOfferFcmMessage`:

```json
{
  "type": "booking_offer",
  "offerId": "<uuid>",
  "bookingId": "<uuid>"
}
```

Tests assert those three keys only (no phone, route, fare, JWT). Data-only (no `notification` block).

---

## 9. Android FCM config (code)

When a send **would** run:

| Field | Value |
|-------|--------|
| `android.priority` | `high` |
| `android.ttl` | `remainingTtlSeconds * 1000` (firebase-admin uses **milliseconds**) |
| TTL > 0 | Required (`shouldSendOfferPush` / `remainingTtlSeconds <= 0` → skip) |
| TTL ≤ remaining offer lifetime | Capped with `Math.min(remaining, DISPATCH_OFFER_TTL_SECONDS)` |

Here `DISPATCH_OFFER_TIMEOUT_SECONDS=30`, so max TTL is **30s** (30000 ms). Not observed on the wire because FCM was not called.

---

## 10. Socket is not FCM

`notifyDriverOfPersistedOffer` emits Socket.IO **first**, then `scheduleDriverOfferPush` in a detached import. Offer rows and a possible in-app offer UI only prove **dispatch + socket/REST**. They do not prove FCM.

The LocationService “Last update” notification is local Android, not this payload.

---

## What would be required for `FCM_SEND_CONFIRMED`

1. API process running with `FCM_ENABLED=true` and valid Firebase Admin credentials for the **same** project as Driver `google-services.json`.
2. Startup log `fcm.initialized`.
3. Driver `PUT /api/v1/driver/push-token` so `driver_push_tokens` has an enabled row matching `active_device_id` + `active_session_id`.
4. A new Passenger booking whose `driver.push.offer` log shows `pushAttempted=true`, `pushSent=true`, `pushFailureCode=null`, and a Firebase message id (safe to log).

Until then, background ride-request FCM will not appear on the device.

---

## Final status

**FCM_NOT_TRIGGERED — FCM_ENABLED unset/false; Firebase Admin never initialized; sendDriverOfferPush is a no-op (pushAttempted=false, FCM_DISABLED)**
