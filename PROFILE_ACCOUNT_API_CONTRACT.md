# Profile / Account API Contract

**Base URL:** same as backend (`/api/v1`)  
**Auth:** backend session JWT (`Authorization: Bearer <token>`) from existing login routes  
**Envelope:** `{ "success": true, "data": ... }` or `{ "success": false, "error": { "code", "message", "details?" } }`

This phase does **not** implement email change, local password change, phone OTP, KYC, or hard delete.

Passwords remain Auth0-only. Passenger `POST /api/v1/passenger/auth/forgot-password` is unchanged. There is no driver self-service password API.

Logout is unchanged:

- Driver: `POST /api/auth/logout`
- Passenger: `POST /api/v1/passenger/auth/logout`

---

## Auth0 scopes (display name)

Name updates call Auth0 Management API **before** Postgres:

`PATCH https://{AUTH0_DOMAIN}/api/v2/users/{user_id}`

Body: `{ "name": "...", "user_metadata": { "name": "..." } }`

Required M2M scope: **`update:users`** (already listed in `AUTH0_SETUP.md`).

If Auth0 fails, the database name is not changed. Email is never sent to Auth0 from these endpoints.

---

## Driver

All driver profile routes use `requireAuth` + `requireDriver` + existing device/session tracking.

### `GET /api/v1/driver/profile`

**Auth:** driver (self)

**Response 200**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "John Smith",
    "email": "driver@example.com",
    "phone": "+8801712345678",
    "profileImageUrl": "/uploads/avatars/drivers/uuid.jpg",
    "accountStatus": "active",
    "createdAt": "2026-01-01T00:00:00.000Z",
    "vehicleSummary": {
      "id": "uuid",
      "make": "Toyota",
      "model": "Axio",
      "plateNumber": "DHA-1234",
      "color": "White"
    }
  }
}
```

`vehicleSummary` is **read-only**, from the current **active** `driver_vehicle_assignments` row (not legacy `drivers.vehicle_id`). `null` if none.

`email` is read-only. `phone` is a normalized display string or `null`.

Omitted on purpose: `auth0Id`, session/device, QR, cab identifiers, FCM, duty internals.

### `PATCH /api/v1/driver/profile`

**Auth:** driver (self)  
**Rate limit:** profile PATCH bucket (not video upload)

**Body** (strict, all fields optional):

```json
{
  "name": "John Smith",
  "phone": {
    "countryCode": "+880",
    "number": "1712345678"
  }
}
```

`phone: null` clears the optional phone.

Rejected keys (400 `VALIDATION_ERROR`): `email`, `status`, `accountStatus`, `driverId`, `userId`, `auth0Id`, `role`, `vehicleId`, `vehicleType`, cab/QR/session fields.

**Response 200:** same DTO as GET.

Name change: Auth0 first, then Postgres.

### `POST /api/v1/driver/profile/avatar`

**Auth:** driver (self)  
**Content-Type:** `multipart/form-data`  
**Field:** `avatar`  
**Types:** JPEG, PNG, WebP  
**Max size:** 5 MB  
**Rate limit:** 10 / hour / user

Magic-byte validated, re-encoded to JPEG (max 1280px, metadata stripped), stored under `uploads/avatars/drivers/` with a server UUID filename.

Replacing an avatar deletes the previous **managed** file only.

**Response 200**

```json
{
  "success": true,
  "data": {
    "profileImageUrl": "/uploads/avatars/drivers/uuid.jpg"
  }
}
```

If `API_PUBLIC_BASE_URL` or `VIDEO_API_PUBLIC_BASE_URL` is set, the URL is prefixed with that origin.

### `DELETE /api/v1/driver/profile/avatar`

**Auth:** driver (self)

Deletes the managed file (if any) and sets `profileImageUrl` to `null`.

```json
{
  "success": true,
  "data": { "profileImageUrl": null }
}
```

### `POST /api/v1/driver/profile/deactivate`

**Auth:** driver (self)  
**Rate limit:** very strict

```json
{ "confirm": true }
```

**Behavior**

- Sets `drivers.account_status = deactivated` (does **not** reuse duty `status`)
- Invalidates sessions, clears active device/session, removes FCM targets
- If no active ride: ends duty via existing `endDuty` (or sets offline if not on duty)
- If an active ride exists: duty/assignment left in place so the trip can finish; driver is ineligible for **new** dispatch
- Bookings, ride history, videos, audit rows are **not** deleted
- Auth0 user is **not** deleted

**Response 200**

```json
{
  "success": true,
  "data": { "accountStatus": "deactivated" }
}
```

Subsequent login: `403 ACCOUNT_DEACTIVATED`.

---

## Passenger

All passenger profile routes use `requireAuth` + `requireCustomer`. Identity is JWT `userId`.

### `GET /api/v1/passenger/profile`

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Rahim Ahmed",
    "email": "rahim@example.com",
    "phone": "+8801712345678",
    "profileImageUrl": null,
    "accountStatus": "active",
    "createdAt": "2026-01-01T00:00:00.000Z"
  }
}
```

`phone` is composed from `phone_country_code` + `phone_number`. Email is read-only.

### `PATCH /api/v1/passenger/profile`

Same strict body as driver. Phone is stored in the split columns; it is **not** marked verified and is **not** added to ride-offer payloads by this work.

Name: Auth0 first, then Postgres.

### `POST /api/v1/passenger/profile/avatar`

Same rules as driver; files live in `uploads/avatars/passengers/`.

### `DELETE /api/v1/passenger/profile/avatar`

Same as driver.

### `POST /api/v1/passenger/profile/deactivate`

```json
{ "confirm": true }
```

Sets `customers.status = deactivated`, clears session/device, deletes session rows. Does **not** cascade-delete bookings or video sessions. Auth0 user is not deleted.

Login afterwards: `403 ACCOUNT_DEACTIVATED`.

---

## Admin (read-only passengers)

**Auth:** `admin` or `super_admin`

### `GET /api/v1/admin/passengers`

Query: `page` (default 1), `limit` (default 20, max 100), `search` (name/email).

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "...",
      "email": "...",
      "phone": "+880...",
      "profileImageUrl": null,
      "accountStatus": "active",
      "createdAt": "..."
    }
  ],
  "metadata": {
    "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
  }
}
```

### `GET /api/v1/admin/passengers/:id`

Same passenger object in `data`. `404 NOT_FOUND` if missing.

Driver admin lists (`GET /api/admin/users`, `GET /api/drivers`) now also include `profileImageUrl` and `accountStatus`.

---

## Error codes

| Code | HTTP | When |
|---|---|---|
| `AUTH_FAILED` | 401 | Missing/invalid token |
| `UNAUTHORIZED` | 403 | Wrong role |
| `ACCOUNT_DEACTIVATED` | 403 | Login or duty/status while deactivated |
| `VALIDATION_ERROR` | 400 | Strict body, avatar type/size, `confirm` missing |
| `NOT_FOUND` | 404 | Driver/passenger row missing |
| `AUTH0_ERROR` | 502/503 | Name update Auth0 failure / Management API not configured |
| `RATE_LIMITED` | 429 | Profile PATCH / avatar / deactivate buckets |
| `SESSION_INVALID` | 401 | Existing driver device-tracking |

---

## Public avatar URLs

Served by existing `GET /uploads/...` static hosting, restricted in practice to `uploads/avatars/{drivers|passengers}/{uuid}.jpg`.

Do not use ride-video `private-media` or video upload middleware for avatars.
