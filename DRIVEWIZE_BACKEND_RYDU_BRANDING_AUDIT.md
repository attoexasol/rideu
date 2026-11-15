# DriveWize Backend — Remaining Rydu User-Visible Brand Data Audit

**Date:** 2026-09-20  
**Scope:** Current backend repository only (source, seeds, migrations, scripts, fixtures, tests, docs).  
**Not in scope:** Android, iOS, Passenger app, Admin frontend code, API response shape, financial calculations, QR token/image behavior.

Search terms: `Rydu`, `RYDU`, `rydu` (case-insensitive).

---

## Executive finding

The only **user-visible product brand string** in backend runtime/source is:

```
RYDU Platform
```

It is hardcoded as `PLATFORM_ORG_NAME` in `src/config/duty.ts` and persisted as `organizations.name` for the platform organization (`type = 'platform'`). Admin Vehicles / Official Vehicle Duty QR displays that database value as `organization.name`.

All other matches are technical contracts, test hosts, historical documents, or file/workspace names. There is no `ryduPercentage` / `rydu_percentage` field in this backend; settlement uses `company_percentage`.

**Source-code fix and existing-database update are different operations.** Changing the constant does **not** rename rows already stored as `RYDU Platform`.

---

## 1. Exact origin of `RYDU Platform`

| Question | Answer |
|---|---|
| Hardcoded backend response? | **No.** APIs return `organizations.name` from the database. |
| Seed SQL in migrations? | **No.** `0014_multi_fleet_foundation.sql` creates `organizations` with no INSERT of a name. |
| Organization table row? | **Yes, after bootstrap.** Column `organizations.name`. |
| Fleet table row? | **No.** Fleet seed name is `Platform Fleet` (no Rydu). |
| Test fixture? | **No.** Duty/fleet tests insert names like `Duty Start Org …`. |
| Bootstrap / runtime seed? | **Yes.** `ensurePlatformOrganizationAndFleet()` inserts `{ name: PLATFORM_ORG_NAME, type: 'platform' }` when no row is found **by display name**. |

### Write path (how the string enters the database)

1. `src/config/duty.ts`  
   `export const PLATFORM_ORG_NAME = 'RYDU Platform';`
2. `src/repositories/organization.repository.ts` → `ensurePlatformOrganizationAndFleet()`  
   - Lookup: `findOrganizationByName(PLATFORM_ORG_NAME)` i.e. `WHERE organizations.name = 'RYDU Platform'`  
   - If missing: `INSERT INTO organizations (name, type, status) VALUES ('RYDU Platform', 'platform', 'active')`
3. Callers:
   - `POST /api/v1/admin/fleet/platform/ensure` (`ensurePlatformHandler`)
   - `src/scripts/multi-fleet-backfill.ts` (`npm run db:multi-fleet-backfill`)
   - `src/scripts/migrate-legacy-driver-cabs-to-vehicles.ts`

There is **no slug and no fixed UUID** for the platform organization. The stable discriminator is `organizations.type = 'platform'`. Lookup today is **by display name**, which is unsafe if the display name is renamed without also changing lookup.

`src/db/seed.ts` does **not** seed organizations or fleets.

### Read path (how Admin Duty QR shows `Organization: RYDU Platform`)

Admin does not receive a hardcoded `"RYDU Platform"` string from a QR-image endpoint. It displays `organization.name` from fleet vehicle payloads.

**Primary Admin API (Vehicles list used by Official Vehicle Duty QR):**

- Route: `GET /api/v1/admin/fleet/vehicles`  
  (`src/routes/v1/index.ts` mounts `/admin/fleet` → `src/routes/v1/admin/fleet.ts`)
- Handler: `listAdminFleetVehiclesHandler` → `listAdminFleetVehiclesForAdmin`
- Query: `vehicles` LEFT JOIN `fleets` LEFT JOIN `organizations`  
  (`src/repositories/adminFleetVehicle.repository.ts`)
- Response field (shape unchanged):

```ts
organization: organization
  ? { id: organization.id, name: organization.name }
  : null
```

(`src/services/adminFleetVehicle.service.ts`)

If `organizations.name` is `RYDU Platform`, Admin renders **Organization: RYDU Platform**.

**Related APIs that also expose the same column (same table/field, not QR-token payload):**

| API | Field |
|---|---|
| `GET /api/v1/admin/fleet/organizations` | full org rows including `name` |
| `GET /api/v1/admin/fleet/drivers/:driverId/duty` | `organization.name`, `vehicle.organizationName` |
| `GET /api/v1/driver/duty/current` | `organization.name`, `vehicle.organizationName` |
| `GET /api/v1/driver/duty/current/vehicle-qr` | `vehicle.organizationName` |

QR **token** endpoints (`/vehicles/:vehicleId/qr/issue|rotate|tokens`) return token metadata + image. They do **not** embed organization name in QR payload. The brand leak is the **organization record**, not QR encoding.

---

## 2. Live-data implication

| Environment | What happens |
|---|---|
| New database, after source change only | `ensurePlatformOrganizationAndFleet()` inserts `DriveWize Platform` (once the constant is updated). |
| **Existing database that already ran bootstrap** | Row remains `name = 'RYDU Platform'` until a data UPDATE. Seed/constant change does **not** rewrite it. |
| Existing database + source change **without** type-based lookup | `findOrganizationByName('DriveWize Platform')` misses the old row and **inserts a second platform organization**. Must look up by `type = 'platform'` (and/or legacy name), not only the new display name. |

**SOURCE CODE FIX** ≠ **EXISTING DATABASE DATA MIGRATION**.

Recommended existing-row update (idempotent, identity = `type`, not UUID, not “whatever is named DriveWize”):

```sql
UPDATE "organizations"
SET "name" = 'DriveWize Platform',
    "updated_at" = NOW()
WHERE "type" = 'platform'
  AND "name" = 'RYDU Platform';
```

Do **not** rename by UUID (none is stable in source). Do **not** rename slugs (none exist). Do **not** rename `id`.

---

## 3. Classification of every match

Line counts from a repository-wide case-insensitive search. Runtime/source matches are listed line-by-line. Historical documents are listed per file with a reason (rewriting past audit reports is out of scope).

### 3.1 Runtime / source (must treat as brand vs contract)

| File/location | Current value | Classification | Can user/admin see it? | Should change? | Recommended replacement/action |
|---|---|---|---|---|---|
| `src/config/duty.ts` line 6 | `'RYDU Platform'` (`PLATFORM_ORG_NAME`) | **USER_VISIBLE_BRAND_DATA** + **DATABASE_SEED_VALUE** | **Yes.** Written to `organizations.name` and returned as `organization.name` / `organizationName` | **Yes** | `'DriveWize Platform'`. Keep constant name `PLATFORM_ORG_NAME`. |
| `src/repositories/organization.repository.ts` (uses `PLATFORM_ORG_NAME`) | Inserts/looks up by that string | **DATABASE_SEED_VALUE** | Indirectly (via DB + APIs above) | **Yes (lookup behavior)** | Keep using the constant. **Also** resolve existing platform org by `type = 'platform'`, then legacy display name, so renaming does not create a second org. |
| `src/controllers/adminFleet.controller.ts` `ensurePlatformHandler` | Calls ensure bootstrap | **OTHER** (bootstrap endpoint) | Admin can see resulting org name | Change via repository/config only | No controller/API-shape change. |
| `src/scripts/multi-fleet-backfill.ts` | Calls ensure | **DATABASE_SEED_VALUE** (script) | Indirectly | No extra string change | Inherits constant + safer lookup. |
| `src/scripts/migrate-legacy-driver-cabs-to-vehicles.ts` | Calls ensure | **DATABASE_SEED_VALUE** (script) | Indirectly | No extra string change | Inherits constant + safer lookup. |
| `src/services/passengerAuth.service.ts` line 77 | `decoded['https://rydu.com/role']` | **API_CONTRACT** (Auth0 custom-claim namespace fallback) | No (JWT claim key, not a label) | **No** | Keep as legacy-token fallback after `https://drivewize.com/role`. |
| `src/websocket/server.ts` line 106 | `decoded['https://rydu.com/role']` | **API_CONTRACT** (same Auth0 claim fallback) | No | **No** | Keep fallback so old tokens still resolve role. |

### 3.2 Tests

| File/location | Current value | Classification | Can user/admin see it? | Should change? | Recommended replacement/action |
|---|---|---|---|---|---|
| `tests/avatar-storage.test.ts` ~65–67 | `https://api.rydu.test` | **TEST_FIXTURE** (fake public base URL) | No | **No** | Technical hostname in unit test; not product UI copy. |
| `tests/avatar-storage.test.ts` ~78 | `` `rydu-avatar-test-${Date.now()}` `` | **INTERNAL_PATH** / **TEST_FIXTURE** (tmpdir prefix) | No | **No** | Local temp directory name only. |

No test asserts `RYDU Platform`. Fleet/duty fixtures use generated names (`Duty Start Org …`, exchange org names).

### 3.3 Schema, migrations, env, payments, notifications (negative findings)

| Area | Result | Classification if a match existed |
|---|---|---|
| `src/db/schema/organizations.ts` | Columns `id`, `name`, `type`, `status` — no `rydu` in identifiers | — |
| `src/db/migrations/*.sql` | **No** `Rydu`/`RYDU`/`rydu` strings; org table created empty | — |
| `.env` / `.env.example` | **No** matches. DB name example is `drivewize` | — |
| Email / templates | **None** in repo | — |
| Stripe PaymentIntent | metadata `bookingId` / `passengerId` only; no brand description | — |
| FCM titles/bodies | `'New ride request'`, ride-event titles; no Rydu | — |
| Settlement labels | `driver_percentage`, `company_percentage`, `platform_amount` — not `rydu_*` | **DATABASE_COLUMN** / **API_CONTRACT** if they had been named rydu — they are not |
| Market seed | `Bangladesh` / `United States` | — |
| QR token payload | opaque `VQR_…`; no org name inside token | — |
| `package.json` | `"name": "drivewize-backend"`, description DriveWize | — |
| Root health `GET /` | `'DriveWize Backend API'` | already DriveWize |

### 3.4 Historical documentation (do not treat as live brand data)

These files are prior audit/implementation reports. They are **not** served to Admin/apps. **Should change? No** (historical record). Classification: **HISTORICAL_DOCUMENTATION**. Many also mention the workspace folder `backend_rydu` (**INTERNAL_PATH**).

| File | Approx. match lines | Typical values |
|---|---|---|
| `RYDU_BACKEND_STRIPE_CONNECT_PAYMENT_AUDIT.md` | 7 | Title “RYDU Backend”; prose “Passenger pays Rydu”; `backend_rydu` |
| `RYDU_BACKEND_SETTLEMENT_CONFIGURATION_IMPLEMENTATION_REPORT.md` | 6 | “company / Rydu share”; status banners |
| `RYDU_BACKEND_DRIVER_PAYMENT_HISTORY_IMPLEMENTATION_REPORT.md` | 7 | “Standard Rydu envelope”; “captured by the Rydu platform” |
| `RYDU_BACKEND_RATE_LIMIT_AUDIT_REPORT.md` | 7 | “Rydu Node backend”; `backend_rydu` |
| `RYDU_STRIPE_PHASE_C_PASSENGER_AUTHORIZATION_REPORT.md` | 8 | “Rydu platform account”; “do not send card numbers to Rydu” |
| `RYDU_STRIPE_PHASE_B_DRIVER_CONNECT_REPORT.md` | 6 | “Rydu does not request…” |
| `RYDU_STRIPE_PHASE_D_CAPTURE_CANCELLATION_REPORT.md` | 5 | “If Rydu cancelled first…” |
| `RYDU_STRIPE_PHASE_A_FOUNDATION_REPORT.md` | 2 | Title / workspace |
| `RYDU_BACKEND_AIRPORT_CURRENCY_CONSISTENCY_REPORT.md` | 6 | “Rydu today is BDT-only” |
| `RYDU_BACKEND_USD_END_TO_END_FINANCIAL_QA_REPORT.md` | 6 | workspace `backend_rydu` |
| `RYDU_BACKEND_MARKET_CURRENCY_IMPLEMENTATION_REPORT.md` | 4 | Title / status |
| `RYDU_BACKEND_MARKET_FARE_CATEGORY_DATA_AUDIT_REPORT.md` | 4 | Title / status |
| `RYDU_BACKEND_MULTI_AIRPORT_FIXED_FEE_IMPLEMENTATION_REPORT.md` | 5 | Title / status |
| `RYDU_BACKEND_PASSENGER_PLACES_COUNTRY_VERIFICATION_REPORT.md` | 5 | Title / status |
| `RYDU_BACKEND_CASH_PAYMENT_HISTORY_AUDIT_REPORT.md` | 4 | Title / status |
| `RYDU_BACKEND_DRIVER_TOTAL_EARNINGS_AUDIT.md` | 3 | “captured by Rydu’s payment ledger” |
| `RYDU_STRIPE_CONNECT_ACCOUNT_CREATE_FAILURE_REPORT.md` | 4 | Title / status |
| `RYDU_STRIPE_CONNECT_IDEMPOTENCY_V2_REPORT.md` | 3 | Title / repo path |
| `RYDU_STRIPE_ACCOUNTS_V1_FRESH_PROBE_REPORT.md` | 4 | “Persisted in Rydu DB” |
| `RYDU_STRIPE_RUNTIME_IDENTITY_AUDIT.md` | 4 | Title / `backend_rydu` |
| `RYDU_BACKEND_IOS_TERMINATED_FCM_AUDIT_REPORT.md` | 1 | Title |
| `RYDU_backEnd_Full_project_audit.md` | 1 | Self-filename reference |
| `ADMIN_RIDE_VIDEO_VISIBILITY_FINALIZATION_REPORT.md` | 1 | `backend_rydu` |
| `BACKEND_DVR_RUNTIME_AUDIT_REPORT.md` | 1 | local path `…\backend_rydu\…` |
| `RIDE_VIDEO_FIRST_PLAYABLE_SEGMENT_BACKEND_TRACE.md` | 1 | local path `…\backend_rydu\…` |

**Filenames** starting with `RYDU_` (22 files): **INTERNAL_PATH** / **HISTORICAL_DOCUMENTATION**. Do not rename (not user-visible product branding; would churn git history without changing Admin).

Workspace directory `backend_rydu`: **INTERNAL_PATH**. Do not rename as part of this task.

---

## 4. Totals (pre-change search)

| Bucket | Files | Approx. line matches |
|---|---|---|
| Runtime source (user-visible brand) | 1 (`duty.ts`) | 1 (`RYDU Platform`) |
| Runtime source (Auth0 claim contract) | 2 | 2 |
| Test fixtures | 1 | 3 |
| Historical docs + path mentions | 25 | ~105 |
| SQL migrations / schema / env / emails / FCM / Stripe copy | 0 | 0 |
| **Search total** | **29 files** | **~111 line matches** |

**User-visible backend branding matches: 1 string, `RYDU Platform`, plus every existing `organizations` row that already stored it.**

---

## 5. Technical identifiers to protect

Do **not** rename:

- Auth0 claim `https://rydu.com/role` (legacy JWT contract)
- Test host `api.rydu.test` / tmp prefix `rydu-avatar-test-`
- Package/repo/workspace names
- Database columns (`organizations.name` is the **value** to change, not the column)
- API keys `organization`, `organizationName`, `name`
- Event names, storage ids, env var names

There is no `ryduPercentage` / `rydu_percentage` in this codebase.

---

## 6. Recommended actions (implementation follows this audit)

1. Set `PLATFORM_ORG_NAME = 'DriveWize Platform'`.
2. Resolve platform org by `type = 'platform'` (stable) before inserting, including a legacy-name match for `'RYDU Platform'`, so existing DBs are not duplicated.
3. Add idempotent SQL migration `0032` updating `organizations.name` where `type = 'platform'` AND `name = 'RYDU Platform'`.
4. Do not change Admin/API JSON keys, QR behavior, or financial math.
5. Leave Auth0 fallback claims and historical markdown as-is.
