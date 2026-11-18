# Passenger Backend API — Complete Reference

**Base URL:** `http://localhost:3000`  
**API prefix:** `/api/v1/passenger`  
**Auth prefix:** `/api/v1/passenger/auth`  
**Map provider (passenger):** Google Maps (server-side only) — Places Autocomplete/Details, Geocoding, **Routes API v2** (`computeRoutes`)  
**Currency:** BDT — all fares rounded to 2 decimal places  
**WebSocket:** Same host as HTTP (`ws://localhost:3000` or `wss://` in production)

> **Important:** Fares and route previews use **Google Routes API v2**, not Distance Matrix. Autocomplete returns `latitude: null` and `longitude: null`; coordinates are resolved via Place Details. Pickup spots returns only the selected location (no synthetic/fake spots).

---

## Response Envelope

All REST endpoints return a standardized JSON envelope:

**Success:**
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

**Error:**
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {}
  }
}
```

---

## Common Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Protected routes | `Bearer <session_jwt>` from `POST /auth/login` |
| `Content-Type` | POST/PATCH bodies | `application/json` |
| `Idempotency-Key` | `POST /bookings` (recommended) | Unique string per booking attempt; prevents duplicate bookings on retry |

---

## Rate Limiting Summary

| Scope | Window | Max | Error Code | Applies To |
|-------|--------|-----|------------|------------|
| Global | 15 min (`RATE_LIMIT_WINDOW_MS=900000`) | 100 (`RATE_LIMIT_MAX_REQUESTS`) | `RATE_LIMIT_EXCEEDED` | All HTTP routes |
| Passenger maps | 60 s (`PASSENGER_MAPS_RATE_LIMIT_WINDOW_MS=60000`) | 60 (`PASSENGER_MAPS_RATE_LIMIT_MAX`) | `RATE_LIMITED` | Autocomplete, place details, reverse geocode, pickup spots, route preview, booking quote |

Maps rate limit is keyed per authenticated customer (`customer:{userId}`).

---

## Cache Behavior Summary

| Endpoint / Operation | Cached | TTL | Key Pattern |
|---------------------|--------|-----|-------------|
| Place details | Yes (Redis) | 300 s default | `place-details:{placeId}` |
| Reverse geocode | Yes (Redis) | 300 s default | `reverse-geocode:{lat}:{lng}` (coords rounded to 5 decimals) |
| Route compute (preview + quote) | Yes (Redis) | 300 s default | `route:{pickup}:{dropoff}:{stops}:{travelMode}:{routePreference}` |
| Autocomplete | No | — | — |
| Saved places / bookings | No | — | — |

---

# Passenger Authentication APIs

Base path: `/api/v1/passenger/auth`

---

## POST `/api/v1/passenger/auth/register`

| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **Full path** | `/api/v1/passenger/auth/register` |
| **Purpose** | Register a new passenger account (creates Auth0 user + `customers` row) |
| **Authentication** | None |
| **Required role** | None |
| **Headers** | `Content-Type: application/json` |
| **Body params** | See validation below |
| **Rate limit** | Global (`RATE_LIMIT_EXCEEDED`) |
| **Cache** | None |

### Validation Rules

| Field | Type | Rules |
|-------|------|-------|
| `email` | string | Valid email; trimmed and lowercased |
| `password` | string | Min 8 characters |
| `name` | string | Min 1 character |

### Success Response — `201 Created`

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "John Doe",
    "email": "john@example.com"
  }
}
```

### Error Responses

| HTTP | Code | When |
|------|------|------|
| 400 | `REGISTRATION_FAILED` | Validation failure or Auth0 not configured |
| 409 | `REGISTRATION_FAILED` | Email already exists |
| 429 | `RATE_LIMIT_EXCEEDED` | Global rate limit |

### Example cURL

```bash
curl -X POST http://localhost:3000/api/v1/passenger/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"john@example.com","password":"securepass1","name":"John Doe"}'
```

### Notes

- Requires Auth0 Management API to be configured server-side.
- After register, the Flutter app must sign in via Auth0 SDK, then call `/auth/login`.

---

## POST `/api/v1/passenger/auth/login`

| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **Full path** | `/api/v1/passenger/auth/login` |
| **Purpose** | Exchange Auth0 access token for backend session JWT |
| **Authentication** | None |
| **Required role** | None |
| **Headers** | `Content-Type: application/json` |
| **Body params** | See validation below |
| **Rate limit** | Global |
| **Cache** | None |

### Validation Rules

| Field | Type | Rules |
|-------|------|-------|
| `auth0Token` | string | Required — Auth0 **access_token** (not id_token) |
| `deviceId` | string | Optional |
| `deviceInfo` | string | Optional |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "token": "<access_token>",
    "sessionId": "sess_...",
    "user": {
      "id": "uuid",
      "name": "John Doe",
      "email": "john@example.com",
      "role": "customer"
    }
  }
}
```

### Error Responses

| HTTP | Code | When |
|------|------|------|
| 401 | `AUTH_FAILED` | Invalid token, wrong audience, customer not found, wrong account type |
| 400 | `VALIDATION_ERROR` | Missing/invalid body |
| 429 | `RATE_LIMIT_EXCEEDED` | Global rate limit |

### Example cURL

```bash
curl -X POST http://localhost:3000/api/v1/passenger/auth/login \
  -H "Content-Type: application/json" \
  -d '{"auth0Token":"<auth0_access_token>","deviceInfo":"android"}'
```

### Notes

- Flutter must request audience matching `AUTH0_AUDIENCE` (e.g. `https://api.example.com`).
- Session JWT expires in 24 h by default (`JWT_EXPIRES_IN`).
- Use returned `token` for all protected REST and WebSocket connections.

---

## POST `/api/v1/passenger/auth/forgot-password`

| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **Full path** | `/api/v1/passenger/auth/forgot-password` |
| **Purpose** | Trigger Auth0 password reset email |
| **Authentication** | None |
| **Required role** | None |
| **Headers** | `Content-Type: application/json` |
| **Body params** | `email` (valid email, trimmed/lowercased) |
| **Rate limit** | Global |
| **Cache** | None |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "message": "Password reset instructions have been sent to your email. Check inbox and spam folder."
  }
}
```

### Error Responses

| HTTP | Code | When |
|------|------|------|
| 404 | `NOT_FOUND` | No customer with that email |
| 503 | `CONFIG_ERROR` | Auth0 password reset not configured |
| 500 | `RESET_FAILED` | Unexpected failure |
| 400 | `VALIDATION_ERROR` | Invalid email |

### Example cURL

```bash
curl -X POST http://localhost:3000/api/v1/passenger/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"john@example.com"}'
```

### Notes

- Does not reveal whether email exists in some flows; implementation returns 404 if customer not in DB.

---

## POST `/api/v1/passenger/auth/logout`

| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **Full path** | `/api/v1/passenger/auth/logout` |
| **Purpose** | Invalidate session token and clear active device session |
| **Authentication** | Bearer session JWT |
| **Required role** | `customer` |
| **Headers** | `Authorization: Bearer <token>` |
| **Body params** | None |
| **Rate limit** | Global |
| **Cache** | None |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": { "message": "Logged out" }
}
```

### Error Responses

| HTTP | Code | When |
|------|------|------|
| 401 | `AUTH_FAILED` | Missing/invalid token |
| 403 | `UNAUTHORIZED` | Role is not `customer` |

### Example cURL

```bash
curl -X POST http://localhost:3000/api/v1/passenger/auth/logout \
  -H "Authorization: Bearer <session_jwt>"
```

---

## GET `/api/v1/passenger/auth/me`

| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Full path** | `/api/v1/passenger/auth/me` |
| **Purpose** | Get current authenticated passenger profile |
| **Authentication** | Bearer session JWT |
| **Required role** | `customer` |
| **Headers** | `Authorization: Bearer <token>` |
| **Query params** | None |
| **Rate limit** | Global |
| **Cache** | None |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "customer"
  }
}
```

### Error Responses

| HTTP | Code | When |
|------|------|------|
| 404 | `NOT_FOUND` | Customer record missing |
| 401 | `AUTH_FAILED` | Invalid token |
| 403 | `UNAUTHORIZED` | Not a customer |

### Example cURL

```bash
curl http://localhost:3000/api/v1/passenger/auth/me \
  -H "Authorization: Bearer <session_jwt>"
```

---

# Passenger Places APIs

Base path: `/api/v1/passenger`

---

## GET `/api/v1/passenger/places/autocomplete`

| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Full path** | `/api/v1/passenger/places/autocomplete` |
| **Purpose** | Search place suggestions via Google Places Autocomplete (no coordinates in results) |
| **Authentication** | Bearer session JWT |
| **Required role** | `customer` |
| **Headers** | `Authorization: Bearer <token>` |
| **Query params** | See validation below |
| **Rate limit** | Global + maps (`RATE_LIMITED`) |
| **Cache** | None |

### Validation Rules (Query)

| Param | Type | Rules |
|-------|------|-------|
| `input` | string | Required; 2–200 chars (trimmed) |
| `lat` | number | Optional; -90 to 90 (bias) |
| `lng` | number | Optional; -180 to 180 (bias) |
| `city` | string | Optional; max 100 chars |
| `country` | string | Optional; 2-char ISO code (default: `BD`) |
| `sessionToken` | string | Optional; max 256 — use for billing session grouping |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "placeId": "ChIJ...",
      "label": "Gulshan 1",
      "secondaryText": "Dhaka, Bangladesh",
      "address": "Gulshan 1, Dhaka, Bangladesh",
      "latitude": null,
      "longitude": null,
      "types": ["sublocality", "political"],
      "city": null,
      "country": null,
      "countryCode": null
    }
  ]
}
```

### Error Responses

| HTTP | Code | When |
|------|------|------|
| 400 | `VALIDATION_ERROR` | Invalid query |
| 503 | `GOOGLE_MAPS_CONFIG_ERROR` | `GOOGLE_MAPS_API_KEY` not set |
| 503 | `GOOGLE_MAPS_TIMEOUT` | Provider timeout |
| 503 | `GOOGLE_MAPS_QUOTA_EXCEEDED` | Quota exceeded |
| 503 | `GOOGLE_MAPS_PROVIDER_ERROR` | Other provider error |
| 404 | `PLACE_NOT_FOUND` | Google returned zero/not found |
| 429 | `RATE_LIMITED` | Maps rate limit |
| 401/403 | `AUTH_FAILED` / `UNAUTHORIZED` | Auth failure |

### Example cURL

```bash
curl "http://localhost:3000/api/v1/passenger/places/autocomplete?input=gulshan&lat=23.78&lng=90.41&sessionToken=abc123" \
  -H "Authorization: Bearer <session_jwt>"
```

### Notes

- **`latitude` and `longitude` are always `null`** in autocomplete results. Call `/places/details` to resolve coordinates.
- Max 8 results (`GOOGLE_MAPS_AUTOCOMPLETE_MAX_RESULTS`).
- Filtered to Bangladesh by default (`GOOGLE_MAPS_DEFAULT_COUNTRY=BD`).

---

## GET `/api/v1/passenger/places/details`

| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Full path** | `/api/v1/passenger/places/details` |
| **Purpose** | Resolve a `placeId` to full address and coordinates |
| **Authentication** | Bearer session JWT |
| **Required role** | `customer` |
| **Headers** | `Authorization: Bearer <token>` |
| **Query params** | `placeId` (required), `sessionToken` (optional) |
| **Rate limit** | Global + maps |
| **Cache** | Redis, 300 s TTL |

### Validation Rules (Query)

| Param | Type | Rules |
|-------|------|-------|
| `placeId` | string | Required; 1–512 chars |
| `sessionToken` | string | Optional; max 256 |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "placeId": "ChIJ...",
    "label": "Gulshan 1 Circle",
    "address": "Gulshan 1, Dhaka, Bangladesh",
    "latitude": 23.7805735,
    "longitude": 90.4167958,
    "city": "Dhaka",
    "district": "Dhaka District",
    "country": "Bangladesh",
    "countryCode": "BD",
    "postalCode": "1212",
    "types": ["route"]
  }
}
```

### Error Responses

| HTTP | Code | When |
|------|------|------|
| 400 | `INVALID_PLACE_ID` | Invalid or not found place ID |
| 400 | `VALIDATION_ERROR` | Missing placeId |
| 503 | `GOOGLE_MAPS_*` | Config/timeout/quota/provider errors |
| 429 | `RATE_LIMITED` | Maps rate limit |

### Example cURL

```bash
curl "http://localhost:3000/api/v1/passenger/places/details?placeId=ChIJ...&sessionToken=abc123" \
  -H "Authorization: Bearer <session_jwt>"
```

### Notes

- Pair with autocomplete using the same `sessionToken` for Google billing optimization.

---

## GET `/api/v1/passenger/places/reverse-geocode`

| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Full path** | `/api/v1/passenger/places/reverse-geocode` |
| **Purpose** | Convert GPS coordinates to a human-readable address |
| **Authentication** | Bearer session JWT |
| **Required role** | `customer` |
| **Headers** | `Authorization: Bearer <token>` |
| **Query params** | `lat` (required), `lng` (required) |
| **Rate limit** | Global + maps |
| **Cache** | Redis, 300 s TTL |

### Validation Rules (Query)

| Param | Type | Rules |
|-------|------|-------|
| `lat` | number | Required; -90 to 90 |
| `lng` | number | Required; -180 to 180 |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "placeId": "ChIJ...",
    "label": "Road 11",
    "address": "Road 11, Dhaka, Bangladesh",
    "latitude": 23.78057,
    "longitude": 90.41680,
    "city": "Dhaka",
    "district": "Dhaka District",
    "country": "Bangladesh",
    "countryCode": "BD",
    "postalCode": null,
    "types": ["route"]
  }
}
```

### Error Responses

| HTTP | Code | When |
|------|------|------|
| 400 | `VALIDATION_ERROR` | Invalid coordinates |
| 503 | `GOOGLE_MAPS_*` | Provider errors |
| 429 | `RATE_LIMITED` | Maps rate limit |

### Notes

- If geocoding returns no results, a coordinate fallback label is returned (e.g. `"23.78057, 90.41680"`).

### Example cURL

```bash
curl "http://localhost:3000/api/v1/passenger/places/reverse-geocode?lat=23.78057&lng=90.41680" \
  -H "Authorization: Bearer <session_jwt>"
```

---

## GET `/api/v1/passenger/places/suggestions`

| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Full path** | `/api/v1/passenger/places/suggestions` |
| **Purpose** | List passenger's saved/recent places with optional distance sorting |
| **Authentication** | Bearer session JWT |
| **Required role** | `customer` |
| **Headers** | `Authorization: Bearer <token>` |
| **Query params** | `lat`, `lng` (optional), `limit` (optional, 1–30, default 15) |
| **Rate limit** | Global only (not maps-limited) |
| **Cache** | None |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "label": "Home",
      "address": "Banani, Dhaka",
      "latitude": 23.79,
      "longitude": 90.40,
      "placeId": "ChIJ...",
      "placeType": "home",
      "distanceKm": 2.3,
      "lastUsedAt": "2026-07-10T12:00:00.000Z"
    }
  ]
}
```

### Error Responses

| HTTP | Code | When |
|------|------|------|
| 400 | `VALIDATION_ERROR` | Invalid query |
| 401/403 | Auth errors | — |

### Example cURL

```bash
curl "http://localhost:3000/api/v1/passenger/places/suggestions?lat=23.78&lng=90.41&limit=10" \
  -H "Authorization: Bearer <session_jwt>"
```

### Notes

- `distanceKm` is `null` if `lat`/`lng` not provided; rounded to 1 decimal when present.

---

## GET `/api/v1/passenger/pickup-spots`

| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Full path** | `/api/v1/passenger/pickup-spots` |
| **Purpose** | Return pickup spot for the selected map pin (single spot only) |
| **Authentication** | Bearer session JWT |
| **Required role** | `customer` |
| **Headers** | `Authorization: Bearer <token>` |
| **Query params** | `lat` (required), `lng` (required), `address` (optional) |
| **Rate limit** | Global + maps |
| **Cache** | None |

### Validation Rules (Query)

| Param | Type | Rules |
|-------|------|-------|
| `lat` | number | Required; -90 to 90 |
| `lng` | number | Required; -180 to 180 |
| `address` | string | Optional; max 500 chars |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": null,
      "label": "Gulshan 1, Dhaka",
      "address": "Gulshan 1, Dhaka",
      "latitude": 23.78057,
      "longitude": 90.41680,
      "distanceMeters": 0,
      "source": "selected_location"
    }
  ]
}
```

### Error Responses

| HTTP | Code | When |
|------|------|------|
| 400 | `VALIDATION_ERROR` | Invalid coordinates |
| 503 | `GOOGLE_MAPS_CONFIG_ERROR` | Maps not configured |
| 429 | `RATE_LIMITED` | Maps rate limit |

### Example cURL

```bash
curl "http://localhost:3000/api/v1/passenger/pickup-spots?lat=23.78057&lng=90.41680&address=Gulshan%201" \
  -H "Authorization: Bearer <session_jwt>"
```

### Notes

- **Returns only the selected location** — no fake or generated nearby spots.
- `label` defaults to `"Selected location"` if `address` is omitted.

---

## POST `/api/v1/passenger/places`

| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **Full path** | `/api/v1/passenger/places` |
| **Purpose** | Save or upsert a customer place (home, work, favorite, recent) |
| **Authentication** | Bearer session JWT |
| **Required role** | `customer` |
| **Headers** | `Authorization`, `Content-Type: application/json` |
| **Body params** | See validation |
| **Rate limit** | Global |
| **Cache** | None |

### Validation Rules (Body)

| Field | Type | Rules |
|-------|------|-------|
| `label` | string | Required; 1–255 chars |
| `address` | string | Required; 1–500 chars |
| `latitude` | number | Required; -90 to 90 |
| `longitude` | number | Required; -180 to 180 |
| `placeId` | string | Optional; max 255 |
| `city` | string | Optional; max 255 |
| `countryCode` | string | Optional; 2 chars |
| `placeType` | enum | `home`, `work`, `favorite`, `recent` (default: `recent`) |

### Success Response — `201 Created`

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "label": "Home",
    "address": "Banani, Dhaka",
    "latitude": 23.79,
    "longitude": 90.40,
    "placeId": "ChIJ...",
    "city": "Dhaka",
    "countryCode": "BD",
    "placeType": "home",
    "createdAt": "2026-07-10T12:00:00.000Z",
    "updatedAt": "2026-07-10T12:00:00.000Z"
  }
}
```

### Example cURL

```bash
curl -X POST http://localhost:3000/api/v1/passenger/places \
  -H "Authorization: Bearer <session_jwt>" \
  -H "Content-Type: application/json" \
  -d '{"label":"Home","address":"Banani, Dhaka","latitude":23.79,"longitude":90.40,"placeType":"home"}'
```

---

## PATCH `/api/v1/passenger/places/:placeId`

| Field | Value |
|-------|-------|
| **Method** | `PATCH` |
| **Full path** | `/api/v1/passenger/places/:placeId` |
| **Purpose** | Partially update a saved place |
| **Authentication** | Bearer session JWT |
| **Required role** | `customer` |
| **Headers** | `Authorization`, `Content-Type: application/json` |
| **Path params** | `placeId` — UUID |
| **Body params** | Any subset of save-place fields (at least one required) |
| **Rate limit** | Global |
| **Cache** | None |

### Validation Rules

- `placeId` must be a valid UUID owned by the customer.
- Body: partial `savePlaceSchema`; at least one field required.

### Success Response — `200 OK`

Returns updated place object (same shape as POST response).

### Error Responses

| HTTP | Code | When |
|------|------|------|
| 404 | `NOT_FOUND` | Place not found or not owned |
| 400 | `VALIDATION_ERROR` | Empty body or invalid fields |

### Example cURL

```bash
curl -X PATCH http://localhost:3000/api/v1/passenger/places/<place_uuid> \
  -H "Authorization: Bearer <session_jwt>" \
  -H "Content-Type: application/json" \
  -d '{"label":"Office"}'
```

---

## DELETE `/api/v1/passenger/places/:placeId`

| Field | Value |
|-------|-------|
| **Method** | `DELETE` |
| **Full path** | `/api/v1/passenger/places/:placeId` |
| **Purpose** | Delete a saved place |
| **Authentication** | Bearer session JWT |
| **Required role** | `customer` |
| **Headers** | `Authorization` |
| **Path params** | `placeId` — UUID |
| **Rate limit** | Global |
| **Cache** | None |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": { "id": "uuid", "deleted": true }
}
```

### Error Responses

| HTTP | Code | When |
|------|------|------|
| 404 | `NOT_FOUND` | Place not found |

### Example cURL

```bash
curl -X DELETE http://localhost:3000/api/v1/passenger/places/<place_uuid> \
  -H "Authorization: Bearer <session_jwt>"
```

---

# Passenger Route APIs

---

## POST `/api/v1/passenger/routes/preview`

| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **Full path** | `/api/v1/passenger/routes/preview` |
| **Purpose** | Preview driving route using **Google Routes API v2** (`computeRoutes`) |
| **Authentication** | Bearer session JWT |
| **Required role** | `customer` |
| **Headers** | `Authorization`, `Content-Type: application/json` |
| **Body params** | See validation |
| **Rate limit** | Global + maps |
| **Cache** | Redis, 300 s TTL |

### Validation Rules (Body)

| Field | Type | Rules |
|-------|------|-------|
| `pickup` | object | `latitude`, `longitude` required; `address`, `placeId` optional |
| `dropoff` | object | Same as pickup |
| `stops` | array | Optional; max 3 intermediate stops |
| `travelMode` | enum | Optional: `DRIVE` (default), `TWO_WHEELER` |
| `routePreference` | enum | Optional: `TRAFFIC_AWARE` (default), `TRAFFIC_UNAWARE` |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "pickup": { "latitude": 23.78, "longitude": 90.41, "address": "Gulshan 1" },
    "dropoff": { "latitude": 23.73, "longitude": 90.39, "address": "Dhanmondi" },
    "stops": [],
    "distanceMeters": 5200,
    "distanceKm": 5.2,
    "durationSeconds": 900,
    "durationMin": 15,
    "staticDurationSeconds": 840,
    "trafficDelaySeconds": 60,
    "encodedPolyline": "encoded_polyline_string",
    "routeBounds": {
      "northeast": { "latitude": 23.79, "longitude": 90.42 },
      "southwest": { "latitude": 23.72, "longitude": 90.38 }
    },
    "legs": [
      {
        "start": { "latitude": 23.78, "longitude": 90.41 },
        "end": { "latitude": 23.73, "longitude": 90.39 },
        "distanceMeters": 5200,
        "durationSeconds": 900,
        "encodedPolyline": "leg_polyline"
      }
    ],
    "provider": "google",
    "calculatedAt": "2026-07-10T12:00:00.000Z"
  }
}
```

### Error Responses

| HTTP | Code | When |
|------|------|------|
| 404 | `NO_ROUTE_FOUND` | No drivable route between points |
| 400 | `GOOGLE_MAPS_PROVIDER_ERROR` | More than 3 stops |
| 503 | `GOOGLE_MAPS_*` | Config/timeout/quota errors |
| 429 | `RATE_LIMITED` | Maps rate limit |

### Example cURL

```bash
curl -X POST http://localhost:3000/api/v1/passenger/routes/preview \
  -H "Authorization: Bearer <session_jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "pickup": {"latitude": 23.78, "longitude": 90.41, "address": "Gulshan 1"},
    "dropoff": {"latitude": 23.73, "longitude": 90.39, "address": "Dhanmondi"},
    "routePreference": "TRAFFIC_AWARE"
  }'
```

### Notes

- Uses **Google Routes API v2**, not Distance Matrix.
- Response includes **`encodedPolyline`** and **`routeBounds`** for map rendering.
- Max intermediate stops: 3 (`GOOGLE_MAPS_MAX_ROUTE_STOPS`).

---

# Passenger Service APIs

---

## GET `/api/v1/passenger/services`

| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Full path** | `/api/v1/passenger/services` |
| **Purpose** | List active ride service categories and promotions |
| **Authentication** | Bearer session JWT |
| **Required role** | `customer` |
| **Headers** | `Authorization` |
| **Query params** | None |
| **Rate limit** | Global |
| **Cache** | None |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "services": [
      {
        "serviceCategoryId": "uuid",
        "code": "economy",
        "name": "Economy",
        "description": "Affordable rides",
        "iconKey": "economy_car",
        "capacity": 4,
        "baseFare": "50.00",
        "perKmRate": "15.00",
        "minFare": "80.00",
        "sortOrder": 1
      }
    ],
    "promotions": [
      {
        "id": "uuid",
        "title": "10% off Economy",
        "discountType": "percent",
        "discountValue": "10.00"
      }
    ]
  }
}
```

### Error Responses

| HTTP | Code | When |
|------|------|------|
| 401/403 | Auth errors | — |

### Notes

- `rental` service category is **excluded** from passenger app listing.

### Example cURL

```bash
curl http://localhost:3000/api/v1/passenger/services \
  -H "Authorization: Bearer <session_jwt>"
```

---

# Passenger Driver APIs

---

## GET `/api/v1/passenger/drivers/nearby`

| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Full path** | `/api/v1/passenger/drivers/nearby` |
| **Purpose** | Find nearby available drivers for a service category |
| **Authentication** | Bearer session JWT |
| **Required role** | `customer` |
| **Headers** | `Authorization` |
| **Query params** | See validation |
| **Rate limit** | Global |
| **Cache** | None |

### Validation Rules (Query)

| Param | Type | Rules |
|-------|------|-------|
| `lat` | number | Required; -90 to 90 |
| `lng` | number | Required; -180 to 180 |
| `serviceCategoryId` | UUID | Required |
| `radiusKm` | number | Optional; 0.5–30 (default: 15) |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "driverId": "uuid",
      "distanceKm": 1.2,
      "estimatedArrivalMinutes": 3,
      "vehicle": {
        "id": "uuid",
        "type": null,
        "plateNumberMasked": "DHA-****"
      }
    }
  ]
}
```

### Error Responses

| HTTP | Code | When |
|------|------|------|
| 400 | `VALIDATION_ERROR` | Invalid query |
| 401/403 | Auth errors | — |

### Notes

- Returns at most **20** drivers, sorted by distance.
- Plate numbers are masked for privacy.

### Example cURL

```bash
curl "http://localhost:3000/api/v1/passenger/drivers/nearby?lat=23.78&lng=90.41&serviceCategoryId=<uuid>&radiusKm=10" \
  -H "Authorization: Bearer <session_jwt>"
```

---

# Passenger Quote APIs

---

## POST `/api/v1/passenger/bookings/quote`

| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **Full path** | `/api/v1/passenger/bookings/quote` |
| **Purpose** | Get route summary and fare quotes for one or all service categories |
| **Authentication** | Bearer session JWT |
| **Required role** | `customer` |
| **Headers** | `Authorization`, `Content-Type: application/json` |
| **Body params** | See validation |
| **Rate limit** | Global + maps |
| **Cache** | Route cached in Redis (300 s) |

### Validation Rules (Body)

| Field | Type | Rules |
|-------|------|-------|
| `pickup` | object | `latitude`, `longitude` required; `address` optional |
| `dropoff` | object | Same as pickup |
| `stops` | array | Optional; max 3; each stop requires `address` |
| `serviceCategoryId` | UUID | Optional — if provided, returns quote for that category only |

### Success Response — `200 OK`

Returns `{ route, quotes }`:

```json
{
  "success": true,
  "data": {
    "route": {
      "distanceMeters": 5200,
      "distanceKm": 5.2,
      "durationSeconds": 900,
      "durationMin": 15,
      "encodedPolyline": "encoded_polyline_string",
      "routeBounds": {
        "northeast": { "latitude": 23.79, "longitude": 90.42 },
        "southwest": { "latitude": 23.72, "longitude": 90.38 }
      }
    },
    "quotes": [
      {
        "serviceCategoryId": "uuid",
        "serviceCode": "economy",
        "serviceName": "Economy",
        "description": "Affordable rides",
        "iconKey": "economy_car",
        "capacity": 4,
        "distanceKm": 5.2,
        "durationMin": 15,
        "driverEtaMinutes": 4,
        "originalFare": 128.00,
        "discountType": "percent",
        "discountValue": 10,
        "discountAmount": 12.80,
        "finalFare": 115.20,
        "currency": "BDT",
        "promotion": {
          "id": "uuid",
          "title": "10% off Economy",
          "discountType": "percent",
          "discountValue": 10
        }
      }
    ]
  }
}
```

### Fare Calculation

```
originalFare = max(minFare, baseFare + perKmRate × distanceKm)
originalFare = round to 2 decimals
discount (percent) = round(originalFare × value / 100, 2)
discount (fixed) = value
finalFare = max(0, round(originalFare - discount, 2))
currency = "BDT"
```

Route distance comes from **Google Routes API v2**, not Distance Matrix.

### Error Responses

| HTTP | Code | When |
|------|------|------|
| 404 | `NO_ROUTE_FOUND` | No route |
| 503 | `GOOGLE_MAPS_*` | Provider errors |
| 400 | `VALIDATION_ERROR` | Invalid body |
| 429 | `RATE_LIMITED` | Maps rate limit |

### Example cURL

```bash
curl -X POST http://localhost:3000/api/v1/passenger/bookings/quote \
  -H "Authorization: Bearer <session_jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "pickup": {"latitude": 23.78, "longitude": 90.41, "address": "Gulshan 1"},
    "dropoff": {"latitude": 23.73, "longitude": 90.39, "address": "Dhanmondi"}
  }'
```

### Notes

- Without `serviceCategoryId`: quotes all active categories (except `rental`) with driver ETA per category.
- With `serviceCategoryId`: single-category quote.
- `driverEtaMinutes` may be `null` if no nearby driver found.

---

# Passenger Booking APIs

---

## POST `/api/v1/passenger/bookings`

| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **Full path** | `/api/v1/passenger/bookings` |
| **Purpose** | Confirm and create a booking; starts driver dispatch for instant rides |
| **Authentication** | Bearer session JWT |
| **Required role** | `customer` |
| **Headers** | `Authorization`, `Content-Type: application/json`, **`Idempotency-Key`** (recommended) |
| **Body params** | See validation |
| **Rate limit** | Global |
| **Cache** | None |

### Validation Rules (Body)

| Field | Type | Rules |
|-------|------|-------|
| `serviceCategoryId` | UUID | Required |
| `pickup` | object | `latitude`, `longitude`, `address` (min 1 char); `spotLabel` optional |
| `dropoff` | object | `latitude`, `longitude`, `address` (min 1 char); `placeId` optional |
| `stops` | array | Optional; max 3 |
| `paymentMethodCode` | string | Default: `cash` |
| `schedulingType` | enum | Optional: `instant` (default), `scheduled` |
| `scheduledPickupAt` | ISO datetime | Required when `schedulingType` is `scheduled` |

### Success Response — `201 Created`

Returns booking record:

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "bookingNumber": "BK20260710001",
    "customerId": "uuid",
    "serviceCategoryId": "uuid",
    "status": "searching",
    "schedulingType": "instant",
    "pickupLatitude": "23.78000000",
    "pickupLongitude": "90.41000000",
    "pickupAddress": "Gulshan 1",
    "dropoffAddress": "Dhanmondi",
    "estimatedDistanceKm": "5.20",
    "estimatedDurationMin": 15,
    "finalFare": "115.20",
    "currency": "BDT",
    "paymentStatus": "pending",
    "shareToken": "abc123...",
    "routeEncodedPolyline": "encoded_polyline",
    "createdAt": "2026-07-10T12:00:00.000Z"
  }
}
```

### Error Responses

| HTTP | Code | When |
|------|------|------|
| 400 | `ACTIVE_BOOKING_EXISTS` | Customer already has an ongoing booking (`searching`, `offered`, `scheduled`, or active ride statuses) |
| 400 | `BOOKING_CREATION_FAILED` | Payment method not found, fare error, etc. |
| 400 | `VALIDATION_ERROR` | Invalid body |

### Idempotency

- Send `Idempotency-Key: <unique-string>` header.
- Duplicate requests with same key return the original booking (24 h TTL).
- Prevents double-booking on network retry.

### Example cURL

```bash
curl -X POST http://localhost:3000/api/v1/passenger/bookings \
  -H "Authorization: Bearer <session_jwt>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: booking-attempt-001" \
  -d '{
    "serviceCategoryId": "<uuid>",
    "pickup": {"latitude": 23.78, "longitude": 90.41, "address": "Gulshan 1"},
    "dropoff": {"latitude": 23.73, "longitude": 90.39, "address": "Dhanmondi"},
    "paymentMethodCode": "cash"
  }'
```

### Notes

- Instant bookings start dispatch immediately (`status: searching`).
- Booking insert, stops, events, and idempotency record are committed in a single database transaction; dispatch starts only after commit.
- Scheduled bookings get `status: scheduled` — dispatch deferred.

---

## GET `/api/v1/passenger/bookings`

| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Full path** | `/api/v1/passenger/bookings` |
| **Purpose** | Paginated booking history |
| **Authentication** | Bearer session JWT |
| **Required role** | `customer` |
| **Query params** | `page` (default 1), `limit` (default 20) |
| **Rate limit** | Global |
| **Cache** | None |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": [ { "id": "uuid", "bookingNumber": "BK...", "status": "completed", "...": "..." } ],
  "metadata": {
    "pagination": { "page": 1, "limit": 20, "total": 45, "totalPages": 3 }
  }
}
```

### Example cURL

```bash
curl "http://localhost:3000/api/v1/passenger/bookings?page=1&limit=20" \
  -H "Authorization: Bearer <session_jwt>"
```

---

## GET `/api/v1/passenger/bookings/active`

| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Full path** | `/api/v1/passenger/bookings/active` |
| **Purpose** | Get current active booking with full detail, or `null` |
| **Authentication** | Bearer session JWT |
| **Required role** | `customer` |
| **Rate limit** | Global |
| **Cache** | None |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": null
}
```

Or full booking detail object when active (statuses: `accepted`, `driver_en_route`, `arrived`, `in_progress`).

### Example cURL

```bash
curl http://localhost:3000/api/v1/passenger/bookings/active \
  -H "Authorization: Bearer <session_jwt>"
```

---

## GET `/api/v1/passenger/bookings/:bookingId`

| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Full path** | `/api/v1/passenger/bookings/:bookingId` |
| **Purpose** | Get booking detail by ID |
| **Authentication** | Bearer session JWT |
| **Required role** | `customer` |
| **Path params** | `bookingId` — UUID |
| **Rate limit** | Global |
| **Cache** | None |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "booking": { "id": "uuid", "status": "driver_en_route", "...": "..." },
    "customerName": "John Doe",
    "customerEmail": "john@example.com",
    "driverName": "Karim",
    "driverPhone": "+880...",
    "vehiclePlate": "DHA-1234",
    "serviceName": "Economy",
    "serviceCode": "economy"
  }
}
```

### Error Responses

| HTTP | Code | When |
|------|------|------|
| 404 | `NOT_FOUND` | Booking not found |
| 403 | `FORBIDDEN` | Booking belongs to another customer |

### Example cURL

```bash
curl http://localhost:3000/api/v1/passenger/bookings/<booking_uuid> \
  -H "Authorization: Bearer <session_jwt>"
```

---

## POST `/api/v1/passenger/bookings/:bookingId/cancel`

| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **Full path** | `/api/v1/passenger/bookings/:bookingId/cancel` |
| **Purpose** | Cancel a booking (before driver acceptance) |
| **Authentication** | Bearer session JWT |
| **Required role** | `customer` |
| **Path params** | `bookingId` — UUID |
| **Body params** | `reason` (optional string) |
| **Rate limit** | Global |
| **Cache** | None |

### Cancellable Statuses

`quoted`, `searching`, `offered`, `scheduled`

Cannot cancel after driver accepts (`accepted` and beyond).

### Success Response — `200 OK`

Returns updated booking object with `status: cancelled`.

### Error Responses

| HTTP | Code | When |
|------|------|------|
| 400 | `CANCEL_FAILED` | Not cancellable, not found, access denied |

### Example cURL

```bash
curl -X POST http://localhost:3000/api/v1/passenger/bookings/<booking_uuid>/cancel \
  -H "Authorization: Bearer <session_jwt>" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Changed plans"}'
```

### Notes

- Emits `booking:status` WebSocket event with `status: cancelled`.

---

## POST `/api/v1/passenger/bookings/:bookingId/consent-recording`

| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **Full path** | `/api/v1/passenger/bookings/:bookingId/consent-recording` |
| **Purpose** | Record passenger consent for in-ride video recording |
| **Authentication** | Bearer session JWT |
| **Required role** | `customer` |
| **Path params** | `bookingId` — UUID |
| **Rate limit** | Global |
| **Cache** | None |

### Allowed Statuses

`accepted`, `driver_en_route`, `arrived` — before ride starts (`in_progress`).

### Success Response — `200 OK`

Returns booking with `recordingConsentedAt` timestamp set.

### Error Responses

| HTTP | Code | When |
|------|------|------|
| 400 | `CONSENT_FAILED` | Wrong status or access denied |

### Notes

- Driver cannot start ride (`in_progress`) without passenger consent.

### Example cURL

```bash
curl -X POST http://localhost:3000/api/v1/passenger/bookings/<booking_uuid>/consent-recording \
  -H "Authorization: Bearer <session_jwt>"
```

---

## GET `/api/v1/passenger/bookings/:bookingId/share`

| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Full path** | `/api/v1/passenger/bookings/:bookingId/share` |
| **Purpose** | Get share token and URL for trip sharing |
| **Authentication** | Bearer session JWT |
| **Required role** | `customer` |
| **Path params** | `bookingId` — UUID |
| **Rate limit** | Global |
| **Cache** | None |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "shareToken": "abc123token",
    "shareUrl": "/api/v1/passenger/bookings/share/abc123token"
  }
}
```

### Error Responses

| HTTP | Code | When |
|------|------|------|
| 404 | `NOT_FOUND` | Booking not found or not owned |

### Example cURL

```bash
curl http://localhost:3000/api/v1/passenger/bookings/<booking_uuid>/share \
  -H "Authorization: Bearer <session_jwt>"
```

---

## GET `/api/v1/passenger/bookings/:bookingId/live-video`

| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Full path** | `/api/v1/passenger/bookings/:bookingId/live-video` |
| **Purpose** | List live video session and segments for a booking |
| **Authentication** | Bearer session JWT |
| **Required role** | `customer` |
| **Path params** | `bookingId` — UUID |
| **Rate limit** | Global |
| **Cache** | None |

### Success Response — `200 OK`

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
      "startedAt": "2026-07-10T12:00:00.000Z"
    },
    "segments": [
      {
        "id": "uuid",
        "segmentIndex": 0,
        "videoUrl": "/uploads/live/<tripId>/segment_0.mp4",
        "mimeType": "video/mp4",
        "durationSeconds": 10
      }
    ]
  }
}
```

### Error Responses

| HTTP | Code | When |
|------|------|------|
| 404 | `NOT_FOUND` | Booking not found |

### Example cURL

```bash
curl http://localhost:3000/api/v1/passenger/bookings/<booking_uuid>/live-video \
  -H "Authorization: Bearer <session_jwt>"
```

---

# Passenger Payment APIs

---

## GET `/api/v1/passenger/payment-methods`

| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Full path** | `/api/v1/passenger/payment-methods` |
| **Purpose** | List active payment methods for booking |
| **Authentication** | Bearer session JWT |
| **Required role** | `customer` |
| **Headers** | `Authorization` |
| **Rate limit** | Global |
| **Cache** | None |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "code": "cash",
      "name": "Cash",
      "description": "Pay driver in cash",
      "iconKey": "cash",
      "isActive": true,
      "sortOrder": 1
    }
  ]
}
```

### Notes

- Only active methods returned.
- Default booking payment: `cash` (`paymentMethodCode` defaults to `"cash"`).

### Example cURL

```bash
curl http://localhost:3000/api/v1/passenger/payment-methods \
  -H "Authorization: Bearer <session_jwt>"
```

---

# Passenger WebSocket Events

**URL:** `ws://localhost:3000` (Socket.IO)  
**Transports:** `websocket`, `polling`  
**Auth:** Pass session JWT via `auth.token` or `query.token`

```javascript
const socket = io('http://localhost:3000', {
  auth: { token: '<session_jwt>' },
  transports: ['websocket', 'polling'],
});
```

On connect, passenger joins room `customer-{userId}`.

---

## Connection Lifecycle

### Server → Client: `authenticated`

Emitted immediately after successful connection.

```json
{
  "userId": "uuid",
  "userType": "customer",
  "role": "customer",
  "rooms": ["<socketId>", "customer-<userId>"]
}
```

### Client ↔ Server: `ping` / `pong`

```javascript
socket.emit('ping');
// Server responds:
socket.on('pong', (data) => { /* { timestamp: "ISO8601" } */ });
```

---

## Booking Events (Server → Passenger)

### `booking:searching`

Emitted when dispatch starts or advances to a new batch.

```json
{
  "bookingId": "uuid",
  "batch": 1
}
```

### `booking:accepted`

Emitted when a driver accepts the booking.

```json
{
  "bookingId": "uuid",
  "driver": {
    "id": "uuid",
    "name": "Karim Ahmed",
    "phone": "+8801712345678",
    "plateNumber": "DHA-1234"
  },
  "etaMinutes": 4
}
```

### `booking:status`

Emitted on every status change (cancel, driver en route, arrived, in progress, completed, etc.).

```json
{
  "bookingId": "uuid",
  "status": "driver_en_route",
  "timestamp": "2026-07-10T12:05:00.000Z",
  "reason": "optional for cancellations"
}
```

**Possible statuses:** `searching`, `offered`, `accepted`, `driver_en_route`, `arrived`, `in_progress`, `completed`, `cancelled`, `expired`, `no_drivers`, `scheduled`

### `booking:expired`

Emitted when no drivers found after max dispatch batches.

```json
{
  "bookingId": "uuid",
  "reason": "no_drivers"
}
```

---

## Driver Location (Server → Passenger)

### `driver:location`

Emitted to `customer-{customerId}` when the assigned driver sends GPS updates during an active booking.

```json
{
  "driverId": "uuid",
  "bookingId": "uuid",
  "latitude": 23.78057,
  "longitude": 90.41680,
  "heading": 180.5,
  "speedKph": 32.4,
  "accuracyMeters": 8.2,
  "timestamp": "2026-07-10T12:06:00.000Z"
}
```

| Field | Type | Notes |
|-------|------|-------|
| `speedKph` | number \| null | Converted from m/s (`speed × 3.6`); null if unavailable |
| `accuracyMeters` | number \| null | GPS accuracy in meters |
| `heading` | number \| null | Degrees |
| `latitude` / `longitude` | number | **Raw GPS** — no Mapbox road snapping for passenger |

### Notes

- Only sent when driver has an active booking with this customer.
- Updates filtered server-side: accuracy > 20 m skipped; movement < 50 m from last point skipped.

---

## Live Video (Server → Passenger)

### `video:live-segment`

Emitted when driver uploads a new live video chunk.

```json
{
  "bookingId": "uuid",
  "sessionId": "uuid",
  "segmentIndex": 0,
  "videoUrl": "/uploads/live/<tripId>/segment_0.mp4",
  "timestamp": "2026-07-10T12:10:00.000Z"
}
```

---

## Passenger → Server Events

### `booking:cancel`

Cancel booking via WebSocket (alternative to REST).

```javascript
socket.emit('booking:cancel', { bookingId: 'uuid', reason: 'optional' }, (response) => {
  // { success: true } or { success: false, error: 'message' }
});
```

**Required role:** `customer`

---

## Error Events (Server → Client)

### `error`

```json
{
  "code": "UNAUTHORIZED",
  "message": "Only customers can cancel via this event"
}
```

---

# Passenger Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `VALIDATION_ERROR` | 400 | Request body/query/params failed Zod validation |
| `AUTH_FAILED` | 401 | Missing, invalid, or expired token |
| `UNAUTHORIZED` | 403 | Authenticated but wrong role (needs `customer`) |
| `FORBIDDEN` | 403 | Access denied to resource (e.g. another user's booking) |
| `NOT_FOUND` | 404 | Resource not found |
| `REGISTRATION_FAILED` | 400/409 | Registration error or duplicate email |
| `RESET_FAILED` | 500 | Password reset unexpected error |
| `CONFIG_ERROR` | 503 | Auth0 password reset not configured |
| `GOOGLE_MAPS_CONFIG_ERROR` | 503 | `GOOGLE_MAPS_API_KEY` missing or denied |
| `GOOGLE_MAPS_TIMEOUT` | 503 | Google Maps request timed out |
| `GOOGLE_MAPS_QUOTA_EXCEEDED` | 503 | Google API quota exceeded |
| `GOOGLE_MAPS_PROVIDER_ERROR` | 503/400 | General provider failure or too many stops |
| `NO_ROUTE_FOUND` | 404 | No drivable route between coordinates |
| `PLACE_NOT_FOUND` | 404 | Place/geocode not found |
| `INVALID_PLACE_ID` | 400 | Invalid Google place ID |
| `RATE_LIMITED` | 429 | Passenger maps rate limit exceeded |
| `RATE_LIMIT_EXCEEDED` | 429 | Global HTTP rate limit exceeded |
| `ACTIVE_BOOKING_EXISTS` | 400 | Customer already has an ongoing booking (`searching`, `offered`, `scheduled`, or active ride) |
| `BOOKING_CREATION_FAILED` | 400 | Booking creation failed (payment, fare, etc.) |
| `CANCEL_FAILED` | 400 | Cancellation not allowed or failed |
| `CONSENT_FAILED` | 400 | Recording consent not allowed in current status |

---

# Flutter Integration Flow

## 1. Authentication

```
Register (optional) → Auth0 SDK login → POST /auth/login → Store session JWT
```

1. **Register** (first-time users): `POST /api/v1/passenger/auth/register`
2. **Auth0 login** via Flutter SDK (`auth0.api.login`) with:
   - `connectionOrRealm: 'Username-Password-Authentication'`
   - `audience: '<AUTH0_AUDIENCE>'` (must match server `AUTH0_AUDIENCE`)
3. **Backend login**: send `credentials.accessToken` (not id_token) to `POST /api/v1/passenger/auth/login`
4. Store `data.token` securely; attach as `Authorization: Bearer <token>` on all requests

## 2. Location Search Flow

```
Autocomplete (null coords) → Place Details (coords) → Optional: save place
```

1. `GET /places/autocomplete?input=...&sessionToken=...` — display suggestions (**coords are null**)
2. `GET /places/details?placeId=...&sessionToken=...` — resolve `latitude`/`longitude`
3. Optionally `POST /places` to save as home/work/favorite/recent
4. For GPS pin: `GET /places/reverse-geocode?lat=...&lng=...`

## 3. Pickup Confirmation

```
Reverse geocode or place details → GET /pickup-spots → Confirm pickup
```

1. `GET /pickup-spots?lat=...&lng=...&address=...` — returns single selected spot
2. User confirms pickup coordinates

## 4. Route & Quote

```
POST /routes/preview (map polyline) → POST /bookings/quote (fares)
```

1. `POST /routes/preview` — draw route on map (`encodedPolyline`, `routeBounds`)
2. `POST /bookings/quote` — show service options with `finalFare` in **BDT**
3. Route computed via **Google Routes API v2** (not Distance Matrix)

## 5. Book Ride

```
POST /bookings with Idempotency-Key → Connect WebSocket → Listen for events
```

1. `GET /payment-methods` — let user choose payment
2. `POST /bookings` with `Idempotency-Key` header
3. Connect WebSocket with session JWT
4. Listen for:
   - `booking:searching` — finding drivers
   - `booking:accepted` — driver assigned
   - `booking:status` — lifecycle updates
   - `driver:location` — live map tracking (`speedKph`, `accuracyMeters`)
   - `video:live-segment` — in-ride video (if enabled)

## 6. During Ride

1. `POST /bookings/:id/consent-recording` — before driver starts trip
2. Track driver via `driver:location` events
3. `GET /bookings/active` — poll fallback for state recovery

## 7. Cancel / Complete

- Cancel (before acceptance): `POST /bookings/:id/cancel` or WebSocket `booking:cancel`
- History: `GET /bookings?page=1&limit=20`
- Share trip: `GET /bookings/:id/share`

## Flutter WebSocket Example

```dart
import 'package:socket_io_client/socket_io_client.dart' as IO;

final socket = IO.io(
  'http://localhost:3000',
  IO.OptionBuilder()
    .setTransports(['websocket'])
    .setAuth({'token': sessionJwt})
    .build(),
);

socket.on('authenticated', (data) => print('Connected: $data'));
socket.on('booking:accepted', (data) => print('Driver assigned: $data'));
socket.on('driver:location', (data) {
  // data['speedKph'], data['accuracyMeters']
  updateDriverMarker(data['latitude'], data['longitude']);
});
socket.on('booking:status', (data) => handleStatusChange(data['status']));
```

---

# Environment and Deployment Requirements

## Required Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `NODE_ENV` | Yes | `development` | Runtime mode |
| `PORT` | No | `3000` | HTTP server port |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `REDIS_URL` | Yes | — | Cache, pub/sub, Socket.IO adapter |
| `JWT_SECRET` | Yes | — | Backend session JWT signing (≥ 32 chars) |
| `AUTH0_DOMAIN` | Yes | — | Auth0 tenant domain |
| `AUTH0_API_IDENTIFIER` | Yes | — | API identifier |
| `AUTH0_AUDIENCE` | Yes | — | Token audience (must match Flutter app) |
| `AUTH0_CLIENT_ID` | Yes | — | Management API client |
| `AUTH0_CLIENT_SECRET` | Yes | — | Management API secret |
| `AUTH0_PASSENGER_CLIENT_ID` | Recommended | — | Passenger native app client |
| `GOOGLE_MAPS_API_KEY` | Yes | — | Server-side Google Maps (never expose to client) |
| `GOOGLE_MAPS_REGION` | No | `BD` | Routes API region code |
| `GOOGLE_MAPS_LANGUAGE` | No | `en` | Places/geocode language |
| `GOOGLE_MAPS_DEFAULT_COUNTRY` | No | `BD` | Autocomplete country filter |
| `GOOGLE_MAPS_REQUEST_TIMEOUT_MS` | No | `8000` | Provider timeout |
| `GOOGLE_MAPS_CACHE_TTL_SECONDS` | No | `300` | Redis cache TTL for maps |
| `GOOGLE_MAPS_MAX_ROUTE_STOPS` | No | `3` | Max intermediate stops |
| `CORS_ORIGIN` | Yes | — | Comma-separated allowed origins |
| `RATE_LIMIT_WINDOW_MS` | No | `900000` | Global rate limit window |
| `RATE_LIMIT_MAX_REQUESTS` | No | `100` | Global max requests per window |
| `PASSENGER_MAPS_RATE_LIMIT_WINDOW_MS` | No | `60000` | Maps rate limit window |
| `PASSENGER_MAPS_RATE_LIMIT_MAX` | No | `60` | Maps max requests per window |

> **Never commit or document real API keys, secrets, or tokens.** Use `.env` locally and secure secret management in production.

## Google Cloud APIs to Enable

- Places API (Autocomplete, Place Details)
- Geocoding API (reverse geocode)
- **Routes API** (v2 `computeRoutes`) — required for route preview and fare distance

## Infrastructure Dependencies

| Service | Purpose |
|---------|---------|
| PostgreSQL | Customers, bookings, places, sessions |
| Redis | Maps cache, real-time driver locations, Socket.IO adapter, pub/sub |
| Auth0 | Passenger authentication, password reset |
| Google Maps Platform | Places, geocoding, routing (server-side proxy) |

## Deployment Checklist

- [ ] Set all required environment variables (see table above); **never expose `GOOGLE_MAPS_API_KEY` in the mobile app**
- [ ] Enable Google Places, Geocoding, and **Routes API v2** in Google Cloud Console
- [ ] Restrict `GOOGLE_MAPS_API_KEY` to server IP / backend service only
- [ ] Configure Auth0 Native app with Password grant and correct `AUTH0_AUDIENCE`
- [ ] Configure Auth0 Management API for registration and password reset
- [ ] Run database migrations (`npm run db:migrate` or equivalent)
- [ ] Verify Redis connectivity (required for WebSocket scaling and maps cache)
- [ ] Set `CORS_ORIGIN` to Flutter app origin(s)
- [ ] Set `BYPASS_AUTH=false` in production
- [ ] Use HTTPS/WSS in production (`https://` / `wss://`)
- [ ] Configure `trust proxy` if behind reverse proxy (already set to `1`)
- [ ] Verify health endpoint responds after deploy
- [ ] Test end-to-end flow: register → login → autocomplete → details → quote → book → WebSocket events
- [ ] Confirm fare currency displays as **BDT** with 2-decimal rounding
- [ ] Monitor `GOOGLE_MAPS_QUOTA_EXCEEDED` and `RATE_LIMITED` in logs
- [ ] Rotate `JWT_SECRET` and Google API key if ever exposed

## Local Development Quick Start

```bash
# Copy environment template
cp .env.example .env
# Edit .env with your values (no real secrets in docs)

# Install and run
npm install
npm run dev
```

Server runs at `http://localhost:3000`. Flutter emulator/device should use the machine IP with port (e.g. `http://10.0.2.2:3000` on Android emulator).

---

*Generated from implemented passenger backend code. Base prefix: `/api/v1/passenger`.*
