# Backend Passenger FCM Ride-Event Audit

**Date:** 2026-08-19  
**Scope:** Backend only. Audit only. No code changes.  
**Goal:** Prepare Passenger FCM for ride lifecycle wake-up, copying Driver architecture conceptually (Socket.IO foreground, FCM background, REST authoritative).  
**Out of scope (untouched by this audit’s recommendations for implementation):** booking logic internals, dispatch matching, Driver FCM, Redis/location, DVR/video, Ride History, profiles, payments.

---

## Final classification

**D. BOTH_TOKEN_AND_EVENT_PATH_MISSING**

| Layer | Driver today | Passenger today |
|---|---|---|
| Firebase Admin SDK | Present (`src/services/fcmAdmin.service.ts`) | Reusable, not wired to Passenger |
| Token table | `driver_push_tokens` | **Missing** |
| Token APIs | `PUT/DELETE /api/v1/driver/push-token` | **Missing** |
| Send path | `notifyDriverOfPersistedOffer` → `scheduleDriverOfferPush` after persist | **Missing** |
| Socket.IO lifecycle events | `booking:offer` (Driver) | Present for Passenger (`booking:accepted`, `booking:status`, `booking:expired`, …) |
| REST recovery | Driver offers + active booking | Passenger `GET /bookings/active` and `GET /bookings/:bookingId` exist |

Firebase Admin can send to a Passenger app token **if** that app is in the same Firebase project. That is not Passenger push infrastructure. There is no Passenger token storage and no ride-event FCM send.

---

## 1. Passenger push foundation

### Search results (exact)

| Search | Result |
|---|---|
| `passenger_push_tokens` | **Does not exist** (schema, migrations, code) |
| `customer_push_tokens` | **Does not exist** |
| FCM token registration for customers | **None** |
| Passenger notification service | **None** |
| Firebase Admin usage for customers | **None** — Admin SDK is used only by Driver offer push |
| Passenger notification send helpers | **None** |
| Passenger device/session linkage for push | **None** — customers have session/device columns, unused for FCM |

### What does exist (Driver-only, not reusable as Passenger rows)

| Piece | Path | Role |
|---|---|---|
| Firebase Admin lazy init | `src/services/fcmAdmin.service.ts` | `sendFcmMessage(message)` is token-based and app-agnostic |
| Feature flag / credentials | `src/config/fcm.ts`, `.env.example` | `FCM_ENABLED`, `FIREBASE_PROJECT_ID`, service-account JSON/path |
| Driver token table | `src/db/schema/driver_push_tokens.ts`, migration `0024_driver_push_tokens` | `driver_id` + `device_id` unique; `fcm_token` unique |
| Driver token service | `src/services/driverPushToken.service.ts` | Register / unregister / logout invalidate / session replace |
| Driver send | `src/services/driverOfferNotify.service.ts` + `driverOfferPush.service.ts` | Socket first, then isolated FCM |
| Driver payload | `src/services/driverOfferPush.payload.ts` | Data-only: `type`, `offerId`, `bookingId` |
| Config naming | `FCM_COLLAPSE_KEY_PREFIX = 'booking_offer'`, `FCM_OFFER_PUSH_TYPE = 'booking_offer'` | Driver-offer-specific constants |

`BACKEND_PROFILE_ACCOUNT_AUDIT_REPORT.md` already recorded: “Passenger push tokens — **Do not exist**.” This audit confirms that is still true.

### Passenger device/session linkage (auth only)

`customers` has `active_session_id`, `active_device_id`, `active_device_info`. Login writes them. Logout clears them. Nothing stores or sends an FCM token against those fields.

**Current state:** Passenger push foundation is absent. Shared Firebase Admin is Driver-offer oriented in config and call sites.

---

## 2. Passenger session / device model

Source: `src/db/schema/customers.ts`, `src/services/passengerAuth.service.ts`, `src/repositories/customer.repository.ts`, `src/controllers/passengerAuth.controller.ts`, `src/middleware/auth.ts`.

### Identity fields

| Field | Column | Notes |
|---|---|---|
| Customer id | `customers.id` (UUID PK) | Issued in session JWT as `userId` |
| Auth0 id | `customers.auth0_id` | Unique; JWT `auth0Id` |
| Active session | `customers.active_session_id` | Generated at login: `sess_{timestamp}_{rand}` |
| Active device | `customers.active_device_id` | Optional login body `deviceId` |
| Active device info | `customers.active_device_info` | Optional login body `deviceInfo` |
| Last login | `customers.last_login_at` | Set on session update |

There is no separate `passengers` table. APIs are `/passenger/*`; persistence is `customers`.

### Session JWT behavior

`loginPassenger`:

1. Verifies Auth0 access token (`sub` → `auth0_id`).
2. Signs HS256 session JWT (`JWT_SECRET`, expiry `JWT_EXPIRES_IN` default `24h`) with `userId` = `customers.id`, `role`/`userType` = `customer`, `sessionId`.
3. Overwrites `active_session_id` / `active_device_id` / `active_device_info`.
4. Inserts a row via `sessionUtils.create` (`sessions` table).

`requireAuth` verifies JWT signature/expiry only. It does **not** compare `sessionId` to `customers.active_session_id`.

Driver has `src/middleware/device-tracking.ts` (single-session enforcement + takeover). **Passenger has no equivalent middleware.** An old Passenger JWT can remain valid after a new login until it expires, even though `active_session_id` was overwritten.

Logout (`POST /api/v1/passenger/auth/logout`):

- Deletes the presented token from `sessions` (`sessionUtils.deleteByToken`).
- Clears `active_session_id`, `active_device_id`, `active_device_info`.
- Does **not** delete all `sessions` rows for that customer.

Account deactivation (`deactivatePassengerAccount` in `src/services/profile.service.ts`):

- Sets `customers.status` deactivated.
- `clearCustomerSession`.
- `sessionUtils.deleteAllForUser(customerId)`.
- No push-token cleanup (nothing to clean).

### Single-device vs multi-device

**Intended model: single active device/session** (one `active_session_id` + one `active_device_id` on the customer row), same idea as Driver.

**Enforcement: weaker than Driver.**

- Login always overwrites the active session; it does not call a session-replaced hook.
- `deviceId` on `passengerLoginSchema` is **optional**. Login can store `null` device id.
- Subsequent Passenger APIs do not require `X-Device-Id` or matching `sessionId`.
- Relogin does not delete previous `sessions` rows.

### Recommended FCM token binding (do not implement yet)

Bind **customer + active device + active session**, copying Driver:

1. Table keyed by `customer_id` + `device_id` (unique).
2. Store `session_id` = `customers.active_session_id` at register time.
3. Register only when both `active_device_id` and `active_session_id` are present; reject otherwise (`DEVICE_REQUIRED`).
4. Require `X-Device-Id` (and optional body `deviceId`) to match `customers.active_device_id`.
5. Require request JWT `sessionId` to match `customers.active_session_id` (`SESSION_INVALID` if not).
6. On send: load enabled token for `active_device_id` **and** require `token.session_id === customers.active_session_id`. Stale-device tokens must not wake the previous phone.
7. On login device/session replace: delete other devices’ tokens; update `session_id` on the same device, or delete all if device changed (mirror `onDriverSessionReplaced`).
8. On logout / deactivate: delete all tokens for that customer.
9. **Do not** store tokens on `customers` as a single column. **Do not** reuse `driver_push_tokens` rows.

Passenger login should eventually require `deviceId` (today optional). Until then, FCM register cannot bind a real device.

---

## 3. Passenger token API

Driver equivalents:

- `PUT /api/v1/driver/push-token`
- `DELETE /api/v1/driver/push-token`

Mounted in `src/routes/v1/index.ts` as `router.use('/driver/push-token', driverPushRoutes)`.

**Passenger equivalents do not exist.**

- `src/routes/v1/passenger/index.ts` has bookings, places, maps, recording consent, share, live-video. No push routes.
- `src/routes/v1/passenger/auth.ts` has register/login/logout/me/forgot-password only.
- `src/routes/v1/passenger/profile.ts` is profile only.
- No `registerPassengerPushTokenSchema`.

**Do not reuse Driver token rows.** `driver_push_tokens.driver_id` FKs to `drivers.id`. A customer UUID cannot be stored there without breaking the FK and mixing apps.

Future (not implemented): `PUT/DELETE /api/v1/passenger/push-token` with `requireAuth` + `requireCustomer`, body `{ token, deviceId? }`, bind to `customers.id` + active device/session.

---

## 4. Ride event sources

Authoritative statuses live on `bookings.status`. Constant `BookingStatus.ACCEPTED = 'accepted'` exists and is listed in `ACTIVE_BOOKING_STATUSES`, but **the live accept path never persists `accepted`**. Accept writes `driver_en_route` immediately.

Driver PATCH allowed by validator: `driver_en_route | arrived | in_progress | completed`. Service transitions:

```
driver_en_route → arrived → in_progress → completed
```

No service transition **to** `driver_en_route` except accept. `driver_en_route` as a later PATCH from `accepted` does not happen because `accepted` is not the committed status.

### Event: accepted (driver took the offer)

| Item | Actual |
|---|---|
| Service/function | `acceptBookingOffer` in `src/services/dispatch.service.ts` |
| HTTP | `POST /api/v1/driver/bookings/:bookingId/accept` |
| Socket inbound (Driver) | `booking:accept` → same function |
| Transaction | `withTransactionTimeout`: lock booking `FOR UPDATE`; set `status = driver_en_route`, `assigned_driver_id`, `assigned_vehicle_id`, `accepted_at`, `driver_eta_minutes`; mark offer accepted; mark other pending offers `taken`; set driver `busy`; insert `booking_events` `eventType: 'accepted'` |
| Committed status | **`driver_en_route`** (not `accepted`) |
| Socket to Passenger | **After commit only:** `booking:accepted` with `status: 'driver_en_route'`, plus driver/vehicle/eta in the socket payload |
| State before notify | **Yes.** Comment in source: `// --- Side effects after commit (no row locks held)`. Tests in `tests/accept-cancel-concurrency.test.ts` assert `emitToCustomer` is outside the TX block |

### Event: driver_en_route (as a distinct later transition)

| Item | Actual |
|---|---|
| Service/function | **No separate persist.** Same commit as accept |
| Socket to Passenger | Same `booking:accepted` (`status: driver_en_route`) |
| Later PATCH | `updateBookingStatusByDriver` does not allow any current status → `driver_en_route` |

Treat “driver accepted” and “driver en route” as **one** backend event for FCM.

### Event: arrived

| Item | Actual |
|---|---|
| Service/function | `updateBookingStatusByDriver` in `src/services/booking.service.ts` |
| HTTP | `PATCH /api/v1/driver/bookings/:bookingId/status` body `{ status: "arrived" }` |
| Transaction | **No DB transaction.** Sequential: validate transition, `patch.arrivedAt = now`, `updateBooking`, `insertBookingEvent` (`status_change`, payload `{ from, to }`), then `emitBookingStatus` |
| Socket to Passenger | `booking:status` via `emitBookingStatus` — payload `{ bookingId, status, timestamp }` |
| State before notify | **Yes, if `updateBooking` succeeds.** Emit is after persist. Not wrapped in one TX with trip/video side effects (those apply to other statuses) |

### Event: in_progress (ride started)

| Item | Actual |
|---|---|
| Service/function | `updateBookingStatusByDriver` |
| HTTP | `PATCH .../status` `{ status: "in_progress" }` |
| Extra work before persist | Consent check (if video consent required); `createTripFromBooking`; `patch.startedAt`; `linkSessionToTrip` — **before** `updateBooking` |
| Transaction | **No wrapping TX** around trip create + booking update |
| Socket to Passenger | `booking:status` after `updateBooking` |
| State before notify | Emit runs only after `updateBooking`. If trip insert succeeded and booking update failed, booking status would not have changed and Passenger would not get `booking:status` (pre-existing booking-layer risk; out of scope to fix here) |

### Event: completed

| Item | Actual |
|---|---|
| Service/function | `updateBookingStatusByDriver` |
| HTTP | `PATCH .../status` `{ status: "completed" }` |
| Extra work before persist | `completedAt`, `paymentStatus = 'paid'`, complete linked trip, `finalizeRideVideoSessionsForBooking`, `releaseDriverAvailability` |
| Socket to Passenger | `booking:status` after `updateBooking` |
| State before notify | Emit after `updateBooking`. Video finalize runs **before** the booking row update |

### Event: cancelled (driver)

| Item | Actual |
|---|---|
| Service/function | `cancelBookingByDriver` |
| HTTP | `POST /api/v1/driver/bookings/:bookingId/cancel` |
| Allowed statuses | `driver_en_route`, `arrived` only |
| Transaction | **No wrapping TX.** `updateBooking` to `cancelled` + `cancelledAt` + `cancelledBy: 'driver'`, then event row, video finalize, release driver, then emit |
| Socket to Passenger | `booking:status` with `status: cancelled`, extra `{ reason, cancelledBy: 'driver' }` |
| State before notify | **Yes** relative to the booking row |

### Event: cancelled (passenger)

| Item | Actual |
|---|---|
| Service/function | `cancelBookingByCustomer` |
| HTTP | `POST /api/v1/passenger/bookings/:bookingId/cancel` |
| Socket inbound | `booking:cancel` (customer only) |
| Allowed statuses | `searching`, `offered`, `driver_en_route`, `arrived` |
| Transaction | `withTransactionTimeout`: lock, set `cancelled` / `cancelledBy: 'customer'`, cancel pending offers, set assigned driver `online`, insert `cancelled` event |
| After commit | `dispatch_stopped` event, `emitBookingStatus` (`cancelled`), clear dispatch timer, Redis driver online, `booking:offer:cancelled` to pending offer drivers, video finalize |
| State before notify | **Yes.** Tests assert `emitBookingStatus` is outside the TX block |

### Event: no_drivers

| Item | Actual |
|---|---|
| Service/function | `startDispatch` in `src/services/dispatch.service.ts` |
| Path A | `dispatchBatch + 1 > DISPATCH_MAX_BATCHES` → `updateBooking({ status: no_drivers })`, `insertBookingEvent` `no_drivers`, then emit |
| Path B | Batch has zero eligible drivers **and** `batch >= DISPATCH_MAX_BATCHES` → `updateBooking({ status: no_drivers, dispatchBatch })` then emit. **No `booking_events` row in this path** |
| Socket to Passenger | `booking:expired` with `{ bookingId, status: 'no_drivers', reason: 'no_drivers' }` — **not** `booking:status` |
| State before notify | **Yes** (`updateBooking` then emit) |
| Note | Constant `BookingStatus.EXPIRED = 'expired'` exists; this path persists **`no_drivers`**, not `expired` |

### Notification rule (future)

Send FCM only after the booking row (and related TX) has committed, at the same call sites that already emit Socket.IO. Never emit FCM inside a booking lock/transaction.

---

## 5. Existing Passenger-facing socket events

Names below are from source. Nothing invented.

Room: `customer-{userId}`. `emitToCustomer` uses `bookings.customer_id`. Passenger session JWT sets `userId` = `customers.id`, so rooms match when the app uses the session JWT.

Drivers are resolved Auth0 → DB UUID before join. **Customers are not.** An Auth0 access token without `userId` would join `customer-{auth0Id}` and miss emits. FCM must key off `customers.id`, not the socket room string.

### Outbound to Passenger (`emitToCustomer` or direct `io.to('customer-…')`)

| Event name | Emitter | Typical payload keys | Ride-lifecycle? |
|---|---|---|---|
| `booking:accepted` | `acceptBookingOffer` after commit | `bookingId`, `status` (`driver_en_route`), `driver` (id, name, **phone**, plateNumber), `vehicle`, `etaMinutes` | Yes — accept |
| `booking:status` | `emitBookingStatus` | `bookingId`, `status`, `timestamp`, optional extras | Yes — arrived / in_progress / completed / cancelled / searching revert |
| `booking:expired` | `startDispatch` no-drivers paths | `bookingId`, `status` (`no_drivers`), `reason` | Yes — no drivers |
| `booking:searching` | `startDispatch` after offering a batch; `revertOfferedBookingToSearching` | `bookingId`, `batch`, `status` (`searching`) | Searching progress, not a terminal ride event |
| `driver:location` | `emitDriverLocationToCustomer`; also `websocket/handlers/location.ts` | `driverId`, `bookingId`, lat/lng, heading, speed, accuracy, timestamp | High-frequency — **not** FCM |
| `recording:consent_updated` | `consentRecording` | bookingId, consent fields | DVR — out of scope |
| `recording:session_started` | `rideVideo.service` | DVR | Out of scope |
| `recording:session_paused` | `rideVideo.service` | DVR | Out of scope |
| `recording:session_resumed` | `rideVideo.service` | DVR | Out of scope |
| `recording:session_finalized` | `rideVideo.service` | DVR | Out of scope |
| `recording:session_available` | `rideVideo.service` (also after accept if video enabled) | DVR | Out of scope |
| `video:live-segment` | `emitLiveVideoSegment` | session/segment/url | High-frequency / DVR — **not** FCM |
| `authenticated` | socket connect | `userId`, `userType`, `role`, `rooms` | Connection, not ride |
| `pong` | heartbeat | `timestamp` | Connection |
| `error` | various handlers | code/message | Errors |
| `auth:status_response` | `auth:status` without callback | auth snapshot | Connection |

`revertOfferedBookingToSearching` also emits `booking:status` with `searching` after `booking:searching`.

### Inbound from Passenger

| Event | Handler | Effect |
|---|---|---|
| `authenticate` | `websocket/handlers/authentication.ts` | Re-emit `authenticated` |
| `auth:status` | same | Status |
| `ping` | `websocket/server.ts` | `pong` |
| `booking:cancel` | `websocket/handlers/booking.ts` | `cancelBookingByCustomer` |

Passenger does not receive `booking:offer` (Driver-only).

### Lifecycle → actual socket event

| Logical event | Persisted `bookings.status` | Passenger socket event |
|---|---|---|
| Driver accepted / en route | `driver_en_route` | **`booking:accepted`** |
| Driver arrived | `arrived` | **`booking:status`** (`status: arrived`) |
| Ride started | `in_progress` | **`booking:status`** (`status: in_progress`) |
| Ride completed | `completed` | **`booking:status`** (`status: completed`) |
| Driver cancelled | `cancelled` (`cancelled_by = driver`) | **`booking:status`** (`status: cancelled`, `cancelledBy: driver`) |
| Passenger cancelled | `cancelled` (`cancelled_by = customer`) | **`booking:status`** (`status: cancelled`) |
| No drivers | `no_drivers` | **`booking:expired`** (not `booking:status`) |
| Still searching / new batch | `searching` or `offered` | `booking:searching` (and sometimes `booking:status`) |
| Driver GPS | unchanged | `driver:location` |

FCM `type`/`event` strings should map to these **status values**, not to invented socket names.

---

## 6. Notification candidates

High-frequency location and DVR/live-segment: **DO NOT PUSH**.

| Ride state / user intent | Classification | Reason |
|---|---|---|
| Driver accepted (= committed `driver_en_route`) | **SHOULD PUSH** | App may be backgrounded during search; this is the critical wake-up |
| Driver en route as a second event | **DO NOT PUSH** | Not a separate persist/socket today; would duplicate accept |
| Driver arrived | **SHOULD PUSH** | Time-sensitive; passenger may be inside / phone locked |
| Ride started (`in_progress`) | **SHOULD PUSH** | State change while phone may be pocketed; hydrate via REST |
| Ride completed | **SHOULD PUSH** | Terminal; passenger may have left the foreground map |
| Driver cancelled | **SHOULD PUSH** | Passenger must be told without an open socket |
| Passenger cancellation acknowledgement | **OPTIONAL** | Passenger already got REST/socket success; useful only if cancel was sent then app backgrounded before response |
| No drivers found | **SHOULD PUSH** | Search may outlive the open app; socket is `booking:expired` |
| Searching / offered / new dispatch batch | **DO NOT PUSH** | Noisy; foreground already has `booking:searching` |
| Driver location | **DO NOT PUSH** | High frequency |
| Recording / live video events | **DO NOT PUSH** | Out of scope; not ride-state wake-up |

If a later change persists `accepted` then separately patches `driver_en_route`, reclassify then. Do not send two FCM messages for one accept commit.

---

## 7. Payload design (recommendation only)

Copy Driver: **data-only**, IDs only, no `notification` block. Passenger hydrates via REST.

### Recommended data fields (all strings; FCM data values must be strings)

```
type: "ride_event"
bookingId: "<uuid>"
event: "<status>"
```

`event` should be the committed `bookings.status` (or the no-drivers reason status):

| Push | `event` value |
|---|---|
| Accept / en route | `driver_en_route` |
| Arrived | `arrived` |
| Started | `in_progress` |
| Completed | `completed` |
| Cancelled (either actor) | `cancelled` |
| No drivers | `no_drivers` |

Optional later (still IDs only): `cancelledBy` = `driver` \| `customer` so the app can choose copy without extra PII.

### Do not put in FCM

- Phone numbers (today `booking:accepted` socket **does** include `driver.phone` — FCM must not copy that)
- Fare, addresses, polyline, ETA
- JWT / session tokens
- Driver name, plate, vehicle object
- FCM token, service-account material
- Full REST snapshot

Collapse key: `ride_event:{bookingId}` so a newer lifecycle push for the same booking can replace a stale queued one on Android. Do not reuse `booking_offer:{offerId}`.

Do not send through `buildAndroidOfferFcmMessage` / `driverOfferPush.service.ts`. New Passenger payload builder, same isolation pattern.

---

## 8. Tap recovery API

Existing Passenger routes (`src/routes/v1/passenger/index.ts`):

| Endpoint | Handler | What it returns |
|---|---|---|
| `GET /api/v1/passenger/bookings/active` | `activeBookingHandler` → `getPassengerActiveBooking` | Latest booking in `PASSENGER_ONGOING_BOOKING_STATUSES`, or success with `null` |
| `GET /api/v1/passenger/bookings/:bookingId` | `getBookingHandler` | Snapshot if `customerId` matches; 404/403 otherwise |
| `GET /api/v1/passenger/bookings` | Ride history list | Terminal history (`completed`, `cancelled`, `no_drivers`) |

Ongoing statuses for **active**: `searching`, `offered`, `scheduled`, `accepted`, `driver_en_route`, `arrived`, `in_progress`.

**Not** in active: `completed`, `cancelled`, `no_drivers`, `quoted`, `expired`.

### Authoritative recovery

| Tap from | Use |
|---|---|
| Active ride events (`driver_en_route`, `arrived`, `in_progress`) | **`GET /api/v1/passenger/bookings/active` first.** If `id` matches `bookingId` (or is the current ride), use it. If null/mismatch, **`GET /api/v1/passenger/bookings/:bookingId`** as fallback (race to terminal). |
| Completed / cancelled / no_drivers | **`GET /api/v1/passenger/bookings/:bookingId`.** Active will return null. History list is not required for tap. |

**No new endpoint is necessary.** Both routes already return `formatPassengerRideSnapshot` (id, status, timestamps, driver, fare, route, etc.). Rate limit `passengerRecoveryRateLimit` already wraps `/bookings/active`.

Do not treat FCM as state. Do not add a push-specific recovery URL.

---

## 9. Event delivery semantics

Driver pattern (copy conceptually):

```
persist offer/booking
  → emit Socket.IO (must not be skipped)
  → schedule FCM (fire-and-forget)
  → FCM failure never rolls back booking
```

Implementation today: `notifyDriverOfPersistedOffer` awaits `emitToDriver('booking:offer', …)` then `void import(...).then(scheduleDriverOfferPush)`. `scheduleDriverOfferPush` swallows errors as `driver.push.isolated_failure`.

Passenger future (do not implement yet):

```
persist booking status (TX or updateBooking already committed)
  → emit existing Passenger socket event (unchanged names/payloads)
  → schedulePassengerRidePush(...)  // isolated, never thrown into booking flow
  → FCM failure / FCM_DISABLED / NO_TOKEN → log only
```

Hook **after** existing emits, not inside TX:

| Event | Hook after |
|---|---|
| Accept | `emitToCustomer(..., 'booking:accepted', ...)` in `acceptBookingOffer` |
| Arrived / started / completed | `emitBookingStatus` in `updateBookingStatusByDriver` |
| Driver cancel | `emitBookingStatus` in `cancelBookingByDriver` |
| No drivers | `emitToCustomer(..., 'booking:expired', ...)` in `startDispatch` |
| Passenger cancel (if OPTIONAL is built) | `emitBookingStatus` in `cancelBookingByCustomer` |

Do not call FCM from `emitToCustomer` globally (that would also fire for `driver:location` and DVR). A dedicated scheduler per ride-state emit is required.

`emitBookingStatus` is shared with Driver/admin. Passenger FCM should filter: only the listed statuses, and only the customer target.

FCM must not replace Socket.IO. Foreground apps keep sockets. FCM is wake-up when backgrounded / locked / process dead.

---

## 10. Duplication / dedupe

### What exists

| Mechanism | Present? | Usable for FCM dedupe? |
|---|---|---|
| Push event id column | **No** | — |
| Booking row version / etag | **No** | — |
| `booking_events.id` (UUID) | Yes, per audit row | Possible but not exposed to clients; `status_change` is generic |
| Status timestamps | `accepted_at`, `arrived_at`, `started_at`, `completed_at`, `cancelled_at`, `updated_at` | Client can ignore a push if local snapshot already has that timestamp/status |
| `bookings.status` | Yes | Primary dedupe key with `bookingId` |
| Idempotency keys | Create/cancel booking only | Not per lifecycle push |
| Driver FCM collapse key | Per `offerId` | Not applicable to Passenger ride events |

`booking_events.eventType` values seen: `created`, `accepted`, `cancelled`, `status_change`, `no_drivers`, `dispatch_stopped`. Arrived/started/completed share `status_change` plus `{ from, to }`. No unique constraint on `(booking_id, event_type)`.

### Recommendation (do not implement yet)

Client + optional server collapse:

**Dedupe key:** `bookingId + event` where `event` = committed status (`driver_en_route`, `arrived`, `in_progress`, `completed`, `cancelled`, `no_drivers`).

- Android collapse key: `ride_event:{bookingId}` (latest wins while queued).
- Client: if REST snapshot `status` is already `event` or is later in the lifecycle, ignore the push.
- Do not require a new event-id column for v1.
- `cancelled` once per booking is enough; actor is recovered from REST `cancelledBy`.

---

## 11. TTL / priority

Driver offers use Android `priority: 'high'` and TTL = remaining offer seconds (capped by `DISPATCH_OFFER_TTL_SECONDS`). That is correct for a short-lived offer. **Do not mark every Passenger event high priority.**

Recommendations (Android `ttl` in milliseconds for firebase-admin):

| Event | Android priority | TTL | Rationale |
|---|---|---|---|
| `driver_en_route` (accept) | **high** | ~120–180 s | Must wake during search; stale accept is confusing if passenger already recovered via REST |
| `arrived` | **high** | ~60–90 s | Pickup window is short |
| `in_progress` | **high** | ~90–120 s | Ride start is time-sensitive; slightly less than arrived |
| `cancelled` (driver) | **high** | ~180–300 s | Must know the ride died; still bounded |
| `no_drivers` | default / **normal** | ~300–600 s | Important but not a curb-arrival |
| `completed` | default / **normal** | ~600–1800 s | Receipt-like; user will open the app later |
| Passenger cancel ack (if built) | normal | ~60 s | Optional; they already initiated cancel |

Do not use high priority for searching batches, location, or DVR.

If FCM `apns` is added later, keep the same split (time-sensitive vs informational). This backend is currently Android-shaped (Driver payload has `android` only).

---

## 12. Firebase project

### Can Driver Admin send to Passenger?

**Yes, if** the Passenger Android app is registered in the **same Firebase project** as the service account (`FIREBASE_PROJECT_ID` / service-account `project_id`). FCM `messaging.send({ token })` is per registration token, not per Kotlin module name.

If Passenger uses a **different** Firebase project, current Admin init cannot send to those tokens without a second `initializeApp` / named app. That is not in code today.

`.env.example` and `DRIVER_PUSH_FCM_BACKEND_CONFIG.md` describe **one** project aligned with the Driver Android app. Adding Passenger as a second Android app in that project is the intended reuse. Confirm package names with the mobile teams before implementation.

### Backend: app-agnostic vs Driver-specific

| Layer | Verdict |
|---|---|
| `sendFcmMessage` / `isFcmReady` / `isFcmEnabled` | **App-agnostic** (token + generic message) |
| Startup log `fcm.config.unavailable` (“offer push is a no-op”) | Wording is Driver-offer-centric; flag is global |
| `FCM_COLLAPSE_KEY_PREFIX`, `FCM_OFFER_PUSH_TYPE` | **Driver-specific** |
| `driverOfferPush.*`, `driver_push_tokens`, Driver routes | **Driver-specific** |
| Token lookup (`findEnabledPushTokenForDriverDevice`) | **Driver-specific** |

Reuse Admin + `FCM_ENABLED` + credentials. Do not route Passenger messages through the offer send service. Do not store Passenger tokens in `driver_push_tokens`.

---

## 13. Migration requirements

**A new table is required.** There is no Passenger/customer push table and no FCM column on `customers`.

Recommended name: **`passenger_push_tokens`**  
FK: `customer_id` → `customers.id` `ON DELETE CASCADE`  
(There is no `passengers` table. API prefix is passenger; row identity is customer.)

Mirror `driver_push_tokens` / migration `0024`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK default random | |
| `customer_id` | uuid NOT NULL FK customers | Not `driver_id` |
| `device_id` | varchar(255) NOT NULL | App UUID = `customers.active_device_id`, never the FCM token |
| `session_id` | varchar(255) | `customers.active_session_id` at register; checked on send |
| `fcm_token` | text NOT NULL | Unique index |
| `enabled` | boolean NOT NULL default true | |
| `created_at` | timestamp NOT NULL default now | |
| `updated_at` | timestamp NOT NULL default now | |
| `last_registered_at` | timestamp NOT NULL default now | |

Indexes (same shape as Driver):

- Unique `(customer_id, device_id)`
- Unique `fcm_token` (detach if the same token registers on another customer/device)
- Index `customer_id`
- Index `device_id`

Single-session policy: on upsert, delete other devices for that customer (Driver already deletes other driver devices).

Do not implement in this audit.

---

## 14. Logging

Safe structured logs (no token, no private key, no JWT, no phone/fare/route):

| Event | When | Fields |
|---|---|---|
| `passenger.push.registered` | Successful PUT | `customerId`, `deviceId` |
| `passenger.push.sent` | FCM accepted | `customerId`, `bookingId`, `event`, `deviceId`, `pushAttempted: true`, `pushSent: true` |
| `passenger.push.failed` | Send attempted but failed (or skipped with a code) | `customerId`, `bookingId`, `event`, `deviceId`, `pushAttempted`, `pushSent: false`, `pushFailureCode` |
| `passenger.push.invalidated` | Logout, deactivate, session replace, unregistered token cleanup | `customerId`, `deviceId?`, reason code |

Align with Driver: `driver.push.token_registered`, `driver.push.offer`, `driver.push.targets_invalidated`, `driver.push.isolated_failure`.

Suggested `pushFailureCode` values (same family as Driver): `FCM_DISABLED`, `FCM_UNAVAILABLE`, `NO_ACTIVE_DEVICE`, `NO_TOKEN`, `SESSION_MISMATCH`, permanent FCM codes, `ISOLATED_EXCEPTION`.

**Never log** `fcm_token`, service-account JSON, JWT, driver phone, addresses.

---

## 15. Tests

### Existing (relevant)

**Passenger booking state**

- `tests/accept-cancel-concurrency.test.ts` — accept/cancel TX vs emit; cancellation policy
- `tests/active-booking-cancellation.test.ts` — ongoing statuses, snapshot shape, cancel response
- `tests/dispatch.contract.test.ts` — Driver status transition matrix (`en_route → arrived → in_progress → completed`)
- `tests/ride-history.test.ts`, `tests/ride-history-routes.test.ts`, `tests/ride-history-service.test.ts` — history snapshots/timestamps
- `tests/booking-route.contract.test.ts` — route fill (not lifecycle push)

**Sockets**

- `tests/accept-cancel-concurrency.test.ts` — `emitToCustomer` after commit (source contract)
- `tests/driver-offer-notify.test.ts` — Driver `booking:offer` only
- No Jest suite that spins Socket.IO and asserts Passenger `booking:accepted` / `booking:status` / `booking:expired`

**Logout / session**

- `tests/profile-regression.contract.test.ts` — passenger logout clears `clearCustomerSession` / `deleteByToken`
- `tests/profile-login-guard.test.ts`, `tests/account-status.test.ts`, `tests/profile-deactivate.test.ts` — account/session; Driver deactivation mocks `invalidateDriverPushTargets`

**Firebase Admin / Driver push**

- `tests/driver-push-routes.test.ts`
- `tests/driver-push-token.service.test.ts` (including logout removes targets)
- `tests/driver-offer-push.service.test.ts` (mocks `fcmAdmin.service`)
- `tests/driver-offer-push.payload.test.ts` (data-only, TTL, error class)
- `tests/driver-push-dispatch.contract.test.ts` (persist then notify; Socket not replaced; routes; migration `0024`)

**Missing Passenger push tests (all of these)**

- `PUT/DELETE /api/v1/passenger/push-token` auth + validation
- Register binds `customer_id` + `active_device_id` + `active_session_id`
- Reject missing device/session; session/device mismatch
- Same FCM token cannot remain on another customer/device
- Logout / deactivate / session replace deletes or updates tokens
- Send only after persist; FCM throw does not change booking status
- No send for `driver:location` / searching batches / DVR
- Payload keys only `type`, `bookingId`, `event` (plus optional `cancelledBy`)
- TTL/priority per event class
- `NO_TOKEN` / `FCM_DISABLED` / invalid token cleanup
- Tap recovery: active vs `:bookingId` for terminal statuses
- Contract: Passenger routes must not write `driver_push_tokens`

---

## 16. Output summary

| # | Topic | Finding |
|---|---|---|
| 1 | Foundation | Firebase Admin exists for Driver offers. No Passenger token table, APIs, or send helpers |
| 2 | Session | Single-row active device/session on `customers`; JWT does not enforce it; `deviceId` optional on login |
| 3 | Token API | `PUT/DELETE /api/v1/passenger/push-token` **missing** |
| 4 | Event sources | Accept TX → `driver_en_route` + `booking:accepted`; later states via `updateBookingStatusByDriver` / cancels / `startDispatch` no-drivers |
| 5 | Sockets | Real names listed; accept ≠ `booking:status`; no-drivers = `booking:expired` |
| 6 | Candidates | Push accept, arrived, started, completed, driver cancel, no-drivers; optional passenger-cancel ack; never location |
| 7 | Payload | Data-only IDs: `type`, `bookingId`, `event` |
| 8 | Recovery | Existing `GET .../bookings/active` and `GET .../bookings/:bookingId`; no new route |
| 9 | Isolation | Copy Driver: persist → socket → schedule FCM; never roll back |
| 10 | Dedupe | No event ids/version; use `bookingId + status` + collapse key |
| 11 | TTL | High priority only for time-sensitive ride events |
| 12 | Firebase | Same project + second Android app can work; send API is token-agnostic; call sites are Driver-specific |
| 13 | Migration | Need `passenger_push_tokens` mirroring Driver columns with `customer_id` |
| 14 | Logs | `passenger.push.registered/sent/failed/invalidated`; never log tokens |
| 15 | Tests | Driver FCM well covered; Passenger push uncovered |

### Classification

**D. BOTH_TOKEN_AND_EVENT_PATH_MISSING**

Not A: no Passenger push foundation.  
Not B-only: event send path is also missing.  
Not C-only: token storage is also missing.  
Not E: cause is absence of Passenger token storage **and** absence of a post-commit FCM scheduler on ride-state emits, not a misconfigured existing path.

### Implementation order (recommendation only; not done here)

1. Table `passenger_push_tokens` + repository/service (do not touch `driver_push_tokens` rows).
2. `PUT/DELETE /api/v1/passenger/push-token` bound to active customer device/session.
3. Logout / login-replace / deactivate cleanup (mirror Driver hooks).
4. Isolated `schedulePassengerRidePush` after the socket emits listed in §9.
5. Tests listed in §15.

Booking, dispatch matching, Driver FCM, Redis/location, DVR, Ride History, profiles, and payments stay unchanged except adding **post-commit, failure-isolated** FCM calls at existing notify sites.
