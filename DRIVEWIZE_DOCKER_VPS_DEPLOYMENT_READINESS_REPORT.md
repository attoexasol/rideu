# DriveWize — Docker VPS Deployment Readiness Report

**Repository audited:** `backend_rydu` only  
**Audit date:** 2026-11-16  
**VPS target (provided):** Hostinger KVM 2 — Ubuntu 26.04 LTS, 2 vCPU, 8 GB RAM, 100 GB NVMe, 2 GB swap, Docker Engine 29.x, Compose v5.x, dirs `/opt/drivewize/{staging,production}`  
**Scope:** Read-only audit. No application code changes, no VPS deploy, no local DB mutation, no secret values exposed, no metered charging enablement.

**Legend**
- **[VERIFIED]** — Confirmed from this repository / local runtime inspection.
- **[RECOMMENDATION]** — Deployment planning guidance; not currently implemented in-repo.

---

## Executive summary

The backend is a Node/Express + Socket.IO API with Drizzle/PostgreSQL, Redis (cache + pub/sub + rate limits), local filesystem media, Auth0, Stripe, Google Maps, Mapbox, and optional FCM. It is **functionally deployable** on the VPS, but **not Docker/CI ready as-is**.

| Area | Status |
|------|--------|
| Application runtime build (`tsc` → `node dist/index.js`) | Ready |
| Existing Dockerfile | Present but incomplete / outdated for this stack |
| Docker Compose / Caddy / GH Actions / GHCR | Missing in this repo |
| PostgreSQL migrations | Present (through `0040_*`); image does not ship migration SQL |
| Redis dependency | Required for `staging`/`production` |
| Persistent media volumes | Required (`private-media/`, `uploads/`) |
| Staging/production branch strategy | Only `main` exists |
| Production metered charging | Latched off (`METERED_CHARGING_RELEASED = false`) |

**Primary blockers before first staging deploy:** compose stack + secrets management, Dockerfile fixes (Node base, volumes, migration assets, `sharp`/native deps), Auth0/Stripe/Maps production config, Caddy WebSocket proxy, and a migration/backup runbook for moving local `ryd_u` → VPS staging.

---

## 1. Current Node.js and npm versions

| Item | Value | Class |
|------|-------|-------|
| Local Node (audit host) | **v22.19.0** | [VERIFIED] |
| Local npm | **10.9.3** | [VERIFIED] |
| `package.json` engines | `node >= 18.0.0`, `npm >= 9.0.0` | [VERIFIED] |
| Existing Dockerfile base | `node:18-alpine` (builder + runtime) | [VERIFIED] |
| README claim | Node.js 18+ | [VERIFIED] |

**[RECOMMENDATION]** Use **Node 22 LTS** (or at least Node 20 LTS) in the production image to match the current local toolchain. Keep engines compatible with `>=18`. Prefer `node:22-bookworm-slim` over Alpine if `sharp` binary issues appear.

---

## 2. Existing Dockerfiles and Docker Compose files

| Artifact | Finding | Class |
|----------|---------|-------|
| `Dockerfile` | Multi-stage: `npm ci` → `npm run build` → production `npm ci --only=production` → `CMD ["node","dist/index.js"]`, exposes `3000`, HEALTHCHECK hits `/health` | [VERIFIED] |
| `.dockerignore` | Excludes `node_modules`, `dist`, `.env*`, `*.md`, `tests`, etc. Does **not** exclude `private-media` / `uploads` content | [VERIFIED] |
| `docker-compose*.yml` in this repo | **None** | [VERIFIED] |
| Parent-dir compose (`../docker-compose*`) | **None** found | [VERIFIED] |
| README “docker-compose from root” | Documents a parent compose that is **not present** next to this backend | [VERIFIED] gap |

### Dockerfile gaps (verified)

1. Production stage copies only `dist/` — **does not copy `src/db/migrations/`**.
2. Migrator hardcodes folder `./src/db/migrations` (see §6) — image cannot run migrations without extra copy/path fix.
3. No `VOLUME` / runtime mounts for `private-media` or `uploads`.
4. Non-root `nodejs` user owns `/app` only — writable media dirs need explicit chown/mount strategy.
5. Alpine + `sharp` may need extra native libs; not handled.
6. Base image Node 18 vs local Node 22.

---

## 3. Current PostgreSQL version and Docker image

| Item | Finding | Class |
|------|---------|-------|
| Local DB reachable via `DATABASE_URL` | Host `localhost:5432`, database **`ryd_u`** | [VERIFIED] (host/db name only; credentials not disclosed) |
| Local PostgreSQL version | **PostgreSQL 17.10** (Windows build) | [VERIFIED] |
| Installed extensions locally | **`plpgsql` only** | [VERIFIED] |
| Repo Docker Postgres image | **None** (no compose) | [VERIFIED] |
| Documented requirement | README: **PostgreSQL 15+** | [VERIFIED] |

**[RECOMMENDATION]** VPS image: `postgres:17-alpine` (or `postgres:17-bookworm`) to match local 17.x. Acceptable fallback: `postgres:16` if you prefer a longer-established LTS line; do **not** go below 15.

---

## 4. Current Redis version and Docker image

| Item | Finding | Class |
|------|---------|-------|
| Client library | `ioredis` ^5.3.2 | [VERIFIED] |
| Documented requirement | README: **Redis 7+** | [VERIFIED] |
| Repo Docker Redis image | **None** | [VERIFIED] |
| Connection | `REDIS_URL` **or** `REDIS_HOST`/`REDIS_PORT` (default `localhost:6379`) | [VERIFIED] |
| Required when | `NODE_ENV` is `production` or `staging`, or `USE_REDIS=true` | [VERIFIED] |
| Clients created | Main + publisher + subscriber (3 connections minimum per process) | [VERIFIED] |

**[RECOMMENDATION]** VPS image: `redis:7.4-alpine` with AOF persistence (`appendonly yes`) and a password via Compose (`requirepass` + `REDIS_URL=redis://:PASSWORD@redis:6379`).

---

## 5. Required PostgreSQL extensions

| Finding | Class |
|---------|-------|
| No `CREATE EXTENSION` statements in `src/` or migration SQL searched | [VERIFIED] |
| UUIDs use `gen_random_uuid()` in migrations / Drizzle `defaultRandom()` | [VERIFIED] |
| Local DB works with only `plpgsql` on PG 17 | [VERIFIED] |

**[RECOMMENDATION]** No mandatory extensions beyond default `plpgsql` for PG 15+. Optionally enable `pgcrypto` for older PG compatibility; not required on 17.

---

## 6. Database schema and Drizzle migration procedure

| Item | Finding | Class |
|------|---------|-------|
| ORM | Drizzle ORM `^0.44.6` + drizzle-kit `^0.31.5` | [VERIFIED] |
| Config | `drizzle.config.ts` → schema `./src/db/schema/index.ts`, out `./src/db/migrations`, dialect `postgresql` | [VERIFIED] |
| Migration journal | `_journal.json` entries `0000` … `0040_metered_post_trip_billing` (40 indexed migrations) | [VERIFIED] |
| SQL files on disk | **48** `*.sql` files (includes some `.down.sql` companions) | [VERIFIED] |
| Apply command | `npm run db:migrate` → `tsx src/db/migrate.ts` | [VERIFIED] |
| Migrator behavior | `drizzle-orm/postgres-js/migrator` against folder `./src/db/migrations` | [VERIFIED] |
| Dev push | `npm run db:push` (`drizzle-kit push`) — schema push, not journaled migrate | [VERIFIED] |
| Seed | `npm run db:seed` | [VERIFIED] |
| Compiled migrator | `dist/db/migrate.js` exists after build | [VERIFIED] |

**Production procedure (documented + code-aligned) — [VERIFIED] pattern:**

1. Backup DB.
2. Set `DATABASE_URL`.
3. Run `npm run db:migrate` (or container equivalent) **before** or as a one-shot job before app start.
4. Start app with `npm start`.

**[RECOMMENDATION]** Never use `db:push` on staging/production. Use journaled `db:migrate` only. Ship `src/db/migrations/**` (and meta) in the migrate job image, or change migrator path to a copied `/app/migrations` folder in a future Dockerfile change (out of scope for this audit).

---

## 7. Database backup and restore procedure

| Item | Finding | Class |
|------|---------|-------|
| Automated backup scripts in repo | **None** | [VERIFIED] |
| Documented strategy | `DATABASE_MIGRATION_GUIDE.md`: `pg_dump -F c`, gzip, optional S3, cron, `pg_restore` | [VERIFIED] (docs only) |
| Hosting-provider backup assumptions | Railway/Supabase/Render mentioned — **not applicable to Hostinger VPS** | [VERIFIED] doc debt |

**[RECOMMENDATION] VPS backup**

```bash
# Backup (custom format)
pg_dump "$DATABASE_URL" -F c -b -f "/opt/drivewize/backups/drivewize_$(date +%Y%m%d_%H%M%S).dump"

# Restore into empty DB
pg_restore -d "$DATABASE_URL" --clean --if-exists /path/to/backup.dump
```

Schedule daily dumps on the VPS (cron or a Compose `backup` service), retain ≥14–30 days on disk + off-VPS copy. Always backup before migrations and before local→staging data import.

---

## 8. Required environment variable names (no secret values)

### Production required — [VERIFIED] (`src/config/env-validator.ts`)

`NODE_ENV`, `PORT`, `DATABASE_URL`, `REDIS_URL`, `AUTH0_DOMAIN`, `AUTH0_API_IDENTIFIER`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_PASSENGER_CLIENT_ID`, `JWT_SECRET`, `CORS_ORIGIN`, `MAPBOX_ACCESS_TOKEN`, `GOOGLE_MAPS_API_KEY`

### Staging required — [VERIFIED]

Same as production **except** Mapbox/Google Maps are optional for staging validation.

### Present in local `.env` key names only — [VERIFIED] (values not listed)

Also observed configured locally (names only):  
`AUTH0_ALGORITHM`, `AUTH0_AUDIENCE`, `AUTH0_MANAGEMENT_CLIENT_ID`, `AUTH0_MANAGEMENT_CLIENT_SECRET`, `BYPASS_AUTH`, `DB_HOST`, `DB_NAME`, `DB_PASSWORD`, `DB_PORT`, `DB_USER`, dispatch/rate-limit/video/Stripe/FCM keys as in `.env.example`, `SENTRY_DSN`, `USE_REDIS`, `WALKUP_STRIPE_TEST_PAYMENTS`, `ONDEMAND_STRIPE_TEST_PAYMENTS`, meter checkout URLs.

### Documented / used elsewhere (include in VPS secrets inventory) — [VERIFIED]

From `.env.example` and code references:

**Core:** `NODE_ENV`, `PORT`, `DATABASE_URL`, `REDIS_URL`, `REDIS_HOST`, `REDIS_PORT`, `USE_REDIS`, `REDIS_COMMAND_TIMEOUT_MS`, `DB_POOL_MAX`

**Auth0 / JWT:** `AUTH0_DOMAIN`, `AUTH0_API_IDENTIFIER`, `AUTH0_AUDIENCE`, `AUTH0_ALGORITHM`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_PASSENGER_CLIENT_ID`, `AUTH0_MANAGEMENT_CLIENT_ID`, `AUTH0_MANAGEMENT_CLIENT_SECRET`, `AUTH0_PASSWORD_RESET_CLIENT_ID`, `AUTH0_NATIVE_CLIENT_ID`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `BYPASS_AUTH`

**CORS / public URLs:** `CORS_ORIGIN`, `API_PUBLIC_BASE_URL`, `VIDEO_API_PUBLIC_BASE_URL`

**Maps:** `MAPBOX_ACCESS_TOKEN`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_MAPS_REGION`, `GOOGLE_MAPS_LANGUAGE`, `GOOGLE_MAPS_DEFAULT_COUNTRY`, `GOOGLE_MAPS_REQUEST_TIMEOUT_MS`, `GOOGLE_MAPS_CACHE_TTL_SECONDS`, `GOOGLE_MAPS_AUTOCOMPLETE_*`, `GOOGLE_MAPS_MAX_ROUTE_STOPS`

**Rate limits:** `RATE_LIMIT_*`, `AUTH_RATE_LIMIT_*`, `PASSENGER_*`, `BOOKING_*`, `DRIVER_*`, `SOFT_METER_*`, `VIDEO_UPLOAD_*`, profile/avatar/admin video/document limit keys

**Dispatch / ops:** `DRIVER_LOCATION_STALE_SECONDS`, `DISPATCH_*`, `DRIVER_INACTIVITY_THRESHOLD_MINUTES`, `ACCEPT_REQUEST_TIMEOUT_MS`, `DB_TRANSACTION_TIMEOUT_MS`, `QR_DUTY_REQUIRED`, `VEHICLE_EXCHANGE_*`, `ADMIN_FLEET_VEHICLE_LIST_MAX_LIMIT`, `LOG_LEVEL`, `SENTRY_DSN`

**Video / documents / avatars:** `VIDEO_*`, `DRIVER_DOCUMENT_*`, `AVATAR_STORAGE_ROOT`

**FCM:** `FCM_ENABLED`, `FIREBASE_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS`, `FIREBASE_SERVICE_ACCOUNT_JSON`

**Stripe:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_CONNECT_DEFAULT_COUNTRY`, `CONNECT_DEFAULT_COUNTRY`, `STRIPE_CONNECT_RETURN_URL`, `STRIPE_CONNECT_REFRESH_URL`, `WALKUP_STRIPE_TEST_PAYMENTS`, `WALKUP_STRIPE_TEST_SANDBOX`, `ONDEMAND_STRIPE_TEST_PAYMENTS`, `ONDEMAND_STRIPE_TEST_SANDBOX`, `METER_CHECKOUT_SUCCESS_URL`, `METER_CHECKOUT_CANCEL_URL`

### Format constraints — [VERIFIED]

- `DATABASE_URL` must start with `postgresql://` (not `postgres://`).
- `REDIS_URL` must match `^redis://` (**`rediss://` rejected**).
- `AUTH0_DOMAIN` must **not** include `https://`.
- Production: `BYPASS_AUTH` cannot be `true`; `JWT_SECRET` ≥ 32 chars.
- If `VIDEO_RECORDING_ENABLED=true` in production: storage + signing secret required.

---

## 9. Production build and startup commands

| Step | Command | Class |
|------|---------|-------|
| Install | `npm ci` | [VERIFIED] |
| Build | `npm run build` (`tsc`) | [VERIFIED] |
| Start | `npm start` → `node dist/index.js` | [VERIFIED] |
| Migrate | `npm run db:migrate` | [VERIFIED] |
| Dev | `npm run dev` (`tsx watch`) — not for VPS prod | [VERIFIED] |

Dockerfile equivalent: build stage `npm run build`, runtime `CMD ["node","dist/index.js"]`.

---

## 10. Backend port and listening address

| Item | Value | Class |
|------|-------|-------|
| Port | `process.env.PORT` or **3000** | [VERIFIED] |
| Bind address | **`0.0.0.0`** | [VERIFIED] |
| Trust proxy | `app.set('trust proxy', 1)` (single reverse proxy) | [VERIFIED] |
| Container EXPOSE | `3000` | [VERIFIED] |

**[RECOMMENDATION]** Publish backend only on the Docker private network; expose 80/443 via Caddy only. Do not publish host `:3000` publicly.

---

## 11. Health-check endpoints

| Endpoint | Behavior | Class |
|----------|----------|-------|
| `GET /health` | Full startup-style check (Postgres, Redis, Auth0 when not bypassed/non-dev, optional Mapbox). HTTP 200 if healthy/degraded, **503** if unhealthy | [VERIFIED] |
| `GET /api/health` | Safer public check: server + DB + Redis ping/write-read/pubsub probes. 200 or 503 | [VERIFIED] |
| `GET /` | Service metadata JSON | [VERIFIED] |
| Dockerfile HEALTHCHECK | `http://localhost:3000/health` every 30s | [VERIFIED] |

**[RECOMMENDATION]** Use `/api/health` for external uptime monitors; use `/health` for orchestrator probes with care (Auth0 dependency can fail the check).

---

## 12. Socket.IO and WebSocket requirements

| Item | Finding | Class |
|------|---------|-------|
| Library | `socket.io` ^4.6 + `@socket.io/redis-adapter` | [VERIFIED] |
| Attached to | Same HTTP server as Express | [VERIFIED] |
| Transports | `websocket` + `polling` | [VERIFIED] |
| CORS | Same `CORS_ORIGIN` list as HTTP | [VERIFIED] |
| Redis adapter | Enabled when pub/sub enabled (`staging`/`production`/`USE_REDIS=true`) | [VERIFIED] |
| Auth | Handshake `auth.token` or `query.token`; JWT verify; mock admin only in dev/bypass | [VERIFIED] |
| Booking fan-out | Redis channel `booking:update` | [VERIFIED] |

**[RECOMMENDATION] Caddy must support WebSocket upgrade** to the backend (path `/socket.io/`). Sticky sessions not required when Redis adapter is used; still prefer one backend replica initially on this VPS.

---

## 13. Redis connection, authentication, persistence, rate limiting

| Topic | Finding | Class |
|-------|---------|-------|
| Auth | Prefer password embedded in `REDIS_URL`; code does not separately require `REDIS_PASSWORD` | [VERIFIED] |
| Persistence | App treats Redis as cache + pub/sub; docs recommend RDB+AOF | [VERIFIED] docs / [RECOMMENDATION] ops |
| Rate limiting | `RedisRateLimitStore` (`rl:` keys), fail-open on Redis errors | [VERIFIED] |
| Production default | Uses Redis store when `REDIS_URL` set unless `RATE_LIMIT_USE_REDIS=false` | [VERIFIED] |
| Startup | Redis failure **exits process** in staging/production | [VERIFIED] |
| Uses | Sessions, driver location/status/heartbeat, maps cache, Socket.IO adapter, booking pub/sub, rate limits | [VERIFIED] |

**[RECOMMENDATION]** Enable AOF; set `maxmemory` (~256–512 MB) with `allkeys-lru`; do not expose Redis ports on the public firewall.

---

## 14. Background jobs, workers, cron jobs, and scheduled tasks

No separate worker process or `node-cron` dependency. All in-process timers in the API process — [VERIFIED]:

| Job | Interval / trigger | Notes |
|-----|--------------------|-------|
| Driver inactivity checker | ~2 minutes | Marks stale drivers offline |
| Offer expiration | 15 seconds | `processExpiredOffers()` |
| Vehicle exchange expiration | 15 seconds | Polls pending exchanges |
| Ride video recovery | When `VIDEO_RECORDING_ENABLED=true` | Default poll 30s |

**[RECOMMENDATION]** Run a **single** backend replica first so timers are not duplicated. If scaling to N replicas later, move timers to a dedicated worker or leader election.

---

## 15. Video upload, processing, storage paths, persistent volumes

| Item | Finding | Class |
|------|---------|-------|
| Feature flag | `VIDEO_RECORDING_ENABLED` (default false in `.env.example`) | [VERIFIED] |
| Storage root | `VIDEO_STORAGE_ROOT` default **`private-media`** | [VERIFIED] |
| Container/subdir | `VIDEO_STORAGE_CONTAINER` default **`ride-recordings`** | [VERIFIED] |
| MIME | `video/mp4`, `video/quicktime` | [VERIFIED] |
| Processing | Segment upload + DVR recovery; **no ffmpeg** dependency | [VERIFIED] |
| Legacy public videos | `/uploads` static + `uploads/videos` | [VERIFIED] |
| Avatars | `uploads/avatars` via `sharp` | [VERIFIED] |
| Driver documents | under `private-media/driver-documents` (or configured root) | [VERIFIED] |
| Signed URLs | Need reachable `API_PUBLIC_BASE_URL` / `VIDEO_API_PUBLIC_BASE_URL` | [VERIFIED] |
| `.gitignore` | Ignores `private-media/driver-documents/` and some uploads; **ride-recordings not fully ignored** (untracked recording dirs present locally) | [VERIFIED] |

**[RECOMMENDATION] Compose volumes**

- `drivewize_private_media` → `/app/private-media`
- `drivewize_uploads` → `/app/uploads`
- Separate staging vs production named volumes

Ensure container user can write those mounts.

---

## 16. Auth0 configuration

| Item | Finding | Class |
|------|---------|-------|
| JWT validation | `express-oauth2-jwt-bearer` / JWKS from `https://{AUTH0_DOMAIN}/.well-known/jwks.json` | [VERIFIED] |
| Audience | `AUTH0_AUDIENCE` or `AUTH0_API_IDENTIFIER` (default audience string in config) | [VERIFIED] |
| Management API | `AUTH0_MANAGEMENT_CLIENT_ID` / `SECRET` for admin user provisioning | [VERIFIED] |
| Roles expected | `Driver`, `Admin`, `Super Admin` (`AUTH0_SETUP.md`) | [VERIFIED] |
| Passenger client | `AUTH0_PASSENGER_CLIENT_ID` required in prod/staging | [VERIFIED] |
| Startup check | Auth0 OIDC discovery probed outside development when auth not bypassed | [VERIFIED] |

**[RECOMMENDATION]** Use separate Auth0 apps/tenants or at least separate M2M clients for staging vs production. Management credentials are **not** in the production required list but are required for admin user creation flows.

---

## 17. Stripe configuration and webhook endpoints

| Item | Finding | Class |
|------|---------|-------|
| Webhook path | **`POST /api/v1/webhooks/stripe`** (`STRIPE_WEBHOOK_PATH`) | [VERIFIED] |
| Raw body | Mounted with `express.raw` **before** `express.json()` | [VERIFIED] |
| Config keys | Secret, webhook secret, publishable, Connect country/URLs | [VERIFIED] |
| Optional | Cash bookings work without Stripe | [VERIFIED] |
| Metered production charging | `METERED_CHARGING_RELEASED = false` hard latch | [VERIFIED] |
| Test payment flags | Walk-up / on-demand test switches; production requires sandbox authorization flags; live keys rejected for those test paths | [VERIFIED] |
| Browser return pages | `GET /meter/payment/return`, `GET /meter/payment/cancel` (informational only; webhook confirms paid) | [VERIFIED] |

**[RECOMMENDATION]** Point Stripe webhook endpoint to  
`https://<public-api-host>/api/v1/webhooks/stripe`.  
Keep `WALKUP_STRIPE_TEST_PAYMENTS` / `ONDEMAND_STRIPE_TEST_PAYMENTS` unset/false on production. Do not enable production metered charging as part of VPS bring-up.

---

## 18. CORS and reverse-proxy requirements

| Item | Finding | Class |
|------|---------|-------|
| CORS origins | Comma-separated `CORS_ORIGIN` | [VERIFIED] |
| Credentials | `credentials: true` | [VERIFIED] |
| Defaults if unset | `http://localhost:5173`, `http://localhost:8081` | [VERIFIED] |
| Production warning | localhost in `CORS_ORIGIN` warns | [VERIFIED] |
| Helmet | Enabled | [VERIFIED] |
| Trust proxy | First proxy only (`1`) — correct for single Caddy hop | [VERIFIED] |

**[RECOMMENDATION]** Set staging/production `CORS_ORIGIN` to real Admin + any web origins (and mobile deep-link origins if needed). Caddy should terminate TLS, proxy HTTP + WebSockets, and forward `X-Forwarded-*`. Do not strip Stripe webhook path body.

---

## 19. Existing GitHub Actions workflows

| Finding | Class |
|---------|-------|
| `.github/workflows` **absent** | [VERIFIED] |
| No CI build/test/deploy automation in this repo | [VERIFIED] |

---

## 20. Current Git branches and deployment strategy

| Item | Finding | Class |
|------|---------|-------|
| Local branch | `main` | [VERIFIED] |
| Remotes | `origin/main` only (`https://github.com/attoexasol/rideu.git`) | [VERIFIED] |
| Staging/production branches | **None** | [VERIFIED] |
| Recent commits | Soft meter, documents, geofencing, branding, etc. on `main` | [VERIFIED] |
| Prior host docs | Railway-oriented (`RAILWAY_ENV_VARS.md`) | [VERIFIED] |

**[RECOMMENDATION]** Introduce `staging` deploy from `main` (or a `release/*` tag) and promote immutable image digests to production. Keep separate Compose env files under `/opt/drivewize/staging` and `/opt/drivewize/production`.

---

## 21. Hardcoded localhost, local IPs, or development-only dependencies

| Finding | Class |
|---------|-------|
| CORS/Socket defaults to localhost origins | [VERIFIED] |
| Redis/DB defaults to `localhost` when URL unset | [VERIFIED] |
| Scripts default to `http://127.0.0.1:3000` for live tests | [VERIFIED] |
| `npm run stop:dev` is **Windows PowerShell**-specific | [VERIFIED] |
| `BYPASS_AUTH` / Socket mock admin in development | [VERIFIED] |
| JWT fallback string `your-jwt-secret-key` if unset (dev danger) | [VERIFIED] |
| `src/scripts/seed-drivers.ts` hardcodes Auth0 domain + Management client id/secret | [VERIFIED] **security risk** |
| `RAILWAY_ENV_VARS.md` contains committed credential material | [VERIFIED] **security risk** |

DevDependencies (`tsx`, `jest`, `drizzle-kit`, etc.) are not needed at runtime if using the multi-stage production image correctly.

---

## 22. Production security risks

| Risk | Severity | Class |
|------|----------|-------|
| Secrets committed in `RAILWAY_ENV_VARS.md` and `seed-drivers.ts` — **rotate Auth0 Management / Mapbox tokens immediately** | Critical | [VERIFIED] |
| Local `.env` exists on disk (gitignored) — never copy raw into images/git | High | [VERIFIED] |
| `secrets/` directory intended for Firebase SA; gitignored | Medium | [VERIFIED] |
| `BYPASS_AUTH` blocked in production (good) but must never be set on VPS | High if mis-set | [VERIFIED] |
| Rate limiter fail-open if Redis down | Medium (availability over strict limit) | [VERIFIED] |
| `/uploads` served statically — ensure only intended public assets land there | Medium | [VERIFIED] |
| Private ride videos under `private-media` must not be served as static public files | High if misconfigured | [VERIFIED] |
| Stripe live keys / metered charging must stay off for initial deploy | High (business) | [VERIFIED] latch off |
| Firewall only 22/80/443 — keep Postgres/Redis private | High (ops) | [RECOMMENDATION] aligned with provided VPS firewall |

---

## 23. Recommended Docker resource allocation (this VPS)

**Host:** 2 vCPU / 8 GB RAM / 2 GB swap — [RECOMMENDATION]

| Service | CPU (limit) | Memory (limit) | Notes |
|---------|-------------|----------------|-------|
| `postgres` | 0.75–1.0 | 1.5–2.0 GB | shared_buffers ~256–512 MB |
| `redis` | 0.25 | 256–512 MB | AOF on volume |
| `backend` | 0.75–1.0 | 768 MB–1.25 GB | Node + Socket.IO + timers |
| `caddy` | 0.25 | 128–256 MB | TLS + proxy |
| `admin` (if containerized) | 0.25–0.5 | 256–512 MB | Outside this repo |
| OS / Docker headroom | — | ~1.5–2.0 GB | Leave free |

Start with **one** backend replica. Monitor RSS under peak GPS + booking load before adding a second replica (would duplicate in-process timers).

Disk: reserve volumes for Postgres data, Redis data, `private-media`, `uploads`, and backup dumps (videos dominate growth).

---

## 24. Dependencies on external services

| Service | Purpose | Required for prod boot? | Class |
|---------|---------|-------------------------|-------|
| PostgreSQL | Primary data | Yes (local container OK) | [VERIFIED] |
| Redis | Cache, pub/sub, rate limit, Socket adapter | Yes in staging/prod | [VERIFIED] |
| Auth0 | Auth / Management / password reset | Yes (domain required) | [VERIFIED] |
| Google Maps Platform | Passenger places/routes | Yes in production validator | [VERIFIED] |
| Mapbox | Admin map / matching / road snap | Yes in production validator | [VERIFIED] |
| Stripe | Card / Connect / webhooks | Optional (cash works) | [VERIFIED] |
| Firebase / FCM | Push offers | Optional (`FCM_ENABLED`) | [VERIFIED] |
| Sentry | Error tracking | Optional | [VERIFIED] |
| Admin frontend | Consumes `/api/admin` | Not in this repo | [VERIFIED] gap vs compose intent |
| Mobile apps | Socket.IO + REST clients | External | Assumed |

Outbound HTTPS from VPS to Auth0, Google, Mapbox, Stripe, Firebase must be allowed.

---

## Compatible versions (planning)

| Component | Compatible choice | Basis |
|-----------|-------------------|-------|
| Node image | **22-bookworm-slim** (or 20-slim) | Local 22 + engines ≥18 |
| PostgreSQL | **17** (`postgres:17`) | Local 17.10; README ≥15 |
| Redis | **7.4** (`redis:7.4-alpine`) | README Redis 7+ |
| Caddy | **2.x** | Standard TLS/WS reverse proxy |
| Docker Compose | v2/v5 file format on VPS Compose 5.x | VPS provided |
| Drizzle migrations | Existing journal through **0040** | In-repo |

---

## Recommended Docker Compose services

**[RECOMMENDATION]** Separate projects/files for staging and production under `/opt/drivewize/{staging,production}`:

1. **`postgres`** — private network only; named volume; healthcheck `pg_isready`
2. **`redis`** — private network; password; AOF volume; healthcheck `redis-cli ping`
3. **`backend`** — build from GHCR image; depends_on healthy DB/Redis; env file; mounts for media; healthcheck `/api/health` or `/health`
4. **`migrate`** (one-shot profile) — same image with migrations assets; `npm run db:migrate` / `node dist/db/migrate.js` after path fix
5. **`caddy`** — publish 80/443; reverse_proxy backend:3000 with WebSocket support; optional admin static/upstream
6. **`admin`** — from Admin repository image (not audited here)
7. **`backup`** (optional cron container) — `pg_dump` to host bind mount

**Networking:** single bridge network e.g. `drivewize_internal`; no public bind for 5432/6379/3000.

**Persistent volumes:** `pgdata`, `redisdata`, `private_media`, `uploads`, `caddy_data`, `caddy_config`, `db_backups`.

---

## Backend Dockerfile requirements (recommended deltas)

**[RECOMMENDATION]** (do not implement in this audit pass):

1. Base `node:22-bookworm-slim`.
2. Install any `sharp` system deps if needed.
3. Copy `src/db/migrations` (and meta) into the image **or** dedicated migrate image.
4. Align migrator folder path with image layout.
5. Create/chown `private-media` and `uploads` for non-root user.
6. Keep HEALTHCHECK; prefer `/api/health` if Auth0 flakiness is undesirable.
7. Never `COPY .env`.
8. Pin digests in production Compose.

---

## Database migration strategy (staging/production)

**[RECOMMENDATION]**

1. CI builds image → push GHCR tagged `sha-<gitsha>` + `staging`/`prod` moving tags.
2. On deploy: `docker compose run --rm migrate` then `docker compose up -d backend`.
3. Forward-only migrations; keep `.down.sql` for manual emergency use only.
4. Never run `drizzle-kit push` on VPS databases.

### Local database → VPS staging migration

**[RECOMMENDATION]**

1. On local host:  
   `pg_dump "postgresql://...@localhost:5432/ryd_u" -F c -f ryd_u_staging.dump`
2. Transfer dump over SCP to VPS staging (not commit to git).
3. Create empty staging DB/user.
4. `pg_restore` into staging.
5. Run any **pending** journal migrations if dump schema lags behind `0040`.
6. Point staging backend `DATABASE_URL` at restored DB.
7. Sanitize/rotate secrets; do not reuse production Stripe live keys.
8. Validate `/api/health`, Auth0 login, booking smoke, Socket.IO connect.

Production DB should start empty + migrate, or restore from a **sanitized** staging snapshot after UAT — decide deliberately before go-live.

---

## Staging vs production separation

**[RECOMMENDATION]**

| Concern | Staging | Production |
|---------|---------|------------|
| Directory | `/opt/drivewize/staging` | `/opt/drivewize/production` |
| `NODE_ENV` | `staging` | `production` |
| Hostnames | e.g. `api.staging.…` | e.g. `api.…` |
| Auth0 | Separate app/M2M | Separate |
| Stripe | Test keys only | Live only when intentionally enabled later |
| Meter test flags | Optional sandbox | Off |
| Volumes/DB | Isolated | Isolated |
| `BYPASS_AUTH` | false | false |
| Compose project name | `drivewize-staging` | `drivewize-production` |

---

## Caddy reverse-proxy configuration (outline)

**[RECOMMENDATION]**

```caddyfile
api.example.com {
  encode gzip
  reverse_proxy backend:3000
}

# Optional admin host → admin container or static files
admin.example.com {
  reverse_proxy admin:80
}
```

Requirements:

- TLS via Caddy automatic HTTPS on 80/443.
- WebSocket upgrades to Socket.IO (`/socket.io/*`).
- Preserve raw body for `/api/v1/webhooks/stripe`.
- Set `API_PUBLIC_BASE_URL` / `VIDEO_API_PUBLIC_BASE_URL` to the public `https://api…` origin.
- `trust proxy` already expects one hop.

---

## GitHub Actions + GHCR strategy

**[RECOMMENDATION]** (none exists today)

1. Workflow on `main` / tags: lint → test → `docker build` → push `ghcr.io/<org>/drivewize-backend:<sha>`.
2. Staging deploy job (SSH to VPS or runner in VPC): pull image, migrate, recreate backend, healthcheck.
3. Production deploy: manual approval; pull same digest previously validated on staging.
4. Store VPS SSH key, GHCR auth, and env files as GitHub Environments secrets — never in git.
5. Rollback: redeploy previous image digest; restore DB dump only if migration was incompatible.

---

## Health checks and rollback procedure

**[RECOMMENDATION]**

1. After deploy: `curl -fsS https://api…/api/health` and Socket.IO smoke.
2. If unhealthy: `docker compose up -d --no-deps backend` with previous image tag.
3. If migration broke schema: stop backend → `pg_restore` from pre-migrate dump → redeploy previous image.
4. Redis can be flushed if cache corruption suspected (sessions/locations rebuild); do not flush blindly during active trips without understanding impact.
5. Keep last N image digests and last N DB dumps.

---

## Automated database backups

**[RECOMMENDATION]**

- Daily `pg_dump -F c` to `/opt/drivewize/backups/{staging,production}/`.
- Retention 14–30 days local; weekly copy off-box.
- Pre-migrate and pre-restore dumps are mandatory.
- Periodically test restore on a throwaway DB.

---

## Identified blockers / gaps checklist

| # | Blocker / gap | Severity |
|---|---------------|----------|
| 1 | No Compose / Caddy / CI in this repo | High |
| 2 | Dockerfile missing migration SQL + media volume strategy | High |
| 3 | Migrator path `./src/db/migrations` incompatible with dist-only image | High |
| 4 | Committed secrets in docs/scripts — rotate before VPS use | Critical |
| 5 | Only `main` branch; no staging promotion workflow | Medium |
| 6 | Admin service not in this repository | Medium (compose depends on other repo) |
| 7 | README references missing parent `docker-compose` | Low/Medium |
| 8 | `REDIS_URL` rejects `rediss://`; plan passworded `redis://` on private net | Medium |
| 9 | Production requires Mapbox + Google keys at boot | Medium |
| 10 | In-process timers discourage multi-replica without redesign | Medium |
| 11 | No in-repo automated backup job | Medium |
| 12 | `private-media/ride-recordings` not fully gitignored | Low |

---

## Suggested next steps (order)

1. **Rotate** any credentials that appeared in committed files; purge from git history if needed.
2. Author VPS Compose + Caddy + env templates under `/opt/drivewize/staging` (outside or alongside app — future change).
3. Fix Dockerfile for Node 22, migrations, volumes, `sharp` (future change).
4. Add GitHub Actions → GHCR → SSH deploy (future change).
5. Dump local `ryd_u` → restore to staging → migrate → smoke test.
6. Only then promote image digest to production with empty or approved dataset.
7. Keep metered production charging latched off; Stripe webhooks in test mode for staging first.

---

## Audit constraints compliance

- No application functionality modified for this deliverable (report file only).
- Nothing deployed to VPS `82.180.139.178`.
- Local database not modified.
- Secret **values** not copied into this report.
- Production metered charging not enabled (`METERED_CHARGING_RELEASED` remains false in source).
- Stripe PaymentSheet / payment flows not changed.
- Other repositories not modified.

---

*End of report.*
