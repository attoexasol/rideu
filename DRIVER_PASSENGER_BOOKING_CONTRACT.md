# Driver ↔ Passenger Booking Contract

**Authority:** Implemented code in `src/` as of this document.  
**Base URL:** `http://103.208.181.253:3000` (or `PORT` from env)  
**Passenger API:** `/api/v1/passenger`  
**Driver booking API:** `/api/v1/driver/bookings`  
**Legacy driver APIs (preserved):** `/api/auth/login`, `/api/drivers/me`, `PATCH /api/drivers/:id/status`, `POST /api/locations`, `POST /api/videos/live-chunk`

---

## 1. Architecture overview

```
Passenger Flutter ──REST/Socket──► Backend ──Socket──► Kotlin Driver App
                                      │
                                      ├── PostgreSQL (bookings, offers, trips, video)
                                      ├── Redis (driver location, status, pub/sub)
                                      └── Socket.IO rooms (customer-{id}, driver-{id}, admin)
```

**Lifecycle:** quote → confirm → dispatch batches → `booking:offer` → accept/decline → `driver_en_route` → `arrived` → consent → `in_progress` (video session) → `completed`.

---

## 2. Authentication

| App | Login | Socket token |
|-----|-------|--------------|
| Driver (Kotlin) | `POST /api/auth/login` with Auth0 token → backend HS256 JWT with `userId` = driver UUID | Same JWT in `auth.token` |
| Passenger | Passenger auth flow → JWT with `userId` = customer UUID | Same |

On Socket.IO connect, drivers are resolved by `auth0Id` → DB `drivers.id` for room `driver-{driverId}`.

**Authenticated event:**
```json
{
  "userId": "uuid",
  "userType": "driver",
  "role": "driver",
  "rooms": ["driver-uuid", "socket-id"]
}
```

---

## 3. Driver availability

| State | Set by | Dispatch eligible? |
|-------|--------|-------------------|
| `offline` | Manual PATCH, inactivity checker, go_offline | No |
| `online` | PATCH status, location upload, go_online | Yes (if other rules pass) |
| `busy` | Backend on successful offer accept | No |

- `PATCH /api/drivers/:id/status` accepts only `online` \| `offline` (backward compatible).
- `busy` is backend-managed; drivers cannot self-set busy.
- Stale GPS makes driver ineligible without changing visible status.

**Config (env):**
- `DRIVER_LOCATION_STALE_SECONDS` (default 120)
- `DISPATCH_RADIUS_KM` (default 15)
- `DISPATCH_BATCH_SIZE` (default 5)
- `DISPATCH_OFFER_TIMEOUT_SECONDS` (default 45)
- `DISPATCH_MAX_BATCHES` (default 3)
- `VIDEO_SEGMENT_DURATION_SECONDS` (default 10)

---

## 4. Vehicle / service category eligibility

**Authoritative mapping:**
```
driver → drivers.vehicleId → vehicles (status must be active/approved)
driver → driver_service_categories → service_categories
booking.serviceCategoryId must match driver_service_categories
```

Dispatch never trusts client claims. Eligibility checks: online, not busy, approved vehicle, category match, fresh Redis location, within radius, not previously declined/expired/taken for this booking.

---

## 5. Dispatch algorithm

1. Booking → `searching` on confirm (instant).
2. Every `DISPATCH_OFFER_TIMEOUT_SECONDS`, next batch up to `DISPATCH_MAX_BATCHES`.
3. Nearest eligible drivers (max `DISPATCH_BATCH_SIZE`) get persisted `booking_offers` + `booking:offer`.
4. Passenger receives `booking:searching` with `{ bookingId, batch }`.
5. On timeout, stale offers → `expired`; drivers get `booking:offer:cancelled` reason `offer_expired`; booking reverts to `searching` when no pending offers remain.
6. If no acceptance after max batches → `no_drivers`; passenger gets `booking:expired`.
7. Passenger cancel → pending offers `cancelled`; `booking:offer:cancelled` reason `passenger_cancelled`.

**Note:** Batch retry uses in-process `setTimeout` (survives single instance; not durable across restarts).

---

## 6. Socket events

### Driver ← server

| Event | When |
|-------|------|
| `booking:offer` | New dispatch offer |
| `booking:offer:cancelled` | Offer taken/expired/cancelled |
| `booking:taken` | Legacy alias when another driver accepts |
| `booking:status` | Status changes (incl. passenger cancel) |
| `booking:recording-consent` | Passenger consented to recording |
| `authenticated` | On connect |

### Passenger ← server

| Event | When |
|-------|------|
| `booking:searching` | Dispatch batch started |
| `booking:accepted` | Driver assigned |
| `booking:status` | Status updates |
| `booking:expired` | No drivers / dispatch ended |
| `driver:location` | During active assigned booking |
| `video:live-segment` | Live segment uploaded |

### `booking:offer` payload (representative)
```json
{
  "offerId": "uuid",
  "bookingId": "uuid",
  "bookingNumber": "RYD-...",
  "expiresAt": "ISO-8601",
  "service": { "serviceCategoryId", "serviceCode", "serviceName", "capacity" },
  "pickup": { "latitude", "longitude", "address", "spotLabel" },
  "dropoff": { "latitude", "longitude", "address" },
  "route": { "distanceKm", "durationMin" },
  "fare": { "amount", "currency": "BDT" },
  "passenger": { "displayName", "rating": null }
}
```

### `booking:accepted` (passenger)
```json
{
  "bookingId": "uuid",
  "driver": { "id", "name", "phone", "plateNumber" },
  "vehicle": { "id", "make", "model", "color", "plateNumber" },
  "etaMinutes": 5
}
```

---

## 7. Driver REST endpoints

All require driver JWT + `requireDriver`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/driver/bookings/active` | Restore active ride (`data: null` if none) |
| GET | `/api/v1/driver/bookings/offers/pending` | Valid pending offers |
| GET | `/api/v1/driver/bookings/offers` | Same as pending (alias) |
| GET | `/api/v1/driver/bookings/offers/:offerId` | Hydrate single offer after push |
| GET | `/api/v1/driver/bookings/:bookingId` | Assigned booking or active offer detail |
| POST | `/api/v1/driver/bookings/:bookingId/accept` | Atomic accept; body `{ "offerId"? }` |
| POST | `/api/v1/driver/bookings/:bookingId/decline` | Decline; body `{ "offerId"?, "reason"? }` |
| POST | `/api/v1/driver/bookings/:bookingId/reject` | Legacy alias for decline |
| PATCH | `/api/v1/driver/bookings/:bookingId/status` | Body `{ "status" }` |
| POST | `/api/v1/driver/bookings/:bookingId/cancel` | Driver cancel before ride start |
| POST | `/api/v1/driver/bookings/:bookingId/video/segments` | Multipart segment upload |

### Accept errors (409)
- `BOOKING_ALREADY_TAKEN`
- `OFFER_EXPIRED`

### Status errors (409)
- `RECORDING_CONSENT_REQUIRED` — `arrived` → `in_progress` without consent

### Other codes
`DRIVER_NOT_ONLINE`, `DRIVER_BUSY`, `DRIVER_NOT_ELIGIBLE`, `VEHICLE_NOT_APPROVED`, `SERVICE_CATEGORY_MISMATCH`, `OFFER_NOT_FOUND`, `BOOKING_NOT_ASSIGNED`, `INVALID_STATUS_TRANSITION`, `LOCATION_STALE`, `FORBIDDEN`, `UNAUTHORIZED`

---

## 8. Status transition matrix

Accept sets **`driver_en_route`** (skips `accepted`).

| From | To | Notes |
|------|-----|-------|
| `searching`/`offered` | `driver_en_route` | Via accept only |
| `driver_en_route` | `arrived` | Driver PATCH |
| `arrived` | `in_progress` | Requires `recordingConsentedAt`; creates trip + video session |
| `in_progress` | `completed` | Ends video session; driver → `online` |

---

## 9. Recording consent

**Passenger:** `POST /api/v1/passenger/bookings/:bookingId/consent-recording`  
Allowed: `driver_en_route`, `arrived` (and legacy `accepted`). Idempotent.

**Driver notification:** `booking:recording-consent`  
```json
{ "bookingId", "consented": true, "recordingConsentedAt": "ISO-8601" }
```

---

## 10. Video policy

- No video on offer, accept, en_route, or arrived.
- Video session created at `in_progress` (one active session per booking).
- Segments: `POST /api/v1/driver/bookings/:bookingId/video/segments` or legacy `POST /api/videos/live-chunk`.
- Requires consent + `in_progress` + assigned driver.
- Duplicate `segmentIndex` is idempotent (returns existing).
- Session ended on `completed` / cancel.

**`in_progress` response includes:**
```json
{
  "video": {
    "required": true,
    "sessionId": "uuid",
    "segmentDurationSeconds": 10,
    "nextSegmentIndex": 0
  }
}
```

---

## 11. Driver location

**Legacy (preserved):** `POST /api/locations`

```json
{
  "bookingId": "uuid-or-omit",
  "latitude": 23.8103,
  "longitude": 90.4125,
  "accuracy": 8,
  "speed": 5.5,
  "heading": 180,
  "timestamp": "ISO-8601"
}
```

- Identity from JWT.
- Optional `bookingId` must match driver's active assigned booking.
- Emits `driver:location` to passenger room during active booking.
- Also available via Socket `location:update` (existing).

---

## 12. Driver cancellation

`POST /api/v1/driver/bookings/:bookingId/cancel` — allowed in `driver_en_route`, `arrived`. Sets booking `cancelled`, notifies passenger, releases driver to `online`, stops video.

---

## 13. FCM / background delivery

**Not implemented.** Socket.IO + `GET .../offers/pending` + `GET .../offers/:offerId` support reconnect hydration. Production Android background requires future FCM integration.

---

## 14. Kotlin implementation sequence

1. Login → store JWT.
2. Connect Socket.IO with JWT → wait for `authenticated`.
3. `PATCH /api/drivers/:id/status` → `online`.
4. Start GPS → `POST /api/locations` (10s+ interval).
5. Listen `booking:offer` → show UI; optional `GET /offers/:offerId`.
6. Accept → `POST .../accept` with `offerId`.
7. On restore → `GET .../active`.
8. Status flow: `arrived` → wait `booking:recording-consent` → `in_progress`.
9. Upload segments to `.../video/segments` with `sessionId` from status response.
10. Include `bookingId` in location posts during ride.
11. `completed` → stop video/location booking scope.

---

## 15. Flutter passenger compatibility

Existing events preserved: `booking:searching`, `booking:accepted`, `booking:status`, `booking:expired`, `driver:location`, `video:live-segment`.  
`booking:accepted` now may include `vehicle` object (additive).

All passenger booking events include `bookingId` and `status` where applicable.

### Active booking restore — `GET /api/v1/passenger/bookings/active`

Returns the customer's current in-flight booking or `data: null`.

**Included statuses:** `searching`, `offered`, `scheduled`, `accepted`, `driver_en_route`, `arrived`, `in_progress`.

**Response (`data` when active):**
```json
{
  "id": "uuid",
  "status": "searching",
  "bookingNumber": "RYD-...",
  "pickup": { "latitude", "longitude", "address", "spotLabel" },
  "dropoff": { "latitude", "longitude", "address", "placeId" },
  "service": { "serviceCategoryId", "serviceCode", "serviceName" },
  "fare": { "amount", "currency", "estimatedAmount", "discountAmount" },
  "route": { "encodedPolyline", "distanceKm", "durationMin" },
  "driver": null,
  "createdAt": "ISO-8601"
}
```

Use on app launch and foreground/resume to restore the Finding Driver screen after background/kill.

### Polling fallback (recommended)

| When | Endpoint |
|------|----------|
| App launch | `GET /bookings/active` once |
| Foreground/resume | `GET /bookings/active` once |
| Socket disconnected only | `GET /bookings/active` every 10–15s |

Do **not** poll aggressively while the socket is connected.

### Passenger cancel — `POST /api/v1/passenger/bookings/:bookingId/cancel`

**Headers:** `Authorization`, optional `Idempotency-Key` (scoped to `customerId + bookingId + cancel`).

**Success (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "cancelled",
    "cancelledAt": "ISO-8601"
  }
}
```

**Idempotent:** Re-cancelling an already-cancelled booking returns the same shape (not 429).

**Not allowed after driver acceptance:**
```json
{
  "success": false,
  "error": {
    "code": "BOOKING_CANCELLATION_NOT_ALLOWED",
    "message": "This ride can no longer be cancelled."
  }
}
```

**Allowed passenger cancel statuses:** `searching`, `offered`, `driver_en_route`, `arrived`  
**Blocked:** `in_progress`, `completed`, `cancelled`

Cancel request body:
```json
{
  "reasonCode": "changed_mind",
  "reason": "optional text"
}
```

Accept and cancel use short DB transactions (`DB_TRANSACTION_TIMEOUT_MS`, default 8s) with Redis/socket work **after commit** to prevent lock deadlocks.

---

## 16. Known limitations

- Dispatch retry timers are in-memory (not Redis/Bull).
- No FCM push for offers.
- Scheduled bookings (`scheduled`) do not auto-dispatch yet.
- Multi-instance safe via Redis pub/sub for booking events; dispatch timers are per-instance.
- Concurrent accept integration tests not wired to CI DB.

---

## 17. Deployment configuration

Add to `.env`:
```
DRIVER_LOCATION_STALE_SECONDS=120
DISPATCH_RADIUS_KM=15
DISPATCH_BATCH_SIZE=5
DISPATCH_OFFER_TIMEOUT_SECONDS=45
DISPATCH_MAX_BATCHES=3
VIDEO_SEGMENT_DURATION_SECONDS=10
```

Restart server after changes. Redis required for location, status, and Socket.IO fan-out.
