# Phase-1 QR Features — Postman Testing Guide

**Base URL:** `http://localhost:3000`

**Auth:** All endpoints require `Authorization: Bearer <data.token from POST /api/auth/login>`.

---

## Setup

```powershell
npm run db:migrate
npm run db:backfill-vehicle-qr
npm run dev
```

---

## Step 0 — Login

`POST /api/auth/login`

```json
{
  "auth0Token": "<Auth0 access token>",
  "deviceId": "postman-001"
}
```

Save `data.token` as `{{token}}`.

---

## Step 1 — Create Vehicle

`POST /api/vehicles` (admin token)

```json
{
  "plateNumber": "ABC123",
  "bodyNumber": "VAN-101",
  "make": "Ford",
  "model": "Transit",
  "year": 2022,
  "status": "active"
}
```

Save `data.id` → `{{vehicleId}}`, `data.qrCode` → `{{vehicleQrCode}}`.

**SQL:**
```sql
SELECT id, body_number, plate_number, qr_code, status FROM vehicles WHERE id = '<vehicleId>';
```

---

## Step 2 — Generate Vehicle QR

`GET /api/vehicles/{{vehicleId}}/qrcode?format=base64`

**Expected:** `data.qrCode` = `VEHICLE_<uuid>`

---

## Step 3 — Lookup Vehicle by QR

`GET /api/vehicles/qr/{{vehicleQrCode}}`

---

## Step 4 — Scan & Assign Vehicle

`POST /api/drivers/scan-vehicle` (driver or admin token)

```json
{
  "driverId": "<driver-uuid>",
  "vehicleQrCode": "VEHICLE_..."
}
```

**SQL:**
```sql
SELECT d.vehicle_id, a.status, a.assigned_at
FROM drivers d
JOIN driver_vehicle_assignments a ON a.driver_id = d.id AND a.status = 'active'
WHERE d.id = '<driverId>';
```

---

## Step 4b — Generate Company Check-In QR (admin)

`GET /api/company/checkin/qrcode?format=base64`

**Headers:** `Authorization: Bearer {{token}}` (admin token)

**Expected:**

```json
{
  "success": true,
  "data": {
    "qrCode": "COMPANY_CHECKIN",
    "format": "base64",
    "base64": "...",
    "dataUrl": "data:image/png;base64,..."
  }
}
```

PNG variant: `GET /api/company/checkin/qrcode?format=png`

See [POSTMAN_COMPANY_CHECKIN_QR.md](./POSTMAN_COMPANY_CHECKIN_QR.md) for full details.

---

## Step 5 — Check-In

`POST /api/drivers/check-in`

```json
{
  "driverId": "<driver-uuid>",
  "qrCode": "COMPANY_CHECKIN",
  "location": "Main Depot"
}
```

**SQL:**
```sql
SELECT * FROM driver_attendance WHERE driver_id = '<driverId>' AND status = 'checked_in';
SELECT status FROM drivers WHERE id = '<driverId>';
```

---

## Step 6 — Check-Out

`POST /api/drivers/check-out`

```json
{
  "driverId": "<driver-uuid>",
  "qrCode": "COMPANY_CHECKIN"
}
```

---

## Step 7 — Verify Assignment

`GET /api/drivers/{{driverId}}/assignment`

---

## Step 8 — Verify Attendance

`GET /api/drivers/{{driverId}}/attendance`

---

## Call order

1. Login → token
2. Create vehicle
3. Generate vehicle QR
4. **Generate company check-in QR (admin)**
5. Scan vehicle QR
6. Check-in (`COMPANY_CHECKIN`)
7. Verify assignment + attendance
8. Check-out
