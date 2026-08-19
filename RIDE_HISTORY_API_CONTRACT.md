# Ride History API Contract

**Authority:** Implemented code in `src/`  
**Base:** `/api/v1`  
**Envelope:** `{ success, data, error?, metadata? }`  
**Currency:** `BDT` (hardcoded; no currency column)

Ride History is **bookings-backed**. `trips` is not queried. Active restore is unchanged.

---

## Status classification

| Booking status | Passenger `/active` | Passenger history | Driver `/active` | Driver history |
|----------------|---------------------|-------------------|------------------|----------------|
| `searching` | yes | no | no | no |
| `offered` | yes | no | no | no |
| `scheduled` | yes | no | no | no |
| `accepted` | yes | no | yes | no |
| `driver_en_route` | yes | no | yes | no |
| `arrived` | yes | no | yes | no |
| `in_progress` | yes | no | yes | no |
| `completed` | no | yes | no | yes |
| `cancelled` | no | yes | no | yes |
| `no_drivers` | no | yes | no | no |
| `quoted` | no | no | no | no |
| `expired` | unused on bookings | no | no | no |

Accept writes `driver_en_route`, not `accepted`. `expired` is an **offer** status; failed dispatch stores booking status **`no_drivers`**.

### `no_drivers` UI label

Do **not** map `no_drivers` to `completed`.

Recommended passenger labels:

- `completed` → Completed
- `cancelled` → Cancelled
- `no_drivers` → **Expired** (or “No driver found”)

`filter=cancelled` includes both `cancelled` and `no_drivers` so a single “Cancelled” chip can cover failed dispatch. The item `status` field remains `no_drivers` so the app can label it separately.

---

## Pagination

Query (both history lists):

| Param | Type | Default | Rules |
|-------|------|---------|--------|
| `page` | integer | `1` | `>= 1` |
| `limit` | integer | `20` | `1..50` |
| `filter` | enum | `all` | `all` \| `completed` \| `cancelled` |

Invalid values → `400 VALIDATION_ERROR`.

```json
{
  "success": true,
  "data": [],
  "metadata": {
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 50,
      "totalPages": 3
    }
  }
}
```

Sort: `created_at DESC, id DESC` (stable newest-first).

---

## Passenger

Auth: Bearer JWT, role `customer`. History and detail are scoped to `req.user.userId` (customer id). There is no customer-id query parameter.

### `GET /api/v1/passenger/bookings/active`

Unchanged restore endpoint. Returns one ongoing booking or `data: null`.

Ongoing statuses: `searching`, `offered`, `scheduled`, `accepted`, `driver_en_route`, `arrived`, `in_progress`.

The snapshot is additive (history fields are present when stored). Existing fields are preserved.

### `GET /api/v1/passenger/bookings`

Paginated **history only**. Excludes `PASSENGER_ONGOING_BOOKING_STATUSES`.

Filters:

- `all` → `completed`, `cancelled`, `no_drivers`
- `completed` → `completed`
- `cancelled` → `cancelled`, `no_drivers`

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "bookingNumber": "RYD-...",
      "status": "completed",
      "createdAt": "ISO-8601",
      "acceptedAt": "ISO-8601",
      "arrivedAt": "ISO-8601",
      "startedAt": "ISO-8601",
      "completedAt": "ISO-8601",
      "cancelledAt": null,
      "cancelledBy": null,
      "cancellationReason": null,
      "pickup": {
        "latitude": 23.81,
        "longitude": 90.41,
        "address": "Gulshan",
        "spotLabel": "Gate 1"
      },
      "dropoff": {
        "latitude": 23.75,
        "longitude": 90.38,
        "address": "Dhanmondi",
        "placeId": "place-1"
      },
      "route": {
        "encodedPolyline": "poly",
        "distanceKm": 11.05,
        "durationMin": 28
      },
      "service": {
        "serviceCategoryId": "uuid",
        "serviceCode": "ride",
        "serviceName": "Ride"
      },
      "fare": {
        "amount": 200,
        "currency": "BDT",
        "estimatedAmount": 220,
        "discountAmount": 20
      },
      "payment": {
        "methodCode": "cash",
        "methodName": "Cash",
        "status": "paid"
      },
      "driver": {
        "id": "uuid",
        "name": "Karim",
        "phone": "+880...",
        "plateNumber": "DHK-1234"
      },
      "vehicle": {
        "id": "uuid",
        "make": "Toyota",
        "model": "Axio",
        "color": "Silver",
        "plateNumber": "DHK-1234"
      },
      "recording": { "available": true },
      "schedulingType": "instant",
      "searchStartedAt": "ISO-8601"
    }
  ],
  "metadata": {
    "pagination": { "page": 1, "limit": 20, "total": 50, "totalPages": 3 }
  }
}
```

`driver` / `vehicle` are `null` when unassigned (`cancelled` before accept, `no_drivers`).

Distance/duration are **estimated** stored values. Google Maps is not called.

### `GET /api/v1/passenger/bookings/:bookingId`

Owner only. `403 FORBIDDEN` if another customer’s booking; `404` if missing.

Same snapshot as history/active (additive). Use this when a history row is tapped. Do not call `/api/trips`.

---

## Driver

Auth: Bearer JWT, role `driver`. Driver id is resolved from Auth0 / session identity. **Do not send `driverId`.**

### `GET /api/v1/driver/bookings/active`

Unchanged restore. Statuses: `accepted`, `driver_en_route`, `arrived`, `in_progress`. `data: null` if none.

Existing nested payload is preserved. Additive fields on `booking`: timestamps, `payment`, `recording`. Top-level `recording.available` is also present. `passenger.id` is included when the ride is assigned.

### `GET /api/v1/driver/bookings`

Paginated history. Registered **before** `/:bookingId`.

`WHERE assigned_driver_id = authenticated driver`.

Excludes `ACTIVE_BOOKING_STATUSES`. Does **not** include `searching`, `offered`, `scheduled`, `no_drivers`, or bookings the driver only received as an offer.

Filters:

- `all` → `completed`, `cancelled`
- `completed` → `completed`
- `cancelled` → `cancelled`

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "bookingNumber": "RYD-...",
      "status": "completed",
      "createdAt": "ISO-8601",
      "acceptedAt": "ISO-8601",
      "arrivedAt": "ISO-8601",
      "startedAt": "ISO-8601",
      "completedAt": "ISO-8601",
      "cancelledAt": null,
      "cancelledBy": null,
      "cancellationReason": null,
      "pickup": {
        "latitude": 23.81,
        "longitude": 90.41,
        "address": "Gulshan",
        "spotLabel": "Gate 1"
      },
      "dropoff": {
        "latitude": 23.75,
        "longitude": 90.38,
        "address": "Dhanmondi"
      },
      "route": {
        "distanceKm": 11.05,
        "durationMin": 28,
        "encodedPolyline": "poly"
      },
      "fare": { "amount": 200, "currency": "BDT" },
      "service": {
        "serviceCategoryId": "uuid",
        "serviceCode": "ride",
        "serviceName": "Ride"
      },
      "passenger": { "id": "uuid", "name": "Rahim" },
      "vehicle": {
        "id": "uuid",
        "make": "Toyota",
        "model": "Axio",
        "color": "Silver",
        "plateNumber": "DHK-1234"
      },
      "payment": {
        "methodCode": "cash",
        "methodName": "Cash",
        "status": "paid"
      },
      "recording": { "available": true }
    }
  ],
  "metadata": {
    "pagination": { "page": 1, "limit": 20, "total": 12, "totalPages": 1 }
  }
}
```

No earnings or commission fields (not stored).

### `GET /api/v1/driver/bookings/:bookingId`

- Assigned to this driver (any status, including completed/cancelled after assignment): full nested detail, additive history fields.
- Unassigned `searching`/`offered` **with a live pending offer**: still allowed for dispatch hydration (`passenger.displayName`). This is **not** used by the history list.
- Otherwise `404 BOOKING_NOT_ASSIGNED`.

History screens should only navigate here for rows returned by `GET /api/v1/driver/bookings`.

---

## `recording.available`

```json
{ "recording": { "available": true } }
```

`true` when the booking has at least one video segment with `upload_status` in `uploaded`/`verified`, a `storage_key`, and no `retention_deleted_at`.

Does **not** include session ids, signed URLs, segment counts, or DVR diagnostics.

---

## Realtime

No new sockets. Apps should:

1. Patch the active card from existing `booking:accepted` / `booking:status`.
2. Refetch history page 1 on terminal events (`completed`, `cancelled`, passenger `booking:expired`).
3. On History screen open / pull-to-refresh: `GET .../active` + `GET .../bookings?page=1`.

---

## Authorization

| Caller | History | Detail |
|--------|---------|--------|
| Passenger | own `customer_id` only | own booking or 403 |
| Driver | own `assigned_driver_id` only | assigned, or pending offer for live dispatch |

A driver cannot request another driver’s history by changing IDs. A passenger cannot pass another customer id.
