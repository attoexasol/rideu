# Admin Ride Video API Contract

Usable by the Admin Dashboard Cursor agent.

**Base path:** `/api/v1/admin`  
**Primary resource family:** `/api/v1/admin/ride-videos`  
**Status:** READY FOR ADMIN DASHBOARD INTEGRATION

---

## 1. Authentication

| Requirement | Value |
|-------------|--------|
| Scheme | `Authorization: Bearer <token>` |
| Token types | Auth0 RS256 access token **or** backend HS256 session JWT from `/api/auth/login` |
| Auth0 audience | `AUTH0_AUDIENCE` / `AUTH0_API_IDENTIFIER` (e.g. `https://api.drivewize.com`) |
| Role claim | `role` **or** `https://drivewize.com/role` (**or** first of `https://drivewize.com/roles`) |
| Permission claim | `permissions` **or** `https://drivewize.com/permissions` (string array) |
| Required roles | `admin` or `super_admin` |

All ride-video admin routes use: `requireAuth` → `extractUserInfo` → `requireAdmin` → `requireRideVideoPermission(...)`.

Unauthenticated → **401** `AUTH_FAILED` / `UNAUTHENTICATED`  
Authenticated but wrong role → **403**  
Missing permission → **403** `MISSING_PERMISSION`

---

## 2. Permission mapping

| Permission | Purpose |
|------------|---------|
| `ride_video.view` | List, summary, detail, segments, health, timeline, booking ride-video |
| `ride_video.play` | Playback manifest + segment signed URL refresh |
| `ride_video.download` | Combined download (currently always unsupported) |
| `ride_video.audit` | Read audit log |
| `ride_video.manage` | Reserved (not required by current endpoints) |
| `ride_video.delete` | Reserved — **delete endpoint not implemented** |

### Role fallback (when JWT has no `ride_video.*` scopes)

| Role | Permissions |
|------|-------------|
| `admin` | view, play, audit |
| `super_admin` | view, play, download, audit, manage, delete |

If the JWT includes any `ride_video.*` permission strings, those are treated as authoritative (role fallback is skipped).

---

## 3. Response envelope

Success:

```json
{
  "success": true,
  "data": {},
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

Error:

```json
{
  "success": false,
  "error": {
    "code": "RECORDING_SESSION_NOT_FOUND",
    "message": "Recording session was not found",
    "details": null
  }
}
```

Rate limit (**429**):

- Header: `Retry-After: <seconds>`
- Body includes `error.retryable: true` and `error.details.retryAfterSeconds`

Datetime format: ISO-8601 UTC strings.

Pagination lives in `metadata.pagination` (project convention). List payloads also put `items` under `data`.

---

## 4. Endpoints

### 4.1 List sessions

`GET /api/v1/admin/ride-videos`  
**Permission:** `ride_video.view`  
**Rate limit:** admin list bucket

Query params:

| Param | Type | Notes |
|-------|------|-------|
| page, limit | number | default 1 / 20; max 100 |
| search | string | booking id, session id, names, phones, plate |
| bookingId, sessionId, driverId, passengerId | uuid | |
| driverPhone, passengerPhone, vehicleRegistration | string | |
| bookingStatus | string | booking status |
| recordingStatus | string | admin-facing status (see enums) |
| consentStatus | enum | `not_required\|pending\|granted\|denied\|revoked\|required` |
| uploadHealth | enum | see enums |
| processingStatus | string | mapped to session statuses |
| retentionStatus | enum | `active\|expiring_soon\|expired\|deleted` |
| serviceType | string | category code or name |
| dateFrom, dateTo | ISO datetime | filters `video_sessions.created_at` |
| sortBy | enum | `createdAt\|finalizedAt\|startedAt\|rideDate` |
| sortOrder | enum | `asc\|desc` |

Success `data`:

```json
{
  "items": [
    {
      "sessionId": "...",
      "bookingId": "...",
      "rideDate": "...",
      "bookingStatus": "completed",
      "recordingStatus": "ready",
      "consentStatus": "granted",
      "driver": { "id": "...", "name": "...", "phone": "..." },
      "passenger": { "id": "...", "name": "...", "phone": "..." },
      "vehicle": { "id": "...", "registration": "...", "make": "...", "model": "..." },
      "durationSeconds": 420,
      "expectedSegmentCount": 42,
      "uploadedSegmentCount": 42,
      "readySegmentCount": 42,
      "failedSegmentCount": 0,
      "missingSegmentCount": 0,
      "uploadHealth": "healthy",
      "retentionExpiresAt": "...",
      "retentionStatus": "active",
      "daysRemaining": 24,
      "lastActivityAt": "...",
      "playbackAvailable": true,
      "downloadAvailable": false
    }
  ]
}
```

---

### 4.2 Summary

`GET /api/v1/admin/ride-videos/summary`  
**Permission:** `ride_video.view`

Query: `dateFrom`, `dateTo`, `driverId`, `passengerId`

```json
{
  "totalSessions": 100,
  "recordingNow": 4,
  "readyForReview": 70,
  "uploadIssues": 8,
  "missingSegments": 3,
  "expiringSoon": 7,
  "finalizedToday": 14
}
```

Counts are computed from real session + segment data. A session is **not** counted healthy merely because one segment exists.

---

### 4.3 Session detail

`GET /api/v1/admin/ride-videos/:sessionId`  
**Permission:** `ride_video.view`

Returns the enriched session object (same fields as list item, plus booking/serviceType, failureReason, missingSequences, etc.).

Errors: `404 RECORDING_SESSION_NOT_FOUND`

---

### 4.4 Booking-linked video

`GET /api/v1/admin/bookings/:bookingId/ride-video`  
**Permission:** `ride_video.view`

```json
{
  "bookingId": "...",
  "recordingEnabled": true,
  "sessionExists": false,
  "absenceReason": "CONSENT_NOT_GRANTED",
  "consentStatus": "pending",
  "session": null,
  "playbackAvailable": false,
  "retentionStatus": null
}
```

Absence reasons:

- `VIDEO_RECORDING_DISABLED`
- `CONSENT_NOT_GRANTED`
- `SESSION_NOT_CREATED`
- `BOOKING_NOT_ELIGIBLE`
- `RECORDING_EXPIRED`
- `RECORDING_DELETED`
- `NO_RECORDING_DATA`

**Compat:** Existing `GET /api/v1/admin/bookings/:bookingId/video` remains available (legacy summary shape). Prefer `/ride-video` for the dashboard.

---

### 4.5 Segments

`GET /api/v1/admin/ride-videos/:sessionId/segments`  
**Permission:** `ride_video.view`

Query: `page`, `limit` (max 200), `sortOrder`

`data`:

```json
{
  "items": [ { "segmentId": "...", "segmentIndex": 0, "uploadStatus": "verified", "processingStatus": "ready", "playbackAvailable": true } ],
  "missingSequences": [4]
}
```

---

### 4.6 Health

`GET /api/v1/admin/ride-videos/:sessionId/health`  
**Permission:** `ride_video.view`

```json
{
  "state": "healthy",
  "expectedSegmentCount": 42,
  "uploadedSegmentCount": 42,
  "readySegmentCount": 42,
  "failedSegmentCount": 0,
  "missingSegmentCount": 0,
  "duplicateSegmentCount": 0,
  "missingSequences": [],
  "expectedDurationSeconds": 420,
  "availableDurationSeconds": 420,
  "completenessPercentage": 100,
  "lastSegmentAt": "...",
  "finalized": true,
  "issues": []
}
```

States: `healthy | partial | upload_delayed | failed | unknown`

---

### 4.7 Timeline

`GET /api/v1/admin/ride-videos/:sessionId/timeline`  
**Permission:** `ride_video.view`

```json
{
  "items": [
    {
      "eventId": "...",
      "type": "CONSENT_GRANTED",
      "category": "consent",
      "timestamp": "...",
      "title": "Passenger consent granted",
      "description": null,
      "videoOffsetSeconds": 0,
      "metadata": {}
    }
  ]
}
```

Categories: `ride | recording | consent | upload_error | audit`  
`videoOffsetSeconds` only when recording start is known and offset ≥ 0.

---

### 4.8 Playback manifest (lazy window)

`POST /api/v1/admin/ride-videos/:sessionId/playback-manifest`  
**Permission:** `ride_video.play`  
**Rate limit:** playback bucket (keyed by admin + session)

Body (optional):

```json
{ "fromIndex": 0, "limit": 10 }
```

`limit` capped at 30. Does **not** sign thousands of URLs.

```json
{
  "sessionId": "...",
  "expiresAt": "...",
  "durationSeconds": 420,
  "manifestVersion": 1,
  "totalPlayableSegments": 42,
  "fromIndex": 0,
  "nextFromIndex": 10,
  "segments": [
    {
      "segmentId": "...",
      "segmentIndex": 0,
      "startOffsetSeconds": 0,
      "durationSeconds": 10,
      "url": "/api/v1/admin/video/segments/{segmentId}/content?token=...",
      "urlExpiresAt": "..."
    }
  ]
}
```

Notes:

- URLs are **relative app paths** with HMAC tokens (not cloud credentials).
- TTL from `VIDEO_READ_URL_TTL_SECONDS` (default 300).
- Creates audit `STARTED_PLAYBACK`.
- Expired/deleted recordings → **410** `RECORDING_EXPIRED` / `RECORDING_DELETED`.
- Not ready → **409** `RECORDING_NOT_READY`.

Media bytes: `GET /api/v1/admin/video/segments/:segmentId/content?token=...` (no JWT; token is auth).

---

### 4.9 Segment playback URL refresh

`POST /api/v1/admin/ride-videos/:sessionId/segments/:segmentId/playback-url`  
**Permission:** `ride_video.play`

Validates segment belongs to session. Audit: `REFRESHED_PLAYBACK_URL`.

```json
{ "segmentId": "...", "url": "...", "expiresAt": "..." }
```

---

### 4.10 Audit log

`GET /api/v1/admin/ride-videos/:sessionId/audit`  
**Permission:** `ride_video.audit`

Paginated audit entries (admin, action, result, timestamp, booking/session ids, optional ip/userAgent).

Actions include: `VIEWED_METADATA`, `STARTED_PLAYBACK`, `REFRESHED_PLAYBACK_URL`, `VIEWED_SEGMENTS`, `VIEWED_HEALTH`, `VIEWED_TIMELINE`, `VIEWED_AUDIT`, `LISTED_SESSIONS`, `VIEWED_SUMMARY`, `DOWNLOADED_RECORDING`.

---

### 4.11 Download

`POST /api/v1/admin/ride-videos/:sessionId/download`  
**Permission:** `ride_video.download`

**Always returns:**

```json
{
  "success": false,
  "error": {
    "code": "COMBINED_DOWNLOAD_NOT_AVAILABLE",
    "message": "Combined recording download is not available"
  }
}
```

HTTP **409**. Session responses always set `downloadAvailable: false`.

---

### 4.12 Delete

**Not implemented.** Do not call a delete endpoint. Documented as unsupported.

---

## 5. Enums

### recordingStatus (admin-facing)

`waiting_for_consent | initializing | recording | uploading | processing | ready | partially_available | failed | finalized | expired | deleted | disabled`

### consentStatus (admin-facing)

`not_required | pending | granted | denied` (DB `required` → `pending`)

### uploadHealth

`healthy | delayed | missing_segments | failed_segments | duplicate_segments | incomplete | unknown`

### retentionStatus

`active | expiring_soon | expired | deleted`

### segment uploadStatus (raw)

`pending | uploading | uploaded | verified | failed`

---

## 6. Live updates (sockets / polling)

Existing Socket.IO admin room already receives:

- `recording:session_started`
- `recording:session_paused` / `recording:session_resumed`
- `recording:session_finalized`
- `recording:session_available`
- `recording:consent_updated`

**No private playback URLs are emitted on sockets.**

Polling recommendation if not using sockets:

- Active/recording sessions: 10–15s
- Finalized/expired: no continuous polling

---

## 7. Rate limits

| Bucket | Default (dev) | Applies to |
|--------|---------------|------------|
| `adminRideVideoList` | 300/min | list, summary, detail, segments, health, timeline, booking ride-video, audit |
| `adminRideVideoPlayback` | 120/min (admin+session key) | manifest + segment URL |
| `adminRideVideoDownload` | 20/min | download |

Env overrides:

- `ADMIN_RIDE_VIDEO_LIST_RATE_LIMIT_*`
- `ADMIN_RIDE_VIDEO_PLAYBACK_RATE_LIMIT_*`
- `ADMIN_RIDE_VIDEO_DOWNLOAD_RATE_LIMIT_*`

---

## 8. Error codes (selected)

| HTTP | Code |
|------|------|
| 401 | `UNAUTHENTICATED`, `AUTH_FAILED` |
| 403 | `FORBIDDEN`, `MISSING_PERMISSION`, `INVALID_VIDEO_READ_AUTHORIZATION` |
| 404 | `RECORDING_SESSION_NOT_FOUND`, `BOOKING_NOT_FOUND`, `SEGMENT_NOT_FOUND`, `VIDEO_SEGMENT_NOT_FOUND` |
| 409 | `RECORDING_NOT_READY`, `COMBINED_DOWNLOAD_NOT_AVAILABLE` |
| 410 | `RECORDING_EXPIRED`, `RECORDING_DELETED` |
| 429 | `RATE_LIMITED` |
| 5xx | `VIDEO_STORAGE_ERROR`, `SERVER_ERROR` |

---

## 9. Example curls

```bash
export TOKEN="..."
export BASE="http://localhost:3000/api/v1/admin"

curl -s -H "Authorization: Bearer $TOKEN" "$BASE/ride-videos?page=1&limit=20"
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/ride-videos/summary"
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/ride-videos/{sessionId}"
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/bookings/{bookingId}/ride-video"
curl -s -H "Authorization: Bearer $TOKEN" -X POST "$BASE/ride-videos/{sessionId}/playback-manifest" \
  -H "Content-Type: application/json" -d '{"fromIndex":0,"limit":5}'
curl -s -H "Authorization: Bearer $TOKEN" -X POST \
  "$BASE/ride-videos/{sessionId}/segments/{segmentId}/playback-url"
```

---

## 10. Environment

| Var | Purpose |
|-----|---------|
| `VIDEO_RECORDING_ENABLED` | Global recording feature flag |
| `VIDEO_RECORDING_CONSENT_REQUIRED` | Consent gate |
| `VIDEO_RETENTION_DAYS` | Retention window (default 30) |
| `VIDEO_READ_URL_TTL_SECONDS` | Signed read URL TTL (default 300) |
| `VIDEO_SIGNING_SECRET` or `JWT_SECRET` | HMAC signing for media tokens |
| `VIDEO_STORAGE_ROOT` | Private local storage root |

---

## 11. Backward compatibility

- Driver/passenger video APIs unchanged.
- Legacy admin `GET .../bookings/:id/video` and `POST .../video/segments/:id/read-url` remain.
- Dashboard should use `/ride-videos` family + `/bookings/:id/ride-video`.
