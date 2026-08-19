# Backend DVR Runtime Audit Report

**Date:** 2026-08-14  
**Scope:** Fresh ride-video session on current test booking (audit only — no code changes)  
**Auditor:** Backend runtime inspection (DB, storage, dev-server logs, code paths)

---

## Executive summary

The latest fresh session **`a81a60f9-2d9d-4ec2-962e-b43ba0167779`** registered **8 segments** during a ~9-minute recording, but **no segment PUT upload ever reached the backend**. `last_upload_activity_at` stayed **null**, storage contains **zero files**, and all segments remained **`pending`** until disconnect recovery marked them **`failed`** at **05:45:22 UTC**.

Admin correctly returned **409 `WAITING_FOR_FIRST_SEGMENT`** while the session was active/finalizing with zero playable segments. After recovery the session is **`failed`** and manifest requests return **409 `RECORDING_PARTIAL`**.

**Classification:** **B. REGISTERED_UPLOAD_NOT_STARTED**

---

## 1. Latest fresh session

| Field | Value |
|-------|-------|
| **bookingId** | `b00adca1-b7bf-4c75-82bc-17957701cbc5` |
| **bookingNumber** | `RYD-MSSIHQBX-7FBK` |
| **sessionId** | `a81a60f9-2d9d-4ec2-962e-b43ba0167779` |
| **driverId** | `4d8d26f0-cee9-4575-8331-ae64b072f42c` |
| **passengerId** | `5b09ba54-e76b-4632-8a28-baf4b7f46cfa` |
| **booking status** | `completed` |
| **session status** | `failed` (was `active` during recording; entered `finalizing` at ride end; recovery finalized at 05:45:22) |
| **manifestVersion** | **8** (at audit time; was **0** at create, bumped only by finalization/failure — not by register) |
| **startedAt** | `2026-08-14T05:33:57.995Z` |
| **endedAt** | `2026-08-14T05:43:10.824Z` |
| **finalizedAt** | `2026-08-14T05:45:22.745Z` |
| **lastUploadActivityAt** | **`null`** (never set — definitive proof no successful PUT) |
| **consentStatus** | `granted` |

**Selection rationale:** Most recently created session in `video_sessions` for the active test driver/passenger pair; matches the Admin Ride Video page session under test.

---

## 2. All segments (session `a81a60f9…`)

**Total segment count:** 8  
**Indexes:** 0–7

| Idx | segmentId | duration | fileSize | uploadStatus | storageKey (exists?) | retry | createdAt | updatedAt | failureReason |
|-----|-----------|----------|----------|--------------|----------------------|-------|-----------|-----------|---------------|
| 0 | `87139bcb-9853-4914-b937-f63ce06cd011` | 10,978 ms | 11,725,913 B | `failed` | `…/0-87139bcb….mp4` (**no**) | 0 | 05:34:09.219Z | 05:45:22.732Z | Stale registered segment timed out |
| 1 | `dd5af2ca-b65b-4604-b173-a0850bc01606` | 10,539 ms | 11,548,976 B | `failed` | (**no**) | 0 | 05:34:38.616Z | 05:45:22.728Z | Stale registered segment timed out |
| 2 | `5f6d4bcc-bedf-4404-bf42-f9eceb12700d` | 10,490 ms | 11,540,648 B | `failed` | (**no**) | 0 | 05:34:38.974Z | 05:45:22.735Z | Stale registered segment timed out |
| 3 | `62c36c9b-3305-4699-af6e-6dceddbcf57a` | 10,484 ms | 11,521,044 B | `failed` | (**no**) | 0 | 05:35:02.895Z | 05:45:22.730Z | Stale registered segment timed out |
| 4 | `0495e2ba-3707-41e8-83f2-f76ad00f5d59` | 10,491 ms | 11,565,610 B | `failed` | (**no**) | 0 | 05:35:02.934Z | 05:45:22.734Z | Stale registered segment timed out |
| 5 | `5be8cc92-ad90-4bd6-b630-8d3b05835077` | 10,476 ms | 11,503,035 B | `failed` | (**no**) | 0 | 05:35:03.057Z | 05:45:22.737Z | Stale registered segment timed out |
| 6 | `354f8b70-e26e-49ca-bf89-a76185616dca` | 10,539 ms | 11,520,071 B | `failed` | (**no**) | 0 | 05:35:53.770Z | 05:45:22.742Z | Disconnect recovery finalize |
| 7 | `554d1bf1-f8fc-43cb-806c-c0d5a69d4405` | 10,433 ms | 11,468,339 B | `failed` | (**no**) | 0 | 05:35:53.913Z | 05:45:22.743Z | Disconnect recovery finalize |

**Status summary (current DB state):**

| Status | Count |
|--------|-------|
| pending | 0 |
| uploading | 0 |
| uploaded | 0 |
| verified / playable | 0 |
| failed | **8** |

**During live recording (05:34–05:43):** all 8 segments were **`pending`**, **`uploadedAt` null**, checksum present on all rows.

---

## 3. Segment 0 trace (`87139bcb…`, index 0)

### REGISTER

| Check | Evidence |
|-------|----------|
| Request received? | **Yes** — DB row exists; `createdAt = 2026-08-14T05:34:09.219Z` |
| recordedAt | `2026-08-14T05:33:59.499Z` (~10 s before register) |
| HTTP status | **201** (expected from `registerVideoSegmentHandler`; no 4xx row in DB) |
| Response shape | `{ segment: { id, sequenceNumber, uploadStatus: "pending", … }, upload: { method: "PUT", url, storageKey, expiresAt, requiredHeaders } }` per controller |

Dev-server log buffer **does not retain** register lines from 05:34 (server restarted / log rotation). Register success is inferred from persisted segment row + handler contract.

### PUT

| Check | Evidence |
|-------|----------|
| Request received? | **No runtime evidence** |
| Timestamps | N/A |
| HTTP status | N/A |
| Content length / bytes written | N/A |
| Token valid/invalid | **Untested** — no PUT reached middleware |
| Storage write | **Failed by absence** — file never created |

Grep of live dev-server terminal for `/upload`, `87139bcb`, `segment_route` (upload), `recording.upload_token_rejected`: **zero matches** for this session.

### COMPLETE

| Check | Evidence |
|-------|----------|
| Request received? | **No** |
| HTTP status | N/A |
| DB state after complete | N/A — segment never left `pending` until recovery set `failed` |

### MANIFEST (admin, during/after test)

Observed at **05:45:22 UTC** (`ride_video.manifest_blocked`):

```
playbackReason: "RECORDING_PARTIAL"
totalSegments: 8
pendingCount: 0
uploadingCount: 0
uploadedCount: 0
verifiedCount: 0
failedCount: 8
storageObjectCount: 0
playableCount: 0
manifestVersion: 8
liveEdgeSeconds: 0
```

**Why Admin saw `WAITING_FOR_FIRST_SEGMENT` during recording:**

`computePlaybackEligibility` returns `WAITING_FOR_FIRST_SEGMENT` when `playableSegmentCount === 0` and session status ∈ `{active, paused, pending}`:

```454:461:src/services/adminRideVideo.helpers.ts
  if (['active', 'paused', 'pending'].includes(input.sessionStatus)) {
    return {
      playbackAvailable: false,
      playbackReason: 'WAITING_FOR_FIRST_SEGMENT',
      availableSegmentCount: 0,
      latestSegmentIndex,
      finalized: false,
    };
  }
```

`assertPlaybackAllowed` maps that to HTTP **409 `WAITING_FOR_FIRST_SEGMENT`**. With zero segments in `uploaded`/`verified` state and no storage objects, `playableCount` and `liveEdgeSeconds` remain **0**.

---

## 4. Storage inspection

**Root:** `C:\Users\AttoExa PC 5\Downloads\backend_rydu\private-media`  
**Session path:** `private-media/ride-recordings/b00adca1-b7bf-4c75-82bc-17957701cbc5/a81a60f9-2d9d-4ec2-962e-b43ba0167779`

| Check | Result |
|-------|--------|
| Directory exists? | **No** — `ENOENT` on scandir |
| File count | **0** |
| Segment 0 file | **Does not exist** (`0-87139bcb-9853-4914-b937-f63ce06cd011.mp4`) |

Storage keys are pre-assigned at register time in DB, but **no bytes were ever written**.

---

## 5. Upload URL / token (segment 0)

Derived from runtime config + register timestamp (token value **not** logged):

| Field | Value |
|-------|-------|
| URL form | **Relative** — `apiPublicBaseUrl` is `null` (`VIDEO_API_PUBLIC_BASE_URL` / `API_PUBLIC_BASE_URL` unset) |
| Path pattern | `/api/v1/driver/video/segments/87139bcb-9853-4914-b937-f63ce06cd011/upload?token=<signed>` |
| TTL | **300 seconds** (from `.env` `VIDEO_UPLOAD_URL_TTL_SECONDS=300`; code default is 1800 but env overrides) |
| issuedAt (approx) | `2026-08-14T05:34:09.219Z` (segment `createdAt`) |
| expiresAt (approx) | `2026-08-14T05:39:09.219Z` |
| Signing secret | `VIDEO_SIGNING_SECRET` set (stable across restarts) |
| Token validation at PUT | **Not exercised** — no PUT observed |
| Authorization failure reason | N/A for this session |

**Note:** Even if the driver had deferred PUT past 300 s, we would expect a **403** with `recording.upload_token_rejected` in logs. Absence of any PUT log line indicates upload was **never started**, not merely rejected.

---

## 6. Playable state — code vs runtime

### What makes a segment playable

**DB-level (`isPlayableSegment`):**

```44:49:src/services/rideVideoDvr.helpers.ts
export function isPlayableSegment(segment: DvrSegmentInput): boolean {
  return (
    PLAYABLE_UPLOAD_STATUSES.includes(segment.uploadStatus as (typeof PLAYABLE_UPLOAD_STATUSES)[number]) &&
    Boolean(segment.storageKey) &&
    !segment.retentionDeletedAt
  );
}
```

`PLAYABLE_UPLOAD_STATUSES = ['uploaded', 'verified']`.

**Manifest-level (`buildDvrPlaybackManifest`):** additionally requires **`inspectPrivateSegment(storageKey)`** to return a file on disk. Metadata alone is insufficient.

### What upload/complete endpoints write

| Step | `uploadStatus` written | Playable? |
|------|------------------------|-----------|
| Register | `pending` | No |
| PUT (`uploadRideVideoSegment`) | `uploaded` | Yes (DB); manifest also needs file on disk (PUT creates file) |
| Complete (`completeRideVideoSegment`) | `verified` | Yes |

**No status mismatch** between `uploaded`/`verified` and playable logic. This session never reached either state.

### Runtime comparison

| Requirement | Segment 0 actual |
|-------------|------------------|
| `uploadStatus` ∈ `{uploaded, verified}` | `pending` → `failed` |
| `storageKey` present | Yes (metadata only) |
| File on disk | **No** |
| Playable | **No** |

---

## 7. Manifest version

**Schema default:** `manifest_version = 0` on session create.

**Increments only via `bumpManifestVersion` on:**

| Event | Increments? | This session |
|-------|-------------|--------------|
| Segment register | **No** | — |
| Segment PUT / upload | **No** (unless `onSegmentBecamePlayable` fires) | Never fired |
| Segment complete → verified | **Yes** (`segment_playable`) | Never fired |
| Segment failed (stale recovery) | **Yes** (`segment_failed`) | **+6** (segments 0–5) |
| Session → finalizing | **Yes** (`session_finalizing`) | **+1** |
| Session finalized | **Yes** (`session_finalized`) | **+1** |
| **Final `manifestVersion`** | | **8** |

Manifest version **did not** increment from uploads because no upload completed.

---

## 8. Realtime admin events

Inferred from code paths + trace logs (no socket capture in audit):

| Event | Emitted for this session? | Notes |
|-------|---------------------------|-------|
| `admin:ride-video:session_updated` | Likely on session create/restore | Session visible in Admin list |
| `admin:ride-video:segment_available` | **Yes, ×8 on register** | Emitted via `notifyAdminSegmentState` with `uploadStatus: "pending"` — **not proof of playability** |
| `admin:ride-video:manifest_updated` | **No** | Only from `onSegmentBecamePlayable` (never called) |
| `admin:ride-video:finalizing` | **Yes** | When session entered `finalizing` (~05:43:10) |
| `admin:ride-video:finalized` | **Yes** | At 05:45:22 recovery — `readySegmentCount: 0`, `playableSegmentCount: 0`, status `failed` |

Trace at finalization:

```
stage: "session_finalized"
reason: "Disconnect recovery finalize"
readySegmentCount: 0
playableSegmentCount: 0
sessionStatus: "failed"
```

**Post-recovery register/finalize retries:** dev-server shows repeated **HTTP 429** on `POST …/segments` and `POST …/finalize` (limiter: `global`, `userRole: anonymous`) after ride ended — these did **not** produce new playable segments.

---

## 9. Failure classification

### **B. REGISTERED_UPLOAD_NOT_STARTED**

**Primary evidence:**

1. Eight segments registered with checksums and expected file sizes (~11.5 MB each).
2. `last_upload_activity_at` is **null** for the entire session lifetime.
3. **Zero** storage objects under `VIDEO_STORAGE_ROOT`.
4. **Zero** PUT `/upload` log lines for session `a81a60f9…` or segment `87139bcb…`.
5. All segments stayed **`pending`** for the full ~9-minute recording window until recovery marked them failed.

**Ruled out for this session:**

| Class | Why excluded |
|-------|--------------|
| A. ZERO_SEGMENTS_REGISTERED | 8 segments registered |
| C. PUT_AUTHORIZATION_FAILED | No PUT reached server |
| D. PUT_STORAGE_WRITE_FAILED | No PUT reached server |
| E. PUT_SUCCEEDED_COMPLETE_NOT_CALLED | No storage files |
| F. COMPLETE_FAILED | Complete never attempted |
| G. COMPLETE_SUCCEEDED_NOT_PLAYABLE | Complete never succeeded |
| H. MANIFEST_EXCLUDES_PLAYABLE_SEGMENT | No playable segments existed to exclude |

**Contributing factors (secondary, not re-classifying):**

- Same driver/device pattern as prior session `27a93d27…`: long gap between register and PUT start (~170 s observed previously); this session shows **no PUT at all**.
- `.env` still sets **`VIDEO_UPLOAD_URL_TTL_SECONDS=300`** (5 min) vs code default 1800 — relevant if driver defers upload, but moot here because PUT never started.
- Post-ride **429 rate limiting** on segment register/finalize retries may block driver recovery attempts after disconnect.

---

## 10. Cross-session context (same test day)

| Session | Register | PUT reached server | First playable | Admin symptom |
|---------|----------|-------------------|----------------|---------------|
| `8f94075d…` | 26 segments | Yes | No — 409 `BOOKING_NOT_RECORDABLE` on PUT | WAITING_FOR_FIRST_SEGMENT |
| `27a93d27…` | 11 segments | Yes (delayed ~170 s) | No — 403 `INVALID_VIDEO_UPLOAD_AUTHORIZATION` | WAITING_FOR_FIRST_SEGMENT |
| **`a81a60f9…` (this audit)** | **8 segments** | **No** | **No** | **WAITING_FOR_FIRST_SEGMENT → RECORDING_PARTIAL** |

The fresh session regression is **earlier in the pipeline**: uploads never begin, despite successful registration during an **`completed`** (not cancelled) booking.

---

## Recommended next steps (audit only — not implemented)

1. **Driver-side:** Confirm upload queue processes PUT after register for session `a81a60f9…` (logcat / network trace on device).
2. **Backend observability:** Preserve `segment_route` / `recording.upload_url_issued` logs across dev-server restarts for future audits.
3. **If PUT deferral > 300 s:** Align `.env` `VIDEO_UPLOAD_URL_TTL_SECONDS` with code default (1800) or driver upload scheduling.
4. **Rate limits:** Investigate why post-ride segment/finalize calls hit **`global`** limiter as `anonymous` (429 storm after disconnect).

---

**AUDIT COMPLETE — B. REGISTERED_UPLOAD_NOT_STARTED**
