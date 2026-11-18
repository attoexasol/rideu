# Gitleaks CI Fix Report

**Date:** 2026-11-18  
**Repository:** `backend_rydu`  
**Branch:** `main` (local fixes; not pushed)  
**Tool:** Gitleaks **v8.21.2** (same as GitHub Actions)  
**Command:** `gitleaks detect --source . --no-git --redact --exit-code 1 -c .gitleaks.toml`

No secret values are included in this report.

---

## Summary

The production CI gate failed with **9 Gitleaks findings** on the Actions checkout (no `node_modules`, no gitignored env/secret files). All nine were **false positives** in workflows/docs (dummy CI JWT, truncated JWT example, curl `Bearer` placeholders). They were remedited by replacing placeholders and tightening `.gitleaks.toml` without disabling the scanner.

**Gitleaks now exits 0** for both a CI-like tracked-tree scan and a full local `--no-git` scan with the updated config.

---

## The 9 CI findings

| # | File | Line | Rule ID | Classification | Fix |
|---|------|------|---------|----------------|-----|
| 1 | `.github/workflows/ci.yml` | 68 | `generic-api-key` | **False positive** — dummy CI `JWT_SECRET` for Jest only | Replaced with `CHANGE_ME_…` placeholder (allowlisted pattern) |
| 2 | `.github/workflows/production-deploy.yml` | 57 | `generic-api-key` | **False positive** — same CI dummy | Same as #1 |
| 3 | `All_APIs_endpoint.md` | 173 | `generic-api-key` | **False positive** — truncated JWT example (`eyJ…`) | Replaced with `"<access_token>"` |
| 4 | `POSTMAN_COMPANY_CHECKIN_QR.md` | 126 | `curl-auth-header` | **False positive** — `Bearer YOUR_TOKEN` docs | Use `Bearer $ACCESS_TOKEN` |
| 5 | `POSTMAN_COMPANY_CHECKIN_QR.md` | 133 | `curl-auth-header` | **False positive** | Same |
| 6 | `POSTMAN_PASSENGER_PICKUP_QR.md` | 194 | `curl-auth-header` | **False positive** — `Bearer ADMIN_TOKEN` | Use `Bearer $ADMIN_TOKEN` |
| 7 | `POSTMAN_PASSENGER_PICKUP_QR.md` | 201 | `curl-auth-header` | **False positive** | Same |
| 8 | `POSTMAN_PASSENGER_PICKUP_QR.md` | 208 | `curl-auth-header` | **False positive** — `Bearer DRIVER_TOKEN` | Use `Bearer $DRIVER_TOKEN` |
| 9 | `VIDEO_API_REFERENCE.md` | 240 | `curl-auth-header` | **False positive** — `Bearer DRIVER_TOKEN` | Use `Bearer $DRIVER_TOKEN` |

None of these nine were live production credentials.

### Local-only noise (not in the CI nine)

While reproducing with a dirty workspace, Gitleaks also hit:

- Local `.env` / `.env.production` / `secrets/*.json` (gitignored real credentials)  
- `node_modules/**` (not present on Actions before `npm ci`)  
- Transient `README.md` / `LICENSE` pollution from extracting the Windows Gitleaks zip into the repo root (restored/removed; **not** part of the original CI failure)

---

## Config / gate hardening

### `.gitleaks.toml`

- Still `useDefault = true` (full rule set).  
- Path allowlist limited to: `node_modules`, `coverage`, `dist`, local gitleaks artifacts, **gitignored** `.env*` / `secrets/`, tests, env examples.  
- Regex allowlist limited to `CHANGE_ME` and known test Stripe/webhook fixtures.  
- **Not** disabled; source directories remain scanned.

### Workflows (`ci.yml`, `production-deploy.yml`)

1. **Assert** `.env*`, `secrets/*`, `*.pem`, `*.key`, `*.dump` are **not tracked**.  
2. Run Gitleaks with explicit `-c .gitleaks.toml`.  
3. Keep `--exit-code 1` (blocking).

---

## Credentials requiring rotation

These nine CI hits do **not** themselves require rotation. Separate, previously documented exposures still apply:

| Credential | Why |
|------------|-----|
| Auth0 Management client ID/secret | Historically present in git (`RAILWAY_ENV_VARS.md` / `seed-drivers.ts`); working tree scrubbed earlier |
| Mapbox access token | Same historical exposure |
| Railway DB password (if still live) | Same historical exposure |
| Firebase service-account key under local `secrets/` | Present on disk, gitignored; rotate if this file was ever shared or previously committed outside ignore |
| Stripe | Current keys are **test** mode; regenerate webhook secret when production webhook URL is registered. No evidence these nine findings leaked Stripe secrets |

**Do not rewrite git history** without a separate explicit approval.

---

## Gitleaks scan results

| Scan | Result |
|------|--------|
| CI-like (tracked files only, v8.21.2, `--no-git`, `.gitleaks.toml`) | **PASS** — `no leaks found`, exit **0** |
| Full workspace (`--no-git`, updated `.gitleaks.toml`) | **PASS** — `no leaks found`, exit **0** |

---

## Test and build results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | **PASS** (`TSC_EXIT=0`) |
| `npm run build` | **PASS** (`BUILD_EXIT=0`) |
| `npm test -- --runInBand --forceExit` | **PASS** — 93 suites / **1008** tests (`TEST_EXIT=0`) |

---

## Files modified

| File | Change |
|------|--------|
| `.gitleaks.toml` | Precise allowlists + documentation |
| `.github/workflows/ci.yml` | Untracked-secret assert; explicit config; CI JWT placeholder |
| `.github/workflows/production-deploy.yml` | Same |
| `All_APIs_endpoint.md` | Safe token placeholder |
| `POSTMAN_COMPANY_CHECKIN_QR.md` | `$ACCESS_TOKEN` in curl examples |
| `POSTMAN_PASSENGER_PICKUP_QR.md` | `$ADMIN_TOKEN` / `$DRIVER_TOKEN` |
| `VIDEO_API_REFERENCE.md` | `$DRIVER_TOKEN` |
| `.gitignore` | Ignore local `gitleaks.exe` / report JSON |
| `GITLEAKS_CI_FIX_REPORT.md` | This report |

`README.md` restored from git after accidental overwrite by the Gitleaks release zip (no intentional content change).

---

## Git exclusion confirmation

| Path | Status |
|------|--------|
| `.env` | gitignored, **not tracked** |
| `.env.production` | gitignored, **not tracked** |
| `secrets/` | gitignored, **not tracked** |
| `*.pem` / `*.key` / `*.dump` | gitignored patterns; **none tracked** |
| `gitleaks.exe` | gitignored |

---

## Remaining blockers

1. **Push to `main`** (manual) so production CI re-runs with these fixes — not done in this session.  
2. **Rotate** historically exposed Auth0 Management / Mapbox (and Railway DB if applicable) before relying on production.  
3. Set a real rotated **`MAPBOX_ACCESS_TOKEN`** in VPS `.env.production` (still a placeholder from earlier env prep).  
4. Optional: delete or relocate any local Firebase JSON under `secrets/` after rotation if unused.

No application business logic, PaymentSheet, Soft Meter, booking, or driver behavior was changed. Metered charging remains disabled in source. No push/deploy and no history rewrite.
