# Backend Admin Ride Video — Implementation Report

## Final status

**READY FOR ADMIN DASHBOARD INTEGRATION**

---

## Existing components reused

| Component | How reused |
|-----------|------------|
| `video_sessions` / `video_segments` | Source of truth for sessions and segments |
| Booking consent columns | Absence reasons + consent display |
| `createAdminSegmentReadUrl` / HMAC tokens | Playback URLs (no cloud signing secrets exposed) |
| `GET .../video/segments/:id/content` | Byte delivery for signed tokens |
| `requireAuth` + `extractUserInfo` + `requireAdmin` | Auth stack |
| `sendSuccess` / pagination metadata | Response envelope |
| Socket admin room + recording events | Live updates without playback URLs |
| `videoConfig` retention/TTL | Retention + URL expiry |
| Driver/passenger recording services | Left untouched |

### Mapping (existing → admin capability)

| Existing | Admin capability |
|----------|------------------|
| Session/segment tables | List, detail, segments, health, summary |
| Booking consent | Booking ride-video absence reasons |
| HMAC read tokens | Playback manifest + refresh |
| Booking events + session lifecycle | Timeline |
| (new) `ride_video_audit_events` | Audit API |
| Admin WS events | Polling fallback documented |

---

## Routes added

Base: `/api/v1/admin`

| Method | Path | Permission |
|--------|------|------------|
| GET | `/ride-videos` | view |
| GET | `/ride-videos/summary` | view |
| GET | `/ride-videos/:sessionId` | view |
| GET | `/bookings/:bookingId/ride-video` | view |
| GET | `/ride-videos/:sessionId/segments` | view |
| GET | `/ride-videos/:sessionId/health` | view |
| GET | `/ride-videos/:sessionId/timeline` | view |
| POST | `/ride-videos/:sessionId/playback-manifest` | play |
| POST | `/ride-videos/:sessionId/segments/:segmentId/playback-url` | play |
| GET | `/ride-videos/:sessionId/audit` | audit |
| POST | `/ride-videos/:sessionId/download` | download → 409 unsupported |

Delete: **not implemented** (by design).

Legacy routes retained:

- `GET /bookings/:bookingId/video`
- `POST /video/segments/:segmentId/read-url`
- `GET /video/segments/:segmentId/content`

---

## Services / files added

- `src/services/adminRideVideo.service.ts` — admin list/detail/health/timeline/playback
- `src/services/adminRideVideo.helpers.ts` — pure health/status/gap/retention helpers
- `src/controllers/adminRideVideo.controller.ts`
- `src/routes/v1/admin/rideVideos.ts`
- `src/constants/rideVideoPermissions.ts`
- `src/middleware/rideVideoPermissions.ts`
- `src/repositories/rideVideoAudit.repository.ts`
- `src/repositories/rideVideoAudit.types.ts`
- `src/db/schema/ride_video_audit_events.ts`
- `src/db/migrations/0021_ride_video_admin_api.sql`
- `tests/admin-ride-video.test.ts`
- `ADMIN_RIDE_VIDEO_API_CONTRACT.md`
- `ADMIN_RIDE_VIDEO_API.openapi.yaml`
- `BACKEND_ADMIN_RIDE_VIDEO_IMPLEMENTATION_REPORT.md` (this file)

---

## Authorization

- Role gate: `admin` / `super_admin`
- Fine-grained: `ride_video.*` via JWT claim or role fallback
- `admin` → view/play/audit
- `super_admin` → all including download/manage/delete
- Download endpoint still returns unsupported even for super_admin

---

## Database

Migration `0021_ride_video_admin_api.sql`:

- Table `ride_video_audit_events`
- Indexes on sessions: created_at, finalized_at, passenger_id, consent_status
- Index on segments: retention_deleted_at
- Journal entry added to `meta/_journal.json`

**Deploy:** run `npm run db:migrate` (or apply SQL) before using audit endpoints.

---

## Signed playback design

1. Admin requests manifest window (`fromIndex`/`limit`, max 30).
2. Backend verifies permission, retention, playable status.
3. Reuses `createReadToken` → relative URL under `/api/v1/admin/video/segments/:id/content?token=...`
4. Refresh endpoint for expired URLs.
5. Secrets never returned; storage paths never exposed as permanent URLs.
6. Audit `STARTED_PLAYBACK` / `REFRESHED_PLAYBACK_URL`.

---

## Audit behavior

Append-only `ride_video_audit_events`. Sensitive metadata/playback actions recorded with admin Auth0 id/email, optional IP/UA, session/booking ids.

---

## Retention behavior

- Expiry = finalizedAt (or createdAt) + `VIDEO_RETENTION_DAYS`
- Statuses: active / expiring_soon (≤7 days) / expired / deleted (all segment media purged)
- Playback rejects expired/deleted with **410**

---

## Rate limits

Dedicated limiters (skipped from global limiter):

- List family
- Playback (keyed by admin + session)
- Download

429 includes `Retry-After` and `retryAfterSeconds`.

---

## Tests

| Suite | Result |
|-------|--------|
| `tests/admin-ride-video.test.ts` | Pass (helpers + permissions) |
| `tests/ride-video-foundation.test.ts` | Pass (driver/passenger foundation unchanged) |
| `tests/rate-limit-config.test.ts` | Pass (updated for new 429 shape + skip paths) |
| `tsc --noEmit` / `npm run build` | Pass |

Known gap: full HTTP integration tests against a live DB for every admin endpoint were not added; unit coverage focuses on health/permission contracts. Contract doc is the dashboard integration source of truth.

---

## Environment variables

No new required vars. Uses existing video + Auth0 config. Optional rate-limit env vars listed in the API contract.

---

## Deployment steps

1. Pull changes.
2. `npm run db:migrate` (ensures `ride_video_audit_events` + indexes).
3. Restart API (`npm run build && npm start` or current process manager).
4. Confirm `GET /api/v1/admin/ride-videos` with admin JWT returns 200.
5. Point Admin Dashboard at contract base path.

---

## Known limitations

1. Combined download not available (`downloadAvailable: false`).
2. Delete not implemented.
3. No new dedicated `admin:ride-video:*` socket event names; reuse existing `recording:*` admin events.
4. Post-filters for `uploadHealth` / computed `recordingStatus` / `retentionStatus` apply after SQL page fetch (may reduce page fullness when those filters are used). Prefer session status / date / id filters for large fleets.
5. Fine-grained Auth0 API scopes for `ride_video.*` are optional; role fallback is active until scopes are assigned in Auth0.

---

## Documentation for dashboard

Primary: `ADMIN_RIDE_VIDEO_API_CONTRACT.md`  
OpenAPI sketch: `ADMIN_RIDE_VIDEO_API.openapi.yaml`
