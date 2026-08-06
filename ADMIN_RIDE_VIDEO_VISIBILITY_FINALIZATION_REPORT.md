# Admin Ride Video Visibility & Finalization Report

**Date:** 2026-08-06  
**Repository:** backend_rydu  
**Final status:** **READY FOR ACTIVE-AND-COMPLETED VIDEO RETEST**

---

## 1. Playback model (clarified)

This backend does **not** implement true live streaming (no WebRTC, RTMP, or HLS live pipeline).

### Supported model: **near-live segmented playback**

```
Driver records ~10s segment
  → segment registered (POST .../segments)
  → signed upload URL issued
  → bytes uploaded (PUT .../upload)
  → segment verified (POST .../complete)
  → segment becomes admin-playable
  → admin socket event emitted
  → admin polls/refreshes playback manifest
  → admin plays uploaded portions while ride is still active
```

**Admin playback mode:** `near_live_segmented`  
**Refresh hint:** `refreshAfterSeconds` ≈ segment duration (default 10s)

---

## 2. Root causes found

### Active ride not visible / not playable

| Issue | Impact |
|-------|--------|
| No admin socket events on segment upload/verify | Dashboard stale until manual refresh |
| Active sessions with segments mapped only as `recording`, not `partially_available` | List/detail under-reported readiness |
| Booking lookup picked newest session only | Wrong session returned when retries exist |
| Playback manifest lacked active-session metadata | Dashboard could not distinguish near-live vs finalized |
| Generic `RECORDING_NOT_READY` for waiting sessions | Looked like missing recording |

### Completed ride not found / not playable

| Issue | Impact |
|-------|--------|
| **Finalization immediately marked pending/uploading segments as `failed`** | Final partial segment lost; session looked broken |
| Finalization jumped straight to `completed` even with in-flight uploads | Race with last segment upload |
| Booking-completed session could remain in `finalizing` without admin clarity | Completed booking appeared incomplete |
| `recordingStatus` SQL filter excluded active/finalizing sessions when filtering `partially_available` | Filtered lists hid in-progress recordings |

---

## 3. Session status transitions (actual model)

```
pending → active → paused ⇄ active
                 ↓
            finalizing → completed | cancelled
                 ↑
     (booking complete / driver finalize / cancel)
```

**Segment upload statuses:** `pending → uploading → uploaded → verified` (or `failed`)

**Admin recording statuses (computed):**
- `initializing`, `recording`, `uploading`, `partially_available`, `processing`, `ready`, `finalized`, `partially_available`, `failed`, `expired`, `deleted`

---

## 4. Fixes implemented

### Visibility & playback
- Active sessions with ≥1 playable segment now expose:
  - `playbackAvailable: true`
  - `playbackMode: near_live_segmented`
  - `playbackReason: RECORDING_ACTIVE`
  - `availableSegmentCount`, `latestSegmentIndex`, `lastSegmentAt`, `refreshAfterSeconds`
- Sessions with no ready segment return `playbackReason: WAITING_FOR_FIRST_SEGMENT` (not generic not-found)
- Playback manifest works for **non-finalized** sessions when playable segments exist
- Manifest verifies storage object existence; missing objects → `STORAGE_OBJECT_MISSING`
- Booking lookup uses `pickBestSessionForBooking()` (prefers recoverable, then most playable)

### Finalization
- Booking completion now:
  1. Sets session → `finalizing` (does **not** fail pending uploads immediately)
  2. Allows upload/complete during `finalizing`
  3. Auto-completes to `completed` when all segments reach terminal state
  4. Sets `finalizedAt` and computes retention anchor
- Final partial segments preserved (no forced fail on pending at ride end)

### Admin realtime
New canonical socket events (no signed URLs):
- `admin:ride-video:session_updated`
- `admin:ride-video:segment_updated`
- `admin:ride-video:health_updated` (helper ready)
- `admin:ride-video:finalized`

Emitted after: session create, segment register/upload/verify/fail, finalization.

### Trace logging
Structured `ride_video.trace` logs at all lifecycle stages with safe IDs:
`bookingId`, `sessionId`, `segmentId`, `segmentIndex`, `driverId`, statuses, storage existence, `finalizedAt`, `lastActivityAt`.

### List filter audit
- Default unfiltered list includes active, finalizing, completed, failed sessions
- `partially_available` filter now includes `active`, `paused`, `finalizing`, `completed`
- Post-filter on `recordingStatus` only when explicitly requested

---

## 5. Files changed

| File | Change |
|------|--------|
| `src/services/rideVideoTrace.service.ts` | **NEW** — lifecycle trace logging |
| `src/services/adminRideVideoNotify.service.ts` | **NEW** — admin socket events |
| `src/services/adminRideVideo.helpers.ts` | Playback eligibility, session picker, active status mapping |
| `src/services/adminRideVideo.service.ts` | List/detail/manifest visibility, storage verify, error codes |
| `src/services/rideVideo.service.ts` | Finalization fix, admin events, trace, upload during finalizing |
| `tests/admin-ride-video-visibility.test.ts` | **NEW** — 12 visibility/playback/socket tests |
| `tests/ride-video-foundation.test.ts` | Updated finalization mocks |

---

## 6. Admin API behavior (after fix)

### Active session, no segments yet
```json
{
  "sessionExists": true,
  "playbackAvailable": false,
  "playbackReason": "WAITING_FOR_FIRST_SEGMENT"
}
```

### Active session, 2+ ready segments
```json
{
  "recordingStatus": "partially_available",
  "playbackAvailable": true,
  "playbackMode": "near_live_segmented",
  "availableSegmentCount": 2,
  "refreshAfterSeconds": 10
}
```

### Playback manifest (active)
```json
{
  "sessionStatus": "active",
  "finalized": false,
  "playbackMode": "near_live_segmented",
  "latestSegmentIndex": 3,
  "refreshAfterSeconds": 10,
  "manifestGeneratedAt": "2026-08-06T12:00:00.000Z",
  "segments": [...]
}
```

### Distinct error codes
| Code | Meaning |
|------|---------|
| `SESSION_NOT_FOUND` / `RECORDING_SESSION_NOT_FOUND` | No session row |
| `WAITING_FOR_FIRST_SEGMENT` | Session exists, nothing playable yet |
| `RECORDING_ACTIVE` | Active near-live playback available |
| `RECORDING_FINALIZING` | Ride ended, uploads may still complete |
| `RECORDING_PARTIAL` | Some segments playable, gaps/failures |
| `RECORDING_READY` | Finalized and fully playable |
| `STORAGE_OBJECT_MISSING` | Metadata exists, file missing |
| `RECORDING_EXPIRED` / `RECORDING_DELETED` | Retention |

---

## 7. Tests & build

```text
npm run build                         ✅ PASS
npx jest tests/admin-ride-video.test.ts                          ✅ 13 passed
npx jest tests/admin-ride-video-visibility.test.ts               ✅ 12 passed
npx jest tests/ride-video-foundation.test.ts                     ✅ 42 passed
```

**Total ride-video tests:** 67 passed

---

## 8. Runtime retest checklist (manual)

Perform one fresh ride with `VIDEO_RECORDING_ENABLED=true`:

### During active ride (wait ≥30s)
- [ ] Driver creates session: `POST /api/v1/driver/bookings/:id/video/session`
- [ ] ≥2 segments registered + uploaded + verified
- [ ] `GET /api/v1/admin/ride-videos` includes session (`recordingStatus` = `partially_available`)
- [ ] `GET /api/v1/admin/ride-videos/:sessionId` returns `playbackAvailable: true`
- [ ] `POST /api/v1/admin/ride-videos/:sessionId/playback-manifest` returns ready segments
- [ ] Admin socket receives `admin:ride-video:segment_updated`

### After completion
- [ ] Final partial segment uploaded (e.g. 6s tail segment)
- [ ] Session transitions `finalizing → completed`, `finalizedAt` set
- [ ] `GET /api/v1/admin/ride-videos` still lists session
- [ ] `GET /api/v1/admin/bookings/:bookingId/ride-video` finds session
- [ ] Playback manifest still works
- [ ] `retentionExpiresAt` = finalizedAt + 30 days (default)

### Log grep
```powershell
# Trace one booking end-to-end
Select-String -Path .\logs\* -Pattern "ride_video.trace" | Select-Object -Last 50
```

---

## 9. Deployment steps

1. Deploy backend with these changes
2. Ensure env vars:
   ```
   VIDEO_RECORDING_ENABLED=true
   VIDEO_STORAGE_ROOT=<writable path>
   VIDEO_SIGNING_SECRET=<strong secret>
   ```
3. Restart backend: `npm run stop:dev && npm run dev`
4. Confirm admin WebSocket connected to `admin` room
5. Run one test ride (checklist above)
6. Only after backend verified → integrate Admin Dashboard polling/manifest refresh (`refreshAfterSeconds`)

---

## 10. Notes for Admin Dashboard (not changed in this PR)

- Poll manifest every `refreshAfterSeconds` during active rides
- Subscribe to `admin:ride-video:segment_updated` and `admin:ride-video:session_updated`
- Do **not** label as "Live Stream" — use "Near-live recording" or "Ride recording"
- Handle `WAITING_FOR_FIRST_SEGMENT` as loading state, not error
- Handle `RECORDING_FINALIZING` as "Processing final segments…"
