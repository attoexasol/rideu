# DriveWize Backend — Docker Staging & CI/CD Implementation Report

**Repository:** `backend_rydu` only  
**Date:** 2026-11-16  
**Based on:** `DRIVEWIZE_DOCKER_VPS_DEPLOYMENT_READINESS_REPORT.md`

This report distinguishes **completed implementation (in-repo)** from **pending server-side / human configuration**.

---

## Summary

Docker staging stack, migration image target, Caddy/Redis/Postgres config, deploy/rollback scripts, GitHub Actions workflows, and secret remediation are implemented in this repository.

**Not done (by design):** VPS deploy, DNS cutover, credential rotation at providers, creating/pushing the `development` branch, activating production deploy, transferring local `ryd_u` data.

---

## Files created and modified

### Created

| Path | Purpose |
|------|---------|
| `docker/compose.staging.yml` | Staging Compose: postgres, redis, migrate, backend, caddy |
| `docker/caddy/Caddyfile.staging` | HTTPS / WS reverse proxy for `api-staging.drivewize.co` |
| `docker/redis/redis.conf` | Auth-ready Redis with AOF + `allkeys-lru` |
| `docker/env/staging.env.example` | Sanitized staging env template |
| `docker/entrypoint.sh` | Volume chown → drop to `nodejs` via `gosu` |
| `scripts/deploy/staging-deploy.sh` | Pull → backup → migrate → up → health |
| `scripts/deploy/staging-rollback.sh` | Image rollback (does not reverse migrations) |
| `scripts/db/staging-db-transfer.md` | Manual dump/restore runbook |
| `docs/docker/CREDENTIAL_ROTATION_CHECKLIST.md` | Rotation checklist |
| `.github/workflows/ci.yml` | PR/push CI: secrets, tests, build, Docker, Trivy |
| `.github/workflows/staging-deploy.yml` | `development` / manual → GHCR + SSH staging |
| `.github/workflows/production-deploy.yml` | Manual guard only — **not activated** |
| `.gitleaks.toml` | Working-tree secret scan allowlist for fixtures |
| `DRIVEWIZE_BACKEND_DOCKER_CICD_IMPLEMENTATION_REPORT.md` | This report |

### Modified

| Path | Change |
|------|--------|
| `Dockerfile` | Node **22.19.0-bookworm-slim**, multi-stage `runtime` + `migrate`, tini/gosu, migrations copied, healthcheck `/api/health` |
| `.dockerignore` | Exclude secrets, media, dumps, tests noise |
| `.gitignore` | `.env.staging`, dumps, full `private-media/` / `uploads/` |
| `package.json` | Added `db:migrate:prod` |
| `src/db/migrate.ts` | Connectivity check, resolvable `MIGRATIONS_FOLDER`, no seed/reset |
| `src/scripts/seed-drivers.ts` | Secrets removed; requires env vars |
| `RAILWAY_ENV_VARS.md` | Real secrets replaced with placeholders |

---

## Dockerfile architecture

**Base:** `node:22.19.0-bookworm-slim` (glibc — suitable for `sharp` prebuilds; no ffmpeg in app).

| Stage | Role |
|-------|------|
| `builder` | `npm ci` → `tsc` → `npm prune --omit=dev` |
| `runtime` (default) | Prod deps + `dist/` + migrations + entrypoint; `CMD node dist/index.js` |
| `migrate` | Same filesystem; `CMD node dist/db/migrate.js` |

- Non-root runtime user `nodejs` (uid 1001) after entrypoint privilege drop  
- `tini` for signal forwarding (app already handles SIGTERM/SIGINT)  
- Port **3000**; healthcheck hits `/api/health`  
- **No secrets baked in**

Build locally:

```bash
docker build -t drivewize-backend:local --target runtime --build-arg NODE_VERSION=22.19.0 .
docker build -t drivewize-backend:local-migrate --target migrate --build-arg NODE_VERSION=22.19.0 .
```

---

## Docker Compose services

File: `docker/compose.staging.yml`  
Project name: `drivewize-staging`

| Service | Image | Public ports |
|---------|-------|--------------|
| `postgres` | `postgres:17.6-alpine` | none |
| `redis` | `redis:7.4.2-alpine` | none |
| `migrate` | backend image `target: migrate` (profile `migrate`) | none |
| `backend` | backend image `target: runtime` | none |
| `caddy` | `caddy:2.9.1-alpine` | `${CADDY_HTTP_PORT:-80}`, `${CADDY_HTTPS_PORT:-443}` |

- Private network `drivewize_staging`  
- Named volumes: pgdata, redisdata, private_media, uploads, caddy data/config  
- Healthchecks, restart `unless-stopped` (migrate: `no`)  
- Resource limits sized for Hostinger KVM 2 (8 GB)  
- JSON log rotation `10m` × 5  
- Admin service stub commented for later attachment  

**No separate worker service** — background timers run in-process (matches existing code).

---

## PostgreSQL and Redis versions

| Component | Version |
|-----------|---------|
| PostgreSQL | **17.6** (`postgres:17.6-alpine`) — DB name `ryd_u` |
| Redis | **7.4.2** (`redis:7.4.2-alpine`) + password via `--requirepass` |
| Node | **22.19.0** |
| Caddy | **2.9.1** |

Redis: AOF + RDB, `maxmemory 384mb`, `allkeys-lru`. Application durable state remains in Postgres; Redis keys are TTL’d (locations, sessions, rate limits, maps cache, Socket.IO adapter).

---

## Environment variable requirements

Template: `docker/env/staging.env.example` → copy to repo-root / VPS `.env.staging` (gitignored).

Staging required by `env-validator` (`NODE_ENV=staging`):  
`PORT`, `DATABASE_URL`, `REDIS_URL`, `AUTH0_DOMAIN`, `AUTH0_API_IDENTIFIER`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_PASSENGER_CLIENT_ID`, `JWT_SECRET`, `CORS_ORIGIN`.

Also configure Compose secrets: `POSTGRES_*`, `REDIS_PASSWORD`, Stripe **test** keys, media paths, `API_PUBLIC_BASE_URL` / `VIDEO_API_PUBLIC_BASE_URL`.

**Constraints preserved:** `DATABASE_URL` must be `postgresql://…`; `REDIS_URL` must be `redis://…`; `BYPASS_AUTH=false`; `METERED_CHARGING_RELEASED` remains `false` in source; PaymentSheet architecture unchanged.

---

## Security findings and credential rotation checklist

### Remediated in working tree

- Removed hardcoded Auth0 Management + Mapbox values from `RAILWAY_ENV_VARS.md`  
- Removed hardcoded Auth0 + Railway DB URL from `src/scripts/seed-drivers.ts`  
- Hardened `.gitignore` / `.dockerignore` for env, dumps, media, keys  

### Still pending (human / providers)

See `docs/docker/CREDENTIAL_ROTATION_CHECKLIST.md`:

1. Rotate Auth0 M2M client secret (and consider new client)  
2. Revoke/reissue Mapbox token  
3. Rotate any Railway/DB password that appeared in git history  
4. Review JWT / video signing / Firebase keys if ever committed  
5. Decide separately on git-history purge (**not automated; no force-push**)  

CI secret scan uses **working-tree** gitleaks (`--no-git`) so remediations pass; full-history scan will still fail until rotation + optional history rewrite.

---

## Migration procedure

1. Ensure Postgres healthy  
2. Pre-migration `pg_dump` (deploy script)  
3. Single job:  
   `docker compose -f docker/compose.staging.yml --env-file .env.staging --profile migrate run --rm migrate`  
4. Start/restart backend  

Migrator verifies connectivity, applies journal through **0040**, does **not** seed or reset. Do not run concurrent migrate containers.

---

## Database backup and restore

- Automated pre-migrate dump: `scripts/deploy/staging-deploy.sh` → `backups/staging/`  
- Manual local→VPS transfer: `scripts/db/staging-db-transfer.md` (**not executed** in this work)  
- Rollback of app image ≠ schema rollback; restore `.dump` if migration is incompatible  
- Deploy scripts **never** run `docker compose down -v`  

---

## GitHub Actions workflows

| Workflow | Trigger | Behavior |
|----------|---------|----------|
| `ci.yml` | PR/push `main`/`development` | gitleaks (tree), `npm ci`, `tsc --noEmit`, jest, `npm run build`, Docker build runtime+migrate, Trivy |
| `staging-deploy.yml` | push `development` or manual | Build/push GHCR `sha-<sha>` + `staging`, SSH deploy via **CI deploy key** |
| `production-deploy.yml` | manual only | Requires `deploy-production` confirm + Environment approval; **exits until activated** |

**Branch note:** Only `main` exists today. Do **not** create/push `development` without approval. Workflows are ready when that branch exists.

### Required GitHub configuration (pending)

**Environment `staging` secrets:**

- `STAGING_SSH_HOST` (e.g. `82.180.139.178`)  
- `STAGING_SSH_USER` (e.g. `deploy` or a dedicated `ci-deploy` user)  
- `STAGING_SSH_KEY` — **restricted CI key**, not the personal deploy key  
- `STAGING_DEPLOY_PATH` (e.g. `/opt/drivewize/staging`)  

**Permissions:** `packages: write` for GHCR; Environment protection for staging/production.

**Packages:** enable GHCR for `ghcr.io/<owner>/<repo>` (lowercase).

---

## Exact VPS deployment commands (pending server-side)

On VPS after Docker/Compose are installed and firewall allows 22/80/443:

```bash
# One-time layout
sudo mkdir -p /opt/drivewize/staging /opt/drivewize/production
sudo chown -R deploy:deploy /opt/drivewize

# Clone or sync this repo into staging path
cd /opt/drivewize/staging
cp docker/env/staging.env.example .env.staging
# Edit .env.staging with real staging secrets (Auth0, Stripe test, DB/Redis passwords)

chmod +x scripts/deploy/staging-deploy.sh scripts/deploy/staging-rollback.sh

# First bring-up (image may be built locally or pulled from GHCR)
export BACKEND_IMAGE=ghcr.io/attoexasol/rideu:staging   # after CI push
# or build on server:
# docker build -t drivewize-backend:local --target runtime .

./scripts/deploy/staging-deploy.sh
```

Pre-DNS health via SSH tunnel:

```bash
ssh -L 8080:127.0.0.1:80 deploy@82.180.139.178
# On VPS temporarily set CADDY_SITE_ADDRESS=:80 and enable auto_https off in Caddyfile if needed
curl -fsS http://127.0.0.1:8080/api/health
```

Rollback:

```bash
./scripts/deploy/staging-rollback.sh ghcr.io/attoexasol/rideu:sha-<previous>
```

---

## DNS requirements (pending)

| Environment | Hostname | Record |
|-------------|----------|--------|
| Staging | `api-staging.drivewize.co` | A/AAAA → `82.180.139.178` |
| Production (later) | `api.drivewize.co` | A/AAAA → same or prod IP |

Also point Admin staging origin used in `CORS_ORIGIN`. Configure Stripe Dashboard webhook to `https://api-staging.drivewize.co/api/v1/webhooks/stripe` (test mode).

---

## Tests and actual results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | **PASS** (exit 0) |
| `npm run build` | **PASS** (exit 0) |
| `npm test -- --runInBand --forceExit` | **PARTIAL** — 90 suites passed, **3 failed** (pre-existing TS/type issues in `driver-push-token.service.test.ts`, `passenger-location-timeout.test.ts`, `legacy-cab-migration.test.ts`; 994/995 tests passed). **Not introduced by Docker changes.** |
| Docker `runtime` build | **PASS** (`DOCKER_RUNTIME_EXIT=0`) |
| Docker `migrate` build | **PASS** (`DOCKER_MIGRATE_EXIT=0`) |
| `docker compose … config` | **PASS** |
| Disposable Postgres 17 + migrate through 0040 | **PASS** (`MIGRATE_EXIT=0`) — isolated `drivewize-verify` project; **did not touch local `ryd_u`** |
| Backend container `/api/health` | **PASS** — `database=ok`, `redis=ok`, probes pass |
| Redis `PONG` | **PASS** |
| Media volume write (`private-media`, `uploads`) | **PASS** — app created dirs as `nodejs` |
| VPS deploy | **NOT RUN** |
| Local `ryd_u` dump/restore to VPS | **NOT RUN** |

---

## Remaining blockers

### Completed in-repo

- [x] Node 22 Dockerfile + migrate target  
- [x] Staging Compose + Caddy + Redis auth  
- [x] Env template + deploy/rollback scripts  
- [x] CI/CD workflow definitions  
- [x] Working-tree secret scrub of known files  

### Pending outside this change set

- [ ] Rotate compromised credentials at Auth0/Mapbox/DB providers  
- [ ] Create `development` branch when approved  
- [ ] Configure GitHub Environments + CI SSH key + GHCR  
- [ ] Provision `/opt/drivewize/staging` on VPS with real `.env.staging`  
- [ ] DNS for `api-staging.drivewize.co`  
- [ ] Optional sanitized `pg_dump` of local data → staging  
- [ ] Fix 3 pre-existing failing Jest suites (unrelated to deploy)  
- [ ] Attach Admin container from Admin repository  
- [ ] Activate production workflow only after staging sign-off  

---

## Compliance with restrictions

- Only `backend_rydu` modified  
- No VPS deployment performed  
- No Passenger/Driver/Admin repo changes  
- No booking/fare/PaymentSheet logic changes  
- Metered production charging left disabled  
- No credential values printed in this report  
- No git push / branch creation / history rewrite  

---

*End of report.*
