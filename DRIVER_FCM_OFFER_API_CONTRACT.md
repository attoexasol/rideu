# Driver FCM offer API contract

**Base:** `/api/v1/driver`  
**Auth:** Driver JWT (`Authorization: Bearer …`) plus existing `requireDriver` device/session tracking.  
**Header:** `X-Device-ID` should match `drivers.active_device_id`.

FCM is a **wake-up channel**. It does not replace Socket.IO `booking:offer` or REST recovery. It does not authorize Accept.

---

## Register token

`PUT /api/v1/driver/push-token`

```json
{
  "token": "<FCM registration token>"
}
```

Optional `deviceId` is accepted **only** when it matches both `X-Device-ID` (if sent) and the authenticated driver’s `active_device_id`.

Do **not** send `driverId`. Identity is the JWT. A body `driverId` is ignored/stripped and cannot attach the token to another driver.

**Success (200):**

```json
{
  "success": true,
  "data": {
    "deviceId": "app-device-uuid",
    "registeredAt": "2026-08-18T00:00:00.000Z"
  }
}
```

**Errors**

| HTTP | Code | When |
|------|------|------|
| 401 | `AUTH_FAILED` | Missing/invalid JWT |
| 401 | `SESSION_INVALID` | Logged in elsewhere / stale session |
| 403 | `UNAUTHORIZED` | Not a driver |
| 400 | `DEVICE_REQUIRED` | No active device/session on the driver row |
| 400 | `DEVICE_MISMATCH` | Header/body device id ≠ active device |
| 400 | validation | Missing `token` |

Call after login, and whenever FCM rotates the registration token.

---

## Unregister token

`DELETE /api/v1/driver/push-token`

Removes the push target for the authenticated active device. Call on logout when possible.

**Success (200):** `{ "success": true, "data": { "removed": true } }`

Backend logout (`POST /api/auth/logout`) and new-device login also drop old push targets even if this DELETE never runs.

---

## FCM data payload (Android)

High-priority **data-only** message. All values are strings.

```
type      = booking_offer
offerId   = <uuid>
bookingId = <uuid>
```

No passenger name/phone, pickup/dropoff, route, fare, JWT, or signed URLs.

Collapse key: `booking_offer:<offerId>`  
TTL: remaining offer lifetime (about 45 seconds), never FCM’s default weeks.

---

## Tap / resume hydration

After a data message (or app resume), fetch the authoritative offer:

`GET /api/v1/driver/bookings/offers/:offerId`

Also valid: `GET /api/v1/driver/bookings/offers/pending`

If the offer is expired, taken, cancelled, or not owned by this driver:

- `404` `OFFER_NOT_FOUND`
- Accept: `409` `OFFER_EXPIRED` or `BOOKING_ALREADY_TAKEN`

**Do not show Accept.** Dedupe UI by `offerId` (socket + FCM + REST may all deliver the same offer).

Accept remains:

`POST /api/v1/driver/bookings/:bookingId/accept`  
Body: `{ "offerId": "<uuid>" }`
