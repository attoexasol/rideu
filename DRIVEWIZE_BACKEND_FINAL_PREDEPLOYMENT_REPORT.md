# DriveWize Backend — Final Pre-Deployment Report

**Repository:** `backend_rydu` only  
**Date:** 2026-11-16  
**Follows:** `DRIVEWIZE_BACKEND_DOCKER_CICD_IMPLEMENTATION_REPORT.md`

No VPS deploy, no git push, no provider credential rotation, no Passenger/Driver/Admin changes, no Soft Meter / PaymentSheet / booking logic changes. `METERED_CHARGING_RELEASED` remains `false`.

---

## 1. Automated test fixes

| Suite | Root cause | Fix |
|-------|------------|-----|
| `driver-push-token.service.test.ts` | `Driver` fixture missing Stripe Connect columns → TS2322 | Added explicit `stripe*` fields (`null` / `false` / `[]`) |
| `legacy-cab-migration.test.ts` | Same incomplete `Driver` fixture | Same Stripe fields |
| `passenger-location-timeout.test.ts` | Outdated expectation: booking-by-id should **skip** global limiter (dedicated limiter in `rate-limit-paths.ts`; matches `rate-limit-config` / real-device tests) | Expect `true`; assert `/api/v1/admin/users` still hits global limiter |

**Full Jest:** `93` suites passed, `0` failed (`FULL_TEST_EXIT=0`).

---

## 2. Pinned Docker image versions

| Component | Previous | Selected pin | Notes |
|-----------|----------|--------------|-------|
| PostgreSQL | `17.6-alpine` | **`postgres:17.12-alpine`** | Same major as local **17.10**; patch upgrade only (dumps restore fine) |
| Redis | `7.4.2-alpine` | **`redis:7.4.12-alpine`** | Latest 7.4 security line |
| Node (Dockerfile) | `22.19.0` | **`22.23.5-bookworm-slim`** | Current Node 22 LTS patch |
| Caddy | `2.9.1-alpine` | **`caddy:2.11.9-alpine`** | Current 2.11 alpine |

Updated in: `docker/compose.staging.yml`, `Dockerfile`, `.github/workflows/ci.yml`, `.github/workflows/staging-deploy.yml`.

---

## 3. Redis configuration

**Policy change:** `allkeys-lru` → **`volatile-lru`**, `maxmemory` **512mb** (container limit 640M).

Rationale: driver presence, sessions, maps cache, and rate-limit keys all use TTL (`SETEX` / `PEXPIRE`). `volatile-lru` only evicts keys with expires; avoids silent eviction of non-TTL keys under pressure.

Documented failure modes + monitoring: `docs/docker/REDIS_OPERATIONS.md`.

---

## 4. GitHub Actions deployment safety

| Requirement | Status |
|-------------|--------|
| Failed CI prevents staging deploy | **Yes** — `staging-deploy` job `ci-gate` runs tests/build; `build-and-push` requires `ci-gate` success |
| Deploy only tested commit | **Yes** — gate + build on same `GITHUB_SHA` |
| Runtime + migrate same commit | **Yes** — tags `sha-<sha>` and `sha-<sha>-migrate`; deploy sets both `BACKEND_IMAGE` and `MIGRATE_IMAGE` |
| Immutable refs | **Yes** — prefers image **digests** (`repo@sha256:…`) when Buildx returns digests |
| GHCR private pull | **Yes** — VPS `docker login` via `GHCR_USERNAME` + `GHCR_READ_TOKEN` |
| SSH host fingerprint | **Yes** — `StrictHostKeyChecking yes` + required `STAGING_SSH_KNOWN_HOSTS` (no `accept-new`) |
| Concurrency protection | **Yes** — workflow `concurrency: staging-deploy` + script flock dir |
| Rollback safety | **Yes** — no `down -v`; migrate not auto-reversed; dual image args |
| Production disabled | **Yes** — `production-deploy.yml` still exits until intentionally activated |
| No `continue-on-error` on tests | **Yes** |

New/updated secrets needed for staging Environment:

- `STAGING_SSH_HOST`, `STAGING_SSH_USER`, `STAGING_SSH_KEY` (CI-only key)
- `STAGING_SSH_KNOWN_HOSTS` (from `ssh-keyscan`)
- `STAGING_DEPLOY_PATH`
- `GHCR_USERNAME`, `GHCR_READ_TOKEN` (read:packages PAT or fine-grained token)

---

## 5. Credential security

Working-tree scan of previously leaked files: **no hardcoded secret material** remains in `RAILWAY_ENV_VARS.md` or `src/scripts/seed-drivers.ts`.

### Exact rotation checklist (manual — do not automate)

1. **Auth0 M2M** — Dashboard → Applications → rotate Client Secret (consider new M2M client if Client ID was public in history). Update VPS + GitHub secrets only.
2. **Mapbox** — Revoke leaked token; create restricted token; update env stores.
3. **Railway / DB password** from old `seed-drivers.ts` history — rotate or decommission that DB user/password.
4. **JWT_SECRET / VIDEO_SIGNING_SECRET** — rotate if ever committed in `.env` history; expect session/signed-URL invalidation.
5. **Stripe** — confirm no real `sk_live_` / `whsec_` in history; rotate if any.
6. **Firebase SA JSON** — delete key in GCP if ever exposed under `secrets/`; issue new key.
7. **After rotation** — update `.env.staging`, GitHub Environment secrets, re-verify Auth0 roles/scopes, staging smoke (admin create, maps, Stripe test webhook).
8. **Git history purge** — optional separate decision (`git filter-repo`); **not** performed here; **no force-push**.

Full detail: `docs/docker/CREDENTIAL_ROTATION_CHECKLIST.md`.

---

## 6. Step-by-step deployment instructions (do not execute yet)

### A. Git: development branch + push (when approved)

```bash
cd backend_rydu
git checkout main
git pull
git checkout -b development
git add -A
git status   # confirm .env.staging / dumps / secrets are NOT staged
git commit -m "Prepare Docker staging stack, CI/CD, and pre-deploy hardening"
# Only after review approval:
git push -u origin development
```

### B. GitHub Environment `staging`

1. Repo → **Settings** → **Environments** → **New environment** → `staging`
2. Add required reviewers if desired
3. Add secrets listed in §4

### C. GHCR

1. Repo → **Packages** / ensure Actions can write packages (`GITHUB_TOKEN` packages:write in workflow already)
2. Create a PAT or fine-grained token with `read:packages` for the VPS (`GHCR_READ_TOKEN`)
3. Package visibility: private is fine with VPS login

### D. Restricted CI SSH key (not personal `deploy` key)

On a secure machine:

```bash
ssh-keygen -t ed25519 -f ./drivewize-staging-ci -C "github-actions-staging" -N ""
# Install public key on VPS for a dedicated user (recommended) or deploy with forced command limited to staging dir
ssh-copy-id -i ./drivewize-staging-ci.pub ci-deploy@82.180.139.178
# Capture host keys:
ssh-keyscan -H 82.180.139.178 > staging_known_hosts
```

Store **private** key in `STAGING_SSH_KEY`, contents of `staging_known_hosts` in `STAGING_SSH_KNOWN_HOSTS`.

### E. Prepare VPS `/opt/drivewize/staging`

```bash
ssh deploy@82.180.139.178
sudo mkdir -p /opt/drivewize/staging /opt/drivewize/production
sudo chown -R deploy:deploy /opt/drivewize
# Clone or rsync this repo into /opt/drivewize/staging
cd /opt/drivewize/staging
cp docker/env/staging.env.example .env.staging
chmod 600 .env.staging
# Edit .env.staging with real staging-only values (Auth0, Stripe TEST, DB/Redis passwords, CORS, public URLs)
chmod +x scripts/deploy/staging-deploy.sh scripts/deploy/staging-rollback.sh
```

### F. First bring-up (manual, before CI automation)

```bash
cd /opt/drivewize/staging
# After first GHCR image exists, set:
# BACKEND_IMAGE=ghcr.io/<owner>/<repo>:sha-<commit>
# MIGRATE_IMAGE=ghcr.io/<owner>/<repo>:sha-<commit>-migrate

docker compose -f docker/compose.staging.yml --env-file .env.staging up -d postgres redis
docker compose -f docker/compose.staging.yml --env-file .env.staging --profile migrate run --rm migrate
docker compose -f docker/compose.staging.yml --env-file .env.staging up -d backend caddy

curl -fsS http://127.0.0.1/api/health
# Or via tunnel before DNS:
# ssh -L 8080:127.0.0.1:80 deploy@82.180.139.178
```

Or use `./scripts/deploy/staging-deploy.sh` (backup → migrate → up → health).

### G. DNS (when ready)

`api-staging.drivewize.co` A/AAAA → `82.180.139.178`  
Stripe test webhook → `https://api-staging.drivewize.co/api/v1/webhooks/stripe`

---

## 7. Final verification results (this machine)

| Check | Result |
|-------|--------|
| Full Jest | **PASS** — 93/93 suites |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** |
| Docker runtime build (`22.23.5`) | **PASS** |
| Docker migrate build | **PASS** |
| Compose config validation | **PASS** |
| Isolated migrate (disposable project; **not** local `ryd_u`) | **PASS** |
| Backend `/api/health` | **PASS** (DB + Redis probes) |
| VPS deploy / git push | **Not run** |

---

## Remaining blockers (server / human)

- [ ] Rotate compromised credentials at providers  
- [ ] Create/push `development` after approval  
- [ ] Configure GitHub Environment secrets + CI SSH key + known_hosts  
- [ ] Populate real `/opt/drivewize/staging/.env.staging`  
- [ ] DNS for `api-staging.drivewize.co`  
- [ ] Optional sanitized DB dump transfer (`scripts/db/staging-db-transfer.md`)  
- [ ] Attach Admin container (separate repo)  
- [ ] Production workflow activation (explicit later)

---

## Files touched in this pass

- `tests/driver-push-token.service.test.ts`
- `tests/legacy-cab-migration.test.ts`
- `tests/passenger-location-timeout.test.ts`
- `docker/redis/redis.conf`
- `docker/compose.staging.yml`
- `docker/env/staging.env.example`
- `Dockerfile`
- `.github/workflows/ci.yml`
- `.github/workflows/staging-deploy.yml`
- `scripts/deploy/staging-deploy.sh`
- `scripts/deploy/staging-rollback.sh`
- `docs/docker/REDIS_OPERATIONS.md`
- `DRIVEWIZE_BACKEND_FINAL_PREDEPLOYMENT_REPORT.md` (this file)

---

*End of report.*
