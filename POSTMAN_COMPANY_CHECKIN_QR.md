# Company Check-In QR — Postman Guide

**Base URL:** `http://localhost:3000`

**Auth:** Admin session token required (`Authorization: Bearer <token>`).

---

## Overview

Generates a printable QR code whose encoded value is the fixed string `COMPANY_CHECKIN`. Drivers scan this QR at the depot for check-in and check-out (`POST /api/drivers/check-in`, `POST /api/drivers/check-out`).

| Method | Endpoint | Role |
|--------|----------|------|
| GET | `/api/company/checkin/qrcode` | Admin |

---

## Step 0 — Login (admin)

`POST /api/auth/login`

```json
{
  "auth0Token": "<Auth0 access token>",
  "deviceId": "postman-admin-001"
}
```

Save `data.token` as `{{token}}`.

**Headers for all requests below:**

```
Authorization: Bearer {{token}}
```

---

## Step 1 — Generate QR as base64 JSON

`GET /api/company/checkin/qrcode?format=base64`

**Expected response (200):**

```json
{
  "success": true,
  "data": {
    "qrCode": "COMPANY_CHECKIN",
    "format": "base64",
    "base64": "iVBORw0KGgoAAAANSUhEUgAA...",
    "dataUrl": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
  }
}
```

**Postman tips:**
- Paste `data.dataUrl` into a browser address bar to preview the QR image.
- Decode `data.base64` or save `dataUrl` for printing at the depot.

---

## Step 2 — Generate QR as PNG binary

`GET /api/company/checkin/qrcode?format=png`

**Expected response (200):**
- Body: raw PNG image bytes
- Headers:
  - `Content-Type: image/png`
  - `Content-Disposition: inline; filename="company-checkin-qrcode.png"`
  - `X-Company-CheckIn-QR-Code: COMPANY_CHECKIN`

**Postman tips:**
- Use **Send and Download** to save the PNG file.
- Default format when `format` is omitted is `png`.

---

## Step 3 — Driver check-in (uses scanned value)

After printing the QR, drivers scan it. The app sends:

`POST /api/drivers/check-in`

```json
{
  "driverId": "<driver-uuid>",
  "qrCode": "COMPANY_CHECKIN",
  "location": "Main Depot"
}
```

---

## Step 4 — Driver check-out

`POST /api/drivers/check-out`

```json
{
  "driverId": "<driver-uuid>",
  "qrCode": "COMPANY_CHECKIN"
}
```

---

## Error responses

| Status | Code | Cause |
|--------|------|-------|
| 401 | `AUTH_FAILED` | Missing or invalid Bearer token |
| 403 | `UNAUTHORIZED` | Token valid but user is not admin/super_admin |
| 400 | `VALIDATION_ERROR` | Invalid `format` query value (must be `png` or `base64`) |
| 500 | `SERVER_ERROR` | QR generation failure |

---

## cURL examples

**Base64 JSON:**

```bash
curl -s -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:3000/api/company/checkin/qrcode?format=base64"
```

**PNG file:**

```bash
curl -s -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:3000/api/company/checkin/qrcode?format=png" \
  -o company-checkin-qrcode.png
```

---

## Call order (full Phase-1 flow)

1. Admin login → `{{token}}`
2. **Generate company check-in QR** → print at depot
3. Create vehicle → scan vehicle QR → check-in → check-out

See also: [POSTMAN_PHASE1_QR_TESTING.md](./POSTMAN_PHASE1_QR_TESTING.md)
