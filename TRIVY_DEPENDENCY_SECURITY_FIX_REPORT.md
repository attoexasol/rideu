# Trivy Dependency Security Fix Report

**Date:** 2026-11-18  
**Repository:** `backend_rydu`  
**Branch:** `main` (local fixes; not pushed)  
**Scanner:** Trivy CLI **0.70.0** (aligned with action-bundled Trivy era)  
**Policy (unchanged):** `--severity CRITICAL,HIGH --exit-code 1 --ignore-unfixed`

---

## Summary

Production runtime and migration images now pass the blocking Trivy policy (`exit 0`).  
Original CI failures (`proxy-addr`, `sharp`, `socket.io-parser`, `ws`, `picomatch`, `sigstore`) are resolved via patched dependencies / overrides and by removing unused base-image package managers from the runtime image.

Full Jest suite: **1008 / 1008 passed**. TypeScript + app build: **pass**. Soft meter latch remains `METERED_CHARGING_RELEASED = false`. Drizzle journal still **41** entries through `0040`.

---

## Baseline findings (pre-fix runtime image)

Reproduced locally against `drivewize-backend:trivy-base` (same severity/exit policy). Relevant HIGH/CRITICAL with available fixes included:

| Package | Severity | Installed | Fixed | Source |
|---------|----------|-----------|-------|--------|
| `proxy-addr` | **CRITICAL** | 2.0.7 | 2.0.8 | Production transitive via `express` |
| `sharp` | HIGH | 0.35.3 | 0.35.4 / 0.35.5 | Direct production dependency |
| `socket.io-parser` | HIGH | 4.2.4 | 4.2.6 / **4.2.7** | Production transitive via `socket.io` |
| `ws` | HIGH | 8.17.1 | **8.21.0** | Production transitive via `engine.io` / `socket.io-adapter` |
| `picomatch` | HIGH | 4.0.3 (base npm) / 2.3.1 (jest) | 4.0.4 / 2.3.2 | Dev tree + **base-image npm CLI** |
| `sigstore` | HIGH | 3.1.0 | 4.1.1 | **Base-image npm CLI** (not in app lockfile) |
| `engine.io` | HIGH | 6.6.4 | 6.6.11 | Production transitive via `socket.io` |
| `jws` | HIGH | 3.2.2 | 3.2.3 / 4.0.1 | `jsonwebtoken` + Google auth libs |
| `multer` | HIGH | 2.2.0 | 2.5.0 | Direct production dependency |
| `form-data` | HIGH | 4.0.4 | 4.0.6 | Transitive via `axios` |
| `path-to-regexp` | HIGH | 0.1.12 | 0.1.13 | Transitive via `express` |
| `axios` | HIGH | 1.12.2 | ≥1.16.0 | Direct production dependency |
| `body-parser` | HIGH | 1.20.3 | 1.20.9 | Transitive via `express` |
| `brace-expansion` | HIGH | 2.0.2 | ≥2.1.x | Transitive (+ base npm) |
| `@grpc/grpc-js` | HIGH | 1.14.4 | 1.14.5 | Transitive via `firebase-admin` |
| `drizzle-orm` | HIGH | 0.44.6 | **0.45.2** | Direct production dependency |
| `pacote` / `ip-address` | HIGH | (npm CLI) | newer | **Base-image npm only** |

No secrets were printed from scan output.

---

## Fixes applied

### Direct dependency updates (`package.json`)

| Package | From | To | Notes |
|---------|------|----|-------|
| `sharp` | `^0.35.3` | `^0.35.5` | Media processing libheif/librsvg fixes |
| `socket.io` | `^4.6.1` | `^4.8.4` | Pulls safer parser/engine line |
| `multer` | `^2.2.0` | `^2.5.0` | Upload DoS fixes |
| `axios` | `^1.12.2` | `^1.16.0` | Multiple HIGH CVEs |
| `drizzle-orm` | `^0.44.6` | `^0.45.2` | Identifier escaping SQL injection fix |
| `pino-pretty` | dependencies | **devDependencies** | Only used when `NODE_ENV=development` |

### Narrow npm `overrides` (transitive)

| Override | Version | Parent / reason |
|----------|---------|-----------------|
| `proxy-addr` | `2.0.8` | `express` still declares `~2.0.7` |
| `path-to-regexp` | `0.1.13` | `express` |
| `body-parser` | `1.20.9` | `express` |
| `brace-expansion` | `2.1.6` | transitive DoS fixes |
| `@grpc/grpc-js` | `1.14.5` | `firebase-admin` / gax |
| `form-data@4` | `4.0.6` | `axios` / superagent line |
| `form-data@2` | `2.5.6` | Google `@types/request` line |
| `socket.io-parser` | `4.2.7` | both Socket.IO DoS CVEs |
| `ws` | `8.21.0` | `engine.io` pins `~8.17.1` |
| `engine.io` | `6.6.11` | Socket.IO binary POST DoS |
| `jsonwebtoken.jws` | `3.2.3` | keep JWT on 3.x patched; Google libs keep 4.0.1 |
| `picomatch@2/3/4` | `2.3.2` / `3.0.2` / `4.0.4` | line-correct patches |
| `sigstore` | `4.1.1` | defensive (app lockfile never depended on it) |
| `ip-address` | `10.3.1` | defensive for any transitive |

`package-lock.json` regenerated via `npm install` (no `npm audit fix --force`).

### Dockerfile

1. Added **`prod-deps`** stage: `npm ci --omit=dev` so runtime copies **production-only** `node_modules` (no Jest/eslint/drizzle-kit).  
2. Builder no longer relies on `npm prune` alone.  
3. Runtime removes unused base-image tooling: **`npm` / `npx` / `corepack` / `yarn`** (source of `pacote`, `sigstore`, `picomatch@4`, etc.).  
4. App still runs with Node `22.23.5-bookworm-slim`; migrate target still extends runtime.

---

## Trivy results (final)

| Image / target | Command policy | Result |
|----------------|----------------|--------|
| Production npm lock (prod deps) | `trivy fs … --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1` | **0 findings**, exit **0** |
| `drivewize-backend:trivy-fixed` (runtime) | same image policy as Actions | **0 HIGH/CRITICAL fixed vulns**, exit **0** |
| `drivewize-backend:trivy-migrate` (migrate) | same | **exit 0** |

Trivy remains enabled and blocking in `.github/workflows/production-deploy.yml` and `ci.yml` (pinned action SHA from prior fix).

---

## Vulnerabilities with no available fix

None remaining under the CI policy (`CRITICAL,HIGH` + `ignore-unfixed`) for the final runtime/migrate images.

Unfixed / ignored-by-policy items (if any OS CVEs without fixes) would still be ignored by `ignore-unfixed: true` as before — not newly broadened.

---

## Test and build results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** |
| `npm test -- --runInBand --forceExit` | **93 suites / 1008 tests PASS** |
| Runtime module load (`sharp`, `socket.io`, `express`, `ws`, `proxy-addr`, `drizzle-orm`) | **PASS** |
| Runtime has no `npm`/`yarn` | **Confirmed** |
| `METERED_CHARGING_RELEASED` | **false** |
| Drizzle journal entries | **41** (through `0040`) |

Note: An intermediate Jest run failed only because the shell still pointed `DATABASE_URL` at a disposed CI Postgres on `:55432`. After clearing that env var (local `.env` again), all 1008 tests passed. No production Hostinger DB was used.

---

## Compatibility notes

- **Socket.IO / Redis adapter / PaymentSheet / Soft Meter / dispatch:** no application source changes; dependency minors + overrides only.  
- **drizzle-orm 0.45.2:** security fix for `sql.identifier()` / `.as()` escaping; no intentional business-logic edits. Full suite green.  
- **sharp 0.35.5:** still used for media processing; loads in runtime image.  
- **Stripe test mode / PaymentSheet:** unchanged application paths.

---

## Files modified

| File | Change |
|------|--------|
| `package.json` | Direct upgrades + overrides; `pino-pretty` → devDependencies |
| `package-lock.json` | Regenerated |
| `Dockerfile` | `prod-deps` stage; strip npm/yarn from runtime |
| `.gitignore` | Ignore local `bin-trivy/` and trivy report artifacts |
| `TRIVY_DEPENDENCY_SECURITY_FIX_REPORT.md` | This report |

---

## Remaining blockers

1. **Push to `main`** so Actions rebuilds GHCR images and re-runs Trivy (not done here).  
2. Local Docker disk pressure was observed during iteration; CI runners are independent but keep image pruning hygiene on the VPS.  
3. Prior production bring-up items still apply (Environment secrets, VPS `.env.production`, credential rotation, domain later).

No push/deploy performed. Trivy was not disabled; no broad CVE ignores added; no `continue-on-error`.
