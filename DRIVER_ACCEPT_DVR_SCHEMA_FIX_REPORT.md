# Driver Accept DVR Schema Fix Report

**Date:** 2026-08-13  
**Database:** `postgresql://postgres@localhost:5432/ryd_u` (from `.env` `DATABASE_URL`)  
**Final status:** **READY FOR ACCEPT AND VIDEO RETEST**

---

## Summary

Driver Accept was committing successfully but returning **HTTP 500** because Drizzle ORM queried `video_sessions.manifest_version` and `video_sessions.last_upload_activity_at` columns that did not exist in the live database. Migration `0022_ride_video_dvr_foundation.sql` was present in the repo but **never registered in Drizzle's migration journal**, so `npm run db:migrate` skipped it.

---

## Root cause

| Layer | Finding |
|-------|---------|
| **Code / Drizzle schema** | `src/db/schema/video_sessions.ts` defines `manifestVersion` and `lastUploadActivityAt` (added for DVR foundation). |
| **SQL migration file** | `src/db/migrations/0022_ride_video_dvr_foundation.sql` exists and is idempotent (`ADD COLUMN IF NOT EXISTS`). |
| **Migration journal** | `src/db/migrations/meta/_journal.json` stopped at `0021_ride_video_admin_api` — **0022 was missing**. |
| **Live database** | Before fix: `information_schema` showed **zero rows** for both columns; `drizzle.__drizzle_migrations` had **21** entries (last = 0021). |
| **Runtime symptom** | Post-commit `buildDriverBookingPayload()` → `findActiveSessionByBooking()` → Drizzle `SELECT` including missing columns → unhandled error → HTTP 500 on Accept and Active booking endpoints; ride-video recovery worker logged `ride_video.recovery_failed`. |

### PostgreSQL error beneath `DrizzleQueryError`

When the Drizzle schema expects columns that are absent, PostgreSQL returns:

```text
code: 42703
severity: ERROR
message: column "manifest_version" does not exist
```

(Drizzle wraps this as `DrizzleQueryError` with the PG error on `error.cause`. The same failure occurs for `last_upload_activity_at` if `manifest_version` were present alone.)

**Failing query shape (from runtime logs):**

```sql
SELECT
  id, trip_id, booking_id, driver_id, passenger_id, status, consent_status,
  started_at, paused_at, ended_at, finalized_at, failure_reason,
  manifest_version, last_upload_activity_at, created_at, updated_at
FROM video_sessions
WHERE ...
```

---

## Fixes applied

### 1. Register and apply migration 0022

- Added journal entry `0022_ride_video_dvr_foundation` to `src/db/migrations/meta/_journal.json`.
- Ran `npm run db:migrate` against the same `DATABASE_URL` the backend uses.

**Post-migration verification:**

```json
[
  { "column_name": "last_upload_activity_at", "data_type": "timestamp with time zone" },
  { "column_name": "manifest_version", "data_type": "integer" }
]
```

- `drizzle.__drizzle_migrations` count: **22** (last hash matches 0022).
- No existing `video_sessions` rows were deleted or recreated; migration only adds columns, extends status check, and creates indexes.

### 2. Harden post-commit response building

**`src/services/driverBooking.service.ts`**

- Added `loadOptionalVideoMetadata()` wrapped in try/catch.
- On video lookup failure: logs `driver.booking.video_metadata_failed` (includes PG code when available) and sets **`video: null`** instead of throwing.
- Accept / active / detail payloads remain available when optional video metadata is unavailable.

**`src/services/dispatch.service.ts`**

- After successful accept commit, `getDriverBookingDetailForDriver()` is wrapped in try/catch.
- On failure: logs `driver.accept.response_build_failed` and still returns `{ success: true, booking: ... }` so a committed acceptance is not misrepresented as failure.

### 3. Diagnostic scripts (optional)

- `src/scripts/check-dvr-columns.ts` — validates DVR columns and migration journal against live DB.
- `src/scripts/verify-dvr-schema-fix.ts` — smoke-tests active booking + video session endpoints.

---

## Verification

### Commands

| Command | Result |
|---------|--------|
| `npm run db:migrate` | ✅ Applied 0022 |
| `npm run build` | ✅ Success |
| `npm test` | ✅ **28 suites, 297 tests passed** |

### Live endpoint checks (backend on `http://127.0.0.1:3000`)

| Endpoint | Result |
|----------|--------|
| `POST /api/v1/driver/bookings/:bookingId/accept` | ✅ **HTTP 200**, `driver.accept.transaction phase=committed`, `bookingStatusAfterRequest=driver_en_route` |
| `GET /api/v1/driver/bookings/active` | ✅ **HTTP 200** (no longer 500) |
| `POST /api/v1/driver/bookings/:bookingId/video/session` | ✅ **HTTP 409** (consent/business rule — not schema 500) |
| `GET /api/v1/driver/bookings/:bookingId/video/session` | ✅ **HTTP 200** |

`verify-accept-trace.ts` output:

```json
{
  "httpStatus": 200,
  "transaction": { "started": true, "committed": true, "rolledBack": false },
  "bookingStatusAfterRequest": "driver_en_route",
  "finalStatus": "ACCEPT BACKEND READY"
}
```

Recovery worker: with columns present, `reconcileStaleSessions()` can query `video_sessions` without column errors; **`ride_video.recovery_failed` should no longer appear** for this schema mismatch.

---

## Deployment checklist

1. Deploy code including updated `_journal.json` and hardened services.
2. Run **`npm run db:migrate`** on each environment's `DATABASE_URL` before or during rollout.
3. Confirm columns exist (or run `npx tsx src/scripts/check-dvr-columns.ts`).
4. Restart backend processes so they use the migrated schema.
5. Retest Accept → Active → Video session on a fresh booking.

---

## Files changed

| File | Change |
|------|--------|
| `src/db/migrations/meta/_journal.json` | Register migration 0022 |
| `src/services/driverBooking.service.ts` | Resilient optional video metadata |
| `src/services/dispatch.service.ts` | Accept response build no longer throws after commit |
| `src/scripts/check-dvr-columns.ts` | DB column verification helper |
| `src/scripts/verify-dvr-schema-fix.ts` | Endpoint smoke test helper |

---

## Final status

**READY FOR ACCEPT AND VIDEO RETEST**

Schema and runtime are aligned; Accept returns HTTP 200 after commit; optional video metadata failures no longer convert successful accepts into HTTP 500.
