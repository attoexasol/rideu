# Backend Driver Push Notification Audit

**Date:** 2026-08-18  
**Scope:** Audit only. No application code, schema, dependencies, credentials, or env files were modified.  
**Authority:** Implemented code in `src/`, `package.json`, `.env.example`, and existing tests.  
**Final status:** `AUDIT COMPLETE — PUSH FOUNDATION MISSING: no FCM/Firebase Admin, no device-token storage, no push sender; Socket.IO + REST recovery are the only offer delivery paths.`

---

## Verdict

Reliable background ride-request delivery to Driver Android **cannot be enabled by wiring an existing push stack**. The booking offer pipeline is production-capable over Socket.IO and REST, but **push infrastructure does not exist**.

What already works and must be preserved:

- Passenger confirm → dispatch → `booking_offers` row → `booking:offer` Socket.IO emit.
- REST recovery: `GET /api/v1/driver/bookings/offers/pending` and `GET /api/v1/driver/bookings/offers/:offerId`.
- Accept is authoritative and already rejects expired / taken offers.
- Driver identity is single-session / single-device (`drivers.active_session_id` + `drivers.active_device_id`).

What is missing:

- Firebase Admin / FCM (or any other push provider).
- Device registration-token storage.
- Token register / refresh / logout / invalid-token cleanup APIs.
- A non-blocking push send after a persisted `booking_offers` row.

The booking contract already anticipated this gap: `DRIVER_PASSENGER_BOOKING_CONTRACT.md` §13 states FCM is **not implemented**, and `GET .../offers/:offerId` is documented as hydrate-after-push. Implementation should complement Socket.IO, not replace it.

---

## 1. Existing push infrastructure

### 1.1 Installed dependencies

`package.json` runtime dependencies include Socket.IO, Redis, Auth0, Postgres, and Google Maps client usage via `axios`. **None** of the following are installed:

| Package | Present |
|---------|---------|
| `firebase-admin` | No |
| `@google-cloud/messaging` or related FCM SDK | No |
| `expo-server-sdk` | No |
| OneSignal / `onesignal-node` | No |
| `apn` / APNs | No |
| `web-push` | No |

`package-lock.json` has **no** matches for `firebase`, `fcm`, `onesignal`, `expo-server-sdk`, or `apn`.

### 1.2 Config / env vars

`.env.example` and `src/config/env-validator.ts` define Google **Maps** keys (`GOOGLE_MAPS_API_KEY`, etc.). They do **not** define:

- `FIREBASE_*`
- `FCM_*`
- `GOOGLE_APPLICATION_CREDENTIALS`
- `PUSH_*`
- Android package / applicationId

There is no `src/config/firebase.ts` (or equivalent). Firebase Admin is **not** initialized. There is no `initializeApp`, `applicationDefault()`, or `messaging()` call anywhere in `src/`.

`GOOGLE_MAPS_API_KEY` is a Maps HTTP key. It is **not** a Firebase service account and must not be reused for FCM.

### 1.3 Database tables / columns for device tokens

All tables are exported from `src/db/schema/index.ts`. There is **no**:

- `device_tokens` / `push_tokens` / `fcm_tokens` table
- `fcm_token` / `push_token` / `notification_token` / `registration_token` column on `drivers`, `customers`, `sessions`, or `duty_sessions`

Driver device fields that **do** exist (`src/db/schema/drivers.ts`):

| Column | Purpose today |
|--------|----------------|
| `active_session_id` | Single active login session |
| `active_device_id` | Client-supplied device UUID (not an FCM token) |
| `active_device_info` | Human-readable device label |
| `last_login_at` | Used to reject stale Auth0 tokens after a newer login |

`sessions` (`src/db/schema/sessions.ts`) stores JWT rows (`user_id`, `user_type`, `token`, `expires_at`). The `token` column is the **backend session JWT**, not an FCM registration token.

### 1.4 Services / routes / senders

Existing `*Notify.service.ts` files are **Socket.IO / Redis pub-sub only**:

| Service | Transport |
|---------|-----------|
| `src/services/bookingNotify.service.ts` | `emitToDriver` / `emitToCustomer` / `emitToAdmins` via Socket.IO rooms + Redis `BOOKING_UPDATE` |
| `src/services/dutyNotify.service.ts` | `emitToDriver` |
| `src/services/vehicleExchangeNotify.service.ts` | `emitToDriver` |
| `src/services/adminRideVideoNotify.service.ts` | `emitToAdmins` |

There is **no** notification HTTP route for registering an FCM token.

The only push-shaped code is a **commented stub** in `src/routes/auth.ts` (login, other-device takeover):

```ts
// TODO: Send push notification to old device
// await sendPushNotification(existingDeviceId, {
//   title: "Session Ended",
//   message: "You've been logged in from another device"
// });
```

`sendPushNotification` is not defined. The stub keys off `existingDeviceId` (app device UUID), which is **not** an FCM registration token.

### 1.5 Documented product intent

`DRIVER_PASSENGER_BOOKING_CONTRACT.md`:

- §13: **FCM / background delivery — Not implemented.**
- §16: **No FCM push for offers.**
- §7: `GET /offers/:offerId` is described as **hydrate single offer after push** — REST recovery was designed to be the post-tap source of truth.

---

## 2. Driver device registration (current)

### 2.1 How a Driver device is identified

| Signal | Where | What it is |
|--------|--------|------------|
| `X-Device-ID` | Request header (`src/middleware/device-tracking.ts`) | Client device UUID |
| `X-Device-INFO` | Request header | Optional label |
| `deviceId` / `deviceInfo` | `POST /api/auth/login` body (`loginSchema`) | Optional; stored on the driver row |
| `sessionId` | Embedded in backend HS256 JWT at login | Compared to `drivers.active_session_id` |
| Socket room | `driver-{drivers.id}` | DB UUID, not Auth0 id, not device id |

`trackDriverDevice` is attached to **all** `requireDriver` routes (`src/middleware/rbac.ts`), including `/api/v1/driver/bookings/*`.

Behavior:

1. JWT `sessionId` matching `active_session_id` → accept (even if `X-Device-ID` is missing).
2. No active session/device on the row → create one from this request.
3. `X-Device-ID` equals `active_device_id` → accept.
4. JWT `sessionId` mismatch or token `iat` before `last_login_at` → **401 `SESSION_INVALID`** (`logged_in_elsewhere`).
5. Newer token without matching session → **device takeover** (overwrites `active_session_id` / `active_device_id`).

Missing `X-Device-ID` is logged as a warning and does not fail the request when the session JWT matches.

### 2.2 Session policy (source of truth)

**Single active device per driver.** Enforced at login (`src/routes/auth.ts`) and on subsequent requests (`trackDriverDevice`).

Login (`POST /api/auth/login`):

- If `active_device_id` exists and differs from the new `deviceId`, existing DB sessions are deleted (`sessionUtils.deleteAllForUser`) and the driver row is overwritten with the new session/device.
- `deviceId` is optional; if omitted it is stored as `'unknown'`.

Logout (`POST /api/auth/logout`):

- Deletes the current `sessions` row by JWT.
- `driverUtils.clearSessionInfo(user.userId)` sets `active_session_id`, `active_device_id`, and `active_device_info` to `null`.

Validate (`GET /api/auth/validate-session`):

- Driver session is invalid when JWT `sessionId` ≠ `drivers.active_session_id`.

There is **no** FCM token stored against the driver. Multiple concurrent devices are **not** allowed by policy.

### 2.3 Correct place to associate an FCM registration token

Bind the FCM token to the **authenticated driver’s active session/device**, never to a client-supplied `driverId`.

Recommended model (implementation later):

1. **Canonical send target:** the single token belonging to `drivers.active_device_id` + `drivers.active_session_id`.
2. **Storage:** a dedicated `driver_push_tokens` table is preferable to a lone column, even under single-session policy:
   - unique FCM token (prevents the same token attaching to two drivers)
   - keyed by `(driver_id, device_id)`
   - optional `session_id`, `updated_at`, `enabled`
   - logout / invalid FCM can delete one row without touching login session columns
3. **Minimum viable alternative:** `drivers.fcm_registration_token` + `fcm_token_updated_at`, overwritten on register and cleared on logout / invalid token. This matches today’s 1:1 session policy but is weaker for token uniqueness and cleanup.

Recommended registration surface (not implemented):

- Authenticated `PUT`/`POST` under `/api/v1/driver/...` using `requireAuth` + `requireDriver` (so `trackDriverDevice` already rejects invalidated sessions).
- Body: `{ token }` (and optionally `deviceId` that must match `X-Device-ID` / `active_device_id`).
- Identity from JWT only.

Login may *optionally* accept a token later, but token refresh happens independently of login (FCM rotates tokens). A dedicated register/refresh endpoint is required either way.

Do **not** treat `active_device_id` as an FCM token. The auth stub that would `sendPushNotification(existingDeviceId, ...)` is the wrong lookup key.

---

## 3. Booking offer dispatch (exact trace)

Push must be a **side effect of an already-persisted offer**, not a second dispatch path.

```
Passenger confirm
  passengerBooking.controller → confirmBooking()          src/services/booking.service.ts
    INSERT bookings status=searching (instant)
    AFTER commit: startDispatch(booking.id)               src/services/dispatch.service.ts

startDispatch(bookingId)
  findBookingById
  findNearbyDriversForCategory(...)                       eligibility + Redis active set
    realtimeCache.getActiveDrivers()
    checkDriverEligibility()                              src/services/driverAvailability.service.ts
  slice(0, DISPATCH_BATCH_SIZE)
  updateBooking → status=offered, dispatchBatch++
  for each candidate:
    createPendingBookingOffer(...)                        src/repositories/booking.repository.ts
      buildOfferTimeWindow(ttlSeconds)                    src/utils/offerTimestamps.ts
      INSERT booking_offers status=pending                unique (booking_id, driver_id)
    buildOfferEventPayload(...)                           src/services/driverBooking.service.ts
    emitToDriver(driverId, 'booking:offer', payload)      src/services/bookingNotify.service.ts
      Socket.IO room driver-{driverId}
      Redis BOOKING_UPDATE for multi-instance
  emitToCustomer(..., 'booking:searching', ...)
  scheduleDispatchRetry(bookingId, ttlSeconds)            in-process setTimeout
```

### 3.1 Function names

| Step | Function | File |
|------|----------|------|
| Create booking | `confirmBooking` | `src/services/booking.service.ts` |
| Start / retry dispatch | `startDispatch` | `src/services/dispatch.service.ts` |
| Eligible drivers | `findNearbyDriversForCategory` | `src/services/dispatch.service.ts` |
| Eligibility | `checkDriverEligibility` | `src/services/driverAvailability.service.ts` |
| Persist offer | `createPendingBookingOffer` → `insertBookingOffer` | `src/repositories/booking.repository.ts` |
| Socket payload | `buildOfferEventPayload` | `src/services/driverBooking.service.ts` |
| Socket emit | `emitToDriver` | `src/services/bookingNotify.service.ts` |
| Room join | `setupWebSocketServer` joins `driver-{uuid}` | `src/websocket/server.ts` |
| Pending list | `listPendingOffersForDriver` | `src/repositories/booking.repository.ts` |
| Pending HTTP | `listPendingOffersHandler` / `listOffersHandler` | `src/controllers/driverBooking.controller.ts` |
| Single offer HTTP | `getOfferDetailForDriver` | `src/services/dispatch.service.ts` |
| Accept | `acceptBookingOffer` → `acceptBookingOfferInternal` | `src/services/dispatch.service.ts` |
| Expire worker | `processExpiredOffers` → `expireStaleOffers` | dispatch + repository; interval 15s in `src/index.ts` |

### 3.2 Best place to trigger push (no duplicate offers)

**After** `createPendingBookingOffer` returns, **inside** the existing `for (const candidate of batchDrivers)` loop in `startDispatch`.

Rules:

- Trigger only when the `booking_offers` insert succeeded (row id = `offer.id`).
- Do **not** insert a second offer row.
- Do **not** replace `emitToDriver`.
- Wrap push in try/catch (or `void send(...).catch(...)`) so FCM failure **cannot** abort the remaining candidates or `scheduleDispatchRetry`.
- Do **not** put FCM I/O inside the passenger `confirmBooking` DB transaction (dispatch already runs after commit).

Socket emit today is fire-and-forget even when `roomSize === 0` (`bookingNotify.service.ts` logs room size but still emits). That is the background gap: disconnected / backgrounded Android never receives the socket event. Admin reconnect buffering exists; **driver offer buffering does not**.

---

## 4. Offer payload — what is safe for FCM

### 4.1 Current `booking:offer` payload (`buildOfferEventPayload`)

| Field | In socket/REST payload | Safe for FCM data? |
|-------|------------------------|--------------------|
| `offerId` | yes | **Yes — required** |
| `bookingId` | yes | **Yes — required** |
| `driverId` | yes | Optional; app already knows self from JWT |
| `bookingNumber` | yes | Avoid (not needed to open the offer) |
| `expiresAt` | yes | Optional ISO string; REST is authoritative |
| `service.*` | yes | No |
| `pickup` lat/lng/address/`spotLabel` | yes | No |
| `dropoff` lat/lng/address | yes | No |
| `route` (may include encoded polyline) | yes | **No** |
| `fare.amount` / `currency` | yes | No |
| `passenger.displayName` | yes | **No** |
| `passenger.phone` | not in offer payload (`null` on assigned detail) | **Never** |
| Auth tokens / signed video URLs | not in offer payload | **Never** |

Socket/REST may keep the full payload. FCM must not copy it.

### 4.2 Recommended FCM data payload (all string values)

Android data maps require strings:

```
type          = booking_offer
offerId       = <uuid>
bookingId     = <uuid>
```

Optional non-sensitive extras if the OS needs them for collapse/TTL display:

```
expiresAt     = <ISO-8601>
```

Visible notification title/body, if used for lock-screen wake, must stay generic (e.g. “New ride request”) with **no** passenger name, phone, address, fare, or route.

### 4.3 Authoritative fetch after tap / resume

Driver app should:

1. Deduplicate by `offerId`.
2. `GET /api/v1/driver/bookings/offers/:offerId` (or pending list).
3. Accept only via `POST /api/v1/driver/bookings/:bookingId/accept` with `{ offerId }`.

`getOfferDetailForDriver` already returns `null` (HTTP 404 `OFFER_NOT_FOUND`) when the offer is missing, not owned by the driver, not `pending`, or expired.

---

## 5. TTL alignment

| Clock | Value | Source |
|-------|--------|--------|
| Offer lifetime | `DISPATCH_OFFER_TIMEOUT_SECONDS` **default 45** | `src/config/dispatch.ts` → `DISPATCH_OFFER_TTL_SECONDS` |
| `offered_at` / `expires_at` | single UTC window: `now` + ttl | `buildOfferTimeWindow` |
| Dispatch batch retry | `setTimeout(..., ttlSeconds * 1000)` | `scheduleDispatchRetry` |
| Max batches | `DISPATCH_MAX_BATCHES` **default 3** | same config |
| Expire worker | every **15s** | `src/index.ts` → `processExpiredOffers` |
| Pending REST filter | `status=pending` AND `expires_at > CURRENT_TIMESTAMP` AND booking in `searching`/`offered` | `listPendingOffersForDriver` |
| Accept expiry | `isOfferExpiredAt(expiresAt)` → `expiresAt <= now` then mark `expired`, return `OFFER_EXPIRED` | `acceptBookingOfferInternal` |

**Push TTL must be ≤ remaining offer lifetime**, preferably the remaining seconds until `offer.expiresAt` at send time (not a fresh 45s, and never FCM’s default ~4 weeks).

A stale notification cannot authorize accept: accept and GET offer both re-check DB pending + expiry. Push is a wake-up, not a capability token.

Note: dispatch retry timers are **in-process** (`dispatchTimers` Map). They are not Redis/Bull. That is an existing limitation; push does not fix or worsen it.

---

## 6. Multiple devices — recommendation

Existing session policy is **one active device**.

| Situation | Current behavior | Push recommendation |
|-----------|------------------|---------------------|
| One active device | Token (once stored) on that device | Send to that token only |
| Login on a new device | Old session deleted; `active_device_id` overwritten | Overwrite FCM token; do not send booking offers to the old token |
| Multiple registered tokens without policy change | Not supported | Do **not** fan-out to all historical tokens |
| Logged-out device | `clearSessionInfo` nulls device/session | Clear/disable token; send nothing |
| Old/stale FCM token still in DB | N/A today | On `UNREGISTERED` / invalid, delete token; never block dispatch |

**Recommendation: send only to the active session/device token.** Fan-out to all tokens would violate single-session enforcement and could wake a logged-out or replaced phone.

A separate future notification type (“session ended on another device”) is what the login TODO described. That is **not** a `booking_offer` and must not reuse offer payload fields.

---

## 7. Token lifecycle (design only — not implemented)

| Event | Recommended behavior |
|-------|----------------------|
| Register | Authenticated driver upserts token for `active_device_id`. Reject if session invalid. Do not accept a target `driverId`. |
| Refresh | Same endpoint; overwrite token for that device. Unique constraint: if token already belongs to another driver, detach it there then attach here (FCM tokens move between accounts). |
| Logout | Clear token(s) for that driver/device in the same logout path as `clearSessionInfo`. |
| Device replacement | Login already overwrites `active_device_id`; delete tokens whose `device_id` ≠ new active device. |
| Invalid / unregistered FCM | On send, if Admin SDK reports unregistered/invalid, delete that token. Log `pushFailureCode`. Continue dispatch. |
| Disabled notifications | No flag exists. Missing/null token = do not send. Optional later `enabled=false` without deleting the row. |
| Session invalidation | `trackDriverDevice` 401 already blocks token updates from the old device. |

Do not log raw FCM tokens.

---

## 8. Retry / failure

Socket + REST remain authoritative.

Push send failure **must not**:

- fail `createPendingBookingOffer`
- fail `emitToDriver`
- fail `startDispatch` / batch retry
- fail passenger `confirmBooking`

Recommended log fields (no tokens):

```
driverId
offerId
bookingId
pushAttempted     boolean
pushSent          boolean
pushFailureCode   e.g. UNREGISTERED | INVALID_ARGUMENT | UNAVAILABLE | TIMEOUT | NO_TOKEN
deviceId          optional app UUID, not FCM token
```

Retry: at most a short in-process retry for transient `UNAVAILABLE`/`TIMEOUT`. Do not retry `UNREGISTERED`. Do not build a durable push queue in this foundation unless dispatch timers are also moved off in-memory (out of scope).

`roomSize === 0` is **not** a reason to skip push; that is the primary case push exists to cover. Conversely, `roomSize > 0` is **not** a reason to skip push (app can still be backgrounded with a connected socket, or the OS can freeze the process). Duplicate delivery is handled by `offerId` (section 9).

---

## 9. Duplicate delivery / dedupe

The same offer can already arrive via:

1. Socket `booking:offer`
2. `GET /offers/pending` (and alias `GET /offers`)
3. `GET /offers/:offerId`
4. **Future:** FCM

### 9.1 Existing backend dedupe

| Layer | Mechanism |
|-------|-----------|
| DB | Unique index `idx_booking_offers_unique` on `(booking_id, driver_id)` — one offer row per driver per booking |
| Dispatch exclusion | `listExcludedDriverIdsForBooking` skips drivers in terminal offer statuses (`declined`, `expired`, `taken`, `cancelled`, `accepted`, legacy `rejected`/`superseded`) |
| Accept | Pending + unexpired check inside a booking row lock |
| Expire worker | Updates `WHERE status=pending AND expires_at <= now` (re-run is idempotent) |
| Client identity | `offerId` is a UUID primary key |

There is **no** backend FCM collapse-key or push idempotency table today.

Socket reconnect does **not** replay missed `booking:offer` events. Recovery is REST.

### 9.2 Recommended client + push idempotency

- **Key: `offerId`.** Ignore a second socket/FCM/REST copy of the same id.
- FCM `collapse_key` / Android `collapseKey`: `booking_offer:{offerId}` or `booking:{bookingId}` so OS-level duplicates collapse.
- Accept remains the race winner; other drivers get `booking:offer:cancelled` / `booking:taken`.

Do not invent a second offer id for push.

---

## 10. Env / deployment (required later — do not create credentials now)

| Item | Notes |
|------|--------|
| Firebase project | Same project as the Driver Android app’s `google-services.json` |
| Android package | Must match the Kotlin `applicationId` (not present in this backend repo) |
| Service account | Firebase Admin SDK JSON with Cloud Messaging permission |
| Credential injection | `GOOGLE_APPLICATION_CREDENTIALS` path **or** JSON in a secret store; never commit the file |
| Suggested env (later) | `FCM_ENABLED`, optional `FIREBASE_PROJECT_ID`, credential path/JSON; keep send no-op when disabled/missing so staging without Firebase still dispatches |
| SHA-1 / Play App Signing | Android app ↔ Firebase Android app registration (app-side) |
| Network | Outbound HTTPS to FCM from the API host |

This repo has **no** Android package name, **no** service-account path, and **no** Firebase project id to report.

Do not reuse `GOOGLE_MAPS_API_KEY` or Auth0 secrets.

---

## 11. Security

| Requirement | Current state | Later implementation rule |
|-------------|---------------|---------------------------|
| Driver registers token only for self | No register API yet | JWT `userId` / `auth0Id` → `drivers.id`; never take `driverId` from body |
| Token cannot attach to another driver id | N/A | Upsert by authenticated driver only; unique token constraint |
| Invalidated sessions cannot update token | `requireDriver` → `trackDriverDevice` already 401s old sessions | Put register route behind `requireDriver` |
| Push payload contains no secrets | N/A (no sender) | Identifiers only; no JWT, no passenger phone, no route, no signed URLs |
| Token secrecy | N/A | Treat FCM tokens as credentials: no logs, no admin list APIs without need |

Accept/GET already scope offers to the authenticated driver (`offer.driverId !== driverId` → not found). A leaked `offerId` in an FCM data payload is not sufficient to accept as another driver.

---

## 12. Tests needed later

No FCM tests exist. Closest coverage today:

- `tests/offer-timezone-delivery.test.ts` — TTL window, pending recovery statuses, `driver-{uuid}` rooms
- `tests/dispatch.contract.test.ts` — terminal offer statuses, dispatch config defaults
- `tests/driver-booking-route.test.ts` — pending-offer detail access for live dispatch
- `tests/cross-app-dispatch-fixes.test.ts` — dispatch/offer wiring

There are **no** tests for `trackDriverDevice` / single-session login.

Recommended later tests:

| Case | Assert |
|------|--------|
| Token registration | Authenticated driver stores token against self + active device |
| Token refresh | Second register overwrites; unique token moves off previous driver if needed |
| Unauthorized registration | 401 without JWT; 403 non-driver; body `driverId` ignored/rejected |
| Invalidated session | After login-elsewhere, old JWT cannot register/update token (`SESSION_INVALID`) |
| Logout | Token cleared; subsequent offer send is `NO_TOKEN` / skipped |
| Offer push | After `createPendingBookingOffer`, sender called once with `offerId`/`bookingId`/`type=booking_offer` |
| Push failure does not block dispatch | Mock FCM throw; socket emit still runs; offer row remains pending; next candidate still offered |
| Stale token cleanup | `UNREGISTERED` deletes token; dispatch still succeeds |
| Duplicate offer dedupe | Same `offerId` not inserted twice (unique index); sender not creating a second row |
| Expired offer | GET `/:offerId` 404; accept `OFFER_EXPIRED`; push TTL ≤ remaining lifetime |
| No token | Eligible driver without token still gets socket + REST offer |
| Payload hygiene | Sender never includes phone, route polyline, JWT, or fare |

---

## 13. Implementation sketch (do not implement yet)

Preserve this order:

1. Schema + register/refresh/logout token lifecycle behind `requireDriver`.
2. Firebase Admin init gated by `FCM_ENABLED` / credentials present.
3. `sendDriverOfferPush({ driverId, offerId, bookingId, expiresAt })` with TTL = remaining offer seconds.
4. Call it from `startDispatch` after successful `createPendingBookingOffer`, failure-isolated from socket emit.
5. Driver Android: FCM data listener → dedupe `offerId` → GET offer → existing accept UI.

Do not replace Socket.IO. Do not put full `buildOfferEventPayload` on the wire via FCM.

---

## Appendix A — Routes that already recover offers

| Method | Path | Handler |
|--------|------|---------|
| GET | `/api/v1/driver/bookings/offers/pending` | `listPendingOffersHandler` |
| GET | `/api/v1/driver/bookings/offers` | `listOffersHandler` (same list) |
| GET | `/api/v1/driver/bookings/offers/:offerId` | `getOfferHandler` → `getOfferDetailForDriver` |
| POST | `/api/v1/driver/bookings/:bookingId/accept` | `acceptOfferHandler` → `acceptBookingOffer` |

All use `requireDriver` (role + device tracking).

---

## Appendix B — Socket vs push

| Channel | When it works | Gap |
|---------|----------------|-----|
| Socket `booking:offer` | Driver connected and process running; room `driver-{uuid}` joined | Background / locked / killed / disconnected |
| REST pending / by id | App can make an authenticated HTTP call | Requires the app to wake and poll or be opened |
| FCM (missing) | OS can wake the app | Needs token + Firebase Admin |

---

**AUDIT COMPLETE — PUSH FOUNDATION MISSING:** no FCM/Firebase Admin dependency or init, no token table/column, no register route, no sender; offer delivery is Socket.IO `emitToDriver('booking:offer')` plus REST pending/detail recovery. Single-session `active_device_id` is the correct association point for a future FCM token.
