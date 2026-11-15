# RYDU Backend — Rate Limiting Real-Device Fix Report

**Date:** 2026-11-03  
**Repository:** `backend_rydu` only  
**Status:** FIXED — identity-aware global limiter + dedicated high-frequency policies

---

## 1. Root cause

Real-device testing (1 passenger + 1 driver) produced:

```
RATE_LIMIT_DEBUG
limiter=global
keyType=ip
limit=100
windowMs=900000
currentCount=122+
userRole=unknown
```

**Primary causes (confirmed from live server logs + code):**

1. **Shared IP global bucket** — `globalRateLimiter` keyed only by `req.ip`. Both phones appeared as the same public IP (`103.208.183.242`) behind the same NAT / egress path. Evidence: every 429 used `keyType=ip` with that masked IP.

2. **Production-like env override in development** — `.env` declared `RATE_LIMIT_*` twice. dotenv last-wins applied `RATE_LIMIT_MAX_REQUESTS=100` and `RATE_LIMIT_WINDOW_MS=900000` (100 / 15 min), despite `NODE_ENV=development`.

3. **High-frequency authenticated routes counted against that global IP budget** because they were **not** in the global skip list and had **no** dedicated limiter:
   - `POST /api/v1/driver/video/.../segments` and `.../complete`
   - `GET /api/v1/driver/meter/active`
   - `GET /api/v1/driver/duty/current`
   - `GET /api/v1/driver/vehicle-exchanges/current`
   - `GET /api/v1/passenger/bookings/:bookingId` (booking detail)

4. **`userRole=unknown` is expected for the old global path** — the global limiter ran **before** `requireAuth` / `extractUserInfo`, so `req.user` was unset when 429 debug logged.

5. **Driver GPS was not the consumer of the global bucket** — `POST /api/locations` was already skipped from global and limited per `driver:{userId}`. GPS every 6–7s correctly used `driver_location`, but **other** driver + passenger traffic shared the exhausted global IP quota, so passenger booking GETs then returned 429.

---

## 2. Middleware order

**Before**

```
helmet → cors → rateLimitRequestCounter → globalRateLimiter(IP)
→ stripe webhook raw → json → routes (auth on each route)
```

**After**

```
helmet → cors
→ attachRateLimitIdentity   // best-effort JWT verify for rate-limit keys only (never 401)
→ rateLimitRequestCounter   // development diagnostics
→ globalRateLimiter         // identity-aware key + dual max
→ stripe webhook raw → json → routes (full auth unchanged)
```

`attachRateLimitIdentity` does **not** bypass authentication. Invalid tokens fall back to IP limiting; route handlers still enforce `requireAuth`.

`app.set('trust proxy', 1)` unchanged (correct for single reverse proxy / Railway-style deployments).

---

## 3. Existing limiting algorithm

- Library: `express-rate-limit` v7
- Store: in-memory by default; `RedisRateLimitStore` when `RATE_LIMIT_USE_REDIS=true` or production with `REDIS_URL`
- Algorithm: **fixed window** via Redis `INCR` + `PEXPIRE(windowMs)`
- Failure policy: **fail open** when Redis is disabled/slow/errors (returns `totalHits=1`)

Fixed-window burst edges were **not** the observed failure mode. The failure was a shared IP identity key plus a 100/15m cap. Algorithm retained.

---

## 4. Implemented algorithm / policies

| Policy | Key | Dev default | Prod default | Notes |
|--------|-----|-------------|--------------|-------|
| `global` (authenticated) | `auth:{role}:{userId}` | 5000 / 1 min | 900 / 15 min | Per identity |
| `global` (unauthenticated) | `ip:{ip}` | 300 / 1 min | 100 / 15 min | Strict IP floor |
| `auth` | IP | 100 / 1 min | 50 / 15 min | Login/refresh |
| `passenger_booking` | customer | 100 / 1 min | 20 / 1 min | Booking **create** |
| `passenger_booking_read` | customer | 600 / 1 min | 120 / 1 min | Detail / history |
| `passenger_recovery` | customer | 300 / 1 min | 60 / 1 min | Active / payment status |
| `passenger_checkout` | customer | 30 / 1 min | 10 / 1 min | Stripe Checkout create |
| `driver_checkout` | driver | same checkout bucket | same | Walk-up payment-link |
| `driver_location` | driver | 1000 / 1 min | **30** / 1 min | GPS 5–10s OK; floods throttled |
| `soft_meter` | driver | 1000 / 1 min | 180 / 1 min | Points / pause / resume / finalize |
| `video_upload` | driver | 120 / 1 min | 60 / 1 min | Segment register/complete/etc. |
| `driver_general` | driver | 600 / 1 min | 600 / 15 min | Duty + vehicle exchange |

Stripe webhooks remain globally skipped; signature verification + dedup unchanged.

---

## 5. Authenticated key strategy

1. `attachRateLimitIdentity` verifies Bearer JWT (Auth0 RS256 or session HS256) best-effort.
2. Global key = `auth:{role}:{userId}` when identity present.
3. Else global key = `ip:{req.ip}` with the stricter unauthenticated max.
4. Route limiters continue to use `customer:{id}` / `driver:{id}` after full auth.

Passenger and driver behind the same NAT **no longer share** authenticated budgets.

---

## 6. Driver location request policy

- Endpoint: `POST /api/locations`
- Limiter: `driver_location` keyed by `driver:{userId}`
- Skipped from global
- Production: **30 / minute** (supports ≤ every 2s sustained; normal 5–10s has headroom)
- Abuse (e.g. every 0.5s) still exceeds and receives 429 + `Retry-After`

---

## 7. Passenger booking request policy

| Action | Limiter | Prod |
|--------|---------|------|
| Create booking | `passenger_booking` | 20 / min |
| GET booking detail / history | `passenger_booking_read` | 120 / min |
| Active / payment poll | `passenger_recovery` | 60 / min |
| Checkout create | `passenger_checkout` | 10 / min |
| Cancel | `passenger_cancel` | 10 / min (success skipped) |

Booking detail is skipped from global and no longer competes with driver video/duty traffic.

---

## 8. 429 behavior and Retry-After

Unified response (unchanged contract):

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Please try again shortly.",
    "retryable": true,
    "details": { "retryAfterSeconds": <n> }
  }
}
```

Headers: `Retry-After`, `RateLimit-*` (standardHeaders).

---

## 9. Redis implementation

- Class: `RedisRateLimitStore` (`src/middleware/redis-rate-limit-store.ts`)
- Atomic `INCR` + `PEXPIRE` — consistent across multiple Node instances sharing Redis
- Documented **fail-open** on Redis outage
- In-memory-only is **not** recommended as the sole production mechanism when horizontally scaled

Sliding window / token bucket were evaluated and **not** adopted; root cause was keying/policy, not window shape.

---

## 10. Tests and build results

### Before → after configuration (effective)

| Setting | Before (observed) | After |
|---------|-------------------|-------|
| Global key | IP only | Authenticated identity OR IP |
| Global max (effective local) | 100 / 15 min (duplicate `.env`) | 5000 / 1 min auth; 300 / 1 min unauth (dev) |
| Prod global | 100 / 15 min shared IP | 900 / 15 min per auth identity; 100 / 15 min unauth IP |
| Booking detail | Global IP | `passenger_booking_read` |
| Soft meter / video / duty | Global IP | Dedicated skip + limiters |
| Checkout | Shared recovery bucket | Strict `passenger_checkout` / `driver_checkout` |

### Commands run

```
npx jest tests/rate-limit-config.test.ts tests/rate-limit-debug.test.ts tests/rate-limit-real-device.test.ts --runInBand --forceExit
→ 55 passed

npx jest tests/soft-meter-metered-booking.test.ts tests/soft-meter-ondemand-payment.test.ts tests/soft-meter.webhook.test.ts --runInBand --forceExit
→ 16 passed

npx tsc --noEmit  → exit 0
npm run build     → exit 0
```

### New / updated coverage (`tests/rate-limit-real-device.test.ts`)

- Driver GPS 6s × 15 min does not exhaust passenger booking-read budget
- Same-NAT passenger/driver authenticated keys are distinct
- Unauthenticated traffic uses stricter IP budget
- Booking-detail reads allowed under normal usage
- Booking create + checkout remain strict
- Driver GPS abuse still throttled
- Stripe webhook path skipped from global
- Redis counters + fail-open + multi-key isolation
- HTTP 429 includes `Retry-After`

Controlled local two-device pattern was reproduced via Jest/supertest (same IP, separate identities). No production load test was run.

---

## 11. Remaining mobile polling issues

Backend-only task — **no Flutter / Driver app changes**.

Observed / recommended client follow-ups:

| Issue | API | Expected client correction |
|-------|-----|----------------------------|
| Booking detail polling while sockets connected | `GET /api/v1/passenger/bookings/:id` | Prefer socket booking updates; poll only on disconnect / app resume |
| Duty / vehicle-exchange refresh storms | `GET .../duty/current`, `.../vehicle-exchanges/current` | Avoid tight timers; refresh on lifecycle events |
| Video segment complete + register bursts | `POST .../driver/video/...` | Ensure single in-flight complete per segment; backoff on 429 |
| Possible duplicate socket listeners after reconnect | N/A (socket) | Client: remove listeners before re-subscribe |

Backend now tolerates normal real-device rates; inefficient client polling remains wasteful but should no longer hit the old shared IP 100/15m wall.

---

## 12. Security impact

| Control | Status |
|---------|--------|
| Rate limiting disabled? | **No** |
| Auth bypassed? | **No** — identity peek is best-effort for keys only |
| Stripe webhook signature / dedup | **Unchanged**; path still skipped from API limiters |
| Checkout / payment-link abuse protection | **Strengthened** (dedicated strict limiter) |
| Unauthenticated enumeration | **Preserved** via strict IP global + auth limiter |
| Soft Meter fare / settlement | **Unchanged** |
| Multi-instance limiting | Redis store retained; fail-open documented |

---

## Files changed

| File | Change |
|------|--------|
| `src/middleware/rate-limit-identity.ts` | **NEW** — best-effort JWT identity for rate keys |
| `src/config/rate-limit.ts` | Dual global buckets; booking-read / checkout / soft-meter |
| `src/middleware/create-rate-limiter.ts` | Identity-aware keys; dynamic max |
| `src/middleware/rate-limiters.ts` | New limiters; global redesign |
| `src/middleware/rate-limit-paths.ts` | Expanded skip list |
| `src/middleware/rate-limit-debug.ts` | Richer safe diagnostics |
| `src/middleware/redis-rate-limit-store.ts` | Documented algorithm + fail-open |
| `src/index.ts` | Mount identity middleware before global |
| `src/routes/v1/passenger/index.ts` | Booking-read + checkout limiters |
| `src/routes/v1/driver/{meter,walkUp,bookings,video,duty,vehicle-exchanges}.ts` | Dedicated limiters |
| `src/config/env-validator.ts` | New optional env keys |
| `.env` / `.env.example` | Removed duplicate restrictive global overrides |
| `tests/rate-limit-*.test.ts` | Updated + real-device suite |

---

## Operator note

Restart `npm run dev` so the process reloads rate-limit config and the cleaned `.env` values. Duplicate `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX_REQUESTS` keys must not be reintroduced (dotenv last-wins).
