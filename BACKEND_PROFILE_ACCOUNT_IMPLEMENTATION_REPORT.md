# Backend Profile / Account Implementation Report

**Date:** 2026-08-19  
**Phase:** Driver and Passenger profile foundation (no email change, password change, OTP, or KYC)

## Status

**READY FOR DRIVER AND PASSENGER PROFILE INTEGRATION**

Verified:

- `npm run db:migrate` — applied `0025_driver_profile_account`
- `npm run build` — TypeScript compile succeeded
- `npx jest --maxWorkers=2` — 46 suites, 422 tests passed

## What shipped

### Database

Migration `src/db/migrations/0025_driver_profile_account.sql` (journal idx 24):

- `drivers.profile_image_url` varchar(500) nullable
- `drivers.account_status` varchar(30) NOT NULL DEFAULT `active`
- indexes on `drivers.account_status` and `customers.status`

Duty `drivers.status` (`online` / `offline` / `busy`) is unchanged. Deactivation uses `account_status` for drivers and existing `customers.status` for passengers.

### APIs

| Method | Path |
|---|---|
| GET/PATCH | `/api/v1/driver/profile` |
| POST/DELETE | `/api/v1/driver/profile/avatar` |
| POST | `/api/v1/driver/profile/deactivate` |
| GET/PATCH | `/api/v1/passenger/profile` |
| POST/DELETE | `/api/v1/passenger/profile/avatar` |
| POST | `/api/v1/passenger/profile/deactivate` |
| GET | `/api/v1/admin/passengers` |
| GET | `/api/v1/admin/passengers/:id` |

Contract: `PROFILE_ACCOUNT_API_CONTRACT.md`

### Behavior

- Clean DTOs (no auth0Id, session/device, QR, cab, FCM).
- Strict Zod PATCH allowlist: `name`, `phone` only.
- Name: Auth0 Management `updateUserName` **then** Postgres. Failure leaves DB unchanged. Scope: `update:users`.
- Email read-only. No local password tables or change-password API.
- Phone optional/contact-only, not verified, not unique, not used in login, not added to ride offers.
- Avatars: `uploads/avatars/{drivers|passengers}/`, JPEG/PNG/WebP, 5 MB, magic bytes, sharp re-encode to JPEG max 1280px. Not ride-video `private-media`.
- Soft-deactivate: sessions cleared, driver FCM invalidated, bookings/videos/history preserved. Login returns `403 ACCOUNT_DEACTIVATED`.
- Driver deactivation with an active ride does **not** call `endDuty` (trip can finish). New dispatch is blocked via eligibility + login guard. After a ride, `releaseDriverAvailability` will not put a deactivated driver online.
- Existing logout routes unchanged.

### Admin

- Driver list/user management include `profileImageUrl` and `accountStatus`.
- Minimal read-only passenger list/detail APIs added. No passenger write/delete module.

### Rate limits (new buckets, not video-upload)

- Profile PATCH
- Avatar upload (10/hour production)
- Deactivate (very strict)

## Auth0

Name PATCH requires Management API credentials plus **`update:users`**. Email is not modified. Auth0 users are not deleted or blocked in this phase.

## Tests added

- `tests/profile-validators.test.ts`
- `tests/profile-dto.test.ts`
- `tests/avatar-storage.test.ts`
- `tests/account-status.test.ts`
- `tests/profile-routes.test.ts`
- `tests/profile-name-auth0.test.ts`
- `tests/profile-deactivate.test.ts`
- `tests/profile-login-guard.test.ts`
- `tests/profile-regression.contract.test.ts`

Existing FCM fixture `makeDriver` and legacy cab migration driver factory were updated with the new columns so those suites still typecheck.

## Out of scope (still)

- Email change
- Logged-in password change / driver forgot-password
- Phone OTP
- Driver licence / NID / KYC / approval
- Hard delete
- Passenger self-service on leftover JWTs besides login + profile (same as existing passenger logout JWT semantics)

## Notes

- `sharp` added for avatar re-encode.
- Jest `maxWorkers: 2` to avoid Windows OOM when many suites load Redis/Firebase/sharp.
- `tsconfig.json` excludes two pre-existing live-verify scripts that import missing `socket.io-client`, so `npm run build` succeeds. Those scripts are unchanged and still runnable via `tsx`.
