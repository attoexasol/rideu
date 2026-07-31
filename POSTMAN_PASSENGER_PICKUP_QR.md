# Passenger Pickup Verification QR — Postman Guide

**Base URL:** `http://localhost:3000`

**Auth:** All endpoints require `Authorization: Bearer <token>` from `POST /api/auth/login`.

---

## Overview

Passengers receive a unique QR code per trip. Drivers scan it at pickup to verify boarding.

| QR format | Example |
|-----------|---------|
| Encoded value | `TRIP_<tripId>_<uuid>` |

| Method | Endpoint | Role |
|--------|----------|------|
| POST | `/api/trips/:tripId/generate-qr` | Admin |
| GET | `/api/trips/:tripId/qrcode` | Admin |
| POST | `/api/trips/scan-passenger` | Driver (or admin) |

---

## Step 0 — Login

**Admin** (generate QR / download image):

`POST /api/auth/login`

```json
{
  "auth0Token": "<Auth0 access token>",
  "deviceId": "postman-admin-001"
}
```

Save `data.token` as `{{adminToken}}`.

**Driver** (scan at pickup):

Login with driver Auth0 token → save as `{{driverToken}}`.

---

## Step 1 — Start or pick a trip

Use an existing trip UUID or start one as driver:

`POST /api/trips`

```json
{
  "startTime": "2026-06-05T10:00:00.000Z"
}
```

Save `data.id` as `{{tripId}}`.

**SQL verify:**

```sql
SELECT id, driver_id, status, passenger_qr_code, qr_verified, trip_type
FROM trips
WHERE id = '{{tripId}}';
```

---

## Step 2 — Generate passenger QR (admin)

`POST /api/trips/{{tripId}}/generate-qr`

**Headers:**

```
Authorization: Bearer {{adminToken}}
```

**Expected response (200):**

```json
{
  "success": true,
  "data": {
    "tripId": "550e8400-e29b-41d4-a716-446655440000",
    "qrCode": "TRIP_550e8400-e29b-41d4-a716-446655440000_a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  }
}
```

Save `data.qrCode` as `{{passengerQrCode}}`.

**SQL verify:**

```sql
SELECT passenger_qr_code, qr_verified, qr_verified_at
FROM trips
WHERE id = '{{tripId}}';
```

---

## Step 3 — Download QR image (admin)

**Base64 JSON:**

`GET /api/trips/{{tripId}}/qrcode?format=base64`

**Expected response (200):**

```json
{
  "success": true,
  "data": {
    "tripId": "550e8400-e29b-41d4-a716-446655440000",
    "qrCode": "TRIP_550e8400-e29b-41d4-a716-446655440000_...",
    "format": "base64",
    "base64": "iVBORw0KGgoAAAANSUhEUgAA...",
    "dataUrl": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
  }
}
```

**PNG binary:**

`GET /api/trips/{{tripId}}/qrcode?format=png`

- Body: raw PNG bytes
- Headers: `Content-Type: image/png`, `X-Trip-Passenger-QR-Code: TRIP_...`

---

## Step 4 — Driver scans passenger QR

`POST /api/trips/scan-passenger`

**Headers:**

```
Authorization: Bearer {{driverToken}}
```

**Body:**

```json
{
  "driverId": "<driver-uuid-assigned-to-trip>",
  "qrCode": "{{passengerQrCode}}"
}
```

**Expected response (200):**

```json
{
  "success": true,
  "data": {
    "verified": true,
    "tripId": "550e8400-e29b-41d4-a716-446655440000",
    "driverId": "660e8400-e29b-41d4-a716-446655440001",
    "tripStatus": "in_progress"
  }
}
```

**SQL verify:**

```sql
SELECT qr_verified, qr_verified_at, status
FROM trips
WHERE id = '{{tripId}}';
```

---

## Error responses

| Status | Code | Cause |
|--------|------|-------|
| 401 | `AUTH_FAILED` | Missing or invalid Bearer token |
| 403 | `UNAUTHORIZED` | Non-admin calling generate/qrcode; wrong driver scanning |
| 404 | `NOT_FOUND` | Trip or driver not found |
| 400 | `VALIDATION_ERROR` | Invalid QR format; QR not generated yet |
| 500 | `SERVER_ERROR` | Unexpected failure |

---

## cURL examples

**Generate QR:**

```bash
curl -X POST -H "Authorization: Bearer ADMIN_TOKEN" \
  "http://localhost:3000/api/trips/TRIP_UUID/generate-qr"
```

**Get base64 image:**

```bash
curl -H "Authorization: Bearer ADMIN_TOKEN" \
  "http://localhost:3000/api/trips/TRIP_UUID/qrcode?format=base64"
```

**Driver scan:**

```bash
curl -X POST -H "Authorization: Bearer DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"driverId":"DRIVER_UUID","qrCode":"TRIP_TRIP_UUID_RANDOM"}' \
  "http://localhost:3000/api/trips/scan-passenger"
```

---

## Call order

1. Admin login → `{{adminToken}}`
2. Driver login → `{{driverToken}}`
3. Start trip (driver) → `{{tripId}}`
4. Generate passenger QR (admin) → `{{passengerQrCode}}`
5. Download QR image for passenger (admin)
6. Driver scans at pickup → `verified: true`
7. Confirm `qr_verified` and `qr_verified_at` in database

See also: [POSTMAN_PHASE1_QR_TESTING.md](./POSTMAN_PHASE1_QR_TESTING.md)
