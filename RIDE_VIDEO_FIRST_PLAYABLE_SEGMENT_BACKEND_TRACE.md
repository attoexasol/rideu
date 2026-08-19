# Ride Video First Playable Segment — Backend Trace

**Date:** 2026-08-14  
**Session traced:** `8f94075d-09ec-4dfb-b7f5-a82f5218a0a1`  
**Booking:** `26b0e552-8eee-4bfd-a42a-9f4a3171ca4f`  
**Final status:** **READY FOR ADMIN PLAYBACK RETEST**

---

## Executive summary

Driver **is registering segments** (26 rows over ~5 minutes). Signed **PUT uploads reach the backend** from the physical Android device (`okhttp/5.3.0`, IP `103.208.183.242`). **No segment ever reached `uploaded`/`verified`** because uploads were rejected with **HTTP 409 `BOOKING_NOT_RECORDABLE`** once the booking moved to `cancelled` while large (~11 MB) uploads were still in flight (~58–69 s each).

This is **not** `DRIVER_NOT_SENDING_SEGMENTS` and **not** `SIGNED_UPLOAD_NOT_REACHED`. The backend upload gate was incorrectly re-checking live booking recordability on PUT, blocking in-flight segment uploads after ride end.

**Fix applied:** `uploadRideVideoSegment` now uses `assertSegmentUploadAllowed` (driver assignment only) instead of `assertRecordableBooking` (active booking status). Uploads are allowed while the session is `active`, `paused`, or `finalizing`.

---

## 1. Segment route trace (session `8f94075d…`)

| Route | Observed | Notes |
|-------|----------|-------|
| `POST …/sessions/:sessionId/segments` (register) | **Yes — 26 requests** | Indexes 0–25, ~10.5 s each, ~11.5 MB declared |
| `PUT …/segments/:segmentId/upload` | **Yes — multiple** | From Android; auth + device tracking OK |
| `POST …/segments/:segmentId/complete` | **No successful** | Upload never reached `uploaded` |
| `POST …/segments/:segmentId/failed` | Not primary path | Recovery later marked stale segments `failed` |
| `POST …/sessions/:sessionId/finalize` | Session → `finalizing` @ 05:08:15 UTC | |
| `GET …/sessions/:sessionId/segments` | Not required for this failure mode | |

### Example PUT failure (server log)

```text
HTTP PUT /api/v1/driver/video/segments/166a6ae7-…/upload
status: 409
duration: ~60819 ms
error: Booking status cancelled does not allow recording
code: BOOKING_NOT_RECORDABLE
client: okhttp/5.3.0
ip: 103.208.183.242
```

Register events logged as `recording.segment_registered` / `ride_video.trace stage=segment_registered`. **No** `segment_uploaded`, `recording.storage_write_complete`, or `segment_ready` events for this session.

---

## 2. Driver request arrival classification

| Stage | Expected (30 s ride) | Observed |
|-------|----------------------|----------|
| segment register | 2–3+ | **26 registers** |
| segment PUT upload | 2–3+ attempts | **Multiple PUTs reached server** |
| segment complete | 2–3+ | **0** (blocked at PUT) |

**Classification:** Upload reached backend but failed state transition → **`SEGMENT_STATE_TRANSITION_FAILURE`** (now fixed).

---

## 3. Database inspection

### `video_sessions`

| Field | Value |
|-------|-------|
| id | `8f94075d-09ec-4dfb-b7f5-a82f5218a0a1` |
| status | `failed` (after recovery; was `finalizing`) |
| manifest_version | 1 |
| last_upload_activity_at | **null** (no successful upload) |
| started_at | 2026-08-14T05:02:41.948Z |

### `video_segments` (at trace time)

| Metric | Value |
|--------|-------|
| total rows | **26** |
| upload_status | all **`pending`** → later recovery → **`failed`** |
| uploaded_at | **null** on all |
| duration_ms | ~10,500 each (~10.5 s segments) |
| file_size | ~11.5 MB each (declared at register) |

**Conclusion:** Register API works. Rows exist but never left `pending` because PUT did not persist storage.

---

## 4. Storage verification

| Check | Result |
|-------|--------|
| `VIDEO_STORAGE_ROOT` | `C:\Users\AttoExa PC 5\Downloads\backend_rydu\private-media` |
| Directory exists | **No** (no files written — uploads never succeeded) |
| Objects for segment keys | **0 / 26** |

**Not** `UPLOAD_STORAGE_FAILURE` — storage was never attempted because PUT handler rejected before `savePrivateSegment`.

---

## 5. Playable transition requirements

From `isPlayableSegment` / `buildDvrPlaybackManifest`:

1. `upload_status` ∈ `{ uploaded, verified }`
2. `storage_key` present
3. `retention_deleted_at` is null
4. File exists on disk (`inspectPrivateSegment`)

Admin manifest calls `assertPlaybackAllowed` → **409 `WAITING_FOR_FIRST_SEGMENT`** when `playableSegmentCount === 0` during active/finalizing session with no uploaded segments.

**Observed counts at block time:**

```json
{
  "segmentRows": 26,
  "uploadedCount": 0,
  "verifiedCount": 0,
  "storageExistingCount": 0,
  "playableCount": 0
}
```

---

## 6. Signed upload URL / host

Backend returns **relative** upload URL:

```text
/api/v1/driver/video/segments/{segmentId}/upload?token=[redacted]
```

| Check | Result |
|-------|--------|
| Backend emits localhost/127.0.0.1 | **No** (relative path only) |
| Driver device reachability | **Yes** — PUTs from `103.208.183.242` hit API successfully |
| Absolute URL support added | Optional `VIDEO_API_PUBLIC_BASE_URL` / `API_PUBLIC_BASE_URL` prepends LAN/public host when set |

**Not a localhost upload URL bug in this trace.** Driver already targets a reachable host.

---

## 7. Content route auth model

| Route | Auth required |
|-------|----------------|
| `PUT …/segments/:id/upload` | **Driver JWT** (`requireAuth` + `requireDriver`) **and** signed `token` query param |
| Register / complete / list | Driver JWT only |

Driver sends both (confirmed via `[DeviceTracking] ✅ Active session token accepted` on PUT requests). **Auth model matches Driver implementation.**

---

## 8. Manifest diagnostic logging (added)

When playback is blocked, backend now logs:

```text
event: ride_video.manifest_blocked
sessionId, playbackReason, segmentRows, uploadedCount, verifiedCount, storageExistingCount, playableCount
```

Not exposed in Admin API response.

---

## 9. Per-route structured logging (added)

All driver segment handlers emit:

```text
event: ride_video.segment_route
```

Fields: `route`, `method`, `httpStatus`, `bookingId`, `sessionId`, `segmentId`, `segmentIndex`, `uploadStatusBefore/After`, `storageExists`, `fileSizeBytes`, `durationMs`, `uploadUrlHost`, `uploadUrlPath` (token redacted).

Upload URL issuance also logs:

```text
event: recording.upload_url_issued
uploadUrlHost, uploadUrlPath, urlIsAbsolute
```

---

## 10. Backend fix

**File:** `src/services/rideVideo.service.ts`

- **Before:** `uploadRideVideoSegment` → `assertRecordableBooking` (requires booking `in_progress` / `driver_en_route` / etc.)
- **After:** `uploadRideVideoSegment` → `assertSegmentUploadAllowed` (driver assignment only; session must be uploadable)

**Why:** Segments are registered during the ride; ~11 MB uploads take ~60 s on mobile networks. Uploads often complete after booking cancel/complete/finalizing. DVR design requires accepting those uploads.

**Test added:** `allows PUT upload when booking is cancelled but session is finalizing`

---

## 11. Runtime expectations after fix (fresh booking)

Expected log sequence for a 30 s ride:

```text
ride_video.segment_route route=segment_register segmentIndex=0
recording.upload_url_issued uploadUrlPath=/api/v1/driver/video/segments/.../upload?token=[redacted]
ride_video.segment_route route=segment_upload httpStatus=200 uploadStatusAfter=uploaded
recording.storage_write_complete
ride_video.segment_route route=segment_complete uploadStatusAfter=verified
ride_video.trace stage=segment_ready
manifestVersion incremented
POST playback-manifest → 200 (not 409 WAITING_FOR_FIRST_SEGMENT)
```

**Note:** Admin may still see `WAITING_FOR_FIRST_SEGMENT` until the **first PUT completes** (~10 s segment + upload latency). With ~60 s upload times, first playable segment may appear ~1 minute after recording starts even when healthy.

---

## 12. Current session outcome

Session `8f94075d…` segments were marked **`failed`** by stale-segment recovery after prolonged `pending` with no storage. **Retest requires a fresh booking/recording session.**

---

## 13. Verification commands

```bash
npm run build          # ✅
npm test               # ✅ 298 tests
npx tsx src/scripts/trace-segment-state.ts
npx tsx src/scripts/simulate-segment-upload.ts   # after fresh pending segment exists
```

---

## Final status

### **READY FOR ADMIN PLAYBACK RETEST**

Root cause was backend upload rejection (`BOOKING_NOT_RECORDABLE`) on in-flight PUTs after booking cancellation — not missing driver registers or unreachable signed upload URLs. Fix deployed; run a fresh 30+ second recording and confirm first `segment_upload` → `uploaded` before polling playback-manifest.
