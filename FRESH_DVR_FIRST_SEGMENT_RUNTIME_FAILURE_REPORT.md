# Fresh DVR First Segment Runtime Failure Report

**Date:** 2026-08-14  
**Session:** `27a93d27-9d85-4583-a34a-c0517dca203e`  
**Booking:** `fc7a736c-d4ff-4e70-b342-b4bfc32687e7`  
**Final status:** **READY FOR FRESH ADMIN PLAYBACK RETEST**

---

## 1. Exact DB state (queried live)

### Session `27a93d27-9d85-4583-a34a-c0517dca203e`

| Field | Value |
|-------|-------|
| status | `finalizing` (was `active` during recording) |
| bookingId | `fc7a736c-d4ff-4e70-b342-b4bfc32687e7` |
| driverId | `4d8d26f0-cee9-4575-8331-ae64b072f42c` |
| manifestVersion | **4** (was 1 at failure; **2** after partial recovery attempt) |
| lastUploadActivityAt | **2026-08-14T05:28:00.881Z** (after fix proof) |
| startedAt | 2026-08-14T05:21:35.567Z |
| finalizedAt | null |
| endedAt | 2026-08-14T05:24:16.200Z |

### Booking `fc7a736c-d4ff-4e70-b342-b4bfc32687e7`

| Field | Value (at query time) |
|-------|------------------------|
| status | `cancelled` |
| assigned_driver_id | matches session driver |
| recording_consent_status | `granted` |

**Note:** Admin UI reported `driver_en_route` during recording; DB now shows `cancelled` after ride end. Recording window was **05:21:35 – 05:24:16 UTC** (~2m 41s).

### Segments (11 total at failure; snapshot before fix)

| Index | segmentId | uploadStatus (before fix) | durationMs | fileSize | storageExists |
|-------|-----------|---------------------------|------------|----------|---------------|
| 0 | `e160ec14-66c4-4990-89d1-a75533c49167` | `pending` | 10926 | 11527176 | false |
| 1 | `e3cb635d-7830-4f36-a57c-174cf018f22e` | `pending` | 10452 | 11510425 | false |
| … | … | `pending` | ~10450 | ~11.5 MB | false |
| 10 | `4855274d-3775-496a-a7dc-e77585192647` | `pending` | 10552 | 11500180 | false |

All segments: `uploadedAt = null`, `failureReason = null` (before recovery).

**After runtime proof (segment 0 only):**

| Index | uploadStatus | storageExists |
|-------|--------------|---------------|
| 0 | **`verified`** | **true** (11,527,176 bytes) |
| 1–10 | `pending` | false |

---

## 2. Failure classification

### **G. OTHER — deferred driver uploads + signed-token validation timing**

Evidence-based sub-causes (not mutually exclusive):

1. **During active ride (05:21–05:24):** segments registered but **PUT uploads not started** for ~2–3 minutes → Admin correctly saw `WAITING_FOR_FIRST_SEGMENT` while booking was still active. *(Overlaps B.)*

2. **When PUTs finally ran (05:24:37+):** requests reached backend but **storage was not written** due to **HTTP 403 `INVALID_VIDEO_UPLOAD_AUTHORIZATION`** (and some `request aborted`). *(Overlaps C.)*

3. **Not** size limit: `VIDEO_MAX_SEGMENT_SIZE_BYTES = 25,000,000`; segments ~11.5 MB.

4. **Not** `assertSegmentUploadAllowed` / booking-status gate (prior fix): uploads were rejected **before** storage write at **token verification**.

5. **Not** complete-contract mismatch: **complete never called** because PUT never reached `uploaded`.

---

## 3. Segment index 0 — HTTP sequence (from server logs + DB timestamps)

### REGISTER

| Field | Value |
|-------|-------|
| timestamp | **2026-08-14T05:21:47.486Z** (`created_at`) |
| HTTP status | **201** (inferred — row inserted) |
| segmentId | `e160ec14-66c4-4990-89d1-a75533c49167` |
| recordedAt | 2026-08-14T05:21:37.042Z |

### PUT (first driver attempt)

| Field | Value |
|-------|-------|
| timestamp (request logged) | **2026-08-14T05:24:37 UTC** |
| delay after register | **~170 seconds** |
| HTTP status | **403** (other segments); segment 0 response truncated in log window |
| backend error | **`INVALID_VIDEO_UPLOAD_AUTHORIZATION`** |
| received bytes | ~11.5 MB over **~58–60 s** (parallel uploads) |
| storage write | **failure** — no file until post-fix proof |

Example logged PUT failure (segment index 8):

```text
PUT /api/v1/driver/video/segments/ad33671d-…/upload
status: 403
duration: 58413ms
errorCode: INVALID_VIDEO_UPLOAD_AUTHORIZATION
message: Video upload authorization is invalid or expired
```

### COMPLETE

| Field | Value |
|-------|-------|
| timestamp | **never** (driver) |
| HTTP status | N/A |

**Missing stage for driver path:** **COMPLETE never occurred** because PUT never succeeded.

---

## 4. Storage directory

**Path:** `private-media/ride-recordings/fc7a736c-d4ff-4e70-b342-b4bfc32687e7/27a93d27-9d85-4583-a34a-c0517dca203e/`

| Before fix | After runtime proof |
|------------|---------------------|
| **0 files** (ENOENT) | **1 file:** `0-e160ec14-66c4-4990-89d1-a75533c49167.mp4` (**11,527,176 bytes**) |

---

## 5. PUT response detail (not merely “reached backend”)

| Check | Result |
|-------|--------|
| PUT status | **403** (`INVALID_VIDEO_UPLOAD_AUTHORIZATION`) |
| storage write | **failure** (no object) |
| bytes written | **0** |

Post-fix proof on same segment 0:

| Check | Result |
|-------|--------|
| PUT status | **200** |
| uploadStatus after PUT | **`uploaded`** |
| storage write | **success** |
| bytes written | **11,527,176** |

---

## 6. Upload guards (segment 0, active window)

| Guard | Pass during active ride? |
|-------|--------------------------|
| `assertSegmentUploadAllowed` (driver assignment) | **Yes** — driver matches booking |
| session ownership | **Yes** |
| session status uploadable (`active`/`paused`/`finalizing`) | **Yes** during 05:21–05:24 |
| signed token | **Fails at PUT completion** — validated after body read |
| content length / max size | **Yes** — 11.5 MB < 25 MB |
| content-type | **Yes** — `video/mp4` |
| segment status | **Yes** — `pending` |

**Failing guard:** **signed upload token verification timing** (validated after ~60 s body transfer, not at request start).

---

## 7. Video size limit

```text
VIDEO_MAX_SEGMENT_SIZE_BYTES = 25,000,000
registered segment size      ≈ 11,527,176
```

**Not blocked by size limit.**

---

## 8. Signed URL TTL

| Setting | Value |
|---------|-------|
| `VIDEO_UPLOAD_URL_TTL_SECONDS` (was) | **300** (5 min) |
| segment 0 register | 05:21:47 |
| segment 0 first PUT start | ~05:24:37 (**170 s** later — within 300 s) |
| segment 8 PUT finish | 05:24:40 (**63 s** after its register) — still **403**, so **not pure expiry** |

Contributing factors:

- Token checked **after** body read (60 s transfer completes validation window edge cases)
- Dev server **hot reload** can rotate ephemeral signing secret when `JWT_SECRET`/`VIDEO_SIGNING_SECRET` unset
- Serialized upload queue can exceed 300 s for early segments when driver uploads late

**Fix:** default TTL raised to **1800 s**; token validated **before** body read with **`validAt` = request start**.

---

## 9. Complete contract

```typescript
completeVideoSegmentSchema = {
  checksum?: sha256 hex,
  fileSizeBytes?: number,
}
```

All fields optional. **Not a validation blocker** — complete was never reached.

---

## 10. Playable state definition

From `isPlayableSegment` / `assertPlaybackAllowed` / `buildDvrPlaybackManifest`:

1. `upload_status` ∈ **`uploaded` or `verified`**
2. `storage_key` present
3. `retention_deleted_at` is null
4. **File exists on disk** (manifest builder only)

`complete` sets status to **`verified`** (not `completed`). **No status mismatch.**

---

## 11. Manifest trace (at failure)

```json
{
  "sessionId": "27a93d27-9d85-4583-a34a-c0517dca203e",
  "playbackReason": "WAITING_FOR_FIRST_SEGMENT",
  "totalSegments": 11,
  "pendingCount": 11,
  "uploadingCount": 0,
  "uploadedCount": 0,
  "verifiedCount": 0,
  "failedCount": 0,
  "storageObjectCount": 0,
  "playableCount": 0,
  "manifestVersion": 1
}
```

**After fix proof:**

```json
{
  "ok": true,
  "manifestVersion": 4,
  "segmentCount": 1,
  "liveEdgeSeconds": 11,
  "availableDurationSeconds": 11
}
```

---

## 12. Fixes applied

| Change | File |
|--------|------|
| Validate upload token **before** `express.raw` body read | `src/middleware/videoUploadToken.ts`, `src/routes/v1/driver/video.ts` |
| Accept token valid at **request start** (`validAt`) for slow uploads | `src/services/ride-video-storage.service.ts` |
| Distinct token failure reasons + logging | `StorageTokenError`, `recording.upload_token_rejected` |
| Default upload TTL **300 → 1800** seconds | `src/config/video.ts` |
| Warn on ephemeral dev signing secret | `ride-video-storage.service.ts` |
| Expanded `ride_video.manifest_blocked` counts | `rideVideoSegmentTrace.service.ts` |
| Regression test: `validAt` grace | `tests/ride-video-foundation.test.ts` |

---

## 13. Runtime proof (segment 0, post-fix)

```json
{
  "segmentIndex": 0,
  "putStatus": 200,
  "putUploadStatus": "uploaded",
  "completeStatus": 200,
  "completeUploadStatus": "verified",
  "dbUploadStatus": "verified",
  "manifestVersionBefore": 2,
  "manifestVersionAfter": 4,
  "storageObjectExists": true,
  "adminPlaybackManifest": "HTTP 200, segments.length=1, liveEdgeSeconds=11"
}
```

Chain satisfied:

- register → already existed (201 at 05:21:47)
- PUT → **200**
- storage exists → **true**
- complete → **200**
- DB playable → **verified**
- manifestVersion increased → **2 → 4**
- Admin playback-manifest → **200**, `segments.length >= 1`, `liveEdgeSeconds > 0`

---

## 14. Tests

```text
npm run build  ✅
npm test       ✅ 299 tests
```

New regression: **accepts token at upload request start even if it expires before body finishes**

---

## 15. Driver-side note (backend confirmed, no app change)

Driver **registers segments promptly** but **defers PUT uploads ~2–3 minutes**. During that window Admin will correctly see `WAITING_FOR_FIRST_SEGMENT` even on an active booking. After fix, when PUTs run, tokens must be validated at upload start and remain stable (set `VIDEO_SIGNING_SECRET` or `JWT_SECRET` in all environments).

If upload fails with `VIDEO_UPLOAD_TOKEN_EXPIRED`, driver should **re-register same `clientSegmentId`** to obtain a fresh upload URL (idempotent — no duplicate segment).

---

## Final status

### **READY FOR FRESH ADMIN PLAYBACK RETEST**

Start a **new recording session** (this session’s segments 1–10 remain pending). Confirm first segment PUT returns **200** within one segment duration + upload latency, then Admin playback-manifest returns **200** with `liveEdgeSeconds > 0`.
