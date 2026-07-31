# Trip Video Recording — Implementation Report

**Date:** June 2026  
**Status:** Complete (v1 local storage)

---

## Files changed / created

| File | Action |
|------|--------|
| `src/db/migrations/0010_trip_videos.sql` | Created |
| `src/db/migrations/meta/_journal.json` | Updated (idx 10) |
| `src/db/schema/trip_videos.ts` | Created |
| `src/db/schema/trip_videos.sql` | Created (reference DDL) |
| `src/db/schema/index.ts` | Updated |
| `src/repositories/tripVideo.repository.ts` | Created |
| `src/services/video-storage.service.ts` | Created |
| `src/services/video.service.ts` | Created |
| `src/middleware/upload.ts` | Created |
| `src/controllers/video.controller.ts` | Created |
| `src/routes/videos.ts` | Created |
| `src/routes/trips.ts` | Updated (`GET /:tripId/videos`) |
| `src/validators/index.ts` | Updated |
| `src/index.ts` | Updated (routes + static `/uploads`) |
| `package.json` | Updated (`multer`, `@types/multer`) |
| `.gitignore` | Created |
| `uploads/.gitkeep` | Created |
| `VIDEO_API_REFERENCE.md` | Created |
| `POSTMAN_VIDEO_COLLECTION.json` | Created |

---

## Endpoints

| Method | Path | Role |
|--------|------|------|
| POST | `/api/videos/upload` | driver |
| GET | `/api/trips/:tripId/videos` | driver (own) / admin |
| GET | `/api/videos/:videoId` | driver (own) / admin |
| DELETE | `/api/videos/:videoId` | admin |

---

## Migration SQL

See `src/db/migrations/0010_trip_videos.sql`

```powershell
npm run db:migrate
```

---

## How Android should upload

1. **Login** → `POST /api/auth/login` → save `data.token`
2. **Complete trip** → note `tripId`
3. **Upload after trip ends:**

```kotlin
// Retrofit / OkHttp multipart example
val requestBody = MultipartBody.Builder()
    .setType(MultipartBody.FORM)
    .addFormDataPart("tripId", tripId)
    .addFormDataPart("startTime", startTimeIso)
    .addFormDataPart("endTime", endTimeIso)
    .addFormDataPart("duration", durationSeconds.toString())
    .addFormDataPart(
        "video_file",
        "trip-recording.mp4",
        videoFile.asRequestBody("video/mp4".toMediaType())
    )
    .build()

// Headers
// Authorization: Bearer <token>
// X-Device-ID: <device uuid>
// POST /api/videos/upload
```

4. On **201** response, use `data.videoUrl` and delete local file
5. Show upload progress with OkHttp `ProgressRequestBody` for large files (up to 500MB)

**Tips:**
- Upload on Wi‑Fi when possible
- Retry on network failure (same tripId allowed — creates new video row each upload)
- Use `video/mp4` MIME for `.mp4` files

---

## Storage abstraction (future S3/R2/GCS)

`VideoStorageProvider` interface in `video-storage.service.ts`:

```typescript
uploadVideo(input): Promise<{ fileName, storageKey, videoUrl }>
deleteVideo(storageKey): Promise<void>
getVideoUrl(storageKey): string
```

Swap `getVideoStorageService()` implementation to cloud provider without changing API routes.

---

## Migrating to streaming later

| Phase | Approach |
|-------|----------|
| v1 (now) | Full file POST multipart → local disk |
| v2 | Presigned URL upload direct to S3/R2 (client uploads to bucket, backend saves metadata) |
| v3 | HLS/DASH transcoding pipeline (MediaConvert / FFmpeg worker) |
| v4 | CDN delivery + signed URLs for playback |

Recommended path:
1. Implement `S3VideoStorageService` implementing `VideoStorageProvider`
2. Add `POST /api/videos/presign` for direct mobile → bucket upload
3. Webhook on upload complete → insert `trip_videos` row
4. Optional: `upload_status` values `pending`, `uploaded`, `processing`, `ready`

---

## Security implemented

- JWT auth on all routes
- Driver role required for upload
- Trip ownership validation
- MIME whitelist + magic-byte (`ftyp`) validation
- Extension blocklist (`.exe`, `.zip`, etc.)
- 500MB size limit
- Sanitized original filenames
- Path traversal protection on delete
- Admin-only delete

---

## Setup

```powershell
npm install
npm run db:migrate
npm run dev
```

Import `POSTMAN_VIDEO_COLLECTION.json` into Postman for manual testing.
