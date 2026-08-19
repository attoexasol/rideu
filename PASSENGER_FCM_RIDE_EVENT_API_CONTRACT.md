# Passenger FCM ride-event API contract

**Base:** `/api/v1/passenger`  
**Auth:** Passenger session JWT (`Authorization: Bearer …`) plus `requireCustomer`.  
**Header:** `X-Device-ID` **required** on register. Must match `customers.active_device_id`.

FCM is a **wake-up channel**. It does not replace Socket.IO ride events or REST recovery. It does not authorize booking actions.

Architecture:

1. Persist booking state
2. Existing Passenger Socket.IO event (unchanged names/payloads)
3. Isolated Passenger FCM (`notification` + `data`)
4. REST hydrate

FCM failure never rolls back booking state.

---

## Register token

`PUT /api/v1/passenger/push-token`

```json
{
  "token": "<FCM registration token>",
  "deviceId": "<same X-Device-ID>"
}
```

`deviceId` in the body is optional. If sent, it must match both `X-Device-ID` and `customers.active_device_id`.

Do **not** send `customerId`. Identity is the JWT. A body `customerId` is ignored and cannot attach the token to another customer.

**Success (200):**

```json
{
  "success": true,
  "data": {
    "deviceId": "app-device-uuid",
    "registeredAt": "2026-08-19T00:00:00.000Z"
  }
}
```

The FCM token is never returned.

**Errors**

| HTTP | Code | When |
|------|------|------|
| 401 | `AUTH_FAILED` | Missing/invalid JWT |
| 401 | `SESSION_INVALID` | JWT `sessionId` missing or ≠ `customers.active_session_id` |
| 403 | `UNAUTHORIZED` | Not a customer |
| 400 | `DEVICE_REQUIRED` | No active device/session, or missing `X-Device-ID` |
| 400 | `DEVICE_MISMATCH` | Header/body device id ≠ active device |
| 400 | validation | Missing `token` |

Call after login (with the same device UUID used at login), and whenever FCM rotates the registration token.

---

## Unregister token

`DELETE /api/v1/passenger/push-token`

Removes the push target for the authenticated active device. Call on logout when possible.

**Success (200):** `{ "success": true, "data": { "removed": true } }`

Backend logout (`POST /api/v1/passenger/auth/logout`), new-device login, and account deactivation also drop old push targets even if this DELETE never runs.

---

## FCM message (Android)

`notification` + `data` so the OS can show a tray notification when the Flutter app is backgrounded or terminated. All `data` values are strings.

```
type      = ride_event
bookingId = <uuid>
event     = driver_en_route | arrived | in_progress | completed | cancelled | no_drivers
cancelledBy = driver   (only when event = cancelled)
```

### Notification copy

| `event` | Title |
|---------|--------|
| `driver_en_route` | Your driver accepted the ride |
| `arrived` | Your driver has arrived |
| `in_progress` | Your ride has started |
| `completed` | Ride completed |
| `cancelled` | Ride cancelled |
| `no_drivers` | No driver found |

Body is generic: `Open the app to view ride details.`

No driver name/phone, plate, fare, pickup/dropoff, route, ETA, JWT, or video data.

### Android

- `android.notification.channelId` = `ride_updates` (Flutter must create this channel)
- Collapse key: `ride_event:<bookingId>`
- Do **not** invent `accepted`. Accept commits `driver_en_route`.

### TTL / priority

| `event` | Priority | TTL |
|---------|----------|-----|
| `driver_en_route` | high | 180s |
| `arrived` | high | 90s |
| `in_progress` | high | 120s |
| `cancelled` | high | 300s |
| `no_drivers` | normal | 600s |
| `completed` | normal | 1800s |

---

## When FCM is sent

After Socket.IO, never inside a booking transaction.

| Booking status | Socket event | FCM `event` |
|----------------|--------------|-------------|
| `driver_en_route` (accept) | `booking:accepted` | `driver_en_route` |
| `arrived` | `booking:status` | `arrived` |
| `in_progress` | `booking:status` | `in_progress` |
| `completed` | `booking:status` | `completed` |
| `cancelled` (driver) | `booking:status` | `cancelled` |
| `no_drivers` | `booking:expired` | `no_drivers` |

**Not sent:** searching batches, passenger self-cancel, `driver:location`, DVR/video events.

---

## Tap recovery

Hydrate authoritative state from REST. Do not treat FCM as source of truth.

**Active ride events** (`driver_en_route`, `arrived`, `in_progress`):

`GET /api/v1/passenger/bookings/active`

If the active snapshot is null or does not match `bookingId`, fall back to:

`GET /api/v1/passenger/bookings/:bookingId`

**Terminal events** (`completed`, `cancelled`, `no_drivers`):

`GET /api/v1/passenger/bookings/:bookingId`

---

## Client notes

- Same Firebase project as Driver is supported. Register this Android/iOS app in that project.
- Bind one stable device UUID at login (`deviceId`) and send the same value as `X-Device-ID` on `PUT /push-token`.
- Create Android channel `ride_updates` before background delivery.
- Deduplicate with `bookingId + event`. A later REST snapshot that already has that status (or a later lifecycle status) should ignore the push.
