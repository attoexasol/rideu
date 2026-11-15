# DRIVEWIZE BACKEND — DRIVER SELF-REGISTRATION PASSWORD UPDATE

`POST /api/v1/driver/auth/register` now takes the driver's password. Registration no longer creates a temporary password and no longer sends an Auth0 password-reset email.

## 1. New exact request contract

Public. No Driver JWT. Strict body. Unknown keys return `400 VALIDATION_ERROR` and are not sent to Auth0.

```json
{
  "name": "Amina Rahman",
  "email": "amina@example.com",
  "phone": "+8801712345678",
  "password": "ExamplePassword123!",
  "confirmPassword": "ExamplePassword123!"
}
```

| Field | Rules |
| --- | --- |
| `name` | Required. Trimmed. 1–255 characters. |
| `email` | Required. Valid email. Trimmed, then lowercased before duplicate checks and storage. |
| `phone` | Required. Trimmed. 1–50 characters. |
| `password` | Required. At least 8 characters. Not trimmed. |
| `confirmPassword` | Required. Must exactly equal `password`. Used only for validation. |

## 2. Password validation

Local rule matches existing Admin driver creation and passenger registration: `password` must be a string of at least 8 characters (`createDriverSchema` and `passengerRegisterSchema`).

Auth0 remains the password-policy authority. If `createUser` rejects the password, the endpoint maps the same Auth0 cases Admin already maps, as `400 VALIDATION_ERROR`, without echoing the password:

- too weak (at least 8 characters and 3 of lowercase, uppercase, numbers, special characters)
- contains the user's name or email
- too common
- used recently

A short password never reaches Auth0.

## 3. Confirm-password validation

`confirmPassword` must be present and exactly equal `password`. A mismatch returns `400 VALIDATION_ERROR` with message `Passwords do not match`. Auth0 is not called.

## 4. Auth0 password handling

The driver-supplied `password` is passed only to the existing helper:

```ts
auth0Management.createUser({
  email,
  password,
  name,
  role: 'driver',
})
```

That helper is unchanged: `Username-Password-Authentication`, `app_metadata.role = driver`, and the Auth0 `Driver` role. `confirmPassword` is not an argument. Public Auth0 signup is not enabled. The backend does not issue a session or verify the password itself. Later login stays `POST /api/auth/login` with an Auth0 token.

## 5. Passwords are not persisted, logged, or returned

- `drivers` insert fields are `auth0Id`, `email`, `name`, `phone`, `status`, `accountStatus`, and `qrCode`.
- The 201 body has no `password` or `confirmPassword`.
- Registration logs do not include either value. Auth0 password-policy failures are logged as a fixed message, not the Auth0 body.
- QR generation and the session login path are unchanged and do not receive the password.

`confirmPassword` is dropped after the schema check. Only `password` is forwarded to Auth0.

## 6. Removal of temporary-password generation

`generateTemporaryPassword` and the `crypto.randomInt` generator were removed from `driverRegistration.service.ts`.

## 7. Removal of registration-time reset-email flow

Successful registration does not call `sendPasswordResetEmail`. `PASSWORD_RESET_EMAIL_FAILED` and the registration-only rollback that deleted the driver and Auth0 user after a failed reset email were removed.

`auth0Management.sendPasswordResetEmail` is still in place for Admin reset and other existing forgot-password flows.

## 8. New success response

HTTP 201. No JWT and no automatic login.

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
    "nextStep": "login"
  }
}
```

`nextStep` changed from `password_reset_email_sent` to `login`.

Duplicate responses are unchanged: `409 DUPLICATE_EMAIL` and `409 DUPLICATE_PHONE`, including case-insensitive email checks and the Auth0 email lookup.

## 9. Rollback behavior

Unchanged for a failed driver record:

- Auth0 user created, then QR generation or the `drivers` insert fails: `deleteUser` removes that new Auth0 identity. Response is not 201.
- Vehicle-QR identifier generation fails after the row exists: the driver row is deleted, and the Auth0 user is deleted only if that row delete succeeds.

There is no password-email rollback step.

Initial state is unchanged: `status = offline`, `account_status = active`, `vehicle_id` null, and no fleet membership, vehicle assignment, or service-category rows. `startDuty` still returns `FLEET_MISMATCH` until an admin assigns a fleet.

## 10. Files changed

| File | Change |
| --- | --- |
| `src/validators/index.ts` | `password` and `confirmPassword` on the strict register schema. |
| `src/services/driverRegistration.service.ts` | Driver password sent to Auth0. Temporary password and reset email removed. `nextStep` is `login`. |
| `tests/driver-self-registration.test.ts` | Updated contract tests. |
| `DRIVEWIZE_BACKEND_DRIVER_SELF_REGISTRATION_PASSWORD_UPDATE_REPORT.md` | This report. |

`src/services/auth0Management.ts`, login, Admin creation, Passenger registration, duty, and dispatch were not modified.

## 11. Targeted tests and results

```text
npx jest tests/driver-self-registration.test.ts --runInBand --no-coverage --forceExit
```

**21 passed, 0 failed.**

Covered: five-field registration, strict schema, password required, confirmPassword required, mismatch, password shorter than 8 characters, the supplied password passed to `createUser`, `confirmPassword` not passed to Auth0, neither value stored or returned or logged, no reset email, `nextStep = login`, duplicate email, duplicate phone, Auth0 rollback when insert fails, offline/active with no vehicle, no fleet/vehicle/category writes, and `startDuty` still `FLEET_MISMATCH`.

## 12. Exact curl example

```bash
curl -sS -X POST "https://<API_HOST>/api/v1/driver/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Amina Rahman\",\"email\":\"amina@example.com\",\"phone\":\"+8801712345678\",\"password\":\"ExamplePassword123!\",\"confirmPassword\":\"ExamplePassword123!\"}"
```

Expected: HTTP 201 with `nextStep` `login`. No set-password email. The driver then uses existing Auth0 login and `POST /api/auth/login`. Duty start stays `FLEET_MISMATCH` until admin fleet setup.

## 13. Android and iOS contract changes required next

Both Driver apps need a registration form with name, email, phone, password, and confirm password. Submit those five fields to `POST /api/v1/driver/auth/register`. Do not send a Bearer token.

After 201, show that the account was created and send the driver to the existing login screen. Do not wait for a password-reset email. `nextStep` is `login`.

The password typed in the app is the Auth0 password. Login is still Auth0 Universal Login, then `POST /api/auth/login`. This endpoint does not return a session.

Keep the waiting state after login: the driver is offline, with no vehicle, until Admin assigns a fleet and vehicle. Mismatched or short passwords are `400 VALIDATION_ERROR` and should be shown on the form. `409 DUPLICATE_EMAIL` and `409 DUPLICATE_PHONE` stay as they are.

---

DRIVER SELF-REGISTRATION PASSWORD CONTRACT IMPLEMENTED — APP UPDATES REQUIRED
