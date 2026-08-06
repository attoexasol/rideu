# Admin Ride Video DVR API Contract

**Playback model:** `dvr_segmented` — near-live segmented DVR (not WebRTC).

## Core concepts

| Concept | Description |
|---------|-------------|
| Live edge | End of the verified-segment timeline (`liveEdgeSeconds`) |
| Rewind | Request manifest from `fromOffsetSeconds` or `fromSegmentIndex` |
| Incremental refresh | Pass `sinceManifestVersion`; receive only new segments when version advanced |
| Archive | Ordered manifest is the authoritative complete recording (no sync merge) |

## Booking lookup

`GET /api/v1/admin/bookings/:bookingId/ride-video`

Minimal response:

```json
{
  "bookingId": "...",
  "sessionExists": true,
  "playbackAvailable": true,
  "recordingActive": false,
  "session": {
    "sessionId": "...",
    "bookingId": "...",
    "bookingStatus": "cancelled",
    "sessionStatus": "partial",
    "recordingStatus": "partially_available",
    "playbackMode": "dvr_segmented",
    "playbackAvailable": true,
    "liveEdgeSeconds": 47,
    "availableDurationSeconds": 47,
    "finalized": true,
    "finalizedAt": "...",
    "retentionExpiresAt": "...",
    "manifestVersion": 8,
    "refreshAfterSeconds": 5,
    "playbackReasonLabel": "Partial recording available — some segments may be missing"
  }
}
```

Cancelled bookings retain recordings when segments were uploaded.

## Session detail

`GET /api/v1/admin/ride-videos/:sessionId`

Returns the same minimal shape as list/booking lookup.

Diagnostics (segment counts, upload health, missing sequences): `GET /api/v1/admin/ride-videos/:sessionId/health`

## Playback manifest

`POST /api/v1/admin/ride-videos/:sessionId/playback-manifest`

### Request body / query

| Param | Purpose |
|-------|---------|
| `fromOffsetSeconds` | Seek to timeline offset (rewind) |
| `fromSegmentIndex` | Start at segment index |
| `fromIndex` | Alias of `fromSegmentIndex` |
| `sinceManifestVersion` | Incremental refresh; returns `{ unchanged: true }` if current |
| `limit` | Max segments (default 10, max 30) |

### Active session example

```json
{
  "sessionId": "...",
  "playbackMode": "dvr_segmented",
  "recordingActive": true,
  "finalized": false,
  "timelineStartSeconds": 0,
  "liveEdgeSeconds": 70,
  "availableDurationSeconds": 70,
  "manifestVersion": 8,
  "refreshAfterSeconds": 5,
  "segments": [
    {
      "segmentId": "...",
      "segmentIndex": 0,
      "startOffsetSeconds": 0,
      "durationSeconds": 10,
      "endOffsetSeconds": 10,
      "url": "/api/v1/admin/video/segments/{id}/content?token=...",
      "expiresAt": "...",
      "contentType": "video/mp4",
      "availabilityStatus": "ready"
    }
  ]
}
```

### Signed URL refresh

`POST /api/v1/admin/ride-videos/:sessionId/segments/:segmentId/playback-url`

Regenerates read token without full manifest reload.

## Socket events (no signed URLs)

| Event | When |
|-------|------|
| `admin:ride-video:session_updated` | Session state change |
| `admin:ride-video:segment_available` | Segment verified/playable |
| `admin:ride-video:manifest_updated` | Manifest version incremented |
| `admin:ride-video:finalizing` | Ride ended, uploads finishing |
| `admin:ride-video:finalized` | Session terminal |

Manifest event payload:

```json
{
  "sessionId": "...",
  "bookingId": "...",
  "manifestVersion": 8,
  "latestAvailableSegmentIndex": 6,
  "liveEdgeSeconds": 70,
  "recordingActive": true,
  "timestamp": "..."
}
```

## Session lifecycle

```
pending → active → finalizing → completed | partial | failed
```

- **completed:** all registered segments verified, contiguous
- **partial:** playable gaps/failures/pending after grace
- **failed:** no playable segments

Retention starts at `finalizedAt`. Segments remain in storage until retention expiry.

## Driver stop instruction

On booking terminal events, driver receives:

`recording:stop` `{ bookingId, sessionId, reason }`

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `VIDEO_MANIFEST_REFRESH_SECONDS` | 5 | Admin poll hint |
| `VIDEO_UPLOAD_GRACE_PERIOD_SECONDS` | 120 | Finalization wait for in-flight uploads |
| `VIDEO_STALE_REGISTERED_SEGMENT_SECONDS` | 600 | Fail stale pending registrations |
| `VIDEO_STALE_UPLOADING_SEGMENT_SECONDS` | 300 | Fail stale uploading segments |
| `VIDEO_RECOVERY_POLL_INTERVAL_SECONDS` | 30 | Disconnect recovery job interval |
