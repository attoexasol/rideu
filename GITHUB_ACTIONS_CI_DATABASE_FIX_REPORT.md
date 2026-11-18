# GitHub Actions CI Database Fix Report

**Date:** 2026-11-18  
**Repository:** `backend_rydu`  
**Branch:** `main` (local fixes; not pushed)  
**Scope:** Fix CI Postgres integration failures before production deploy gate

---

## Verified root cause

### Primary (CI gate)

`production-deploy.yml` **ci-gate** ran:

1. `npm ci`
2. `npx tsc --noEmit`
3. **`npm test`** ← against empty disposable Postgres `drivewize_ci`
4. `npm run build`

There was **no Drizzle migrate step before Jest**.

`tests/helpers/vehicleExchange.fixtures.ts` then executed:

`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS color ...`

on a database where **`public.vehicles` did not exist** → `PostgresError: relation "vehicles" does not exist`.

Secondary errors (`Cannot read properties of undefined (reading 'driverAId'|'ids')`) were **cascades**: `beforeEach` failed so `fixture` was undefined, then `afterEach` cleanup dereferenced it.

`DATABASE_URL` used by CI tests:

`postgresql://drivewize_ci:drivewize_ci@localhost:5432/drivewize_ci`

(service container `postgres:17.12-alpine`, Redis `redis:7.4.12-alpine`). Never Hostinger production; never local `ryd_u` on CI runners.

Local 1008/1008 passes used an already-migrated local DB (via dotenv `.env`), which hid the missing CI migrate step.

### Secondary (schema completeness)

Even after applying the journaled migrations on a fresh DB, **`bookings.route_encoded_polyline` was missing**.

SQL files existed but were **orphaned from** `src/db/migrations/meta/_journal.json`:

- `0013_passenger_maps_route.sql` (adds `route_encoded_polyline`, etc.)
- `0018_service_category_normalized_unique.sql`

Drizzle only applies journaled tags → CI schema drifted from TypeScript schema / local DBs that received those columns via earlier push/manual paths.

`ci.yml` previously ran `db:migrate:prod` **after** tests (and after build), so it also did not initialize schema for Jest.

---

## CI database initialization changes

Both `.github/workflows/production-deploy.yml` (ci-gate) and `.github/workflows/ci.yml` (test-and-build):

1. **`npm run db:migrate`** before tests  
   - `DATABASE_URL=postgresql://drivewize_ci:drivewize_ci@localhost:5432/drivewize_ci`  
   - `MIGRATIONS_FOLDER=${{ github.workspace }}/src/db/migrations`
2. **Schema verify** (Node + `postgres` driver):  
   - `public.vehicles` exists  
   - `vehicles.color` exists  
   - `bookings.route_encoded_polyline` exists  
   - `drizzle.__drizzle_migrations` count **≥ 41**
3. Then `npm test -- --runInBand --forceExit`
4. Then `npm run build`

Gitleaks remains enabled and blocking (unchanged intent).

---

## Files modified

| File | Change |
|------|--------|
| `.github/workflows/production-deploy.yml` | Migrate + schema verify before Jest |
| `.github/workflows/ci.yml` | Same; removed post-test migrate-only step |
| `src/db/migrations/meta/_journal.json` | Register orphaned `0013` + `0018`; renumber idx 0..40 (41 entries) |
| `tests/helpers/vehicleExchange.fixtures.ts` | Clear error if `vehicles` missing; safe cleanup when fixture undefined |
| `tests/vehicle-exchange.integration.test.ts` | `teardownExchangeFixture` avoids masking setup failures |
| `GITHUB_ACTIONS_CI_DATABASE_FIX_REPORT.md` | This report |

No booking/driver/payment/Soft Meter business logic changes. No Stripe PaymentSheet changes. No production DB touched.

---

## Migration verification

Fresh disposable Postgres (`drivewize_ci` on host port **55432**, not local `ryd_u`):

| Check | Result |
|-------|--------|
| `npm run db:migrate` | **PASS** |
| Journal entries | **41** (through `0040_metered_post_trip_billing`, including `0013` + `0018`) |
| `__drizzle_migrations` rows | **41** |
| `public.vehicles` | present |
| `vehicles.color` | present |
| `bookings.route_encoded_polyline` | present |

---

## Integration test results (fresh CI DB)

| Suite | Result |
|-------|--------|
| `tests/vehicle-exchange.integration.test.ts` | **23 passed** (`VE_TEST_EXIT=0`) |

---

## Full Jest / TypeScript / build

(Against disposable `drivewize_ci` on `:55432`, with CI-equivalent env vars.)

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | **PASS** (`TSC_EXIT=0`) |
| `npm run build` | **PASS** (`BUILD_EXIT=0`) |
| Full `npm test -- --runInBand --forceExit` | **PASS** — 93 suites / **1008** tests (`TEST_EXIT=0`) |

---

## Remaining deployment blockers

1. **Push to `main`** so Actions re-runs ci-gate with migrate-before-test (not done here).  
2. Prior ops blockers still apply: GitHub `production` secrets, VPS `.env.production` (incl. rotated Mapbox), DNS/domain later, credential rotation for historically exposed Auth0 M2M / Mapbox.  
3. Existing environments that already ran migrations through 0040 will apply **pending** `0013`/`0018` on next `db:migrate` (`IF NOT EXISTS` / `CREATE UNIQUE INDEX IF NOT EXISTS` — safe).  
4. Do not point CI `DATABASE_URL` at Hostinger or local `ryd_u`.

---

## Safety checklist

- [x] Integration tests not skipped / not `continue-on-error`
- [x] Disposable CI DB credentials only
- [x] Production DB schema/data untouched
- [x] Gitleaks still blocking
- [x] No staging/dev environments added
- [x] No automatic push/deploy
