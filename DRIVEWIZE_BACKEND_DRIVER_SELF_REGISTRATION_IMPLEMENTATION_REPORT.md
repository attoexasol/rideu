# DRIVEWIZE BACKEND — DRIVER SELF-REGISTRATION IMPLEMENTATION REPORT

## 1. Endpoint implemented

`POST /api/v1/driver/auth/register`

Public. No Bearer token. Uses the existing `authRateLimiter` (disabled automatically when `NODE_ENV=test` unless `RATE_LIMIT_ENABLED=true`).

Mounted from `src/routes/v1/driver/auth.ts` through `src/routes/v1/index.ts` (`/api/v1` + `/driver/auth`).

`POST /api/auth/login`, `POST /api/drivers`, and `POST /api/admin/users` are unchanged.

## 2. Exact request contract

Strict JSON body. Unknown keys are rejected with `400 VALIDATION_ERROR`.

```json
{
  "name": "Amina Rahman",
  "email": "amina@example.com",
  "phone": "+8801712345678"
}
```

| Field | Rules |
| --- | --- |
| `name` | Required. Trimmed. 1–255 characters. |
| `email` | Required. Valid email. Trimmed, then lowercased before duplicate checks and storage. |
| `phone` | Required. Trimmed. 1–50 characters. No SMS verification. |

Rejected examples: `password`, `role`, `vehicleId`, `serviceCategoryId`, `fleetId`, `cabNumber`, and any other key.

## 3. Exact success and error contract

Success is HTTP **201**. No password, Auth0 token, or backend session JWT.

```json
{
  "success": true,
  "data": {
    "id": "<driver uuid>",
    "name": "Amina Rahman",
    "email": "amina@example.com",
    "phone": "+8801712345678",
    "accountStatus": "active",
    "status": "offline",
    "nextStep": "password_reset_email_sent"
  }
}
```

`operationalReady` is not included.

Errors use the existing envelope: `{ success: false, error: { code, message } }`.

| HTTP | Code | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Invalid or unknown body fields. |
| 409 | `DUPLICATE_EMAIL` | Email already exists on a driver, admin, passenger, or Auth0 user. An existing Auth0 identity is not attached to a new driver. |
| 409 | `DUPLICATE_PHONE` | Another driver already has the same trimmed phone. |
| 503 | `AUTH0_NOT_CONFIGURED` | Management API env vars are missing. No Auth0 user is created. |
| 502 | `AUTH0_ERROR` | Auth0 email lookup or user creation failed. Message is generic. |
| 502 | `PASSWORD_RESET_EMAIL_FAILED` | Auth0 user and driver row were created, then the set-password email could not be sent. Response is not success. See rollback below. |
| 500 | `REGISTRATION_FAILED` | Driver insert or QR identifier generation failed after Auth0 create. Auth0 user is deleted when that delete succeeds. |

Auth0 response bodies and the temporary password are not returned.

## 4. Auth0 creation flow

1. Validate and normalize.
2. Case-insensitive email check on `drivers`, `admin_users`, and `customers`.
3. Trimmed phone check on `drivers`.
4. Require `auth0Management.isConfigured()`.
5. `findUserByEmail`. A hit returns `409 DUPLICATE_EMAIL` and does not call create.
6. `auth0Management.createUser({ email, password, name, role: 'driver' })`.
7. Existing helper behavior is unchanged: connection `Username-Password-Authentication`, `app_metadata.role = driver`, Auth0 role `Driver` / `driver`, `email_verified` left false.
8. Insert the `drivers` row.
9. Generate `qr_code` and `vehicle_qr_code` with `generateUniqueDriverQrCode` and `ensureDriverVehicleQrCode`.
10. `sendPasswordResetEmail(normalizedEmail)` so the driver sets the password on Auth0’s hosted page.

Public Auth0 signup is not enabled by this change.

## 5. Temporary password handling

`crypto.randomInt` builds a 32-character password with lowercase, uppercase, digits, and symbols so it satisfies Auth0’s usual “good” database policy (at least 8 characters and all four character classes).

That password is passed only into `createUser`. It is not stored in Postgres, not placed on the HTTP response, and not written to logs. The existing `createUser` logger still redacts `password` as `***`.

The driver never receives it. They set their real password from the Auth0 email.

## 6. Password-reset email flow

After the driver row exists, the endpoint calls the existing `sendPasswordResetEmail`, which posts to Auth0 `POST /dbconnections/change_password` on `Username-Password-Authentication`.

The 201 body sets `nextStep` to `password_reset_email_sent`. The app should tell the driver to check email and set a password, then use the existing Universal Login and `POST /api/auth/login`.

Login still requires a pre-existing `drivers` row matched by Auth0 `sub`. This endpoint creates that row before the email is sent. Login was not modified.

## 7. Rollback behavior

| Failure | Result |
| --- | --- |
| Duplicate found before Auth0 create | No Auth0 user. `409`. |
| Auth0 create fails | No driver row. `409` if Auth0 reports the user already exists, otherwise `502 AUTH0_ERROR`. |
| QR generation fails before insert | `deleteUser` on the new Auth0 id. `500 REGISTRATION_FAILED`. |
| Driver insert fails | `deleteUser` on the new Auth0 id. If that delete also fails, the Auth0 user may remain and the error is logged with `auth0Id`. Response is still not 201. Unique-constraint races return `409 DUPLICATE_EMAIL`. Other insert failures return `500 REGISTRATION_FAILED`. |
| `ensureDriverVehicleQrCode` fails after insert | Delete the driver row. If that succeeds, delete the Auth0 user. `500 REGISTRATION_FAILED`. |
| Set-password email fails | Not a 201. `502 PASSWORD_RESET_EMAIL_FAILED` with message `Unable to send the password setup email. Registration was not completed.` |

Set-password email rollback, in order:

1. Delete the new `drivers` row.
2. Only if that delete succeeds, `deleteUser` the new Auth0 identity.
3. If both deletes succeed, the driver can retry registration.
4. If the driver-row delete fails, the Auth0 user is **not** deleted. The pair stays together. The API still returns 502, not 201. A retry then returns `409 DUPLICATE_EMAIL`. An admin can send the existing reset email with `POST /api/admin/users/:id/reset-password`.
5. If the driver row is deleted and the Auth0 delete fails, the Auth0 user can remain without a driver row. That case is logged. Response is still 502.

A persisted driver/Auth0 pair is not deleted on one side only when the driver delete fails.

## 8. Duplicate handling

Email is stored lowercase.

Lookups use `lower(email) = normalized` on `drivers`, `admin_users`, and `customers`, so an older mixed-case row still collides.

Auth0 `users-by-email` is checked before create. An existing passenger or admin Auth0 user is rejected. It is not linked to a new driver.

Phone uses `trim(drivers.phone) = trimmed phone`. No migration and no unique phone constraint. A second driver with the same trimmed phone gets `409 DUPLICATE_PHONE`.

## 9. Driver initial DB state

| Column | Value |
| --- | --- |
| `auth0_id` | New Auth0 `user_id` |
| `email` | Lowercased email |
| `name` | Trimmed name |
| `phone` | Trimmed phone |
| `status` | `offline` |
| `account_status` | `active` |
| `qr_code` | Generated identifier |
| `vehicle_qr_code` | Generated identifier (not a fleet vehicle) |
| `vehicle_id` | null (column omitted on insert) |

`account_status = active` allows login after the driver sets a password. It does not make the driver dispatch-ready.

## 10. Confirmation: no fleet, vehicle, or category assignment

Registration does not read or write:

- `driver_fleet_memberships`
- `driver_vehicle_assignments`
- `driver_service_categories`
- `vehicle_service_categories`

It does not set `vehicle_id`, `vehicle_type`, cab fields, fleet, or service category.

`startDuty` is unchanged. With no fleet membership it still throws `FLEET_MISMATCH` (403) before creating an assignment.

Dispatch and category matching were not modified. An offline driver with no vehicle and no categories is not offer-eligible under the existing gates.

## 11. Files changed

| File | Change |
| --- | --- |
| `src/validators/index.ts` | Added strict `driverSelfRegisterSchema`. |
| `src/services/driverRegistration.service.ts` | New registration service. |
| `src/controllers/driverAuth.controller.ts` | New handler. |
| `src/routes/v1/driver/auth.ts` | New public route. |
| `src/routes/v1/index.ts` | Mounted `/driver/auth`. |
| `tests/driver-self-registration.test.ts` | New tests. |
| `DRIVEWIZE_BACKEND_DRIVER_SELF_REGISTRATION_IMPLEMENTATION_REPORT.md` | This report. |

`src/services/auth0Management.ts` was not modified.

## 12. Tests and results

Command:

```text
npx jest tests/driver-self-registration.test.ts --runInBand --no-coverage --forceExit
```

Result: **20 passed, 0 failed.**

Covered:

1. Valid registration and 201 body
2. Only name, email, and phone accepted
3. Email stored lowercase
4. Duplicate driver email
5. Mixed-case duplicate email (`lower(...)` lookup)
6. Admin email collision
7. Passenger email collision
8. Existing Auth0 email, create not called
9. Duplicate driver phone
10. `password` rejected
11. `role` rejected
12. `vehicleId`, `serviceCategoryId`, `fleetId`, `cabNumber` rejected
13. Insert is `offline` + `account_status = active`
14. Insert has no `vehicleId`
15. Service does not reference fleet membership
16. Service does not reference vehicle assignments
17. Service does not reference driver categories
18. Service does not reference vehicle categories; insert target is only `drivers`
19. `sendPasswordResetEmail` called with the normalized email; temporary password absent from the response and from logs
20. Auth0 `deleteUser` when insert fails; password-email failure returns 502 and rolls back both records; Auth0 user is kept if the driver delete fails
21. `POST /api/auth/login` source still returns 404 when no driver row exists and does not call registration
22. `startDuty` still rejects a driver with no fleet membership as `FLEET_MISMATCH`

## 13. Auth0 configuration prerequisite

No Dashboard change is made by this implementation. Signup stays whatever it is today. Do not enable public Database signup for this feature.

Runtime prerequisites, already used by Admin driver create and password reset:

- `AUTH0_DOMAIN`
- `AUTH0_MANAGEMENT_CLIENT_ID`
- `AUTH0_MANAGEMENT_CLIENT_SECRET`
- Management scopes already required for create/delete/roles, plus `read:users` for `GET /api/v2/users-by-email` (same lookup `sendPasswordResetEmail` already uses)
- Auth0 role named `Driver` or `driver`
- Database connection `Username-Password-Authentication`
- A password-reset client: `AUTH0_PASSWORD_RESET_CLIENT_ID` or `AUTH0_CLIENT_ID` (fallback `AUTH0_PASSENGER_CLIENT_ID` / `AUTH0_NATIVE_CLIENT_ID`). That client must allow `Username-Password-Authentication`, or `change_password` returns 404 and registration responds `502 PASSWORD_RESET_EMAIL_FAILED`
- Auth0 password policy must accept a 32-character password that contains upper, lower, digit, and symbol characters

If Management API credentials are missing, the endpoint returns `503 AUTH0_NOT_CONFIGURED` and creates nothing.

## 14. Exact curl example for QA

```bash
curl -sS -X POST "https://<API_HOST>/api/v1/driver/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Amina Rahman\",\"email\":\"amina@example.com\",\"phone\":\"+8801712345678\"}"
```

Expected: HTTP 201 and the JSON in section 3. Then the Auth0 change-password email arrives. After the driver sets a password, existing Driver login (`POST /api/auth/login` with an Auth0 token) should succeed. `POST /api/v1/driver/duty/start` should return `FLEET_MISMATCH` until an admin assigns a fleet.

## 15. Exact expected DB state after QA registration

`drivers` row:

- `email` = `amina@example.com`
- `name` = `Amina Rahman`
- `phone` = `+8801712345678`
- `auth0_id` = the new Auth0 user id (`auth0|...`)
- `status` = `offline`
- `account_status` = `active`
- `vehicle_id` is null
- `vehicle_type` and cab/make/model/year/color columns are null
- `qr_code` and `vehicle_qr_code` are non-null generated strings

No new rows for that driver in:

- `driver_fleet_memberships`
- `driver_vehicle_assignments`
- `driver_service_categories`

`vehicle_service_categories` is unchanged.

No password column is written. The Auth0 user exists on `Username-Password-Authentication` with role driver, and the driver must set the password from the email before login.

---

DRIVER SELF-REGISTRATION BACKEND IMPLEMENTED — QA REQUIRED
