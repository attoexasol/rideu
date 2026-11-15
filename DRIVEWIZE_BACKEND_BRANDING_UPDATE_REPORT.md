# DriveWize Backend — Branding Update Report

**Date:** 2026-09-20  
**Related audit:** `DRIVEWIZE_BACKEND_RYDU_BRANDING_AUDIT.md`

---

## Final status

**BACKEND SOURCE UPDATED — EXISTING DATABASE BRAND DATA UPDATE REQUIRED**

Source and future bootstrap now use **DriveWize Platform**. Existing `organizations` rows still named `RYDU Platform` will keep appearing in Admin (including Official Vehicle Duty QR) until migration `0032_platform_organization_branding` is applied, or until `POST /api/v1/admin/fleet/platform/ensure` / `ensurePlatformOrganizationAndFleet()` runs against that database.

This environment’s migration was **not** applied here. Deployed and local databases that already contain the platform org must run the data update separately. Changing seed/source does not rewrite existing rows by itself.

---

## 1. Total matches found (pre-change)

Case-insensitive search of `Rydu` / `RYDU` / `rydu`:

| Bucket | Files | Approx. line matches |
|---|---|---|
| User-visible runtime brand | 1 (`src/config/duty.ts`) | 1 (`RYDU Platform`) |
| Auth0 JWT claim contract | 2 | 2 |
| Test fixtures | 1 | 3 |
| Historical markdown / workspace paths | 25 | ~105 |
| **Total** | **29** | **~111** |

SQL migrations, schema identifiers, env examples, email templates, FCM copy, and Stripe PaymentIntent descriptions had **no** Rydu brand strings.

There is no `ryduPercentage` / `rydu_percentage` field. Settlement uses `company_percentage` / `platform_amount`.

---

## 2. Every user-visible match

**One hardcoded user-visible product brand string:**

| Location | Value | Where it is seen |
|---|---|---|
| `src/config/duty.ts` `PLATFORM_ORG_NAME` (before change) | `RYDU Platform` | Persisted as `organizations.name`; returned as `organization.name` / `organizationName` |

Admin Official Vehicle Duty QR does not hardcode this. It displays the API field `organization.name` from `GET /api/v1/admin/fleet/vehicles`.

Related user-visible surfaces of the **same database column** (not extra hardcoded copies):

- `GET /api/v1/admin/fleet/organizations` → `name`
- `GET /api/v1/admin/fleet/drivers/:driverId/duty` → `organization.name`, `vehicle.organizationName`
- `GET /api/v1/driver/duty/current` → same
- `GET /api/v1/driver/duty/current/vehicle-qr` → `vehicle.organizationName`

QR token/image endpoints do not embed organization name in the QR payload.

---

## 3. Exact origin of `RYDU Platform`

| Kind | Result |
|---|---|
| Hardcoded HTTP response body? | No |
| SQL seed INSERT in historical migrations? | No (`0014` creates `organizations` empty) |
| `src/db/seed.ts`? | No (does not seed organizations) |
| Test fixture? | No |
| **Runtime bootstrap constant** | **Yes:** `PLATFORM_ORG_NAME` in `src/config/duty.ts` |
| **How it is stored** | `ensurePlatformOrganizationAndFleet()` inserted `{ name: PLATFORM_ORG_NAME, type: 'platform' }` when no row matched **by display name** |
| **Callers** | `POST /api/v1/admin/fleet/platform/ensure`, `src/scripts/multi-fleet-backfill.ts`, `src/scripts/migrate-legacy-driver-cabs-to-vehicles.ts` |

There is no platform org slug and no fixed UUID in source. The stable discriminator is `organizations.type = 'platform'`.

### How `organization.name` reaches Admin Vehicles / Duty QR

1. `organizations.name` (database)
2. `listAdminFleetVehicles()` joins `vehicles` → `fleets` → `organizations`
3. `listAdminFleetVehiclesForAdmin()` maps  
   `organization: { id: organization.id, name: organization.name }`
4. `GET /api/v1/admin/fleet/vehicles` returns that object  
   (`src/routes/v1/index.ts` → `/admin/fleet` → `listAdminFleetVehiclesHandler`)

If the row is still `RYDU Platform`, Admin still shows **Organization: RYDU Platform**.

---

## 4. Database table / field

| Item | Value |
|---|---|
| Table | `organizations` |
| Column | `name` (`varchar(255)`) |
| Identity used for update | `type = 'platform'` **and** current `name = 'RYDU Platform'` |
| Not used as identity | UUID (generated per environment), slug (does not exist) |
| Related table | `fleets.name` is `Platform Fleet` — no Rydu; unchanged |

---

## 5. Whether existing DB data requires updating

**Yes**, for any database that already ran platform bootstrap.

| Situation | Result |
|---|---|
| Brand-new DB after this source change | Inserts `DriveWize Platform` |
| Existing DB with `type=platform` / `name=RYDU Platform` | **Still shows RYDU Platform** until `0032` or ensure-rename |
| Source change **without** type-based lookup | Would have inserted a **second** platform org named DriveWize Platform. Lookup was changed to prevent that. |

---

## 6. Source / seed changes made

| File | Change |
|---|---|
| `src/config/duty.ts` | `PLATFORM_ORG_NAME = 'DriveWize Platform'`. Added `PLATFORM_ORG_LEGACY_NAMES = ['RYDU Platform']` as a **lookup key only**, not a display label. |
| `src/repositories/organization.repository.ts` | Resolve platform org by `type = 'platform'` + current name, then legacy name, then any platform row. New inserts use `DriveWize Platform`. If the found row still has the legacy display name, rename it in place (same org UUID). |
| `tests/duty.qr-foundation.test.ts` | Asserts display name is DriveWize Platform; asserts legacy name remains a lookup key. |

API JSON keys, QR issue/rotate/token behavior, and settlement math were not changed.

---

## 7. Exact data migration / update made or required

**Added (not applied in this session):**

`src/db/migrations/0032_platform_organization_branding.sql`

```sql
UPDATE "organizations"
SET "name" = 'DriveWize Platform',
    "updated_at" = NOW()
WHERE "type" = 'platform'
  AND "name" = 'RYDU Platform';
```

Registered in `src/db/migrations/meta/_journal.json` as tag `0032_platform_organization_branding`.

**How to apply (established pattern):**

```bash
npm run db:migrate
```

Idempotent: second run updates zero rows.

**Alternate path (same rename, not a substitute for running 0032 on every environment):**  
`ensurePlatformOrganizationAndFleet()` now updates the existing platform row if its name is still `RYDU Platform` (for example `POST /api/v1/admin/fleet/platform/ensure`). Prefer the SQL migration so environments that never call ensure still update.

**Not done in this session:** running `db:migrate` against live/local databases (unknown whether `DATABASE_URL` is a shared environment). Operators must apply `0032` on each existing database.

---

## 8. Remaining technical Rydu identifiers and why they remain

After the safe source changes, remaining matches are explained:

| Location | Value | Why it remains |
|---|---|---|
| `src/config/duty.ts` `PLATFORM_ORG_LEGACY_NAMES` | `'RYDU Platform'` | Lookup key to find **existing** platform org rows. Not a new user-visible label. |
| `src/db/migrations/0032_platform_organization_branding.sql` | `name = 'RYDU Platform'` | Idempotent WHERE clause for the data update. |
| `tests/duty.qr-foundation.test.ts` | asserts legacy lookup key | Confirms we did not drop the existing-row matcher. |
| `src/services/passengerAuth.service.ts` | `https://rydu.com/role` | Auth0 custom-claim **API contract** fallback. |
| `src/websocket/server.ts` | `https://rydu.com/role` | Same JWT contract fallback. |
| `tests/avatar-storage.test.ts` | `api.rydu.test`, `rydu-avatar-test-` | Test hostname / temp dir. Not UI copy. |
| Historical `RYDU_*.md` reports and `backend_rydu` paths | various | Historical documentation / internal paths. Not served to Admin or apps. |
| `DRIVEWIZE_BACKEND_RYDU_BRANDING_AUDIT.md` | documents the old string | This audit record. |

No unexplained user-visible backend branding remains in source. After `0032` (or ensure-rename), no unexplained user-visible branding remains in `organizations.name` either.

---

## 9. API response compatibility

Unchanged:

- Field names `organization`, `organization.id`, `organization.name`, `organizationName`
- Vehicle list / QR issue / rotate / token list routes and payloads
- QR token format and image generation
- Settlement columns and percentages
- Auth0 claim keys

Only the **string value** of `organization.name` for the platform org changes (after source+data update), from `RYDU Platform` to `DriveWize Platform`.

---

## 10. Targeted verification result

Command:

```bash
npx jest tests/duty.qr-foundation.test.ts tests/admin-fleet-vehicles.test.ts tests/driver-duty-vehicle-qr.test.ts --no-coverage
```

| Result | Value |
|---|---|
| Suites | 3 passed |
| Tests | 32 passed |
| Full backend suite | **Not run** (per task) |
| Admin QR route contract | Still mounted: `/vehicles/:vehicleId/qr/issue`, `rotate`, `tokens` |
| Vehicle list still returns | `organization: { id, name }` |

Known pre-existing Jest noise: Redis client logs after tests / worker force-exit. Not introduced by this branding change.

---

## QA checklist after migration is applied

1. Run `0032` on the target database (`npm run db:migrate`).
2. `GET /api/v1/admin/fleet/vehicles` — platform vehicles show `organization.name`: `DriveWize Platform`.
3. Admin Official Vehicle Duty QR modal — Organization line shows DriveWize Platform, not RYDU Platform.
4. Confirm organization and fleet **IDs** are unchanged.
5. Confirm no second platform organization was created.
