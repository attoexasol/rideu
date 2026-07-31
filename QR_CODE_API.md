# QR Code API Reference

**Base URL:** `http://localhost:3000` (or your deployed host)

All QR endpoints require authentication unless noted. Obtain a session token first via login.

---

## Prerequisites — Login

| | |
|---|---|
| **Method** | `POST` |
| **URL** | `/api/auth/login` |
| **Headers** | `Content-Type: application/json` |
| **Body** | See below |

```json
{
  "auth0Token": "<Auth0 access token>",
  "deviceId": "postman-001",
  "deviceInfo": "Optional device label"
}
```

**Response:** Save `data.token` for all requests below.

---

## Common Headers

| Header | Required | Value |
|--------|----------|-------|
| `Authorization` | Yes | `Bearer <session token from login>` |
| `Content-Type` | POST endpoints only | `application/json` |
| `X-Device-ID` | Recommended for drivers | Device UUID (single-session enforcement) |

---

## QR Value Formats

| Type | Format | Stored in |
|------|--------|-----------|
| Driver identity | `DRIVER_<uuid>` | `drivers.qr_code` |
| Vehicle (cab) | `VEHICLE_<driverId>_<uuid>` | `drivers.vehicle_qr_code` |
| Company check-in | `COMPANY_CHECKIN` | Fixed constant (not in DB) |
| Passenger pickup | `TRIP_<tripId>_<uuid>` | `trips.passenger_qr_code` |

**Auto-generation:** Driver QR and vehicle QR are created when a driver is created. Passenger QR must be generated via API before image download.

---

## 1. Driver Identity QR

### 1.1 Generate QR image

| | |
|---|---|
| **Method** | `GET` |
| **URL** | `/api/drivers/:id/qrcode` |
| **Path params** | `id` — driver UUID |
| **Query params** | `format` — `png` (default) or `base64` |
| **Request body** | None |
| **Auth** | Admin, super_admin, or the driver themselves |

**Example URLs:**
```
GET /api/drivers/550e8400-e29b-41d4-a716-446655440000/qrcode
GET /api/drivers/550e8400-e29b-41d4-a716-446655440000/qrcode?format=base64
```

**Headers:**
```
Authorization: Bearer <token>
```

**Response — `format=base64` (JSON):**
```json
{
  "success": true,
  "data": {
    "driverId": "550e8400-e29b-41d4-a716-446655440000",
    "qrCode": "DRIVER_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "format": "base64",
    "base64": "iVBORw0KGgo...",
    "dataUrl": "data:image/png;base64,iVBORw0KGgo..."
  }
}
```

**Response — `format=png` (binary):**
- Body: PNG image bytes
- `Content-Type: image/png`
- `X-Driver-QR-Code: DRIVER_...`

---

### 1.2 Lookup driver by QR value

| | |
|---|---|
| **Method** | `GET` |
| **URL** | `/api/drivers/qr/:qrCode` |
| **Path params** | `qrCode` — URL-encoded `DRIVER_<uuid>` |
| **Request body** | None |
| **Auth** | Any authenticated user |

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "driverId": "D-10025",
    "name": "John Smith",
    "vehicle": "Prius 24",
    "status": "Active",
    "qrCode": "DRIVER_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "email": "john@example.com",
    "phone": "+15551234567",
    "cabName": "Cab 101",
    "cabNumber": "D-10025",
    "cabLicence": null,
    "vehicleMake": "Toyota",
    "vehicleModel": "Prius",
    "vehicleYear": "2024",
    "vehicleColor": "White"
  }
}
```

| Scan screen field | API field | Source |
|-------------------|-----------|--------|
| Driver ID | `driverId` | `cabNumber` → `cabName` → short UUID fallback |
| Name | `name` | `drivers.name` |
| Vehicle | `vehicle` | `vehicleModel` + year suffix (e.g. Prius + 2024 → "Prius 24") |
| Status | `status` | `online` → "Active", `offline` → "Offline", etc. |
| Internal UUID | `id` | `drivers.id` |

---

## 2. Vehicle (Cab) QR

Vehicle data lives on the **drivers** table (cab name, make, model, etc.). No separate vehicle record is created.

### 2.1 Generate vehicle QR image

| | |
|---|---|
| **Method** | `GET` |
| **URL** | `/api/vehicles/:driverId/qrcode` |
| **Path params** | `driverId` — driver UUID |
| **Query params** | `format` — `png` (default) or `base64` |
| **Request body** | None |
| **Auth** | Admin or super_admin |

**Example URLs:**
```
GET /api/vehicles/550e8400-e29b-41d4-a716-446655440000/qrcode
GET /api/vehicles/550e8400-e29b-41d4-a716-446655440000/qrcode?format=base64
```

**Headers:**
```
Authorization: Bearer <admin token>
```

**Response — `format=base64` (JSON):**
```json
{
  "success": true,
  "data": {
    "driverId": "550e8400-e29b-41d4-a716-446655440000",
    "qrCode": "VEHICLE_550e8400-e29b-41d4-a716-446655440000_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "format": "base64",
    "base64": "iVBORw0KGgo...",
    "dataUrl": "data:image/png;base64,iVBORw0KGgo..."
  }
}
```

**Response — `format=png` (binary):**
- Body: PNG image bytes
- `Content-Type: image/png`
- `X-Vehicle-QR-Code: VEHICLE_...`

---

### 2.2 Scan vehicle QR (lookup cab details)

| | |
|---|---|
| **Method** | `POST` |
| **URL** | `/api/vehicles/scan` |
| **Request body** | See below |
| **Auth** | Any authenticated user |

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Body:**
```json
{
  "qrCode": "VEHICLE_550e8400-e29b-41d4-a716-446655440000_a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "driverId": "550e8400-e29b-41d4-a716-446655440000",
    "driverName": "John Smith",
    "cabName": "Cab 101",
    "cabNumber": "CAB-101",
    "vehicleMake": "Ford",
    "vehicleModel": "Transit",
    "vehicleYear": "2022",
    "vehicleColor": "White",
    "cabLicence": "LIC-12345"
  }
}
```

---

### 2.3 Driver self-scan vehicle QR (shift verify)

| | |
|---|---|
| **Method** | `POST` |
| **URL** | `/api/drivers/scan-vehicle` |
| **Auth** | Driver (own `driverId`) or admin |

**Body:**
```json
{
  "driverId": "550e8400-e29b-41d4-a716-446655440000",
  "vehicleQrCode": "VEHICLE_550e8400-e29b-41d4-a716-446655440000_..."
}
```

**Note:** QR must belong to the same driver as `driverId`.

---

## 3. Company Check-In QR

Fixed QR value: `COMPANY_CHECKIN`. Used for depot check-in and check-out.

### 3.1 Generate company check-in QR image

| | |
|---|---|
| **Method** | `GET` |
| **URL** | `/api/company/checkin/qrcode` |
| **Query params** | `format` — `png` (default) or `base64` |
| **Request body** | None |
| **Auth** | Admin or super_admin |

**Example URLs:**
```
GET /api/company/checkin/qrcode
GET /api/company/checkin/qrcode?format=base64
```

**Headers:**
```
Authorization: Bearer <admin token>
```

**Response — `format=base64` (JSON):**
```json
{
  "success": true,
  "data": {
    "qrCode": "COMPANY_CHECKIN",
    "format": "base64",
    "base64": "iVBORw0KGgo...",
    "dataUrl": "data:image/png;base64,iVBORw0KGgo..."
  }
}
```

**Response — `format=png` (binary):**
- Body: PNG image bytes
- `Content-Type: image/png`
- `X-Company-CheckIn-QR-Code: COMPANY_CHECKIN`

---

### 3.2 Check-in (scan company QR)

| | |
|---|---|
| **Method** | `POST` |
| **URL** | `/api/drivers/check-in` |
| **Auth** | Driver (own) or admin |

**Body:**
```json
{
  "driverId": "550e8400-e29b-41d4-a716-446655440000",
  "qrCode": "COMPANY_CHECKIN",
  "location": "Main Depot"
}
```

`location` is optional.

---

### 3.3 Check-out (scan company QR)

| | |
|---|---|
| **Method** | `POST` |
| **URL** | `/api/drivers/check-out` |
| **Auth** | Driver (own) or admin |

**Body:**
```json
{
  "driverId": "550e8400-e29b-41d4-a716-446655440000",
  "qrCode": "COMPANY_CHECKIN"
}
```

---

## 4. Passenger Pickup QR

### 4.1 Generate passenger QR value

| | |
|---|---|
| **Method** | `POST` |
| **URL** | `/api/trips/:tripId/generate-qr` |
| **Path params** | `tripId` — trip UUID |
| **Request body** | None |
| **Auth** | Admin or super_admin |

**Example:**
```
POST /api/trips/660e8400-e29b-41d4-a716-446655440001/generate-qr
```

**Headers:**
```
Authorization: Bearer <admin token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "tripId": "660e8400-e29b-41d4-a716-446655440001",
    "qrCode": "TRIP_660e8400-e29b-41d4-a716-446655440001_a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  }
}
```

**Required before:** Call this before `GET .../qrcode` if the trip has no `passenger_qr_code` yet.

---

### 4.2 Generate passenger QR image

| | |
|---|---|
| **Method** | `GET` |
| **URL** | `/api/trips/:tripId/qrcode` |
| **Path params** | `tripId` — trip UUID |
| **Query params** | `format` — `png` (default) or `base64` |
| **Request body** | None |
| **Auth** | Admin or super_admin |

**Example URLs:**
```
GET /api/trips/660e8400-e29b-41d4-a716-446655440001/qrcode
GET /api/trips/660e8400-e29b-41d4-a716-446655440001/qrcode?format=base64
```

**Response — `format=base64` (JSON):**
```json
{
  "success": true,
  "data": {
    "tripId": "660e8400-e29b-41d4-a716-446655440001",
    "qrCode": "TRIP_660e8400-e29b-41d4-a716-446655440001_...",
    "format": "base64",
    "base64": "iVBORw0KGgo...",
    "dataUrl": "data:image/png;base64,iVBORw0KGgo..."
  }
}
```

**Response — `format=png` (binary):**
- Body: PNG image bytes
- `Content-Type: image/png`
- `X-Trip-Passenger-QR-Code: TRIP_...`

---

### 4.3 Scan passenger QR (verify pickup)

| | |
|---|---|
| **Method** | `POST` |
| **URL** | `/api/trips/scan-passenger` |
| **Auth** | Driver (own trip) or admin |

**Body:**
```json
{
  "driverId": "550e8400-e29b-41d4-a716-446655440000",
  "qrCode": "TRIP_660e8400-e29b-41d4-a716-446655440001_..."
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "verified": true,
    "tripId": "660e8400-e29b-41d4-a716-446655440001",
    "driverId": "550e8400-e29b-41d4-a716-446655440000",
    "tripStatus": "in_progress"
  }
}
```

---

## Quick Reference — Generation Endpoints Only

| # | Method | URL | Body | Query | Role |
|---|--------|-----|------|-------|------|
| 1 | GET | `/api/drivers/:id/qrcode` | — | `format=png\|base64` | Admin / own driver |
| 2 | GET | `/api/vehicles/:driverId/qrcode` | — | `format=png\|base64` | Admin |
| 3 | GET | `/api/company/checkin/qrcode` | — | `format=png\|base64` | Admin |
| 4 | POST | `/api/trips/:tripId/generate-qr` | — | — | Admin |
| 5 | GET | `/api/trips/:tripId/qrcode` | — | `format=png\|base64` | Admin |

---

## Backfill Scripts

For existing records missing QR values:

```powershell
npm run db:backfill-qr          # drivers.qr_code
npm run db:backfill-vehicle-qr  # drivers.vehicle_qr_code
```

---

## Related Postman Guides

- `POSTMAN_PHASE1_QR_TESTING.md`
- `POSTMAN_COMPANY_CHECKIN_QR.md`
- `POSTMAN_PASSENGER_PICKUP_QR.md`
