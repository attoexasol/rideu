# Passenger Location Timeout — Regression Report

## Final status

**READY FOR PASSENGER LOCATION RETEST**

---

## Symptom

- Passenger **autocomplete/search** worked.
- After selecting a pickup/destination, the app showed **“Timeout to connect.”**
- Issue appeared after Admin Ride Video API + migration deployment/restart.

---

## Exact failing step (root cause)

| Step | Endpoint | Before fix |
|------|----------|------------|
| Search | `GET /api/v1/passenger/places/autocomplete` | ✅ Works (no Redis cache) |
| Select location | `GET /api/v1/passenger/places/details` | ❌ Hung |
| Map pin / coords | `GET /api/v1/passenger/places/reverse-geocode` | ❌ Hung |
| Route preview | `POST /api/v1/passenger/routes/preview` | ❌ Hung |
| Quote | `POST /api/v1/passenger/bookings/quote` | ❌ Hung |

**Root cause:** post-selection endpoints call `mapsCache` (Redis-backed cache). When Redis is unavailable or slow, `redis.get()` / `redis.setex()` could **block indefinitely** because:

- ioredis used `maxRetriesPerRequest: null` on the command client
- no command timeout wrapper existed
- autocomplete bypasses Redis, so only selection/route steps failed

Server logs showed repeated `ECONNREFUSED 127.0.0.1:6379` while the API remained up — consistent with this failure mode after restart/deploy when Redis was not running.

Admin Ride Video work did **not** mount admin middleware on passenger routes. The regression correlated with redeploy/restart + Redis availability, not route interception.

---

## Admin middleware scope audit

| Middleware | Passenger affected? |
|------------|---------------------|
| `requireRideVideoPermission` | ❌ Only on `/api/v1/admin/ride-videos/*` |
| `adminRideVideoListRateLimit` | ❌ Admin only |
| `adminRideVideoPlaybackRateLimit` | ❌ Admin only |
| Admin audit DB writes | ❌ Admin only |

Passenger maps routes still use:

`requireAuth → extractUserInfo → requireCustomer → passengerMapsRateLimit`

No admin auth/permission/audit middleware on passenger paths.

---

## Rate limiter scope

### Before

- Global limiter skipped passenger maps paths (unchanged).
- Admin ride-video paths added to skip list (correct).
- Redis-backed rate limit store could **hang** passenger requests when Redis was down (shared infrastructure).

### After

- Passenger maps/quote/route paths remain on dedicated `passengerMapsRateLimit` keyed by **customer ID**.
- Admin video limiters remain admin-only.
- `RedisRateLimitStore` now **fails open** on Redis timeout/error (does not block HTTP).
- Global limiter still returns **429 + Retry-After** (never hangs).

---

## Database pool findings

- No passenger location handler changes tied to admin video DB access.
- Admin video audit/list queries use the shared Drizzle pool but are not on the passenger request path.
- No evidence of pool exhaustion causing passenger hangs; primary blocker was Redis command hang before handler completion.

---

## External Google API timings

- Google client already had axios timeouts (`GOOGLE_MAPS_REQUEST_TIMEOUT_MS`, default 8000ms).
- External call duration logging added (`event: google_maps.external`).
- Timeout errors now map to **HTTP 504** (`GOOGLE_MAPS_TIMEOUT`) instead of 503.

---

## Fixes applied

1. **`mapsCache` fail-fast** — Redis get/set wrapped with `withRedisTimeout`; cache miss on timeout/error (request continues to Google API).
2. **Redis command client hardening** — bounded retries + `commandTimeout` on general client; pub/sub clients unchanged.
3. **Redis rate limit fail-open** — passenger/admin limiters no longer hang when Redis is unavailable.
4. **Structured timing logs** — `passengerLocationTiming` middleware logs passenger location-flow latency + status.
5. **Google timeout mapping** — 504 for upstream map timeouts.

---

## Files changed

- `src/utils/redisTimeout.ts` *(new)*
- `src/config/redis.ts`
- `src/middleware/redis-rate-limit-store.ts`
- `src/middleware/passenger-location-timing.ts` *(new)*
- `src/services/googleMaps/googleMaps.client.ts`
- `src/utils/googleMapsHandler.ts`
- `src/index.ts`
- `tests/passenger-location-timeout.test.ts` *(new)*
- `PASSENGER_LOCATION_TIMEOUT_REGRESSION_REPORT.md` *(this file)*

---

## Tests

Added `tests/passenger-location-timeout.test.ts` covering:

1. Passenger maps paths skip global limiter
2. Admin ride-video limiter scope isolated
3. Redis timeout wrapper
4. mapsCache fail-open on hung Redis
5. Rate limit store fail-open
6. Google timeout → 504 mapping

Run:

```bash
npx jest tests/passenger-location-timeout.test.ts tests/rate-limit-config.test.ts --runInBand --forceExit
npx tsc --noEmit
npm run build
```

---

## Deployment / restart instructions

1. **Ensure Redis is running** wherever `REDIS_URL` points (recommended for WS + cache performance).
2. Pull backend changes.
3. Restart API process (`npm run dev` locally or process manager in prod).
4. Optional env tuning:
   - `REDIS_COMMAND_TIMEOUT_MS=2000`
   - `GOOGLE_MAPS_REQUEST_TIMEOUT_MS=8000`
5. Retest passenger flow:
   - autocomplete → select pickup → select destination → route preview → quote

Even if Redis is down, location selection should now complete (cache bypassed) within Google API timeout bounds.

---

## Operational note

For production, keep Redis healthy for caching and rate-limit accuracy. The backend now degrades safely when Redis is unavailable instead of hanging passenger location selection.
