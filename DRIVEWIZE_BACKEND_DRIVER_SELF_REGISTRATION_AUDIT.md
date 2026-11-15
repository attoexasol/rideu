# DRIVEWIZE BACKEND — DRIVER SELF-REGISTRATION FOUNDATION AUDIT

Audit only. No code, migrations, database data, APIs, Auth0 configuration, Admin, Android, iOS, or Passenger changes were made.

Current source is authoritative. Auth0 Dashboard settings (including whether Database signup is enabled) are not stored in this repository and are not assumed.

---

## 1. Current Admin-created Driver flow

Drivers are created only by an authenticated admin. There is no driver self-registration endpoint.

Two admin endpoints create a driver. Both create an Auth0 Database user and then a `drivers` row. Neither assigns a fleet, a duty vehicle, or service categories.

### 1.1 `POST /api/drivers`

| Item | Current behavior |
| --- | --- |
| Route | `src/routes/drivers.ts` |
| Auth | `requireAuth` + `extractUserInfo` + `requireAdmin` (`admin` or `super_admin`) |
| Validator | `createDriverSchema` in `src/validators/index.ts` |
| Auth0 | `auth0Management.createUser({ email, password, name, role: 'driver' })` |
| DB | `INSERT` into `drivers`, then `generateUniqueDriverQrCode()` and `ensureDriverVehicleQrCode()` |

**Request body**

| Field | Required | Notes |
| --- | --- | --- |
| `email` | Yes | Zod email format. Stored as sent. Lookup is exact `eq(drivers.email, email)`. |
| `password` | Yes | Minimum 8 characters. Sent to Auth0 only. Not stored in `drivers`. |
| `name` | Yes | Minimum 1 character. |
| `phone` | No | Empty string becomes omitted. Stored as `null` when absent. |
| `vehicleType` | No | `sedan`, `suv`, `van`, `mini_bus`, `coach_bus`. |
| `vehicleId` | No | UUID. Written to `drivers.vehicle_id` when present. |
| `cabName`, cab identifier (`cabNumber` / `cabLicence` / `cabFieldType`+`cabValue`) | No | Legacy cab fields on the driver row. |
| `vehicleMake`, `vehicleModel`, `vehicleYear`, `vehicleColor` | No | Legacy cab fields on the driver row. |

**Mandatory fields for this endpoint:** `email`, `password`, `name`.

**Writes**

- `auth0_id` = Auth0 `user_id` (required column; set after Auth0 succeeds)
- `email`, `name`, `phone`
- `status` = `'offline'`
- `account_status` left unset, so the column default `'active'` applies
- optional legacy vehicle/cab columns when the admin sent them
- `qr_code` and `vehicle_qr_code` generated as identifier strings

`vehicle_qr_code` is a per-driver QR string (`ensureDriverVehicleQrCode`). It does not create a `vehicles` row, a `driver_vehicle_assignments` row, a fleet membership, or any service-category row.

Duplicate email on this endpoint: `driverUtils.findByEmail` returns 409 `DUPLICATE_ERROR` before Auth0 is called. The check is case-sensitive.

### 1.2 `POST /api/admin/users`

| Item | Current behavior |
| --- | --- |
| Route | `src/routes/admin/users.ts` |
| Auth | JWT + `extractUserInfo`. An `admin` may create only `role: 'driver'`. Creating `admin` / `super_admin` requires `super_admin`. |
| Required body | `email`, `password`, `role`, `name` |
| Optional body | `phone`, cab fields, vehicle make/model/year/color |

For `role: 'driver'` it calls the same `auth0Management.createUser`, inserts `drivers` with `status: 'offline'`, `phone: phone || ''`, generates `qr_code`, and calls `ensureDriverVehicleQrCode`. It does not set `vehicle_id` or `vehicle_type`. `account_status` again defaults to `'active'`.

Auth0 “user already exists” and unique-constraint failures return 409.

### 1.3 Auth0 identity created by Admin

`src/services/auth0Management.ts` `createUser`:

1. `POST https://{AUTH0_DOMAIN}/api/v2/users`
2. Connection: `Username-Password-Authentication`
3. `email_verified: false` (drivers; passengers pass `emailVerified: true`)
4. `app_metadata.role` = `'driver'`
5. `name` and `user_metadata.name`
6. Assigns the Auth0 role whose name is `Driver` or `driver` (`assignRoleToUser`). Role-assignment failure is logged and treated as non-fatal because `app_metadata.role` is already set.

There is no invitation API and no separate users table. The password is chosen by Admin and passed through the backend into Auth0. The backend does not store it.

Password reset for an existing Auth0 email already exists: `sendPasswordResetEmail` posts to Auth0 `dbconnections/change_password` on `Username-Password-Authentication`. Admin can trigger it with `POST /api/admin/users/:id/reset-password`.

### 1.4 What Admin creation does not do

- Does not insert `driver_fleet_memberships`
- Does not insert `driver_vehicle_assignments`
- Does not insert `driver_service_categories`
- Does not insert `vehicle_service_categories`
- Does not set duty status to `online`
- Does not approve a vehicle

A newly admin-created driver can log in. They are not dispatch-ready until later admin setup and a duty start.

---

## 2. Current Driver / Auth0 authentication flow

Driver apps authenticate with Auth0, then exchange that token with the backend. The backend does not collect the driver password on login.

### 2.1 `POST /api/auth/login`

Route: `src/routes/auth.ts`. Rate limit: `authRateLimiter` (IP).

**Body**

```json
{
  "auth0Token": "required string",
  "deviceId": "optional",
  "deviceInfo": "optional"
}
```

**Steps**

1. Verify the Auth0 RS256 token with JWKS when Auth0 is configured (`verifyAuth0Token`). Otherwise the token is only decoded.
2. Require `sub`.
3. Read role from `https://drivewize.com/role`, otherwise `role`.
4. If role is `driver`, load `drivers` by `auth0_id = sub` (`driverUtils.findByAuth0Id`).
5. If no row matches, return **404** `NOT_FOUND` / `User not found in database`.
6. If `drivers.account_status` is `deactivated`, return **403** `ACCOUNT_DEACTIVATED`.
7. Issue a backend HS256 session JWT (`userId`, `auth0Id`, `email`, `name`, `role`, `userType`, `sessionId`) and store a `sessions` row.
8. For drivers, replace the single active device/session (`active_session_id`, `active_device_id`, `last_login_at`).

There is no email fallback and no just-in-time insert. An Auth0 user with role `driver` and no `drivers` row cannot exchange a token. An Auth0 user whose token has no driver role is also not loaded as a driver (the lookup runs only when the claim is `driver`, `customer`, `admin`, or `super_admin`).

`POST /api/auth/login` must not be used as the registration call. It only exchanges a token for a person who already has a `drivers` row.

### 2.2 How role is established

| Layer | What it stores |
| --- | --- |
| Auth0 user | `app_metadata.role = 'driver'` plus Auth0 role `Driver` / `driver` |
| Access token | Custom claim `https://drivewize.com/role` (login). Middleware also accepts `role` and the first entry of `https://drivewize.com/roles`. |
| Database | The row lives in `drivers`. There is no `role` column on `drivers`. `admin_users.role` is a separate table. |

The Auth0 Action that copies `app_metadata.role` or the Auth0 role into `https://drivewize.com/role` is not in this repository. The backend only reads the claim. Admin creation is what puts `app_metadata.role` and the Auth0 role on the user.

Later API calls use the backend session JWT. `extractUserInfo` reads `role` from that token. `requireDriver` allows only `role === 'driver'`. `trackDriverDevice` loads the driver again by `auth0_id` and rejects a missing row (404) or `account_status = deactivated` (403).

### 2.3 Auth0 signup

This repository does not enable or disable Auth0 Universal Login signup. Every driver identity created by this backend is created by the Management API on `Username-Password-Authentication`, with a password supplied by Admin (or, for passengers, by `POST /api/v1/passenger/auth/register`).

Public Auth0 signup is not a supported driver path today:

- Signup would not run `createUser`, so it would not set `app_metadata.role` or the Auth0 `Driver` role unless a separate Auth0 Action did that.
- `POST /api/auth/login` would still 404 until a `drivers` row existed.
- Turning signup on would be an Auth0 tenant change, not a reuse of an existing backend flow.

### 2.4 Passenger pattern (closest existing self-registration)

`POST /api/v1/passenger/auth/register` accepts `email`, `password`, and `name`. It lowercases email, rejects an existing customer, calls `auth0Management.createCustomer` (role `customer`), and inserts `customers`.

That pattern creates the Auth0 user from the backend. It requires a password in the API body. The driver self-registration contract does not include a password, so this endpoint must not be copied as-is.

Passenger login is a separate route (`POST /api/v1/passenger/auth/login`) and also requires a pre-existing customer row for `sub`.

---

## 3. Current DB model and required fields

There is no shared `users` table. Identity is split by role:

| Table | Who |
| --- | --- |
| `drivers` | Drivers. Linked by unique `auth0_id` and unique `email`. |
| `admin_users` | Admins. Linked by unique `auth0_id` and unique `email`. `role` is `admin` or `super_admin`. |
| `customers` | Passengers. Linked by `auth0_id` and unique email. |
| `sessions` | Backend session JWT. `user_id` + `user_type` (`driver`, `admin`, `customer`). |

### `drivers` columns that matter for registration

| Column | Constraint | Admin-create result |
| --- | --- | --- |
| `id` | PK, default UUID | Generated |
| `auth0_id` | `NOT NULL`, unique | Auth0 `user_id`. A driver row cannot be inserted without it. |
| `email` | `NOT NULL`, unique (`drivers_email_unique`) | As submitted. Unique index is case-sensitive. |
| `name` | `NOT NULL` | Required |
| `phone` | nullable `varchar(50)` | Optional. No unique index. |
| `status` | `NOT NULL`, default `'offline'` | Duty availability: `offline`, `online`, or `busy`. Set to `offline`. |
| `account_status` | `NOT NULL`, default `'active'` | Login lifecycle. Only `deactivated` is special-cased in code. |
| `vehicle_id` | nullable FK | Unset unless Admin sent `vehicleId` on `POST /api/drivers` or later `PUT`. |
| `vehicle_type`, cab columns | nullable | Unset unless Admin sent them. |
| `qr_code`, `vehicle_qr_code` | nullable unique | Generated strings. Not a fleet vehicle assignment. |
| Stripe columns | defaults | Untouched. Not part of registration. |

`account_status` is a free `varchar(30)` with no check constraint (`0025_driver_profile_account.sql`). Application constants in `src/services/accountStatus.service.ts` are only:

- `active` — login, duty, and dispatch are allowed to proceed to the other gates
- `deactivated` — blocks login, blocks `startDuty`, blocks dispatch eligibility, blocks going online via `PATCH /api/drivers/:id/status`

There is no `pending`, `approved`, `inactive`, or `onboarding` account status in the application.

`drivers.status` is duty availability, not an approval workflow. New drivers start `offline`.

---

## 4. Exact relationship between Auth0 identity and Driver record

```
Auth0 user.user_id  ==  drivers.auth0_id
Auth0 app_metadata.role / Auth0 role Driver  →  token claim https://drivewize.com/role = driver
drivers row existence  →  required before POST /api/auth/login succeeds
```

Match key on login is `sub` → `drivers.auth0_id`. Email on the token is copied into the session JWT and is not used to find the driver.

The same email must not already belong to another `drivers`, `admin_users`, or `customers` row. Those tables are separate unique indexes, so the database will not stop the same email from existing once as a passenger and once as a driver. Application code has to reject that. Auth0 itself rejects a second Database-connection user with the same email (`The user already exists`).

---

## 5. Whether Auth0 self-signup can be reused

No. Not as the registration mechanism for this feature.

- Driver creation in this codebase always goes through the Management API.
- Login refuses an Auth0 subject that has no `drivers` row.
- The role claim the login endpoint requires is written today by `createUser` (`app_metadata.role` + Auth0 role assignment), not by a public signup handler in this repo.
- The requested body is only name, email, and phone. Auth0 Universal Login signup collects a password in Auth0 and still leaves the backend row and the driver role uncreated.

Enabling Database signup would be a new Auth0 tenant behavior, plus a second backend step, plus a role-assignment Action. That is a larger change than extending the Management API path the admin flow already uses.

---

## 6. Recommended self-registration architecture

**Use a new backend registration endpoint that creates the Auth0 driver identity (approach B), then let the driver set the password inside Auth0.**

Do not register by calling `POST /api/auth/login`.
Do not add a password field to the driver registration body.
Do not store a password in Postgres.
Do not let the client send vehicle, fleet, cab, category, or role fields.

### Why this fits the current system

Admin driver creation already does: Management API user + `app_metadata.role = driver` + Auth0 role `Driver` + `drivers` insert with `auth0_id`. Login already does: Auth0 token in, backend session out, only if that row exists.

The gap is that Admin currently supplies the password. The self-registration contract does not. Auth0’s Database `create:users` call still requires a password. The existing `sendPasswordResetEmail` path (`dbconnections/change_password`) is how a user sets a password in Auth0 without the backend keeping it.

### Recommended sequence

1. Driver app submits `{ name, email, phone }` to a new public endpoint.
2. Backend normalizes email to lowercase and validates the three fields.
3. Backend rejects the request if that email already exists in `drivers`, `admin_users`, `customers`, or Auth0 (`findUserByEmail`).
4. Backend calls the existing `createUser` with `role: 'driver'` and a one-time random password that is never returned, logged, or stored. The password exists only to satisfy Auth0’s create-user API and must meet Auth0’s password policy.
5. Backend immediately calls the existing `sendPasswordResetEmail` so the driver sets the real password on Auth0’s hosted reset page.
6. Backend inserts `drivers` with `auth0_id`, normalized email, name, phone, `status = 'offline'`, `account_status = 'active'`. It does not set `vehicle_id`, cab fields, fleet membership, or any service category.
7. Generate `qr_code` / `vehicle_qr_code` the same way admin create does, so the row matches today’s driver insert. Those strings are not a car assignment.
8. Driver opens the Auth0 email, sets a password, then uses the existing Driver Universal Login and `POST /api/auth/login`.

`account_status = 'active'` means the account may log in and see a waiting screen. It does not mean the driver is dispatch-ready. Operational readiness stays on the existing fleet, vehicle, and category gates in section 9.

If Auth0 user creation succeeds and the database insert fails, the implementation must delete the Auth0 user (`deleteUser` already exists) so a retry is not stuck on “user already exists”.

### Approaches not recommended

| Approach | Why it is not the smallest safe fit |
| --- | --- |
| A. Auth0 signup first, then a profile call | Signup is not how this backend creates drivers. Login will 404 until a row and a driver role claim exist. That requires Auth0 Dashboard and Action changes this codebase does not contain. |
| C. Reuse `POST /api/drivers` or `POST /api/admin/users` | Both are admin-authenticated and require a password. Both accept vehicle and cab fields the driver must not set. |
| C. Reuse passenger `POST /api/v1/passenger/auth/register` | Creates role `customer` and a `customers` row, and requires a password. |

---

## 7. Proposed API contract

New route, parallel to passenger auth, mounted under `/api/v1`:

`POST /api/v1/driver/auth/register`

Public. No bearer token. Apply the existing `authRateLimiter` (passenger register currently does not; this endpoint should).

**Body (strict).** Reject unknown keys so vehicle, category, fleet, role, and password cannot be smuggled in.

```json
{
  "name": "Amina Rahman",
  "email": "amina@example.com",
  "phone": "+8801712345678"
}
```

| Field | Rule |
| --- | --- |
| `name` | Required, trimmed, 1–255 characters. |
| `email` | Required, valid email, trim + lowercase before uniqueness checks and insert. |
| `phone` | Required, trimmed, max 50 characters. Store the trimmed string. Do not add SMS verification. |

**201 response** (no Auth0 token, no password, no session):

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Amina Rahman",
    "email": "amina@example.com",
    "phone": "+8801712345678",
    "accountStatus": "active",
    "status": "offline",
    "operationalReady": false,
    "nextStep": "password_reset_email_sent"
  }
}
```

`operationalReady` is computed, not a new column: `false` until the driver has an active fleet membership and a dispatch-eligible vehicle path (section 9). The app uses it for the waiting screen after the later login.

**Errors**

| Case | HTTP | Code |
| --- | --- | --- |
| Invalid body | 400 | `VALIDATION_ERROR` |
| Email already on `drivers`, `admin_users`, `customers`, or Auth0 | 409 | `DUPLICATE_EMAIL` |
| Phone already on another driver, if the implementation adds an application check | 409 | `DUPLICATE_PHONE` |
| Auth0 Management API missing | 503 | `AUTH0_NOT_CONFIGURED` |
| Auth0 create or reset-email failure | 502 | `AUTH0_ERROR` |

After the driver sets a password in Auth0, login stays exactly:

`POST /api/auth/login` with `{ auth0Token, deviceId, deviceInfo }`.

Profile the app already has: `GET /api/v1/driver/profile` returns `name`, `email`, `phone`, `accountStatus`, and `vehicleSummary` (null until an active `driver_vehicle_assignments` row exists).

---

## 8. Proposed initial Driver status

Use values the schema and services already understand. Do not add a status.

| Field | Initial value | Meaning |
| --- | --- | --- |
| `drivers.status` | `offline` | Same as admin create. Not on duty. |
| `drivers.account_status` | `active` | Login is allowed. `deactivated` would block login and hide the waiting screen. |
| `vehicle_id` | null | No legacy vehicle. |
| `driver_fleet_memberships` | none | `startDuty` returns `FLEET_MISMATCH`. |
| `driver_vehicle_assignments` | none | No active vehicle for dispatch. |
| `driver_service_categories` | none | Legacy category list stays empty. |
| `vehicle_service_categories` | unchanged | Categories stay on vehicles Admin already configured. Registration does not write this table. |

`active` + `offline` + no fleet + no vehicle is the same operational starting point as an admin-created driver before fleet setup. The waiting period is that incompleteness, not a new lifecycle enum.

`deactivated` is the wrong waiting state: `isDeactivatedAccount` blocks `POST /api/auth/login`, `startDuty`, dispatch, and going online.

A stored `account_status = 'pending'` would not block duty or offers. The column has no check constraint, and every gate treats only `deactivated` as blocked. Adding that string without new checks would look pending and still be operationally `active`.

---

## 9. What blocks an incomplete Driver from duty and dispatch

Registration must not write fleet, vehicle, or category rows. These existing gates then keep the driver out of the market.

### Start Duty — `POST /api/v1/driver/duty/start`

`startDuty` in `src/services/duty.service.ts` requires, in order:

1. Driver row exists.
2. `account_status` is not `deactivated`.
3. An **active** `driver_fleet_memberships` row. Missing membership → `FLEET_MISMATCH` (403).
4. A vehicle QR token whose fleet matches that membership.
5. Vehicle status in `APPROVED_VEHICLE_STATUSES` (`active` or `approved`).
6. No conflicting active assignment.

A self-registered driver with no fleet membership fails at step 3, before any assignment is created. `startDuty` is also what creates `driver_vehicle_assignments` (`assigned_by = 'driver_scan'`) and sets `drivers.vehicle_id` and `status = 'online'`.

### Dispatch eligibility — `checkDriverEligibility`

Used by dispatch before an offer. A driver is ineligible unless all of these pass:

| Gate | Incomplete self-registered driver |
| --- | --- |
| Account not `deactivated` | Passes, because `account_status` is `active`. |
| `drivers.status` (or Redis) is `online` | Fails while they remain `offline` (`DRIVER_NOT_ONLINE`). |
| `QR_DUTY_REQUIRED` | When true, also requires an active duty session and active assignment (`DRIVER_NOT_ON_DUTY`). Default in code is `false` (`src/config/duty.ts`). |
| Resolved vehicle | Active assignment, otherwise legacy `drivers.vehicle_id`. Both empty → `NO_ACTIVE_VEHICLE`. |
| Vehicle status `active` or `approved` | No vehicle → already stopped. |
| `driverServesCategory` exact `serviceCategoryId` | No vehicle categories and no legacy driver categories → `SERVICE_CATEGORY_MISMATCH`. |
| Fresh location inside radius | Never reached. |

Category resolution (`src/services/vehicleEligibility.service.ts`):

1. Active assignment’s `vehicle_service_categories`, if any exist.
2. Otherwise categories on `drivers.vehicle_id`’s vehicle, if any exist.
3. Otherwise legacy `driver_service_categories`.

Empty lists do not match a booking. Registration must not insert either category table.

### Online status is not enough to receive offers

Two existing paths can set `status = 'online'` without a vehicle:

- `PATCH /api/drivers/:id/status` blocks a driver’s own online transition with `assertDriverCanGoOnline` only when `QR_DUTY_REQUIRED` is true.
- Socket events `driver:status` and `driver:go_online` (`src/websocket/handlers/driver-status.ts`) update status for any logged-in driver and do not check fleet, duty, or vehicle.

Even if that driver appears online, dispatch still returns `NO_ACTIVE_VEHICLE` and `SERVICE_CATEGORY_MISMATCH` while vehicle and categories are absent. Offers are not sent. Do not “fix” this by assigning a vehicle during registration.

### Admin setup that later makes them eligible

1. `POST /api/v1/admin/fleet/drivers/:driverId/fleet` with `{ fleetId }` creates an active fleet membership.
2. The fleet vehicle already has, or Admin sets, `vehicle_service_categories` and an approved vehicle status.
3. Admin issues a vehicle QR (`POST /api/v1/admin/fleet/vehicles/:vehicleId/qr/issue`).
4. The driver scans that QR at duty start. That creates the active assignment, sets the driver online, and dispatch matches the booking’s `serviceCategoryId` to that vehicle’s categories.

Until step 1 exists, duty start fails. Until step 4 exists, there is no active assignment. Until the vehicle has the booking’s category, dispatch returns `SERVICE_CATEGORY_MISMATCH`.

---

## 10. Existing Admin vehicle assignment flow

There is no second assignment system to build.

**Current duty model (the one dispatch prefers)**

| Step | API | Effect |
| --- | --- | --- |
| Put the driver in a fleet | `POST /api/v1/admin/fleet/drivers/:driverId/fleet` body `{ fleetId }` | `assignDriverToFleet`. Membership `status = 'active'`. |
| Inspect | `GET /api/v1/admin/fleet/drivers/:driverId/assignment` and `.../duty` | Read-only. |
| Prepare the car | `PATCH /api/v1/admin/fleet/vehicles/:vehicleId` | Vehicle profile, `status` / `approvalStatus`, and `serviceCategoryIds`. |
| Issue the QR the driver scans | `POST /api/v1/admin/fleet/vehicles/:vehicleId/qr/issue` (also rotate / revoke) | Vehicle QR token. |
| Driver goes on duty | `POST /api/v1/driver/duty/start` | Creates `driver_vehicle_assignments` and sets `drivers.vehicle_id`. |

Admin does not pre-create the duty assignment. The assignment is created when the driver scans the vehicle QR, and only after a fleet membership exists.

**Legacy driver columns (still writable, still a dispatch fallback)**

- `POST /api/drivers` and `PUT /api/drivers/:id` can set `vehicleId` and cab fields on the driver row.
- `resolveDispatchVehicle` uses that `vehicle_id` when there is no active assignment.
- `POST /api/drivers/scan-vehicle` only checks that a legacy per-driver `vehicle_qr_code` belongs to that driver. It does not assign a fleet vehicle.

Self-registration must leave `vehicle_id` null and must not call fleet assign. Admin keeps using the fleet + vehicle QR + duty-start path above.

---

## 11. Existing Admin category assignment flow

Dispatch matches the booking’s exact `serviceCategoryId` to the **vehicle’s** `vehicle_service_categories` once the driver has that vehicle (active assignment, or legacy `drivers.vehicle_id` if the vehicle has categories).

**Authoritative admin API**

`PATCH /api/v1/admin/fleet/vehicles/:vehicleId`

```json
{ "serviceCategoryIds": ["uuid", "uuid"] }
```

`updateAdminFleetVehicle` replaces the vehicle’s category set, source `admin_update`. The first category inserted for a vehicle with no existing rows is marked `is_primary`. Primary is not the match key. Match is exact category id membership.

Vehicle status must be `active` or `approved` or duty start and dispatch reject the vehicle (`VEHICLE_NOT_APPROVED`).

**Legacy driver categories (fallback only)**

| API | Table |
| --- | --- |
| `POST /api/v1/admin/driver-service-categories` body `{ driverId, serviceCategoryId, isPrimary? }` | `driver_service_categories` |
| `GET /api/v1/admin/drivers/:driverId/service-categories` | list |
| `DELETE /api/v1/admin/drivers/:driverId/service-categories/:categoryId` | remove |
| `GET /api/v1/admin/service-categories` | canonical category catalog |

`driverServesCategory` uses `driver_service_categories` only when the resolved vehicle has **no** `vehicle_service_categories`. Do not assign driver categories during self-registration, and do not add a third assignment table. Admin continues to put Economy / Executive / SUV / Van / Mini-Van / ADA on the vehicle.

---

## 12. Admin gaps

No Admin UI change is required for the backend design. After implementation, a self-registered driver is a normal `drivers` row.

**Already exists**

| Need | Existing capability |
| --- | --- |
| Driver appears in lists | `GET /api/drivers` and `GET /api/admin/users` return every driver, including `accountStatus`, `status`, `phone`, and `vehicleId`. Search matches name and email (`ilike`). |
| Edit name, phone, legacy cab / `vehicleId` | `PUT /api/drivers/:id` |
| Assign fleet | `POST /api/v1/admin/fleet/drivers/:driverId/fleet` |
| Assign categories on the car | `PATCH /api/v1/admin/fleet/vehicles/:vehicleId` `serviceCategoryIds` |
| Issue the QR used at duty start | Fleet vehicle QR issue/rotate |
| Deactivate | Existing account deactivation (`account_status = deactivated`) blocks login, duty, and dispatch |
| Password help | `POST /api/admin/users/:id/reset-password` already sends the Auth0 reset email |

**Not a separate “approve” switch**

There is no approve endpoint. Operational approval is: fleet membership + an approved vehicle that has the right categories + the driver scanning that vehicle’s QR. `account_status = 'active'` will already be set at registration so they can log in. Admin should not have to flip a new status before that setup.

**Visibility gap (optional, not a blocker)**

`GET /api/admin/users` and `GET /api/drivers` do not include fleet membership or category coverage. A self-registered driver looks like any other offline driver with `accountStatus: "active"` and `vehicleId: null`. Admin can already open fleet assignment and see no membership (`GET .../drivers/:driverId/duty`). A dedicated “waiting for setup” badge would be a later Admin display of those existing relations. It does not require a new status or a migration.

`GET /api/drivers` can filter `status` only as `online` or `offline`, not by account lifecycle.

---

## 13. Android / iOS changes that will eventually be required

No app work in this audit. Android remains the product/behavior source when the UI is built. Both apps need the same backend contract.

**Flow derived from this backend**

1. Existing Login stays Auth0 Universal Login, then `POST /api/auth/login`.
2. New Create Account screen collects only name, email, and phone.
3. App calls `POST /api/v1/driver/auth/register`.
4. App shows that a password email was sent. The driver sets the password on Auth0’s hosted page (`dbconnections/change_password`), the same mechanism as forgot-password.
5. Driver returns to existing Login.
6. After login, if `operationalReady` is false (or profile `vehicleSummary` is null and duty start returns `FLEET_MISMATCH`), show a waiting state: account created, Admin still has to assign the fleet and vehicle.
7. When Admin has assigned the fleet and a categorized vehicle, the existing Start Duty / QR scan flow is unchanged.
8. The create-account screen must not offer vehicle, plate, category, fleet, or duty choices.

The apps must not send the registration payload to `POST /api/auth/login` or to `POST /api/drivers`.

---

## 14. Duplicate / security handling

| Case | Current behavior | Required handling |
| --- | --- | --- |
| Duplicate driver email | Unique index + exact `findByEmail` on `POST /api/drivers` → 409 | Lowercase first, then reject if a driver email matches case-insensitively. |
| Case-insensitive email | Unique index is case-sensitive. `Driver@x.com` and `driver@x.com` can both insert today. Passenger register already lowercases. | Store lowercase. Also `ilike` check before insert so an older mixed-case row still collides. |
| Duplicate phone | No unique index. Admin may store duplicates or `''`. Profile update can store E.164 when the app sends `{ countryCode, number }`. | Reject a second driver with the same trimmed phone at registration time (application check). No SMS verification. |
| Existing Auth0 user | `createUser` fails with “The user already exists”. | Call `findUserByEmail` first. Return 409. Do not attach a passenger or admin Auth0 user to a new driver row. |
| Existing backend driver | 409 on `POST /api/drivers` | 409 on the new endpoint. Repeat registration is the same 409. |
| Existing passenger or admin email | Not checked by driver create | Reject. Separate unique indexes would otherwise allow a second row, and Auth0 would reject the second login identity anyway. |
| Role | Client must not choose it | Endpoint hardcodes `role: 'driver'`. Ignore any role field by using a strict schema. |
| Password | Admin endpoints require one | Registration body has none. Random Auth0 password is not returned. Driver sets the password in Auth0. |
| Unknown Auth0 driver calling login | 404 | Leave that behavior. Registration creates the row before they can log in. |
| Abuse | `authRateLimiter` is on `POST /api/auth/login`. Global limiter covers other routes. Passenger register has no dedicated limiter. | Put the new route on `authRateLimiter`. No new limiter and no new verification product. |

`auth0_id` stays the login key. Email uniqueness is the registration key.

---

## 15. Database migration required: NO

Reasons:

- `drivers` already has `name`, `email`, `phone`, `auth0_id`, `status` default `offline`, and `account_status` default `active`.
- Fleet, vehicle assignment, and both category tables already exist and must stay empty for a new self-registered driver.
- No new status value is required. `pending` is not enforced by current gates.
- Phone uniqueness for this feature can be an application check against the existing `phone` column. A unique index would be a later product choice, not a requirement to keep an incomplete driver out of dispatch.
- Case-insensitive email safety is “lowercase on write + `ilike` lookup”. A `citext` or expression unique index is optional hardening, not required for the first implementation.

---

## 16. Exact files that would need modification

Implementation later. Not part of this audit.

| File | Change |
| --- | --- |
| `src/validators/index.ts` | Strict `driverSelfRegisterSchema` for `name`, `email`, `phone` only. |
| `src/services/driverRegistration.service.ts` | New. Duplicate checks, Auth0 create, reset email, driver insert, Auth0 rollback on DB failure. |
| `src/services/auth0Management.ts` | Reuse `createUser`, `findUserByEmail`, `sendPasswordResetEmail`, `deleteUser`. Touch only if a small helper is required so the temporary password is not logged (`createUser` currently logs email, name, and role, not the password). |
| `src/routes/v1/driver/auth.ts` | New `POST /register`, `authRateLimiter`. |
| `src/routes/v1/index.ts` | `router.use('/driver/auth', ...)`. |
| `src/controllers/driverAuth.controller.ts` | Thin handler, same style as `passengerAuth.controller.ts`. |
| `tests/driver-self-registration.test.ts` | New. Duplicate email, no vehicle/fleet/category writes, login still 404 without a row, duty `FLEET_MISMATCH` for the new row. |
| `src/services/profile.service.ts` | Optional computed `operationalReady` on `GET /api/v1/driver/profile` so the waiting screen is explicit. |

**Do not modify for this feature**

- `src/services/dispatch.service.ts`
- `src/services/driverAvailability.service.ts` matching rules
- `src/services/vehicleEligibility.service.ts`
- `src/services/duty.service.ts` assignment rules
- Passenger auth, booking, payment, Stripe, payouts, DVR, Socket.IO, FCM, market fares
- Admin UI and driver apps (separate later work)
- Auth0 Dashboard, in the backend implementation itself

`POST /api/drivers` and `POST /api/admin/users` stay the admin creation APIs.

---

## 17. Smallest implementation sequence

1. Add the strict register schema and `POST /api/v1/driver/auth/register` behind `authRateLimiter`.
2. Normalize email to lowercase. Reject duplicates in `drivers`, `admin_users`, `customers`, and Auth0. Reject a duplicate driver phone by query.
3. Create the Auth0 user with `role: 'driver'` using the existing Management API helper and a random password that is never stored or returned. Send the existing Auth0 password-reset email. Insert `drivers` (`offline`, `active`, no `vehicle_id`). Generate the same QR identifier strings admin create generates. Roll back the Auth0 user if the insert fails.
4. Add tests that the new row has no fleet membership, no assignment, and no category rows, and that `startDuty` fails with `FLEET_MISMATCH`.
5. Optionally expose computed `operationalReady: false` on the driver profile.
6. Leave login, dispatch, and category matching unchanged.
7. Admin uses existing fleet assign, vehicle category patch, and vehicle QR issue. No new admin API.
8. Android, then iOS: Create Account (name, email, phone) → register → Auth0 set-password email → existing login → waiting screen until fleet and vehicle setup exist.

---

## FINAL STATUS

DRIVER SELF-REGISTRATION AUDIT COMPLETE — IMPLEMENTATION PLAN READY
