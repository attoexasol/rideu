# DriveWize — Direct Production Deployment from Main

**Date:** 2026-11-16  
**Repository:** `backend_rydu` only  
**Scope:** Convert staging Docker/CI/CD → single production path from `main`.  
**Not done in this work:** git push, VPS deploy, live Stripe keys, Admin/Passenger/Driver repos, local `ryd_u` mutation.

---

## Summary

Production Docker Compose + Caddy + deploy/rollback scripts + GitHub Actions workflow are in place for **automatic deploy on successful CI after every push to `main`**. Compose project name: **`drivewize-production`**. Public edge: Caddy only (`api.drivewize.co`; `admin.drivewize.co` placeholder until Admin image is attached). Backend, Postgres, and Redis stay on the private Docker network.

---

## Files changed

### Created / converted (active production path)

| Path | Role |
|------|------|
| `docker/compose.production.yml` | Production stack: postgres, redis, migrate, backend, caddy |
| `docker/env/production.env.example` | Sanitized production env template |
| `docker/caddy/Caddyfile.production` | TLS reverse proxy for API + Admin host placeholder |
| `docker/redis/redis.conf` | Redis `maxmemory` + `volatile-lru` (unchanged policy) |
| `scripts/deploy/production-deploy.sh` | Pull → backup → migrate → up → health |
| `scripts/deploy/production-rollback.sh` | Runtime image rollback (no migration reverse) |
| `scripts/db/production-db-transfer.md` | Manual dump/restore runbook |
| `.github/workflows/production-deploy.yml` | Push `main` → CI gate → GHCR → SSH deploy |
| `.github/workflows/ci.yml` | PR validation on `main` (secret scan, tests, build, image scan) |
| `docs/docker/REDIS_OPERATIONS.md` | Production Redis ops |
| `docs/docker/CREDENTIAL_ROTATION_CHECKLIST.md` | Credential rotation (production-focused) |
| `Dockerfile` | Multi-stage `runtime` + `migrate`, Node `22.23.5-bookworm-slim` |

### Removed (obsolete staging deployment artifacts)

| Path |
|------|
| `docker/compose.staging.yml` (replaced) |
| `docker/env/staging.env.example` (replaced) |
| `docker/caddy/Caddyfile.staging` |
| `scripts/deploy/staging-deploy.sh` |
| `scripts/deploy/staging-rollback.sh` |
| `scripts/db/staging-db-transfer.md` |
| `.github/workflows/staging-deploy.yml` (if present) |

### Minor

| Path | Change |
|------|--------|
| `.dockerignore` | Allow `production.env.example`; drop staging example exception |
| `.gitignore` | Already ignores `.env.production` / `.env.staging` |

Historical audit reports that still mention staging were **left as-is** (documentation history only). They are not part of the deploy path.

---

## Final production architecture

```
GitHub main push
  → production-deploy.yml
      1) ci-gate: gitleaks, npm ci, tsc, jest, build
      2) build-and-push: runtime + migrate → GHCR (sha + production tags), Trivy, digest refs
      3) deploy (environment: production):
           SSH (pinned known_hosts) → scp compose/Caddy/redis/scripts
           → docker login GHCR on VPS
           → write BACKEND_IMAGE / MIGRATE_IMAGE digests into .env.production
           → ./scripts/deploy/production-deploy.sh
```

**VPS layout (`/opt/drivewize/production`):**

| Service | Image | Public ports | Volume |
|---------|-------|--------------|--------|
| postgres | `postgres:17.12-alpine` | none | `drivewize_production_pgdata` |
| redis | `redis:7.4.12-alpine` | none | `drivewize_production_redisdata` |
| migrate | GHCR migrate digest (profile `migrate`) | none | — |
| backend | GHCR runtime digest | none (internal `:3000`) | `production_private_media`, `production_uploads` |
| caddy | `caddy:2.11.9-alpine` | `80`, `443` | `production_caddy_data`, `production_caddy_config` |

- Compose **`name: drivewize-production`**
- Network: `drivewize_production` (bridge)
- DB name: **`ryd_u`**
- `NODE_ENV=production`
- Domains: **`api.drivewize.co`**, **`admin.drivewize.co`** (Admin respond `503` until container attached)
- Concurrency: workflow `group: production-deploy` + deploy script flock
- Volumes: **never** `docker compose down -v`
- Soft Meter: `METERED_CHARGING_RELEASED = false` in source
- Stripe: test keys in template; live only after explicit client authorization; sandbox flags documented for test PaymentSheet on production NODE_ENV

---

## Verification results (local)

| Check | Result |
|-------|--------|
| Jest | **93 suites / 1008 tests passed** (`TEST_EXIT=0`) |
| `npx tsc --noEmit` | **PASS** (`TSC_EXIT=0`) |
| `npm run build` | **PASS** (`BUILD_EXIT=0`) |
| `docker compose … config` | **PASS** (`COMPOSE_EXIT=0`) |
| Docker build `runtime` | **PASS** (`DOCKER_RT_EXIT=0`) |
| Docker build `migrate` | **PASS** (`DOCKER_MIG_EXIT=0`) |
| Isolated migrate (compose project `drivewize-prod-verify`) | **PASS** (`MIGRATE_EXIT=0`) |
| Backend `/api/health` (DB + Redis probes) | **PASS** (`HEALTH_EXIT=0`) — `server/database/redis` ok |
| Volumes deleted during smoke | **No** — compose `down` without `-v` |

Pinned bases used: PostgreSQL **17.12-alpine**, Redis **7.4.12-alpine**, Node **22.23.5-bookworm-slim**, Caddy **2.11.9-alpine**.

---

## Required GitHub Environment secrets

Create Environment **`production`** (no required reviewers for routine deploys).

| Secret | Purpose |
|--------|---------|
| `PRODUCTION_SSH_HOST` | `82.180.139.178` |
| `PRODUCTION_SSH_USER` | Deploy Linux user (e.g. `deploy`) |
| `PRODUCTION_SSH_KEY` | Private deploy key (ed25519), full PEM |
| `PRODUCTION_SSH_KNOWN_HOSTS` | Output of `ssh-keyscan -H 82.180.139.178` |
| `PRODUCTION_DEPLOY_PATH` | `/opt/drivewize/production` |
| `GHCR_USERNAME` | GitHub user/org that can read packages |
| `GHCR_READ_TOKEN` | PAT or fine-grained token with `read:packages` (for VPS pull) |

Push/build uses `GITHUB_TOKEN` with `packages: write` in the workflow. Deploy job reads the secrets above from Environment `production`.

### Exact secure SSH + GHCR setup

**1. Deploy user + key (on operator machine, then VPS):**

```bash
# Operator workstation — generate a dedicated CI key (do not reuse personal keys)
ssh-keygen -t ed25519 -f ./drivewize-production-ci -C "github-actions-production" -N ""

# On VPS as root (or with sudo)
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy
sudo mkdir -p /home/deploy/.ssh
sudo chmod 700 /home/deploy/.ssh
# Append ONLY the .pub contents:
sudo tee -a /home/deploy/.ssh/authorized_keys < drivewize-production-ci.pub
sudo chmod 600 /home/deploy/.ssh/authorized_keys
sudo chown -R deploy:deploy /home/deploy/.ssh

# Optional hardening: restrict key to deploy path via authorized_keys forced command / from= CIDR
```

**2. Pin host keys (never `StrictHostKeyChecking=accept-new` in CI):**

```bash
ssh-keyscan -H 82.180.139.178 > production_known_hosts
# Store file contents in GitHub secret PRODUCTION_SSH_KNOWN_HOSTS
# Store private key file contents in PRODUCTION_SSH_KEY
```

**3. GHCR pull on VPS:**

```bash
# Create a classic PAT or fine-grained token with read:packages (and SSO authorize if org requires it)
# Secrets: GHCR_USERNAME=<github username or org bot>, GHCR_READ_TOKEN=<token>
# CI runs: echo "$GHCR_READ_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
```

**4. Do not reuse compromised credentials** — rotate Auth0 M2M / Mapbox / any DB passwords previously exposed in git history (`docs/docker/CREDENTIAL_ROTATION_CHECKLIST.md`) before first production bring-up.

---

## How CI transfers deployment configuration

On each successful image build, the deploy job:

1. Opens SSH with **StrictHostKeyChecking yes** and pinned `known_hosts`.
2. Ensures remote dirs under `$PRODUCTION_DEPLOY_PATH`.
3. **`scp`** (overwrite) these files from the checked-out commit:
   - `docker/compose.production.yml`
   - `docker/caddy/Caddyfile.production`
   - `docker/redis/redis.conf`
   - `docker/env/production.env.example` (template only)
   - `scripts/deploy/production-deploy.sh`
   - `scripts/deploy/production-rollback.sh`
4. Does **not** overwrite `.env.production` (secrets stay on VPS).
5. Updates only `BACKEND_IMAGE` and `MIGRATE_IMAGE` lines to immutable digest refs.
6. Runs `./scripts/deploy/production-deploy.sh`.

---

## Required VPS configuration files

On **`/opt/drivewize/production`** after first bootstrap:

| File | Source | Notes |
|------|--------|-------|
| `.env.production` | Copy from `docker/env/production.env.example` | **chmod 600**; fill real secrets; never commit |
| `docker/compose.production.yml` | Synced by CI | Compose project `drivewize-production` |
| `docker/caddy/Caddyfile.production` | Synced by CI | API + Admin placeholder |
| `docker/redis/redis.conf` | Synced by CI | Eviction policy |
| `scripts/deploy/production-*.sh` | Synced by CI | Must be executable |

Optional: `backups/production/` for pre-migrate dumps (created by deploy script).

---

## Exact VPS setup commands

```bash
# On VPS (Ubuntu) as root/sudo
sudo mkdir -p /opt/drivewize/production
sudo chown -R deploy:deploy /opt/drivewize/production

# As deploy — bootstrap tree once (clone or copy repo files)
cd /opt/drivewize/production
# Ensure docker/, scripts/ exist (first push CI will refresh them; first manual copy is fine)

cp docker/env/production.env.example .env.production
chmod 600 .env.production
# Edit .env.production: DB/Redis passwords, Auth0, Mapbox, Google Maps, Stripe TEST keys,
# CORS_ORIGIN=https://admin.drivewize.co, API_PUBLIC_BASE_URL=https://api.drivewize.co
# Keep WALKUP/ONDEMAND Stripe test switches false unless sandbox=authorized is set

chmod +x scripts/deploy/production-deploy.sh scripts/deploy/production-rollback.sh

# Firewall: allow 22 (restricted), 80, 443 only. Do not publish 3000/5432/6379.
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

---

## Exact first deployment commands

**Option A — preferred after GitHub secrets are set:** push this branch to `main` (when owner authorizes). CI builds, scans, pushes GHCR digests, and deploys.

**Option B — manual first bring-up on VPS** (images available locally or after first GHCR push):

```bash
cd /opt/drivewize/production

# Pull base images + set BACKEND_IMAGE / MIGRATE_IMAGE to known good refs
# Example after CI has published:
# BACKEND_IMAGE=ghcr.io/<owner>/<repo>@sha256:...
# MIGRATE_IMAGE=ghcr.io/<owner>/<repo>@sha256:...

docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin   # paste read token

./scripts/deploy/production-deploy.sh

# Verify
curl -fsS https://api.drivewize.co/api/health
# or pre-DNS: curl -fsS http://127.0.0.1/api/health

# Recorded images:
cat backups/production/DEPLOYED_IMAGES.txt
```

**Rollback (schema-compatible only):**

```bash
./scripts/deploy/production-rollback.sh '<previous-runtime-ref>' '<previous-migrate-ref>'
# If schema advanced incompatibly: restore pre-migrate .dump from backups/production/
```

---

## Required DNS records

| Host | Type | Value |
|------|------|-------|
| `api.drivewize.co` | A (and AAAA if IPv6) | `82.180.139.178` |
| `admin.drivewize.co` | A (and AAAA if IPv6) | `82.180.139.178` |

Also configure:

- Auth0 API identifier / audiences → `https://api.drivewize.co`
- Stripe **test** webhook → `https://api.drivewize.co/api/v1/webhooks/stripe`
- Admin CORS already expected as `https://admin.drivewize.co`

Caddy obtains Let’s Encrypt certificates after DNS points at the VPS.

---

## Stripe / Soft Meter production-mode notes

- Keep `METERED_CHARGING_RELEASED=false` (source latch — verified in tests).
- Use `sk_test_` / `pk_test_` / test webhook secret until client authorizes live.
- For authorized **test** PaymentSheet flows while `NODE_ENV=production`, set both:
  - `WALKUP_STRIPE_TEST_PAYMENTS=true` **and** `WALKUP_STRIPE_TEST_SANDBOX=authorized`
  - and/or `ONDEMAND_STRIPE_TEST_PAYMENTS=true` **and** `ONDEMAND_STRIPE_TEST_SANDBOX=authorized`
- Passenger in-app PaymentSheet path is preserved; Soft Meter / booking / dispatch / Auth0 / Socket.IO / media auth unchanged by this infrastructure work.

---

## Remaining blockers (before real go-live)

1. **Git push / first CI run** — not executed per instruction; owner must push to `main` when ready.
2. **VPS bootstrap** — create `/opt/drivewize/production`, populate `.env.production` with rotated secrets.
3. **GitHub Environment `production` secrets** — all seven secrets above must be set.
4. **DNS** — `api.drivewize.co` / `admin.drivewize.co` → `82.180.139.178`.
5. **Credential rotation** — Auth0 M2M / Mapbox (and any historically leaked DB passwords) before production use.
6. **Stripe live mode** — blocked until explicit client authorization (test mode only for now).
7. **Admin container** — Caddy returns `503` on `admin.drivewize.co` until Admin image is wired (separate repo).
8. **Optional data import** — sanitized dump via `scripts/db/production-db-transfer.md` if seeding from local; do not wipe local `ryd_u`.

---

## Safety checklist (satisfied in design)

- [x] Failed CI prevents production deploy (`needs: ci-gate`)
- [x] No simultaneous deploys (workflow concurrency + flock)
- [x] Immutable digest deploy for runtime + migrate
- [x] Pre-migration DB backup when DB is non-empty
- [x] Health verification after deploy
- [x] Rollback restores previous app image only (schema-compatible caveat documented)
- [x] Persistent volumes preserved (no `down -v`)
- [x] No public exposure of backend / Postgres / Redis
- [x] No staging environment / development-branch deploy path
- [x] No manual approval required for routine production deploys
- [x] No push to GitHub or VPS deploy performed in this session
