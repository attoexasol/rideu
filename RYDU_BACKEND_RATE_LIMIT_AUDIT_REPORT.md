# RYDU Backend Rate Limit Audit Report

**Date:** 2026-09-09  
**Repository:** `backend_rydu`  
**Environment observed:** `NODE_ENV=development` (dev server running on port 3000)  
**Scope:** HTTP 429 from Rydu Node backend only (not Android Flogger)

---

## Executive Summary

The Rydu backend **does return HTTP 429** when rate limits are exceeded, using `express-rate-limit` with a centralized configuration in `src/config/rate-limit.ts`. However, for **physical-device testing with 1 passenger + 1 driver in development**, normal app traffic **should not** hit configured limits.

The Android log line:

```
W/ProxyAndroidLoggerBackend: Too many Flogger logs received before configuration. Dropping old logs.
```

is **Google/Android Flogger internal logging**, not an HTTP 429 from this backend. No `[RateLimit] exceeded` or `[RATE_LIMIT_DEBUG] 429 triggered` entries were found in the running dev server terminal.

**Final status:**

```
RYDU BACKEND RATE LIMIT AUDIT COMPLETE — NO BACKEND 429 ISSUE
```

*(For current development testing. Production has tighter buckets — see §6 and §9.)*

---

## 1. Does the Backend Return HTTP 429?

**Yes.** Two code paths:

| Path | File | Response |
|------|------|----------|
| Primary (all configured limiters) | `src/middleware/create-rate-limiter.ts` | `429` + `{ error: { code: 'RATE_LIMITED', ... } }` + `Retry-After` header |
| Legacy fallback | `src/middleware/error-handler.ts` | `429` + `{ error: { code: 'RATE_LIMIT_EXCEEDED', ... } }` if error message contains "Too many requests" |

The primary path is what all current limiters use. Standard response body:

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Please try again shortly.",
    "retryable": true,
    "details": { "retryAfterSeconds": 60 }
  }
}
```

---

## 2. Every Configured Rate Limiter

Configuration source: `src/config/rate-limit.ts`  
Factory: `src/middleware/create-rate-limiter.ts`  
Exports: `src/middleware/rate-limiters.ts`

| Limiter name | Middleware | Window (prod) | Max (dev / staging / prod) | Key | Applies to |
|--------------|------------|---------------|----------------------------|-----|------------|
| `global` | `globalRateLimiter` | 15 min | 5000 / 500 / **100** | **IP** (`req.ip`) | All routes **except** skip list (`rate-limit-paths.ts`) |
| `auth` | `authRateLimiter` | 15 min | 100 / 50 / 50 | **IP** | `POST /api/auth/login`, `POST /api/auth/refresh` |
| `passenger_maps` | `passengerMapsRateLimit` | 1 min | 300 / 300 / 60 | **customerId** | Maps proxy: autocomplete, details, reverse-geocode, pickup-spots, route preview, booking quote |
| `passenger_booking` | `passengerBookingRateLimit` | 1 min | 100 / 100 / 20 | **customerId** | `POST /api/v1/passenger/bookings` |
| `passenger_cancel` | `passengerBookingCancelRateLimit` | 1 min | 30 / 30 / 10 | **customerId + bookingId** | `POST .../bookings/:id/cancel` (successful cancels not counted) |
| `passenger_recovery` | `passengerRecoveryRateLimit` | 1 min | 300 / 200 / **60** | **customerId** | `GET .../bookings/active`, `GET .../bookings/:id/payment`, passenger push-token register/unregister |
| `driver_location` | `driverLocationRateLimit` | 1 min | 1000 / 1000 / **20** | **driverId** | `POST /api/locations` |
| `driver_offer` | `driverOfferRateLimit` | 1 min | 300 / 300 / 30 | **driverId** | Accept, decline, status patch on driver bookings |
| `driver_recovery` | `driverRecoveryRateLimit` | 1 min | 300 / 200 / **60** | **driverId** | `GET .../bookings/active`, `GET .../offers/pending`, `GET .../video/session` |
| `driver_general` | `driverGeneralRateLimit` | 15 min | 600 / 600 / 200 | **driverId** | Driver Stripe Connect payout routes |
| `video_upload` | `videoUploadRateLimit` | 1 min | 120 / 120 / 30 | **driverId** | Video segment register + upload PUT |
| `profile_patch` | `profilePatchRateLimit` | 15 min | 30 / 20 / 20 | **profile:role:userId** | PATCH passenger/driver profile |
| `avatar_upload` | `avatarUploadRateLimit` | 1 hour | 10 / 10 / 10 | **profile:role:userId** | POST profile avatar |
| `profile_deactivate` | `profileDeactivateRateLimit` | 15 min–24 h | 3 / 3 / 3 | **profile:role:userId** | POST profile deactivate |
| `admin_ride_video_list` | `adminRideVideoListRateLimit` | 1 min | 300 / 200 / 120 | **admin userId** | Admin ride-video list/summary routes |
| `admin_ride_video_playback` | `adminRideVideoPlaybackRateLimit` | 1 min | 120 / 90 / 60 | **admin userId (+ sessionId)** | Admin playback manifest/stream |
| `admin_ride_video_download` | `adminRideVideoDownloadRateLimit` | 1 min | 20 / 10 / 5 | **admin userId** | Admin video download |

**Storage:** In-memory by default; Redis store (`RedisRateLimitStore`) when `RATE_LIMIT_USE_REDIS=true` or production with `REDIS_URL` set. Redis failures **fail open** (requests allowed).

**Enable/disable:** `RATE_LIMIT_ENABLED` — default `true` except Jest test tier (disabled unless explicitly `true`).

---

## 3. Global Limiter Analysis

A **single global limiter** is mounted on the entire app in `src/index.ts` **before** route handlers:

```typescript
app.use(rateLimitRequestCounter);  // dev diagnostics only
app.use(globalRateLimiter);
```

High-frequency routes are **excluded** via `shouldSkipGlobalRateLimit()` in `src/middleware/rate-limit-paths.ts` and instead use dedicated per-user limiters.

### Routes skipped from global (have dedicated or no limiter)

| Pattern | Dedicated limiter |
|---------|-------------------|
| `POST /api/locations` | `driver_location` (per driver) |
| `GET /api/v1/passenger/bookings/active` | `passenger_recovery` (per customer) |
| `GET /api/v1/passenger/bookings/:id/payment` | `passenger_recovery` (shared bucket with active) |
| `GET /api/v1/config/payments` | **None** (skipped global, unlimited) |
| `GET /api/v1/driver/bookings/*` | `driver_recovery` / `driver_offer` on specific sub-routes |
| Maps, quote, booking create, cancel, auth, webhooks, profiles, payouts | Own limiters or auth limiter |

### Routes NOT skipped — subject to global IP bucket only

These consume the **shared global IP quota** with no per-user limiter:

| Endpoint | Typical frequency | Risk |
|----------|-------------------|------|
| `GET /api/v1/passenger/payment-methods` | App launch, payment screen | Low–medium (prod global) |
| `GET /api/v1/passenger/services` | App launch | Low |
| `GET /api/v1/passenger/drivers/nearby` | Booking flow | Low |
| `GET /api/v1/passenger/places/suggestions` | Search UX | Medium during typing |
| `GET /api/v1/passenger/bookings` (history list) | Occasional | Low |
| `GET /api/v1/passenger/bookings/:id` (detail) | Occasional | Low |
| `GET /api/v1/driver/duty/current` | Duty screen | Low–medium if polled |
| `GET /api/v1/driver/duty/current/vehicle-qr` | QR display | Low |
| `PUT/DELETE /api/v1/driver/push-token` | Session start | Low |
| `GET /api/auth/validate-session` | Possible driver session poll | **Medium if polled** |
| `GET /api/auth/me` | App launch | Low |
| Most `/api/v1/driver/video/*` (non-upload) | During recording | Medium |
| Legacy `/api/drivers`, `/api/trips`, etc. | Admin/legacy | N/A for mobile apps |

**Important:** High-frequency telemetry (GPS, active booking, payment status) is **correctly isolated** from the global bucket in current code.

---

## 4. Request Volume vs Limits (1 Passenger + 1 Driver)

### Development (current test environment)

| Traffic source | Estimated rate | Limit | Headroom |
|----------------|----------------|-------|----------|
| Driver GPS `POST /api/locations` every 5 s | 12/min | 1000/min per driver | ✅ Large |
| Passenger `GET /bookings/active` every 10 s | 6/min | 300/min per customer | ✅ Large |
| Payment poll `GET .../payment` every 2 s (Stripe auth) | 30/min | 300/min (shared recovery bucket) | ✅ ~270/min remaining |
| Driver `GET /bookings/active` every 10 s | 6/min | 300/min per driver | ✅ Large |
| Global bucket (misc endpoints) | ~5–20/min combined | 5000/min per IP | ✅ Large |

**Conclusion for development:** Normal 1P + 1D operation cannot realistically exceed limits.

### Production (if deployed without env overrides)

| Traffic source | Estimated rate | Limit | Verdict |
|----------------|----------------|-------|---------|
| Driver GPS every 5 s | 12/min | **20/min** per driver | ✅ OK |
| Driver GPS every 2 s | 30/min | **20/min** | ❌ **Would 429** (`driver_location`) |
| Active booking poll every 10 s | 6/min | 60/min (`passenger_recovery`) | ✅ OK |
| Active + payment poll every 1 s combined | ~120/min | **60/min** (`passenger_recovery`) | ❌ **Would 429** |
| Global misc (both devices, same Wi-Fi) | ~10–30/15 min | **100/15 min** per IP | ✅ OK if no heavy polling on non-skipped routes |

---

## 5. IP-Based Limiting & Proxy Configuration

```typescript
// src/index.ts
app.set('trust proxy', 1);
```

| Limiter | Key when authenticated | Same Wi-Fi impact |
|---------|------------------------|-------------------|
| `global`, `auth` | `ip:{req.ip}` | **Passenger + driver share one quota** |
| `driver_location`, `driver_recovery`, `driver_offer`, etc. | `driver:{userId}` | **Separate per driver** |
| `passenger_recovery`, `passenger_maps`, etc. | `customer:{userId}` | **Separate per passenger** |

With `trust proxy: 1`, `req.ip` reflects the **client IP from the first `X-Forwarded-For` hop** (Railway/cloud reverse proxy). Two physical phones on the same home Wi-Fi appear as **one IP** to the global limiter, but **distinct user IDs** for authenticated route limiters.

**Misconfiguration risk:** If `trust proxy` were set too high, all clients could appear as the proxy IP — not observed in current code (`trust proxy` is correctly set to `1`).

---

## 6. Likely 429 Sources (If Seen in Production)

| Priority | Limiter | Endpoint(s) | Trigger |
|----------|---------|-------------|---------|
| 1 | `driver_location` | `POST /api/locations` | GPS interval < 3 s sustained |
| 2 | `passenger_recovery` | `GET /bookings/active` + `GET .../payment` | Combined polling > 60/min (shared bucket) |
| 3 | `driver_recovery` | `GET /bookings/active` + `GET /offers/pending` + video status | Combined polling > 60/min |
| 4 | `global` | Misc non-skipped routes | > 100 requests / 15 min from same IP (both devices) |
| 5 | `passenger_maps` | Autocomplete during rapid typing | > 60/min in production |

---

## 7. Client Duplication (Backend-Visible Signals)

Client repos were **not modified** (per instructions). From backend contracts and audit docs:

| Endpoint | Documented client behavior | Duplication risk |
|----------|---------------------------|------------------|
| `GET /bookings/active` | Poll every 10–15 s when WebSocket disconnected (`BACKEND_RIDE_HISTORY_AUDIT_REPORT.md`) | Moderate — ensure socket connected during ride |
| `GET .../payment` | Poll until `authorized` after Stripe SDK confirm (`RYDU_STRIPE_PHASE_C_*`) | **High during payment** — stacks with active booking poll in same `passenger_recovery` bucket |
| `GET /config/payments` | App launch / payment screen | Low — no limiter, cannot 429 |
| `GET /payment-methods` | App launch | Low in dev; counts against global IP in prod |
| `GET /auth/validate-session` | Driver session check (documented in push audit) | **If polled frequently, hits global IP bucket** — not skipped |

**Recommendation for client teams:** If HTTP 429 appears with `RATE_LIMITED` during payment or reconnect storms, inspect duplicate timers on `GET /bookings/active` and `GET .../payment` before blaming GPS limits.

---

## 8. Code Changes Made (Diagnostics Only)

No rate limits were increased or removed. Temporary **development-only** diagnostics added:

### Files added/modified

| File | Change |
|------|--------|
| `src/middleware/rate-limit-debug.ts` | **NEW** — dev-only request counter + 429 debug logging helpers |
| `src/middleware/rate-limit-log.ts` | Enhanced to emit `[RATE_LIMIT_DEBUG]` lines on 429 in development |
| `src/middleware/create-rate-limiter.ts` | Passes key, limit, window, currentCount to debug logger |
| `src/index.ts` | Mounts `rateLimitRequestCounter` before global limiter |
| `tests/rate-limit-debug.test.ts` | **NEW** — tests for masking, key types, dev-only gating |

### 429 debug log format (development only)

```
[RATE_LIMIT_DEBUG] 429 triggered
[RATE_LIMIT_DEBUG] method=POST
[RATE_LIMIT_DEBUG] path=/api/locations
[RATE_LIMIT_DEBUG] limiter=driver_location
[RATE_LIMIT_DEBUG] keyType=driver
[RATE_LIMIT_DEBUG] key=driver:8868…3fa0
[RATE_LIMIT_DEBUG] limit=20
[RATE_LIMIT_DEBUG] windowMs=60000
[RATE_LIMIT_DEBUG] currentCount=21
[RATE_LIMIT_DEBUG] userRole=driver
```

No JWTs, Stripe secrets, or card data are logged.

### Endpoint traffic counter (development only)

Every 30 seconds, aggregated counts are logged:

```
[RATE_LIMIT_DEBUG] POST /api/locations count=142
[RATE_LIMIT_DEBUG] GET /api/v1/passenger/bookings/active count=38
```

**Removal:** Delete `rate-limit-debug.ts`, remove its import/mount from `src/index.ts`, and revert debug additions in `rate-limit-log.ts` / `create-rate-limiter.ts`.

---

## 9. Recommended Production Settings

Do **not** blindly raise limits. Prefer endpoint-appropriate buckets:

| Bucket | Current prod | Recommendation |
|--------|--------------|----------------|
| `driver_location` | 20/min | Keep or tune to GPS interval contract (≥ 3 s → 20/min is tight; 5 s → OK). Consider 30/min if product requires 2 s GPS. |
| `passenger_recovery` | 60/min shared | **Split** payment polling from active-booking polling into separate buckets if 429 observed during Stripe auth |
| `global` | 100/15 min IP | Add skip + dedicated limiter for `GET /auth/validate-session` if driver app polls it; or key by userId |
| `GET /config/payments` | Unlimited | Add lightweight per-customer limiter (e.g. 30/min) for abuse prevention without affecting ride telemetry |
| `GET /payment-methods` | Global IP only | Add to skip list + `passenger_recovery` or dedicated `passenger_payment` bucket |

Auth brute-force protection (`auth`: 50/15 min per IP) should remain unchanged.

---

## 10. Test Results

| Command | Result |
|---------|--------|
| `npm test -- --testPathPattern=rate-limit` | ✅ **34/34 passed** (includes new `rate-limit-debug.test.ts`) |
| `npm run build` (tsc) | ✅ Passed |
| `npm test` (full suite) | ⚠️ **556 passed**, 2 suites failed to compile (`legacy-cab-migration.test.ts`, `driver-push-token.service.test.ts`) — pre-existing Stripe schema type errors, **unrelated to rate-limit changes** |

---

## Appendix A — Global Skip List (Complete)

From `src/middleware/rate-limit-paths.ts`:

- `/health`, `/api/health`
- `/api/locations`
- `/api/auth/*`
- `/api/v1/passenger/places/*`, `/pickup-spots`, `/routes/*`
- `/api/v1/passenger/bookings/quote`
- `/api/v1/passenger/bookings` (exact — POST create)
- `/api/v1/passenger/bookings/active`
- `/api/v1/passenger/bookings/:uuid/cancel`
- `/api/v1/passenger/push-token`
- `/api/v1/driver/bookings/*`
- `/api/v1/driver/profile/*`
- `/api/v1/driver/payouts/*`
- `/api/v1/passenger/profile/*`
- `/api/v1/admin/ride-videos/*`
- `/api/v1/admin/bookings/:uuid/ride-video`
- `/api/v1/webhooks/stripe`
- `/api/v1/config/payments`
- `/api/v1/passenger/bookings/:uuid/payment`

---

## Appendix B — How to Confirm Backend 429 During Device Testing

1. Watch dev server logs for `[RATE_LIMIT_DEBUG] 429 triggered` or `[RateLimit] exceeded`.
2. On the device, inspect HTTP response: status `429`, body `error.code === "RATE_LIMITED"`, header `Retry-After`.
3. If Android log shows only `ProxyAndroidLoggerBackend` / Flogger — **ignore**; that is not Rydu HTTP 429.

---

**Report generated by rate-limit audit task.**  
**No production rate limits were changed.**
