# Trip Video API Reference

**Base URL:** `http://localhost:3000`

---

## Authentication

All endpoints require:

```
Authorization: Bearer <session token from POST /api/auth/login>
```

Drivers should also send:

```
X-Device-ID: <device-uuid>
```

---

## Obtaining `tripId` (mobile app)

Before uploading video, the driver app needs the active trip UUID.

**Recommended:** `GET /api/trips/current`

```http
GET /api/trips/current
Authorization: Bearer <token>
X-Device-ID: <device-uuid>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "trip_uuid",
    "status": "in_progress",
    "pickup": "40.71280000, -74.00600000",
    "dropoff": null
  }
}
```

Use **`data.id`** as the `tripId` field in `POST /api/videos/upload`.

**404** when the driver has no trip with `status: "in_progress"`.

**Alternatives (legacy):**

| Endpoint | How to get `tripId` |
|----------|---------------------|
| `POST /api/trips` | Returns existing active trip or creates one; use `data.id` |
| `GET /api/trips/me?status=in_progress&limit=1` | Use first item in `data[]` → `id` |

`pickup` / `dropoff` are `"latitude, longitude"` from linked start/end locations, or `null` if not set.

---

## Upload flow

```
GET /api/trips/current  →  data.id as tripId
        ↓
POST /api/videos/upload  (multipart video + metadata)
        ↓
File saved to uploads/videos/YYYY/MM/<uuid>.mp4
Metadata saved to trip_videos table
        ↓
Response returns videoUrl
        ↓
Mobile app deletes local recording
```

---

## Endpoints

### GET /api/trips/current

**Role:** driver (authenticated)

Returns the driver's single active trip (`status: "in_progress"`). See [Obtaining tripId](#obtaining-tripid-mobile-app) above.

---

### POST /api/videos/upload

**Role:** driver  
**Content-Type:** `multipart/form-data`

| Field | Type | Required |
|-------|------|----------|
| `video_file` | file | yes |
| `tripId` | uuid string | yes |
| `startTime` | ISO datetime | yes |
| `endTime` | ISO datetime | yes |
| `duration` | number (seconds) | yes |

**Allowed MIME:** `video/mp4`, `video/quicktime`  
**Max size:** 500 MB  
**Rejected:** `.exe`, `.zip`, fake MIME (magic-byte check)

**Response (201):**
```json
{
  "success": true,
  "data": {
    "videoId": "uuid",
    "videoUrl": "/uploads/videos/2026/06/uuid.mp4",
    "tripId": "uuid"
  }
}
```

---

### GET /api/trips/:tripId/videos

**Role:** trip owner (driver) or admin

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "videoUrl": "/uploads/videos/2026/06/uuid.mp4",
      "duration": 120
    }
  ]
}
```

---

### GET /api/videos/:videoId

**Role:** trip owner or admin

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "tripId": "uuid",
    "driverId": "uuid",
    "fileName": "uuid.mp4",
    "originalName": "trip-recording.mp4",
    "videoUrl": "/uploads/videos/2026/06/uuid.mp4",
    "mimeType": "video/mp4",
    "fileSize": 104857600,
    "durationSeconds": 120,
    "startedAt": "2026-06-20T10:00:00.000Z",
    "endedAt": "2026-06-20T10:02:00.000Z",
    "uploadStatus": "uploaded",
    "createdAt": "2026-06-20T10:05:00.000Z",
    "updatedAt": "2026-06-20T10:05:00.000Z"
  }
}
```

---

### DELETE /api/videos/:videoId

**Role:** admin

Deletes DB row and physical file.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "message": "Video deleted successfully"
  }
}
```

---

## Database schema

**Table:** `trip_videos`

| Column | Type |
|--------|------|
| id | UUID PK |
| trip_id | UUID FK → trips.id |
| driver_id | UUID FK → drivers.id |
| file_name | TEXT |
| original_name | TEXT |
| video_url | TEXT |
| mime_type | TEXT |
| file_size | BIGINT |
| duration_seconds | INTEGER |
| started_at | TIMESTAMP |
| ended_at | TIMESTAMP |
| upload_status | VARCHAR(20) DEFAULT 'uploaded' |
| created_at | TIMESTAMP |
| updated_at | TIMESTAMP |

**Indexes:** `trip_id`, `driver_id`, `created_at`

---

## Storage structure (v1 — local)

```
uploads/
└── videos/
    └── YYYY/
        └── MM/
            └── <uuid>.mp4
```

Public URL: `{VIDEO_PUBLIC_BASE_URL}/videos/YYYY/MM/file.mp4`  
Default base: `/uploads` (served by Express static)

---

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `VIDEO_PUBLIC_BASE_URL` | `/uploads` | Prefix for stored video URLs |

---

## cURL example

```bash
curl -X POST "http://localhost:3000/api/videos/upload" \
  -H "Authorization: Bearer DRIVER_TOKEN" \
  -H "X-Device-ID: device-001" \
  -F "video_file=@trip-recording.mp4" \
  -F "tripId=TRIP_UUID" \
  -F "startTime=2026-06-20T10:00:00.000Z" \
  -F "endTime=2026-06-20T10:02:00.000Z" \
  -F "duration=120"
```
