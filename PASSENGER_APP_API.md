# Passenger App API Reference (RYD U)

**Base URL:** `http://localhost:3000`  
**API prefix:** `/api/v1/passenger`  
**Map provider (passenger):** Google Maps (`GOOGLE_MAPS_API_KEY`) — places, geocoding, fare distance  
**Auth:** Auth0 email/password → backend session JWT (`role: customer`)

> Admin panel uses **Mapbox** on separate routes (`/api/locations`, etc.). Passenger app must **not** use those for maps.

---

## Authentication

### Flow

1. **Register** — `POST /api/v1/passenger/auth/register` (creates Auth0 user + `customers` row)
2. **Auth0 login** — passenger app signs in with email/password via Auth0 SDK → receives Auth0 `access_token`
3. **Backend login** — `POST /api/v1/passenger/auth/login` with `auth0Token` → returns backend **session JWT**
4. Use session JWT on all protected routes and WebSocket

### Headers (protected routes)

```http
Authorization: Bearer <session_jwt_from_login>
Content-Type: application/json
```

### Standard success envelope

```json
{
  "success": true,
  "data": { },
  "metadata": {
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 100,
      "totalPages": 5
    }
  }
}
```

### Standard error envelope

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Access denied. Required role(s): customer"
  }
}
```

### Required env vars (passenger)

| Variable | Purpose |
|----------|---------|
| `GOOGLE_MAPS_API_KEY` | Places autocomplete, reverse geocode, distance matrix |
| Auth0 Native app (Flutter) | Email/password login via `auth0.api.login` |
| Auth0 Management API | Registration + password reset |
| `JWT_SECRET` | Backend session tokens |
| `AUTH0_AUDIENCE` | `https://api.drivewize.com` — must match Flutter `audience` |

### Flutter / Auth0 setup (sign-in)

**Base URL must include port in dev:** `http://103.208.181.253:3000` (not port 80).

**Sign-in flow (same after register):**
```dart
final credentials = await auth0.api.login(
  usernameOrEmail: email,
  password: password,
  connectionOrRealm: 'Username-Password-Authentication',
  audience: 'https://api.drivewize.com', // required — must match backend AUTH0_AUDIENCE
);

// Send ACCESS token to backend (not id_token)
final response = await dio.post(
  '$baseUrl/api/v1/passenger/auth/login',
  data: {
    'auth0Token': credentials.accessToken,
    'deviceInfo': Platform.operatingSystem,
  },
);
```

**Auth0 Dashboard (Native app used by Flutter):**
1. Application type: **Native**
2. **Applications → APIs → DriveWize API** — identifier `https://api.drivewize.com`
3. Enable **Password** grant: *Application → Settings → Advanced → Grant Types → Password*
4. Connection: **Username-Password-Authentication** enabled for this app

**`validateClaims` log on Android (harmless warning):**
```
E/BaseAuthenticationRequest: The request is made without validating claims...
```
This is a known [auth0-flutter Android warning](https://github.com/auth0/auth0-flutter/issues/191). Login can still succeed — it does **not** mean sign-in failed. Check the next step (backend `/login` response).

**Optional:** Create Auth0 role `customer` in Dashboard → User Management → Roles (registration works without it; role is stored in `app_metadata`).

**Backend login** resolves the passenger by Auth0 `sub` in the `customers` table — a `customer` role claim inside the access token is **not required** if the user registered via `/auth/register`.

---

## 1. Auth

Base: `/api/v1/passenger/auth`

### `POST /register`

**Auth:** None

Creates a new passenger account (Auth0 + database).

**Request body:**
```json
{
  "email": "rahim@example.com",
  "password": "securepass123",
  "name": "Rahim Ahmed"
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Rahim Ahmed",
    "email": "rahim@example.com"
  }
}
```

**Errors:** `409` if email already exists, `400` on validation failure

---

### `POST /login`

**Auth:** None

Exchange Auth0 token for backend session JWT.

**Request body:**
```json
{
  "auth0Token": "<auth0_access_token>",
  "deviceId": "optional-device-uuid",
  "deviceInfo": "iPhone 15 / Android 14"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "token": "<backend_session_jwt>",
    "sessionId": "sess_...",
    "user": {
      "id": "uuid",
      "name": "Rahim Ahmed",
      "email": "rahim@example.com",
      "role": "customer"
    }
  }
}
```

**Errors:** `401` if Auth0 token invalid or role is not `customer`

---

### `POST /forgot-password`

**Auth:** None

Triggers Auth0 to send a **password reset email** (if the email exists in the `customers` table).

**Request body:**
```json
{
  "email": "rahim@example.com"
}
```

**Response 200 (email sent):**
```json
{
  "success": true,
  "data": {
    "message": "We've just sent you an email to reset your password."
  }
}
```

**Response 404 (no account in database):**
```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "No account found with this email address"
  }
}
```

**Response 404 (account in DB but missing in Auth0):**
```json
{
  "success": false,
  "error": {
    "code": "AUTH0_USER_NOT_FOUND",
    "message": "No Auth0 account found for this email on Username-Password-Authentication"
  }
}
```

**Response 502 (Auth0 rejected reset request):**
```json
{
  "success": false,
  "error": {
    "code": "RESET_FAILED",
    "message": "Auth0 failed to send password reset email"
  }
}
```

**Response 503 (server misconfiguration):**
```json
{
  "success": false,
  "error": {
    "code": "CONFIG_ERROR",
    "message": "Password reset is not configured. Set AUTH0_DOMAIN and AUTH0_PASSENGER_CLIENT_ID."
  }
}
```

> Returns an **error status** when reset cannot be completed. `200` only when Auth0 accepts the reset request for a verified account.

**Backend env (required for email to send):**
```env
AUTH0_DOMAIN=your-tenant.us.auth0.com
AUTH0_CLIENT_ID=<Regular Web / backend app Client ID with Database connection enabled>
# Optional override:
# AUTH0_PASSWORD_RESET_CLIENT_ID=<same or another app with Username-Password-Authentication>
```

Password reset uses **`AUTH0_CLIENT_ID`** (backend Regular Web app), **not** the Flutter Native client. The Native app often returns Auth0 `404` on `change_password` unless its Database connection is enabled.

**Auth0 Dashboard checklist:**
1. **Branding → Email Templates → Change Password** — template enabled
2. **Authentication → Database → Username-Password-Authentication** — enabled on the Native app
3. **Applications → [Native app] → Connections** — Username-Password-Authentication turned on
4. Optional: configure **custom SMTP** under Branding → Email Provider (Auth0 default email has daily limits)

**If API returns 200 but no email arrives:**
- Email must match a registered passenger exactly (case-insensitive)
- Check spam/junk folder
- Check server logs for `[forgot-password] Auth0 change_password OK` vs `Skipped — no customer`
- Verify `AUTH0_PASSENGER_CLIENT_ID` matches Flutter `Client ID`

---

### `GET /me`

**Auth:** `customer`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Rahim Ahmed",
    "email": "rahim@example.com",
    "role": "customer"
  }
}
```

---

### `POST /logout`

**Auth:** `customer`

Invalidates session token and clears active device session.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "message": "Logged out"
  }
}
```

---

## 2. Places & Maps (Google)

Base: `/api/v1/passenger`

All places endpoints require `customer` auth. Returns `503 CONFIG_ERROR` if `GOOGLE_MAPS_API_KEY` is not set.

### `GET /places/autocomplete`

Search addresses/places while planning a ride.

**Query:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `input` | string | Yes | Search text |
| `lat` | number | No | Bias results near this latitude |
| `lng` | number | No | Bias results near this longitude |
| `city` | string | No | Restrict to locality (e.g. `Dhaka`) |

**Example:** `GET /places/autocomplete?input=Gulshan&lat=23.81&lng=90.41&city=Dhaka`

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "placeId": "ChIJ...",
      "label": "Gulshan 1",
      "address": "Gulshan, Dhaka, Bangladesh",
      "latitude": 23.7808,
      "longitude": 90.4167
    }
  ]
}
```

---

### `GET /places/reverse-geocode`

Convert GPS coordinates to a formatted address (e.g. “current location” label).

**Query:**
| Param | Type | Required |
|-------|------|----------|
| `lat` | number | Yes |
| `lng` | number | Yes |

**Example:** `GET /places/reverse-geocode?lat=23.8103&lng=90.4125`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "address": "Dhaka, Bangladesh",
    "latitude": 23.8103,
    "longitude": 90.4125
  }
}
```

---

### `GET /places/suggestions`

Saved/recent places for the logged-in customer, optionally sorted by distance from current GPS.

**Query:**
| Param | Type | Required |
|-------|------|----------|
| `lat` | number | No |
| `lng` | number | No |

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "label": "Home",
      "address": "Banani, Dhaka",
      "latitude": 23.7936,
      "longitude": 90.4043,
      "placeId": "ChIJ...",
      "distanceKm": 2.3
    }
  ]
}
```

---

### `GET /pickup-spots`

Suggested pickup points near a chosen location (curbside / nearby landmarks).

**Query:**
| Param | Type | Required |
|-------|------|----------|
| `lat` | number | Yes |
| `lng` | number | Yes |
| `address` | string | Yes | Human-readable label for the area |

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "label": "Near Gulshan 1 - Spot 1",
      "address": "Gulshan 1, Dhaka",
      "latitude": 23.7808,
      "longitude": 90.4167
    }
  ]
}
```

---

### `POST /places`

Save or update a customer place (home, work, recent).

**Request body:**
```json
{
  "label": "Home",
  "address": "Banani, Dhaka, Bangladesh",
  "latitude": 23.7936,
  "longitude": 90.4043,
  "placeId": "ChIJ...",
  "city": "Dhaka",
  "placeType": "recent"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `label` | Yes | Display name |
| `address` | Yes | Full address string |
| `latitude` | Yes | |
| `longitude` | Yes | |
| `placeId` | No | Google place ID |
| `city` | No | |
| `placeType` | No | Default `recent` |

**Response 201:** Saved place row

---

## 3. Ride options & drivers

### `GET /services`

**Auth:** `customer`

Lists active ride types (CNG, Moto, Bike, etc.) and promotions. `rental` category is excluded.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "services": [
      {
        "id": "uuid",
        "code": "cng",
        "name": "CNG",
        "description": "Compressed natural gas auto",
        "iconKey": "cng",
        "capacity": 3,
        "baseFare": "30.00",
        "perKmRate": "15.00",
        "minFare": "50.00",
        "isActive": true,
        "sortOrder": 1
      }
    ],
    "promotions": [
      {
        "id": "uuid",
        "title": "First ride 10% off",
        "discountType": "percent",
        "discountValue": "10.00",
        "serviceCategoryId": "uuid",
        "validFrom": "2026-01-01T00:00:00.000Z",
        "validUntil": "2026-12-31T23:59:59.000Z",
        "isActive": true
      }
    ]
  }
}
```

---

### `GET /payment-methods`

**Auth:** `customer`

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "code": "cash",
      "name": "Cash",
      "isActive": true
    }
  ]
}
```

> MVP supports **cash only** (`paymentMethodCode: "cash"`).

---

### `GET /drivers/nearby`

**Auth:** `customer`

Online drivers near pickup who can serve the selected service category.

**Query:**
| Param | Type | Required |
|-------|------|----------|
| `lat` | number | Yes |
| `lng` | number | Yes |
| `serviceCategoryId` | uuid | Yes |

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "driverId": "uuid",
      "driverName": "Karim",
      "distanceKm": 1.2,
      "vehicleId": "uuid",
      "plateNumber": "DHK-1234"
    }
  ]
}
```

---

## 4. Bookings

Base: `/api/v1/passenger/bookings`

### Booking status values

| Status | Meaning |
|--------|---------|
| `quoted` | Quote only (internal) |
| `searching` | Finding drivers |
| `offered` | Offers sent to drivers |
| `accepted` | Driver assigned (legacy; transitions to `driver_en_route`) |
| `driver_en_route` | Driver heading to pickup |
| `arrived` | Driver at pickup |
| `in_progress` | Ride started (after recording consent) |
| `completed` | Ride finished |
| `cancelled` | Cancelled |
| `expired` | Search timed out |
| `no_drivers` | No drivers available |
| `scheduled` | Future pickup scheduled |

**Free cancellation** (passenger): `quoted`, `searching`, `offered`, `scheduled` — **not** after driver accepts.

---

### `POST /bookings/quote`

Get fare estimate for one or all service types.

**Request body:**
```json
{
  "pickup": {
    "latitude": 23.8103,
    "longitude": 90.4125,
    "address": "Gulshan 1, Dhaka"
  },
  "dropoff": {
    "latitude": 23.7936,
    "longitude": 90.4043,
    "address": "Banani, Dhaka"
  },
  "stops": [
    {
      "latitude": 23.80,
      "longitude": 90.41,
      "address": "Optional stop"
    }
  ],
  "serviceCategoryId": "uuid"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `pickup` | Yes | `latitude`, `longitude`; `address` optional |
| `dropoff` | Yes | Same as pickup |
| `stops` | No | Intermediate waypoints |
| `serviceCategoryId` | No | If omitted, returns quotes for **all** active services |

**Response 200 (single category — `serviceCategoryId` provided):**
```json
{
  "success": true,
  "data": {
    "serviceCategoryId": "uuid",
    "serviceCode": "cng",
    "serviceName": "CNG",
    "capacity": 3,
    "distanceKm": 4.2,
    "durationMin": 18,
    "originalFare": 93,
    "discountAmount": 9.3,
    "finalFare": 83.7,
    "promotionTitle": "First ride 10% off",
    "etaMinutes": 5,
    "promotionId": "uuid"
  }
}
```

**Response 200 (all categories — no `serviceCategoryId`):**
```json
{
  "success": true,
  "data": {
    "quotes": [
      {
        "serviceCategoryId": "uuid",
        "serviceCode": "cng",
        "serviceName": "CNG",
        "capacity": 3,
        "distanceKm": 4.2,
        "durationMin": 18,
        "originalFare": 93,
        "discountAmount": 9.3,
        "finalFare": 83.7,
        "promotionTitle": "First ride 10% off",
        "etaMinutes": 5
      }
    ]
  }
}
```

---

### `POST /bookings`

Confirm and start dispatch (instant) or schedule a ride.

**Request body:**
```json
{
  "serviceCategoryId": "uuid",
  "pickup": {
    "latitude": 23.8103,
    "longitude": 90.4125,
    "address": "Gulshan 1, Dhaka",
    "spotLabel": "Near Spot 1"
  },
  "dropoff": {
    "latitude": 23.7936,
    "longitude": 90.4043,
    "address": "Banani, Dhaka",
    "placeId": "ChIJ..."
  },
  "stops": [],
  "paymentMethodCode": "cash",
  "schedulingType": "instant",
  "scheduledPickupAt": "2026-06-26T08:00:00.000Z"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `serviceCategoryId` | Yes | From `/services` |
| `pickup.address` | Yes | |
| `pickup.spotLabel` | No | Curbside label |
| `dropoff.placeId` | No | Google place ID |
| `paymentMethodCode` | No | Default `cash` |
| `schedulingType` | No | `instant` (default) or `scheduled` |
| `scheduledPickupAt` | If scheduled | ISO datetime |

**Response 201:** Full booking row (status `searching` for instant, `scheduled` for future)

**Errors:** `400` if customer already has an active booking

---

### `GET /bookings`

**Auth:** `customer`

Ride history (paginated).

**Query:**
| Param | Type | Default |
|-------|------|---------|
| `page` | number | `1` |
| `limit` | number | `20` |

**Response 200:** Array of booking rows + `metadata.pagination`

---

### `GET /bookings/active`

**Auth:** `customer`

Current in-progress ride (`accepted`, `driver_en_route`, `arrived`, `in_progress`).

**Response 200 (active ride):**
```json
{
  "success": true,
  "data": {
    "booking": {
      "id": "uuid",
      "bookingNumber": "RYD-20260625-ABC1",
      "status": "driver_en_route",
      "pickupAddress": "Gulshan 1, Dhaka",
      "dropoffAddress": "Banani, Dhaka",
      "finalFare": "83.70",
      "assignedDriverId": "uuid",
      "driverEtaMinutes": 5,
      "recordingConsentedAt": null
    },
    "customerName": "Rahim Ahmed",
    "customerEmail": "rahim@example.com",
    "driverName": "Karim",
    "driverPhone": "+8801711111111",
    "vehiclePlate": "DHK-1234",
    "serviceName": "CNG",
    "serviceCode": "cng"
  }
}
```

**Response 200 (no active ride):**
```json
{
  "success": true,
  "data": null
}
```

---

### `GET /bookings/:bookingId`

**Auth:** `customer` (own bookings only)

Same shape as active booking detail.

**Errors:** `404` not found, `403` if not your booking

---

### `POST /bookings/:bookingId/cancel`

**Auth:** `customer`

Cancel before driver accepts.

**Request body (optional):**
```json
{
  "reason": "Changed plans"
}
```

**Response 200:** Updated booking row (`status: cancelled`)

**Errors:** `400` if cancellation not allowed (after driver acceptance)

---

### `POST /bookings/:bookingId/consent-recording`

**Auth:** `customer`

Passenger consents to in-ride video recording. Required before driver can start the ride (`in_progress`).

Allowed when status is `accepted`, `driver_en_route`, or `arrived`.

**Response 200:** Updated booking with `recordingConsentedAt` set

**Errors:** `400` if wrong status or access denied

---

### `GET /bookings/:bookingId/share`

**Auth:** `customer`

Get share token for “share my ride” feature.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "shareToken": "abc123...",
    "shareUrl": "/api/v1/passenger/bookings/share/abc123..."
  }
}
```

> **Note:** `shareUrl` path is returned for future use. A public `GET /bookings/share/:token` route is **not implemented yet** on the backend.

---

### `GET /bookings/:bookingId/live-video`

**Auth:** `customer`

List live video session and segments for an active or recent ride.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "session": {
      "id": "uuid",
      "tripId": "uuid",
      "bookingId": "uuid",
      "driverId": "uuid",
      "status": "active",
      "startedAt": "2026-06-25T12:00:00.000Z"
    },
    "segments": [
      {
        "id": "uuid",
        "sessionId": "uuid",
        "segmentIndex": 0,
        "videoUrl": "/uploads/videos/live/trip-uuid/segment-0.webm",
        "mimeType": "video/webm",
        "durationSeconds": 10
      }
    ]
  }
}
```

Video files are served from the backend uploads path when using local storage.

---

## 5. WebSocket (real-time)

**URL:** `ws://localhost:3000` (Socket.IO)  
**Auth:** Pass session JWT in handshake:

```javascript
const socket = io('http://localhost:3000', {
  auth: { token: '<session_jwt_from_login>' }
});
```

On connect, server joins customer to room `customer-{customerId}` and emits:

#### `authenticated`
```json
{
  "userId": "uuid",
  "userType": "customer",
  "role": "customer",
  "rooms": ["customer-uuid", "..."]
}
```

#### Heartbeat
- Client → `ping`
- Server → `pong` `{ "timestamp": "..." }`

---

### Events the passenger app **receives**

#### `booking:searching`
Dispatch batch started.
```json
{
  "bookingId": "uuid",
  "batch": 1
}
```

#### `booking:accepted`
Driver accepted the ride.
```json
{
  "bookingId": "uuid",
  "driver": {
    "id": "uuid",
    "name": "Karim",
    "phone": "+8801711111111",
    "plateNumber": "DHK-1234"
  },
  "etaMinutes": 5
}
```

#### `booking:status`
Any status change during the ride.
```json
{
  "bookingId": "uuid",
  "status": "arrived",
  "timestamp": "2026-06-25T12:05:00.000Z"
}
```

Statuses: `driver_en_route`, `arrived`, `in_progress`, `completed`, `cancelled`, etc.

#### `booking:expired`
No drivers found or search exhausted.
```json
{
  "bookingId": "uuid",
  "reason": "no_drivers"
}
```

#### `driver:location`
Live driver GPS during active ride (**raw GPS**, Google Maps — not Mapbox-snapped).
```json
{
  "driverId": "uuid",
  "bookingId": "uuid",
  "latitude": 23.8103,
  "longitude": 90.4125,
  "heading": 180,
  "timestamp": "2026-06-25T12:01:00.000Z"
}
```

#### `video:live-segment`
New live video chunk available during ride.
```json
{
  "bookingId": "uuid",
  "sessionId": "uuid",
  "segmentIndex": 0,
  "videoUrl": "/uploads/videos/live/...",
  "timestamp": "2026-06-25T12:10:00.000Z"
}
```

---

### Events the passenger app **can send**

#### `booking:cancel`
Cancel via WebSocket (alternative to REST).

**Payload:**
```json
{
  "bookingId": "uuid",
  "reason": "optional"
}
```

**Ack callback:**
```json
{ "success": true }
```

---

## 6. Typical ride flow (API sequence)

```
1. POST /auth/register          → create account
2. Auth0 SDK login              → auth0Token
3. POST /auth/login             → session JWT
4. GET  /places/autocomplete    → pick pickup & dropoff
5. POST /bookings/quote         → show CNG/Moto/Bike prices
6. POST /bookings               → confirm ride → status: searching
7. WebSocket booking:accepted   → show driver card
8. WebSocket driver:location    → track on Google Map
9. POST /bookings/:id/consent-recording  → before ride starts
10. WebSocket booking:status    → arrived → in_progress → completed
11. GET /bookings/:id/live-video (optional) → watch live segments
```

---

## 7. Endpoint summary

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/v1/passenger/auth/register` | No | Register |
| `POST` | `/api/v1/passenger/auth/login` | No | Get session JWT |
| `POST` | `/api/v1/passenger/auth/forgot-password` | No | Password reset |
| `GET` | `/api/v1/passenger/auth/me` | customer | Profile |
| `POST` | `/api/v1/passenger/auth/logout` | customer | Logout |
| `GET` | `/api/v1/passenger/places/autocomplete` | customer | Place search |
| `GET` | `/api/v1/passenger/places/reverse-geocode` | customer | Coords → address |
| `GET` | `/api/v1/passenger/places/suggestions` | customer | Saved places |
| `GET` | `/api/v1/passenger/pickup-spots` | customer | Pickup spots |
| `POST` | `/api/v1/passenger/places` | customer | Save place |
| `GET` | `/api/v1/passenger/services` | customer | Ride types + promos |
| `GET` | `/api/v1/passenger/payment-methods` | customer | Payment options |
| `GET` | `/api/v1/passenger/drivers/nearby` | customer | Nearby drivers |
| `POST` | `/api/v1/passenger/bookings/quote` | customer | Fare quote |
| `POST` | `/api/v1/passenger/bookings` | customer | Book ride |
| `GET` | `/api/v1/passenger/bookings` | customer | History |
| `GET` | `/api/v1/passenger/bookings/active` | customer | Current ride |
| `GET` | `/api/v1/passenger/bookings/:bookingId` | customer | Ride detail |
| `POST` | `/api/v1/passenger/bookings/:bookingId/cancel` | customer | Cancel |
| `POST` | `/api/v1/passenger/bookings/:bookingId/consent-recording` | customer | Video consent |
| `GET` | `/api/v1/passenger/bookings/:bookingId/share` | customer | Share token |
| `GET` | `/api/v1/passenger/bookings/:bookingId/live-video` | customer | Live video segments |

---

## 8. Related routes (not passenger-specific)

These exist on the backend but are used by **drivers** or **admins**, not the passenger app:

| Route | Used by |
|-------|---------|
| `POST /api/locations` | Driver GPS upload |
| `POST /api/videos/live-chunk` | Driver live video upload |
| `/api/v1/driver/bookings/*` | Driver accept/status updates |
| `/api/locations/*` | Admin Mapbox fleet map |

Passenger tracking uses WebSocket `driver:location` and Google Maps APIs only.
