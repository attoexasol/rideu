# Admin Panel API Reference

**Base URL:** `http://localhost:3000`  
**API prefix:** `/api`  
**Map provider (admin):** Mapbox (`MAPBOX_ACCESS_TOKEN`) — road snapping on location/breadcrumb endpoints and WebSocket `location:broadcast`

---

## Were existing admin APIs changed?

| Area | Changed? | Details |
|------|----------|---------|
| Admin URL paths | **No** | All existing `/api/admin/*`, `/api/drivers`, `/api/locations`, etc. paths are the same |
| Request bodies (existing) | **No** | Same schemas as before |
| `POST /api/auth/login` | **Minor** | Also accepts `customer` role in Auth0 token; **admin login unchanged** |
| WebSocket `location:broadcast` | **Additive** | Now includes `snappedLatitude`, `snappedLongitude` (Mapbox) for admin map |
| Trip records | **Additive** | Passenger rides may include `bookingId`, `customerId` on `trips` rows |
| **New** admin routes | **Yes** | `/api/v1/admin/*` for service categories & driver booking types |

**Passenger app uses Google Maps** (`/api/v1/passenger/places/*`). Admin panel endpoints below use **Mapbox only** where noted.

---

## Authentication (all admin requests)

```http
Authorization: Bearer <session_jwt_from_login>
Content-Type: application/json
```

### Standard success envelope (most routes)

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
    "message": "Access denied. Required role(s): admin, super_admin"
  }
}
```

> **Note:** `/api/admin/users` uses a legacy envelope: `{ "status": "success" \| "error", "data": ..., "message": ... }`

---

## 1. Health

### `GET /health`

No auth. Service health check.

**Response 200:**
```json
{
  "status": "healthy",
  "timestamp": "2026-06-25T12:00:00.000Z",
  "services": {
    "database": { "status": "healthy", "latency": 5 },
    "redis": { "status": "healthy", "latency": 2 }
  }
}
```

---

## 2. Auth (admin login)

### `POST /api/auth/login`

**Request:**
```json
{
  "auth0Token": "<auth0_access_token>",
  "deviceId": "optional-device-uuid",
  "deviceInfo": "optional-device-name"
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
      "email": "admin@example.com",
      "name": "Admin User",
      "role": "admin"
    }
  }
}
```

### `POST /api/auth/refresh`

**Request:**
```json
{
  "refreshToken": "<refresh_token>"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "token": "<new_jwt>",
    "refreshToken": "<new_refresh_token>"
  }
}
```

### `POST /api/auth/logout`

**Headers:** `Authorization: Bearer <token>`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "message": "Logged out successfully"
  }
}
```

### `GET /api/auth/me`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "admin@example.com",
    "name": "Admin User",
    "role": "admin",
    "status": "active"
  }
}
```

### `GET /api/auth/validate-session`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "valid": true,
    "sessionId": "sess_...",
    "expiresAt": "2026-06-26T12:00:00.000Z"
  }
}
```

---

## 3. Admin — User management

Base: `/api/admin/users`  
**Auth:** `admin` or `super_admin`

### `GET /api/admin/users`

**Query:**
| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Default `1` |
| `limit` | number | Default `100` |
| `role` | string | `driver`, `admin`, `super_admin` |
| `search` | string | Name or email |

**Response 200:**
```json
{
  "status": "success",
  "data": {
    "users": [
      {
        "id": "uuid",
        "auth0Id": "auth0|...",
        "email": "driver@example.com",
        "name": "John Smith",
        "role": "driver",
        "phone": "+880...",
        "status": "online",
        "cabName": "Cab 1",
        "cabNumber": "DHM-123",
        "cabLicence": null,
        "qrCode": "DRV_...",
        "vehicleMake": "Toyota",
        "vehicleModel": "Corolla",
        "vehicleYear": "2022",
        "vehicleColor": "White",
        "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 100,
      "total": 50,
      "totalPages": 1
    }
  }
}
```

### `POST /api/admin/users`

**Auth:** `admin` (drivers only) \| `super_admin` (any role)

**Request:**
```json
{
  "email": "driver@example.com",
  "password": "SecurePass123!",
  "role": "driver",
  "name": "John Smith",
  "phone": "+8801712345678",
  "cabName": "Cab 1",
  "cabFieldType": "cab_number",
  "cabValue": "DHM-123",
  "vehicleMake": "Toyota",
  "vehicleModel": "Corolla",
  "vehicleYear": "2022",
  "vehicleColor": "White"
}
```

**Response 201:**
```json
{
  "status": "success",
  "data": {
    "id": "uuid",
    "auth0Id": "auth0|...",
    "email": "driver@example.com",
    "name": "John Smith",
    "role": "driver"
  },
  "message": "User created successfully"
}
```

### `PATCH /api/admin/users/:id/role`

**Auth:** `super_admin` only

**Request:**
```json
{
  "role": "admin"
}
```

**Response 200:**
```json
{
  "status": "success",
  "data": {
    "id": "uuid",
    "role": "admin"
  },
  "message": "User role updated successfully"
}
```

### `POST /api/admin/users/:id/reset-password`

**Auth:** `admin` (drivers only) \| `super_admin` (anyone)

**Request:** `{}` (empty body)

**Response 200:**
```json
{
  "status": "success",
  "message": "Password reset email sent"
}
```

### `DELETE /api/admin/users/:id`

**Auth:** `admin` (drivers only) \| `super_admin` (anyone except last super_admin)

**Response 200:**
```json
{
  "status": "success",
  "message": "User deleted successfully"
}
```

---

## 4. Drivers (admin)

Base: `/api/drivers`

### `GET /api/drivers`

**Auth:** `admin`

**Query:**
| Param | Type |
|-------|------|
| `status` | `online` \| `offline` |
| `vehicleType` | `sedan` \| `suv` \| `van` \| `mini_bus` \| `coach_bus` |
| `search` | string |
| `page` | number (default `1`) |
| `limit` | number (default `20`) |

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "auth0Id": "auth0|...",
      "email": "driver@example.com",
      "name": "John Smith",
      "phone": "+880...",
      "status": "online",
      "vehicleType": "sedan",
      "vehicleId": "uuid",
      "cabName": "Cab 1",
      "cabNumber": "DHM-123",
      "cabLicence": null,
      "qrCode": "DRV_...",
      "vehicleMake": "Toyota",
      "vehicleModel": "Corolla",
      "vehicleYear": "2022",
      "vehicleColor": "White",
      "lastSeen": "2026-06-25T12:00:00.000Z",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-06-25T12:00:00.000Z",
      "vehicle": {
        "id": "uuid",
        "make": "Toyota",
        "model": "Corolla",
        "plateNumber": "DHM-LA-63-525"
      }
    }
  ],
  "metadata": {
    "pagination": { "page": 1, "limit": 20, "total": 50, "totalPages": 3 }
  }
}
```

### `GET /api/drivers/:id`

**Auth:** `admin` (any driver) \| `driver` (own profile)

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "John Smith",
    "email": "driver@example.com",
    "status": "online",
    "currentLocation": {
      "latitude": 23.8103,
      "longitude": 90.4125,
      "timestamp": "2026-06-25T12:00:00.000Z"
    }
  }
}
```

### `POST /api/drivers`

**Auth:** `admin`

**Request:**
```json
{
  "email": "newdriver@example.com",
  "password": "SecurePass123!",
  "name": "New Driver",
  "phone": "+8801712345678",
  "vehicleType": "sedan",
  "vehicleId": "uuid-optional",
  "cabName": "Cab 1",
  "cabFieldType": "cab_number",
  "cabValue": "DHM-123",
  "vehicleMake": "Toyota",
  "vehicleModel": "Corolla",
  "vehicleYear": "2022",
  "vehicleColor": "White"
}
```

**Response 201:** Full driver object in `data`.

### `PUT /api/drivers/:id`

**Auth:** `admin`

**Request (all optional):**
```json
{
  "name": "Updated Name",
  "phone": "+880...",
  "vehicleType": "suv",
  "vehicleId": "uuid",
  "status": "offline",
  "cabName": "Cab 2",
  "cabFieldType": "cab_licence",
  "cabValue": "LIC-456",
  "vehicleMake": "Honda",
  "vehicleModel": "Civic",
  "vehicleYear": "2023",
  "vehicleColor": "Black"
}
```

**Response 200:** Updated driver in `data`.

### `DELETE /api/drivers/:id`

**Auth:** `admin`

**Response 200:**
```json
{
  "success": true,
  "data": { "message": "Driver deleted" }
}
```

### `PATCH /api/drivers/:id/status`

**Auth:** `admin` \| `driver` (own status)

**Request:**
```json
{
  "status": "online"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "online"
  }
}
```

### `GET /api/drivers/:id/qrcode`

**Auth:** `admin` \| `driver` (own QR)

**Query:** `format=png` (default) \| `base64`

**Response (base64):**
```json
{
  "success": true,
  "data": {
    "driverId": "uuid",
    "qrCode": "DRV_...",
    "format": "base64",
    "base64": "...",
    "dataUrl": "data:image/png;base64,..."
  }
}
```

**Response (png):** Binary `image/png` with header `X-Driver-QR-Code`.

### `GET /api/drivers/:driverId/assignment`

**Auth:** authenticated (admin or driver)

**Response 200:**
```json
{
  "success": true,
  "data": {
    "assignmentId": "uuid",
    "driverId": "uuid",
    "vehicleId": "uuid",
    "status": "active"
  }
}
```

### `GET /api/drivers/:driverId/attendance`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "checkedIn": true,
    "checkInTime": "2026-06-25T08:00:00.000Z"
  }
}
```

---

## 5. Locations (admin — Mapbox)

Base: `/api/locations`

### `GET /api/locations/active`

**Auth:** `admin`  
Live fleet map — all drivers with last known position.

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "driverId": "uuid",
      "driverName": "John Smith",
      "status": "online",
      "lastSeen": "2026-06-25T12:00:00.000Z",
      "latitude": "23.81030000",
      "longitude": "90.41250000",
      "timestamp": "2026-06-25T12:00:00.000Z"
    }
  ]
}
```

### `GET /api/locations/:driverId`

**Auth:** `admin`  
Breadcrumb history with **Mapbox road snapping** (default).

**Query:**
| Param | Type | Default |
|-------|------|---------|
| `startDate` | ISO datetime | — |
| `endDate` | ISO datetime | — |
| `limit` | number | `100` |
| `snapToRoads` | boolean | `true` |

**Response 200:**
```json
{
  "success": true,
  "data": {
    "sessions": [
      {
        "id": 1,
        "startTime": "2026-06-25T08:00:00.000Z",
        "endTime": "2026-06-25T09:30:00.000Z",
        "duration": 5400000,
        "distance": 12500,
        "pointCount": 45,
        "originalPointCount": 120,
        "points": [
          {
            "latitude": 23.8103,
            "longitude": 90.4125,
            "speed": 12.5,
            "heading": 180,
            "timestamp": "2026-06-25T08:00:00.000Z"
          }
        ],
        "roadGeometry": [[90.4125, 23.8103], [90.4130, 23.8110]],
        "snapped": [
          { "latitude": 23.8103, "longitude": 90.4125, "distance": 2.1 }
        ]
      }
    ],
    "meta": {
      "driverId": "uuid",
      "driverName": "John Smith",
      "totalSessions": 1,
      "totalDistance": 12500,
      "totalFilteredPoints": 45,
      "snappedToRoads": true
    }
  }
}
```

### `GET /api/locations/:driverId/today`

**Auth:** `admin`  
Today's trail with Mapbox snapping.

**Query:** `snapToRoads=true` (default) \| `false`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "raw": [
      {
        "id": "uuid",
        "latitude": 23.8103,
        "longitude": 90.4125,
        "speed": 12.5,
        "heading": 180,
        "timestamp": "2026-06-25T08:00:00.000Z"
      }
    ],
    "roadGeometry": [[90.4125, 23.8103], [90.4130, 23.8110]],
    "snapped": [
      { "latitude": 23.8103, "longitude": 90.4125, "distance": 2.1 }
    ],
    "meta": {
      "driverId": "uuid",
      "driverName": "John Smith",
      "count": 120,
      "snappedToRoads": true,
      "date": "2026-06-25"
    }
  }
}
```

### `DELETE /api/locations/cleanup`

**Auth:** `admin`  
Deletes locations older than 6 months.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "deletedCount": 1500,
    "cutoffDate": "2025-12-25T00:00:00.000Z"
  }
}
```

---

## 6. Trips (admin access)

Base: `/api/trips`

### `GET /api/trips/:driverId`

**Auth:** `admin` (any driver) \| `driver` (own trips)

**Query:** `startDate`, `endDate`, `status` (`in_progress`\|`completed`\|`cancelled`), `page`, `limit`

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "startTime": "2026-06-25T08:00:00.000Z",
      "endTime": "2026-06-25T09:00:00.000Z",
      "distance": 12.5,
      "status": "completed",
      "startLocationId": "uuid",
      "endLocationId": "uuid"
    }
  ],
  "metadata": {
    "pagination": { "page": 1, "limit": 20, "total": 10, "totalPages": 1 }
  }
}
```

> Passenger rides also store `bookingId` and `customerId` on the `trips` row (visible in raw DB; trip list may include these fields).

### `GET /api/trips/:tripId/videos`

**Auth:** `admin` \| driver (own trip)

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "tripId": "uuid",
      "driverId": "uuid",
      "videoUrl": "/uploads/videos/2026/06/abc.mp4",
      "mimeType": "video/mp4",
      "fileSize": 1048576,
      "durationSeconds": 120,
      "startedAt": "2026-06-25T08:00:00.000Z",
      "endedAt": "2026-06-25T08:02:00.000Z",
      "uploadStatus": "uploaded",
      "createdAt": "2026-06-25T08:02:00.000Z"
    }
  ]
}
```

### `POST /api/trips/:tripId/generate-qr`

**Auth:** `admin` only (enforced in controller)

**Request:** `{}`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "tripId": "uuid",
    "qrCode": "TRIP_uuid_..."
  }
}
```

### `GET /api/trips/:tripId/qrcode`

**Auth:** `admin` only

**Query:** `format=png` (default) \| `base64`

**Response (base64):**
```json
{
  "success": true,
  "data": {
    "tripId": "uuid",
    "qrCode": "TRIP_...",
    "format": "base64",
    "base64": "...",
    "dataUrl": "data:image/png;base64,..."
  }
}
```

---

## 7. Reports (admin)

Base: `/api/reports`

### `GET /api/reports/export`

**Auth:** `admin`

**Query:**
| Param | Required | Values |
|-------|----------|--------|
| `type` | yes | `csv` \| `pdf` |
| `reportType` | yes | `drivers` \| `trips` \| `locations` |
| `startDate` | no | ISO datetime |
| `endDate` | no | ISO datetime |
| `driverId` | no | uuid |

**Response (csv):** File download `text/csv`

**Response (pdf):**
```json
{
  "success": true,
  "data": {
    "message": "PDF export not yet implemented",
    "data": []
  }
}
```

### `GET /api/reports/driver/:id`

**Auth:** `admin`

**Query:** `startDate`, `endDate` (ISO datetime)

**Response 200:**
```json
{
  "success": true,
  "data": {
    "driverId": "uuid",
    "driverName": "John Smith",
    "totalTrips": 45,
    "totalDistance": 520.5,
    "totalHours": 120.5,
    "averageSpeed": 25.3,
    "trips": [
      {
        "id": "uuid",
        "startTime": "2026-06-25T08:00:00.000Z",
        "endTime": "2026-06-25T09:00:00.000Z",
        "distance": 12.5,
        "status": "completed"
      }
    ]
  }
}
```

### `GET /api/reports/fleet`

**Auth:** `admin`

**Query:** `startDate`, `endDate`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "totalDrivers": 50,
    "activeDrivers": 12,
    "totalTrips": 320,
    "totalDistance": 4500.5,
    "driverStats": [
      {
        "driverId": "uuid",
        "name": "John Smith",
        "trips": 45,
        "distance": 520.5,
        "hours": 120.5
      }
    ]
  }
}
```

---

## 8. Company QR (admin)

### `GET /api/company/checkin/qrcode`

**Auth:** `admin`

**Query:** `format=png` (default) \| `base64`

**Response (base64):**
```json
{
  "success": true,
  "data": {
    "qrCode": "COMPANY_CHECKIN_...",
    "format": "base64",
    "base64": "...",
    "dataUrl": "data:image/png;base64,..."
  }
}
```

---

## 9. Vehicle QR (admin)

### `GET /api/vehicles/:driverId/qrcode`

**Auth:** `admin` only

**Query:** `format=png` (default) \| `base64`

**Response:** Same pattern as driver QR (PNG binary or base64 JSON).

---

## 10. Videos (admin)

Base: `/api/videos`

### `GET /api/videos/:videoId`

**Auth:** authenticated (admin can access any)

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "tripId": "uuid",
    "driverId": "uuid",
    "videoUrl": "/uploads/videos/2026/06/abc.mp4",
    "mimeType": "video/mp4",
    "fileSize": 1048576,
    "durationSeconds": 120,
    "uploadStatus": "uploaded"
  }
}
```

### `DELETE /api/videos/:videoId`

**Auth:** `admin`

**Response 200:**
```json
{
  "success": true,
  "data": { "message": "Video deleted" }
}
```

---

## 11. Booking / service categories (NEW — admin)

Base: `/api/v1/admin`  
**Auth:** `admin` or `super_admin`

### `GET /api/v1/admin/service-categories`

List ride types (CNG, Moto, Bike, etc.) for assigning to drivers.

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "code": "cng",
      "name": "CNG",
      "description": "Affordable, eco-friendly rides",
      "iconKey": "cng",
      "capacity": 4,
      "baseFare": "40.00",
      "perKmRate": "20.00",
      "minFare": "70.00",
      "isActive": true,
      "sortOrder": 3
    }
  ]
}
```

### `GET /api/v1/admin/drivers/:driverId/service-categories`

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "driverId": "uuid",
      "serviceCategoryId": "uuid",
      "isPrimary": true,
      "verifiedAt": "2026-06-25T12:00:00.000Z",
      "code": "cng",
      "name": "CNG"
    }
  ]
}
```

### `POST /api/v1/admin/driver-service-categories`

Assign a service type to a driver (admin only).

**Request:**
```json
{
  "driverId": "uuid",
  "serviceCategoryId": "uuid",
  "isPrimary": false
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "driverId": "uuid",
    "serviceCategoryId": "uuid",
    "isPrimary": false,
    "verifiedAt": "2026-06-25T12:00:00.000Z"
  }
}
```

### `DELETE /api/v1/admin/drivers/:driverId/service-categories/:categoryId`

**Response 200:**
```json
{
  "success": true,
  "data": { "message": "Removed" }
}
```

---

## 12. WebSocket (admin panel — Mapbox live map)

**Connect:** `ws://localhost:3000` (Socket.IO)  
**Auth:** pass JWT in `handshake.auth.token`

### Server → Admin events

#### `authenticated`
```json
{
  "userId": "uuid",
  "userType": "admin",
  "role": "admin",
  "rooms": ["admin", "<socket_id>"]
}
```

#### `location:broadcast` (Mapbox-snapped for map)
```json
{
  "driverId": "uuid",
  "driverName": "John Smith",
  "latitude": 23.8103,
  "longitude": 90.4125,
  "snappedLatitude": 23.8104,
  "snappedLongitude": 90.4126,
  "speed": 12.5,
  "heading": 180,
  "timestamp": "2026-06-25T12:00:00.000Z"
}
```

#### `driver:status_change`
```json
{
  "driverId": "uuid",
  "driverName": "John Smith",
  "status": "online",
  "timestamp": "2026-06-25T12:00:00.000Z"
}
```

#### `driver:online` / `driver:offline`
```json
{
  "driverId": "uuid",
  "driverName": "John Smith",
  "timestamp": "2026-06-25T12:00:00.000Z"
}
```

#### `booking:status` / `booking:accepted` (NEW — passenger bookings)
```json
{
  "bookingId": "uuid",
  "status": "driver_en_route",
  "timestamp": "2026-06-25T12:00:00.000Z"
}
```

#### `video:live-segment` (NEW — safety live view)
```json
{
  "bookingId": "uuid",
  "sessionId": "uuid",
  "segmentIndex": 12,
  "videoUrl": "/uploads/videos/2026/06/live/uuid/segment.mp4",
  "timestamp": "2026-06-25T12:00:00.000Z"
}
```

#### `video:session-started` / `video:session-ended`
```json
{
  "sessionId": "uuid",
  "tripId": "uuid",
  "bookingId": "uuid",
  "customerId": "uuid"
}
```

### Admin → Server events

#### `location:get`
**Request:**
```json
{ "driverId": "uuid" }
```

**Callback response:**
```json
{
  "success": true,
  "data": {
    "latitude": 23.8103,
    "longitude": 90.4125,
    "speed": 12.5,
    "heading": 180,
    "timestamp": "2026-06-25T12:00:00.000Z"
  }
}
```

#### `ping` → receives `pong`
```json
{ "timestamp": "2026-06-25T12:00:00.000Z" }
```

---

## Environment variables (admin panel)

```env
MAPBOX_ACCESS_TOKEN=pk....    # Required for admin map / road snapping
AUTH0_DOMAIN=...
AUTH0_CLIENT_ID=...
JWT_SECRET=...
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
CORS_ORIGIN=http://localhost:5173
```

`GOOGLE_MAPS_API_KEY` is **not** used by admin panel endpoints.
