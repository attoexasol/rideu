# Backend Ride Video DVR Implementation Report

**Date:** 2026-08-06  
**Final status:** **READY FOR DRIVER DVR UPLOAD INTEGRATION**

---

## Summary

Implemented YouTube-style **DVR segmented playback** with live edge, rewind, incremental manifest refresh, cancelled-ride preservation, disconnect recovery, and explicit `partial` terminal sessions.

**Not WebRTC.** Playback mode: `dvr_segmented`.

---

## Old vs new behavior

| Area | Before | After |
|------|--------|-------|
| Playback mode | `near_live_segmented` | `dvr_segmented` with timeline offsets |
| Live edge | Implicit (segment count) | Explicit `liveEdgeSeconds`, `latestAvailableSegmentIndex` |
| Rewind | `fromIndex` only | `fromOffsetSeconds`, `fromSegmentIndex`, `sinceManifestVersion` |
| Manifest version | Static `1` | Monotonic DB-backed `manifestVersion` |
| Terminal status | `completed` / `cancelled` | `completed` / `partial` / `failed` (preserves video on cancel) |
| Finalization | Could fail pending segments immediately | Grace period + in-flight upload completion |
| Disconnect | Sessions could stick in `active` | Recovery poller finalizes stale sessions |
| Admin UI payload | Full diagnostic fields | Minimal view + `/health` for diagnostics |
| Socket events | `segment_updated` | `segment_available`, `manifest_updated`, `finalizing` |

---

## Active playback lifecycle

1. Driver registers segment → upload URL issued  
2. Binary upload → `uploaded`  
3. Complete callback → `verified` + storage check  
4. `manifestVersion++`  
5. `admin:ride-video:segment_available` + `manifest_updated`  
6. Admin polls manifest with `sinceManifestVersion` or seeks with `fromOffsetSeconds`  
7. Live edge grows as new segments verify  

---

## Live edge calculation

Sum of verified/uploaded segment durations (supports partial tail, e.g. 7s final segment):

```
liveEdgeSeconds = Σ durationSeconds(playable segments in order)
```

---

## Manifest versioning

Stored on `video_sessions.manifest_version`. Incremented when:

- Segment becomes playable  
- Segment fails permanently  
- Session enters `finalizing`  
- Session reaches terminal state  

Incremental request: `sinceManifestVersion=N` → `{ unchanged: true }` or newest segment only.

---

## Cancelled ride preservation

- Booking cancel → `recording:stop` to driver  
- Session → `finalizing` (pending uploads allowed)  
- After grace → `completed` or `partial` (never deletes uploaded segments)  
- `GET /bookings/:id/ride-video` returns recording for cancelled bookings  

---

## Disconnect recovery

Background job (`VIDEO_RECOVERY_POLL_INTERVAL_SECONDS`, default 30s):

- Finds terminal bookings + stale `active`/`finalizing` sessions  
- Reconciles stale segments  
- Finalizes as `completed` / `partial` / `failed`  

---

## Files changed

| File | Purpose |
|------|---------|
| `src/db/migrations/0022_ride_video_dvr_foundation.sql` | `manifest_version`, `partial` status, activity index |
| `src/db/schema/video_sessions.ts` | Schema sync |
| `src/config/video.ts` | Grace, stale, refresh, recovery env vars |
| `src/services/rideVideoDvr.helpers.ts` | Timeline, slice, terminal resolution |
| `src/services/rideVideoDvr.service.ts` | Manifest build, version bump, finalization, recovery |
| `src/services/rideVideoRead.service.ts` | Signed read URLs (breaks circular deps) |
| `src/services/rideVideo.errors.ts` | Shared error class |
| `src/services/rideVideoRecovery.service.ts` | Recovery poller |
| `src/services/rideVideoBackground.service.ts` | Job wiring |
| `src/services/adminRideVideoNotify.service.ts` | DVR socket events |
| `src/services/adminRideVideo.service.ts` | Minimal admin views, DVR manifest |
| `src/services/rideVideo.service.ts` | DVR integration, `recording:stop` |
| `src/validators/index.ts` | Manifest params |
| `src/controllers/adminRideVideo.controller.ts` | Manifest param passthrough |
| `src/index.ts` | Start recovery job on boot |
| `tests/admin-ride-video-dvr.test.ts` | 10 DVR unit tests |
| `ADMIN_RIDE_VIDEO_DVR_API_CONTRACT.md` | Admin API contract |

---

## Migrations

Run: `npm run db:migrate` (applies `0022_ride_video_dvr_foundation.sql`)

---

## Tests

```
npm run build                                    ✅
npx jest tests/admin-ride-video-dvr.test.ts      ✅ 10 passed
npx jest tests/admin-ride-video-visibility.test.ts ✅ 12 passed
npx jest tests/admin-ride-video.test.ts          ✅ 13 passed
npx jest tests/ride-video-foundation.test.ts     ✅ 42 passed
Total ride-video tests: 77 passed
```

---

## Deployment steps

1. Apply migration `0022`  
2. Set env (optional overrides):
   ```
   VIDEO_RECORDING_ENABLED=true
   VIDEO_MANIFEST_REFRESH_SECONDS=5
   VIDEO_UPLOAD_GRACE_PERIOD_SECONDS=120
   VIDEO_RECOVERY_POLL_INTERVAL_SECONDS=30
   ```
3. Restart backend  
4. Verify recovery job logs: `ride_video.recovery`  
5. Run test ride; confirm manifest version increments and cancelled ride retains video  

---

## Driver integration notes (next phase)

- Handle `recording:stop` socket event  
- Upload final partial segment (any duration ≤ 2× segment window)  
- Call segment complete after each upload  
- No device-side archive required after successful upload  
