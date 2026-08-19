# Backend Passenger FCM implementation report

**Date:** 2026-08-19  
**Scope:** Backend only. Passenger Flutter was not modified.  
**Final status:** `READY FOR PASSENGER FCM CLIENT INTEGRATION`

---

## What shipped

Passenger FCM is an **additional** wake-up path for ride lifecycle events. Existing delivery is unchanged:

1. Persist booking state
2. Existing Passenger Socket.IO event (same names and payloads)
3. Isolated FCM `notification` + `data` (`type`, `bookingId`, `event`)
4. REST hydrate: `GET /api/v1/passenger/bookings/active` and `GET /api/v1/passenger/bookings/:bookingId`

Booking matching/dispatch, Driver FCM, Redis/location, DVR/video, Ride History, profiles, and payments are not redesigned. Login still accepts optional `deviceId`; when provided it remains `customers.active_device_id`.

When `FCM_ENABLED=false` or Firebase credentials are missing, the API still starts. Push is a no-op. Socket + REST still work. FCM failure never rolls back booking state.

---

## Schema

Table `passenger_push_tokens` (migration `0026_passenger_push_tokens`, journal idx 25):

| Column | Notes |
|--------|--------|
| `id` | UUID PK |
| `customer_id` | FK → `customers.id` ON DELETE CASCADE |
| `device_id` | App device UUID (`customers.active_device_id`), **not** the FCM token |
| `session_id` | Matches `customers.active_session_id` |
| `fcm_token` | Unique |
| `enabled` | Default true |
| `created_at` / `updated_at` / `last_registered_at` | |

Unique `(customer_id, device_id)`. Indexes on `customer_id` and `device_id`.

`driver_push_tokens` is not reused.

Send target is the enabled row whose `device_id` and `session_id` match the customer’s **active** session.

---

## Token APIs

| Method | Path | Behavior |
|--------|------|----------|
| `PUT /api/v1/passenger/push-token` | Upsert for authenticated active device/session. Requires `X-Device-ID`. Same FCM token on another customer/device is detached. Other devices for this customer are removed (single-session). |
| `DELETE /api/v1/passenger/push-token` | Deletes the active-device row |

Errors: `DEVICE_REQUIRED`, `DEVICE_MISMATCH`, `SESSION_INVALID`. Body `customerId` is ignored.

---

## Session / logout

- Login: `onPassengerSessionReplaced` — same device rebinds `session_id`; different/missing device deletes all tokens.
- Logout: `invalidatePassengerPushTargets` after session clear; failure does not block logout.
- Deactivate: deletes all Passenger push targets; failure does not block deactivation.

---

## Ride-event send

`notifyPassengerOfRideEvent` → `schedulePassengerRidePush` → `sendPassengerRidePush` via existing `fcmAdmin.service`.

| Source | After socket | FCM `event` |
|--------|----------------|-------------|
| `acceptBookingOffer` | `booking:accepted` | `driver_en_route` |
| `updateBookingStatusByDriver` | `booking:status` | `arrived` / `in_progress` / `completed` |
| `cancelBookingByDriver` | `booking:status` | `cancelled` (`cancelledBy=driver`) |
| `startDispatch` no-drivers (both paths) | `booking:expired` | `no_drivers` |

Not sent: `accepted`, searching, passenger self-cancel, location, DVR.

Payload: notification tray copy + data IDs only. Channel `ride_updates`. Collapse key `ride_event:<bookingId>`. TTL/priority per contract.

---

## Logging

`passenger.push.registered`  
`passenger.push.sent`  
`passenger.push.failed`  
`passenger.push.invalidated`

Fields: `customerId`, `deviceId`, `bookingId`, `rideEvent`, `pushAttempted`, `pushSent`, `pushFailureCode`. Tokens, JWTs, phones, routes, and fares are not logged.

Diagnostics: `FCM_DISABLED`, `FCM_UNAVAILABLE`, `NO_ACTIVE_DEVICE`, `NO_TOKEN`, `SESSION_MISMATCH`, `UNREGISTERED`, `INVALID_ARGUMENT`, `SENDER_ID_MISMATCH`, `THIRD_PARTY_AUTH_ERROR`, `UNAVAILABLE`, `ISOLATED_EXCEPTION`. Permanent invalid tokens are deleted.

---

## Files

- `src/db/migrations/0026_passenger_push_tokens.sql`
- `src/db/schema/passenger_push_tokens.ts`
- `src/repositories/passengerPushToken.repository.ts`
- `src/services/passengerPushToken.service.ts`
- `src/services/passengerRidePush.payload.ts`
- `src/services/passengerRidePush.service.ts`
- `src/services/passengerRideNotify.service.ts`
- `src/controllers/passengerPush.controller.ts`
- `src/routes/v1/passenger/push.ts`
- `PASSENGER_FCM_RIDE_EVENT_API_CONTRACT.md`

---

## Tests

- `tests/passenger-push-token.service.test.ts`
- `tests/passenger-push-routes.test.ts`
- `tests/passenger-ride-push.payload.test.ts`
- `tests/passenger-ride-push.service.test.ts`
- `tests/passenger-push-dispatch.contract.test.ts`

Existing Driver FCM, dispatch, booking, DVR, history, and profile tests must remain green.

---

## Commands

```
npm run db:migrate
npm run build
npm test
```
