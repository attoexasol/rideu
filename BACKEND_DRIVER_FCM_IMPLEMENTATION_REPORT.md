# Backend Driver FCM implementation report

**Date:** 2026-08-18  
**Scope:** Backend only. Driver Android was not modified.  
**Final status:** `READY FOR DRIVER FCM CLIENT INTEGRATION`

---

## What shipped

FCM is an **additional** wake-up path for Driver ride offers. Existing delivery is unchanged:

1. Persist `booking_offers`
2. Socket.IO `booking:offer`
3. Isolated FCM data message (`type`, `offerId`, `bookingId`)
4. REST hydrate: `GET /api/v1/driver/bookings/offers/:offerId` and `/offers/pending`

Accept semantics, dispatch batching, and offer TTL are unchanged.

When `FCM_ENABLED=false` or Firebase credentials are missing, the API still starts. Push is a no-op. Socket + REST still work.

---

## Schema

Table `driver_push_tokens` (migration `0024_driver_push_tokens`, journal idx 23):

| Column | Notes |
|--------|--------|
| `id` | UUID PK |
| `driver_id` | FK → `drivers.id` ON DELETE CASCADE |
| `device_id` | App device UUID (`drivers.active_device_id`), **not** the FCM token |
| `session_id` | Matches `drivers.active_session_id` |
| `fcm_token` | Unique |
| `enabled` | Default true |
| `created_at` / `updated_at` / `last_registered_at` | |

Unique `(driver_id, device_id)`. Indexes on `driver_id` and `device_id`.

Send target is the enabled row whose `device_id` and `session_id` match the driver’s **active** session.

---

## Firebase init

`src/services/fcmAdmin.service.ts` lazy-inits `firebase-admin`.

- `FCM_ENABLED=false` → no init, warning `fcm.config.unavailable`
- Credentials: `FIREBASE_SERVICE_ACCOUNT_JSON` or `GOOGLE_APPLICATION_CREDENTIALS`
- Init/send failures never crash process startup

---

## Env

`.env.example`:

```
FCM_ENABLED=false
# FIREBASE_PROJECT_ID=
# GOOGLE_APPLICATION_CREDENTIALS=
# FIREBASE_SERVICE_ACCOUNT_JSON=
```

See `DRIVER_PUSH_FCM_BACKEND_CONFIG.md`. Do not reuse `GOOGLE_MAPS_API_KEY`.

---

## Token lifecycle

| Event | Behavior |
|-------|----------|
| `PUT /api/v1/driver/push-token` | Upsert for authenticated active device/session. Same FCM token on another driver/device is detached. Other devices for this driver are removed (single-session). |
| `DELETE /api/v1/driver/push-token` | Deletes the active-device row |
| `POST /api/auth/logout` | `clearSessionInfo` + delete all tokens for that driver |
| New-device login | Deletes all tokens for the driver |
| Same-device login | Updates `session_id` on the remaining row |
| FCM `UNREGISTERED` / invalid token | Row deleted; no retry |

Body `driverId` cannot retarget a token. Invalid sessions are rejected (`SESSION_INVALID`) by `requireDriver` and by a session-id check in `registerDriverPushToken`.

---

## Dispatch integration

`startDispatch` → `createPendingBookingOffer` → `notifyDriverOfPersistedOffer`:

- Socket emit first
- `scheduleDriverOfferPush` via dynamic import + `.catch`
- Candidate loop continues if notify throws

No second `booking_offers` insert. Same `offerId` / `bookingId` / `expiresAt`.

---

## TTL / payload / priority

- TTL = `remainingSecondsUntil(expiresAt)`, capped at `DISPATCH_OFFER_TIMEOUT_SECONDS` (default 45)
- Expired (`expiresAt <= now`) → skip send (`OFFER_EXPIRED`)
- Android: `priority: high`, `collapseKey: booking_offer:<offerId>`, `ttl` in milliseconds
- Data only: `{ type: "booking_offer", offerId, bookingId }` (strings)
- No notification body, passenger PII, route, fare, JWT, or signed URLs

---

## Failure isolation / invalid tokens

Push errors are returned as `SendDriverOfferPushResult`; they do not reject dispatch.

| Failure | Action |
|---------|--------|
| No token / FCM disabled / unavailable | Skip |
| Permanent token errors | Delete row, no retry |
| Transient (`UNAVAILABLE` / timeout / internal) | At most 2 attempts, 150ms apart, still bounded by remaining TTL |

Logs include `driverId`, `bookingId`, `offerId`, `deviceId`, `pushAttempted`, `pushSent`, `pushFailureCode`, `remainingTtlSeconds`. Tokens, private keys, JWTs, and passenger details are not logged.

---

## Files changed

- `src/db/schema/driver_push_tokens.ts`
- `src/db/migrations/0024_driver_push_tokens.sql`
- `src/db/migrations/meta/_journal.json`
- `src/db/schema/index.ts`
- `src/config/fcm.ts`
- `src/config/env-validator.ts`
- `src/services/fcmAdmin.service.ts`
- `src/services/driverOfferPush.payload.ts`
- `src/services/driverOfferPush.service.ts`
- `src/services/driverOfferNotify.service.ts`
- `src/services/driverPushToken.service.ts`
- `src/repositories/driverPushToken.repository.ts`
- `src/controllers/driverPush.controller.ts`
- `src/routes/v1/driver/push.ts`
- `src/routes/v1/index.ts`
- `src/routes/auth.ts`
- `src/services/dispatch.service.ts`
- `src/validators/index.ts`
- `src/index.ts`
- `.env.example`
- `package.json` / `package-lock.json` (`firebase-admin`)
- Tests under `tests/driver-*.test.ts`
- `DRIVER_PUSH_FCM_BACKEND_CONFIG.md`
- `DRIVER_FCM_OFFER_API_CONTRACT.md`

---

## Migration

`0024_driver_push_tokens` is registered in `_journal.json` (idx 23). Apply with `npm run db:migrate`.

---

## Tests

Added:

- `tests/driver-offer-push.payload.test.ts`
- `tests/driver-push-token.service.test.ts`
- `tests/driver-offer-push.service.test.ts`
- `tests/driver-push-routes.test.ts`
- `tests/driver-offer-notify.test.ts`
- `tests/driver-push-dispatch.contract.test.ts`

`npm test` (with `--runInBand`): **37 suites, 372 tests passed**, including existing booking, DVR, history, duty, and exchange tests.

`npm run db:migrate`: applied `0024_driver_push_tokens`; table and unique indexes verified in local Postgres.

`npm run build`: no errors in FCM/dispatch/auth sources. Existing failures remain in unrelated live scripts (`socket.io-client` missing in `src/scripts/live-*.ts`).

---

## Deployment

1. Same Firebase project as Driver Android.
2. Service-account secret via file path or `FIREBASE_SERVICE_ACCOUNT_JSON`.
3. `FCM_ENABLED=true` only after credentials are in place.
4. Android: register token after login; hydrate offers via REST; dedupe by `offerId`.
