# Backend Profile / Account Management Audit

**Date:** 2026-08-19  
**Mode:** Audit only — no code was modified.  
**Scope:** Driver and Passenger (customer) profile view/edit, photo, identity fields, password/security, logout, account deletion/deactivation, admin visibility.

**Final status:** `AUDIT COMPLETE — PROFILE GAPS: no self-serve profile write APIs, no avatar pipeline, Auth0-owned identity cannot be edited in DB, hard-delete is unsafe, passenger Admin list is missing`

---

## How to read this report

- **Invented fields are not listed.** If a requested field (firstName, dateOfBirth, gender, emergency contact, driver license, NID/passport, `driver_documents`, `users`, `profiles`) does not exist in schema or code, it is marked **MISSING**.
- Identity is split across **Auth0** (credentials + `auth0_id`) and **Postgres** (`drivers`, `customers`, `admin_users`). There is no unified `users` table.
- Working core flows (login/session/device, duty, FCM, ride history, video, vehicle exchange, admin dashboard) must not be reused or rewritten for profile work. Logout must call the existing logout paths.

---

## 1. Current user / driver / passenger schema

### 1.1 Tables that exist vs requested

| Requested | Actual | Notes |
|---|---|---|
| `users` | **Does not exist** | Identity is three tables: `drivers`, `customers`, `admin_users`. |
| `drivers` | **Exists** | Operational + account row. `status` is duty (`online`/`offline`), not approval. |
| `customers` / passengers | **`customers` exists** | Passenger app uses this table. No `passengers` table. |
| `profiles` | **Does not exist** | Profile columns live on `drivers` / `customers`. |
| `driver_documents` | **Does not exist** | No license/NID/passport/document store. |
| `vehicles` | **Exists** | Fleet-owned. Not a driver profile table. |
| `sessions` | **Exists** | Polymorphic `user_id` + `user_type`. **No FK.** |
| Auth / device state | On **`drivers`** and **`customers`** | `active_session_id`, `active_device_id`, `active_device_info`, `last_login_at`. Drivers also have `driver_push_tokens`. |

### 1.2 `drivers`

Source: `src/db/schema/drivers.ts`.

| Field | Column | Type | Nullable | Editable? | Used elsewhere |
|---|---|---|---|---|---|
| `id` | `id` | uuid PK | no | **immutable** | Bookings, duty, video, FCM, assignments, trips |
| `auth0Id` | `auth0_id` | varchar(255) unique | no | **immutable** (Auth0 identity) | Login, JWT, sockets, admin delete |
| `email` | `email` | varchar(255) unique | no | **Auth0 SoT — DB must not diverge** | Login lookup, admin list, password reset |
| `name` | `name` | varchar(255) | no | DB copy of Auth0 `name` / `user_metadata.name`. Admin PUT updates **DB only today**. | Dispatch, sockets, admin, ride video DTO |
| `phone` | `phone` | varchar(50) | yes | DB-only today (admin PUT). Not Auth0. | Admin users list, ride-video admin DTO |
| `status` | `status` | varchar(50) default `offline` | no | **Operational, not profile.** Driver may PATCH own status. | Duty, Redis, sockets, dispatch |
| `vehicleType` | `vehicle_type` | enum | yes | **Admin / fleet — not self-edit** | Admin filters |
| `vehicleId` | `vehicle_id` | uuid FK → `vehicles` | yes | **Legacy assignment. Not self-edit.** Current duty uses `driver_vehicle_assignments` | GET `/api/drivers/me` joins this |
| `cabName` / `cabNumber` / `cabLicence` | same | varchar | yes | **Admin-only cab identifier.** `cabLicence` is **cab/vehicle licence**, not a driver driving licence. | QR, admin, identifier APIs |
| `vehicleMake` / `vehicleModel` / `vehicleYear` / `vehicleColor` | same | varchar | yes | **Admin/legacy vehicle hints — not self-edit** | Admin list DTO |
| `qrCode` / `vehicleQrCode` | same | varchar unique | yes | **System-generated — immutable to client** | QR scan/duty |
| `lastSeen` | `last_seen` | timestamp | yes | System | Inactivity checker, sockets |
| `activeSessionId` | `active_session_id` | varchar(255) | yes | System (login/logout/device tracking) | Single-session enforcement |
| `activeDeviceId` | `active_device_id` | varchar(255) | yes | System | Device tracking, FCM `device_id` |
| `activeDeviceInfo` | `active_device_info` | varchar(500) | yes | System | Display only |
| `lastLoginAt` | `last_login_at` | timestamp | yes | System | Stale-token rejection |
| `createdAt` / `updatedAt` | same | timestamp | no | System | Admin list |

**Driver fields that are NOT in schema (requested, not invented as present):**

- `firstName`, `lastName`, `displayName`
- `dateOfBirth`, `gender`
- `address`
- `avatar` / `profileImage` / `profileImageUrl`
- `emergencyContact`
- driver `licenseNumber`
- `NID` / `passport`
- driver **approval** status (there is no pending/approved/rejected on `drivers`)

Related but **not profile**:

- `driver_fleet_memberships.status` (`active` default) — fleet membership, admin/system.
- `driver_service_categories.verifiedAt` — admin-assigned service category verification.
- `duty_sessions.status` — duty, not account.

### 1.3 `customers` (passengers)

Source: `src/db/schema/customers.ts`. Created in `0011_passenger_booking_system.sql`, identity switched to email in `0012_customer_email_auth.sql`.

| Field | Column | Type | Nullable | Editable? | Used elsewhere |
|---|---|---|---|---|---|
| `id` | `id` | uuid PK | no | **immutable** | Bookings (`ON DELETE CASCADE` — see §12), places, video_sessions.passenger_id |
| `auth0Id` | `auth0_id` | varchar(255) unique | no | **immutable** | Passenger login |
| `email` | `email` | varchar(255) unique | no | **Auth0 SoT** | Login, forgot-password, ride-video admin, booking joins |
| `name` | `name` | varchar(255) | no | DB copy of Auth0 name. **No self-edit API.** | Driver offer/history passenger name, admin ride-video |
| `phoneCountryCode` | `phone_country_code` | varchar(10) | yes | DB-only. Unique phone index **dropped** in 0012. **No OTP write path.** | Admin ride-video search/DTO |
| `phoneNumber` | `phone_number` | varchar(30) | yes | Same as above | Same |
| `profileImageUrl` | `profile_image_url` | varchar(500) | yes | **Column exists; never read or written in application code** | Schema only |
| `status` | `status` | varchar(50) default `active` | no | **Never checked on login.** No deactivate API. Suitable for soft-delete. | Unused in auth |
| `emailVerifiedAt` | `email_verified_at` | timestamp | yes | Set at register (`new Date()`). Passenger Auth0 create uses `emailVerified: true`. | Unused after insert |
| `phoneVerifiedAt` | `phone_verified_at` | timestamp | yes | **Never written** after schema create | Unused |
| `activeSessionId` / `activeDeviceId` / `activeDeviceInfo` / `lastLoginAt` | same | varchar/timestamp | yes | System | Passenger login/logout |
| `createdAt` / `updatedAt` | same | timestamp | no | System | Unused in `/me` today |

**Passenger fields that are NOT in schema:**

- `firstName`, `lastName`, `displayName` (driver booking DTO synthesizes `displayName` from `customers.name`)
- `dateOfBirth`, `gender`
- home/profile `address` (saved places are `customer_places`, trip-planning not profile)
- `emergencyContact`

### 1.4 `admin_users`

Not in target apps, but shares Auth0 + admin user management.

| Field | Type | Notes |
|---|---|---|
| `id`, `auth0Id`, `email`, `name`, `role`, `createdAt`, `updatedAt` | as in `src/db/schema/admin_users.ts` | No phone, no avatar, no session columns. |

### 1.5 `sessions`

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `userId` | uuid, **no FK** | Driver or customer or admin id |
| `userType` | varchar(50) | `driver` / `customer` / `admin` |
| `token` | varchar(500) | Backend HS256 session JWT |
| `expiresAt` | timestamp | Login sets +24h |
| `createdAt` | timestamp | |

Orphan rows remain if a user is deleted without `sessionUtils.deleteAllForUser`.

### 1.6 `vehicles`

Fleet asset table (`make`, `model`, `year`, `color`, `plateNumber`, `vin`, `bodyNumber`, `status`, `fleetId`, `qrCode`). Drivers do not own vehicles. Current assignment is `driver_vehicle_assignments` (+ duty). `drivers.vehicleId` is a legacy FK.

### 1.7 Auth / device / push

| Table | Role |
|---|---|
| `drivers.active_*` | Single-session + device for Driver app |
| `customers.active_*` | Session/device for Passenger app (weaker than driver: no `trackDriverDevice` equivalent) |
| `driver_push_tokens` | FCM; `device_id` = app device UUID; `ON DELETE CASCADE` from driver |
| Passenger push tokens | **Do not exist** |

### 1.8 Other related tables (not profile)

`locations`, `trips`, `duty_sessions`, `driver_vehicle_assignments`, `driver_attendance`, `driver_fleet_memberships`, `driver_service_categories`, `customer_places`, `bookings`, `booking_offers`, `video_sessions`, `vehicle_exchange_*`, `fleet_audit_events`, `logs`.

---

## 2. Current profile endpoints

**Do not invent missing routes.** These are the actual ones.

### 2.1 Exist today

#### Driver — view own profile

`GET /api/drivers/me`  
Auth: `requireAuth` + `extractUserInfo` + `trackDriverDevice` (no `requireDriver`; lookup is by JWT `auth0Id`).

Response envelope: `{ success: true, data: { ...driverRow, vehicle, currentLocation } }`.

`data` is the **full `drivers` row** (including `auth0Id`, `activeSessionId`, `activeDeviceId`, cab fields, QR codes) plus:

```json
{
  "...all driver columns...": true,
  "vehicle": { "id": "uuid", "make": "...", "model": "...", "plateNumber": "...", "...": "..." } | null,
  "currentLocation": { "latitude": "...", "longitude": "...", "timestamp": "..." } | null
}
```

Also: `GET /api/drivers/:id` — own profile or admin. Same shape. Non-owners get 404 (not 403).

Also: `GET /api/auth/me` — **driver or admin only**. Customers are not looked up.

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "...",
    "name": "...",
    "role": "driver|admin|super_admin",
    "status": "online|offline|undefined-for-admin"
  }
}
```

#### Driver — edit profile

**There is no `PATCH /api/drivers/me` and no driver self-update of name/phone/email/photo.**

`PUT /api/drivers/:id` is **`requireAdmin` only**. Body (optional): `name`, `phone`, `vehicleType`, `vehicleId`, `status`, `cabName`, cab identifier, `vehicleMake/Model/Year/Color`. **Email is not in the schema.** Updates **Postgres only**, not Auth0.

`PATCH /api/drivers/:id/status` — driver may set **own** `online`/`offline` (duty). Not a profile field.

#### Passenger — view profile

`GET /api/v1/passenger/auth/me`  
Auth: `requireAuth` + `requireCustomer`.

Actual response:

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "...",
    "email": "...",
    "role": "customer"
  }
}
```

Does **not** return `phone`, `profileImageUrl`, `status`, `createdAt`, `emailVerifiedAt`.

#### Passenger — edit profile

**There is no `PATCH /api/v1/passenger/profile`, no `PUT /api/users/me`, no passenger profile update route.**

Saved places (`POST/PATCH/DELETE /api/v1/passenger/places`) are trip-planning addresses, not account profile.

#### Logout

| Route | Who | What it does |
|---|---|---|
| `POST /api/auth/logout` | Any authenticated user; driver branch is special | Deletes session by bearer token. If `role === 'driver'`: `clearSessionInfo` + `invalidateDriverPushTargets`. |
| `POST /api/v1/passenger/auth/logout` | `requireCustomer` | `sessionUtils.deleteByToken` + `clearCustomerSession`. |

Driver logout response: `{ success: true, data: { message: "Logged out successfully" } }`.  
Passenger: `{ success: true, data: { message: "Logged out" } }`.

#### Password

| Route | Who | Behavior |
|---|---|---|
| `POST /api/v1/passenger/auth/forgot-password` | Public | Auth0 `dbconnections/change_password` after DB email lookup. |
| `POST /api/admin/users/:id/reset-password` | Admin (drivers) / super_admin | Same Auth0 email reset. **Does not include customers.** |
| Change-password (old + new while logged in) | **Does not exist** | |
| Driver self forgot-password | **Does not exist** | Admin-triggered only |

#### Email update / phone update / avatar / account delete (self)

**None of these routes exist** for Driver or Passenger.

#### Account delete (admin, not self-serve)

| Route | Who | Behavior |
|---|---|---|
| `DELETE /api/drivers/:id` | Admin | Hard-deletes `drivers` row. **Does not delete Auth0.** Comment claims CASCADE for locations/trips. |
| `DELETE /api/admin/users/:id` | Admin (drivers) / super_admin | Deletes Auth0 user (if Management API configured) then DB row. **Drivers and admins only — not customers.** |

### 2.2 Requested routes that do **not** exist

- `PATCH /api/drivers/me`
- `GET /api/v1/passenger/profile`
- `PATCH /api/v1/passenger/profile`
- `GET /api/users/me`
- `PUT /api/users/me`
- Any avatar upload/remove
- Any self email/phone change
- Any self deactivate/delete
- `POST /api/auth/logout-all` (or equivalent)

---

## 3. Auth0 / auth source of truth

### 3.1 How accounts are created

| Role | Auth0 | Database |
|---|---|---|
| Driver | `auth0Management.createUser` — connection `Username-Password-Authentication`, `email`, `password`, `name`, `app_metadata.role=driver`, `user_metadata.name` | `drivers` row with `auth0_id = user_id` |
| Passenger | `createCustomer` → same, `role=customer`, **`emailVerified: true`** | `customers` row; `emailVerifiedAt` set immediately |
| Admin | Same createUser | `admin_users` |

Passwords are **never stored in Postgres**. Login is Auth0 access token → backend HS256 session JWT.

### 3.2 Field authority

| Field | Authoritative | DB role | Read-only to apps? |
|---|---|---|---|
| User id (`auth0\|...`) | **Auth0 `user_id` / JWT `sub`** | Copied to `auth0_id` | **READ_ONLY** |
| App uuid (`drivers.id` / `customers.id`) | **Database** | PK | **READ_ONLY** |
| Email | **Auth0** | Unique copy for lookup/reset | **READ_ONLY until Auth0 Management update + verify** |
| Password | **Auth0** | Not stored | Never write locally |
| Name | Auth0 `name` / `user_metadata.name` at create; **DB is what apps display** | `drivers.name` / `customers.name` | Can be DB-editable **only if Auth0 is patched in the same transaction** |
| Phone | **Database only** (not written to Auth0) | `drivers.phone`, `customers.phone_*` | Editable in DB **after ownership proof**; not identity for login today |
| Role | Auth0 roles + `app_metadata.role` | Implied by which table the row lives in | **READ_ONLY** to clients |
| Session JWT `userId`/`role` | Backend-issued | Must stay in sync with DB | Client cannot set |

### 3.3 What requires Auth0 Management API

Existing methods in `src/services/auth0Management.ts`:

- `createUser` / `createCustomer`
- `getUser` / `findUserByEmail`
- `updateUserRole` / `assignRoleToUser` / `changeUserRole`
- `deleteUser`
- `sendPasswordResetEmail` / `sendPasswordResetForPhone` (phone helper is **unused**)

**There is no `updateUser` / `updateEmail` / `updateName` / `unlink` method.**

Documented M2M scopes (`AUTH0_SETUP.md`): `create:users`, `update:users`, `delete:users`, `update:users_app_metadata`, `create:users_app_metadata`, role membership scopes.

| Update | Requires Management API? | Can stay DB-only? |
|---|---|---|
| Email | **Yes** (`PATCH /api/v2/users/{id}` with `email`; typically also verification ticket). Need `update:users`. Email-verify tickets may need `create:user_tickets` (not listed in setup). | **No** |
| Password | **Yes** — reset email or Auth0 change-password. Do not store hashes. | **No** |
| Name | **Yes if keeping Auth0 in sync** (currently admin PUT already diverges). | Risky DB-only |
| Phone | No Auth0 phone identity in use (email login). | **Yes**, after OTP if product requires ownership |
| Avatar | No | **Yes** |
| `auth0_id` / role / table | Management + admin process | **No** |
| Duty status / vehicle / QR | No | Operational tables only |

### 3.4 Must remain read-only to clients

`id`, `auth0Id`, `role`, `status` (driver duty), `qrCode`, `vehicleQrCode`, `vehicleId`, cab identifiers, `vehicleType`, fleet/service verification, `activeSessionId`, `activeDeviceId`, `email` (until Auth0 flow exists), approval-like fields (none exist — do not add client-writable ones).

**Current divergence:** `PUT /api/drivers/:id` updates `name` in DB and **does not** patch Auth0. New profile work must not repeat this for self-serve name/email.

---

## 4. Driver profile rules (from actual schema / routes)

### 4.1 Safe to allow the driver to edit (once APIs exist)

| Field | Reason |
|---|---|
| `name` | Personal display; **must also PATCH Auth0** or stay read-only. |
| `phone` | DB-only, unused as login id. Prefer OTP before treating as trusted contact. |
| Profile photo | **Column does not exist** — needs schema + storage. |

### 4.2 Must stay restricted (admin / system)

| Field | Why |
|---|---|
| `email` | Auth0 login identifier |
| `auth0Id`, `id` | Identity |
| `status` (online/offline) | Duty. Existing `PATCH /:id/status` + `/api/v1/driver/duty` already own this. **Do not add to profile PATCH.** |
| `vehicleId`, cab fields, `vehicleMake/Model/Year/Color`, `vehicleType` | Fleet / admin. `PUT /api/drivers/:id` already admin-only. |
| `qrCode`, `vehicleQrCode` | Generated |
| Assigned vehicle / duty / exchange | `driver_vehicle_assignments`, `duty_sessions`, vehicle-exchange APIs |
| Service categories / `verifiedAt` | Admin `POST /api/v1/admin/driver-service-categories` |
| Fleet membership | `driver_fleet_memberships` |
| Session/device/FCM columns | Login/logout/push |

### 4.3 “Verified fields” that do not exist as driver KYC

There is **no** driver license number, NID, passport, document upload, or approval workflow on `drivers`.  
`cabLicence` is a **cab identifier**, admin-managed.  
`driver_service_categories.verifiedAt` is service-type verification, not identity KYC.

**Do not let drivers self-edit approval, duty, vehicle assignment, or verification.** Current architecture already keeps those off self-serve profile (except duty status via dedicated status/duty APIs).

### 4.4 Mass-assignment trap

Do **not** reuse `updateDriverSchema` for a future `PATCH /api/drivers/me`. That schema allows `vehicleType`, `vehicleId`, `status`, cab fields.

---

## 5. Passenger profile rules

### 5.1 Can edit (schema supports; APIs missing)

| Field | Notes |
|---|---|
| `name` | Displayed to drivers as passenger name / `displayName`. Sync Auth0 if editable. |
| `profileImageUrl` | Column exists, unused. Needs upload pipeline. |
| `phoneCountryCode` + `phoneNumber` | Optional, not unique, not OTP-verified. **Do not silently make this identity-critical.** Login is email. |

### 5.2 Should stay read-only / Auth0-gated

| Field | Notes |
|---|---|
| `email` | Login id |
| `id`, `auth0Id` | Identity |
| `role` | JWT / Auth0 |
| `status` | Soft-delete candidate; not client-writable |
| `emailVerifiedAt` / `phoneVerifiedAt` | System |
| Session/device columns | Login/logout |

### 5.3 Related but not account profile

`customer_places` (home/work/favorite/recent) — already CRUD under `/api/v1/passenger/places`. Keep separate from profile DTO unless product explicitly wants “saved addresses” on the profile screen.

### 5.4 Missing from schema (if product requires them)

`dateOfBirth`, `gender`, `emergencyContact`, split first/last name, dedicated profile address.

---

## 6. Profile image storage

### 6.1 What exists

| Mechanism | Purpose | Public? |
|---|---|---|
| `customers.profile_image_url` | Intended avatar URL | Unused |
| `drivers` | **No image column** | — |
| `app.use('/uploads', express.static(...))` | Public static files | **Public, unauthenticated** |
| `src/services/video-storage.service.ts` | Legacy trip videos under `uploads/videos` | Public URL via `/uploads` |
| `src/services/ride-video-storage.service.ts` | Current DVR segments under `private-media` / `VIDEO_STORAGE_ROOT` | **Private**, HMAC signed upload/read tokens |
| Multer `src/middleware/upload.ts` | **Video only** (`video/mp4`, `video/quicktime`, 500MB / 15MB chunk) | — |
| S3 / Cloudinary / AWS SDK | **Not in dependencies or code** | — |

### 6.2 Current avatar state

Profile images **do not exist in practice**. The passenger column is never written. Drivers have no column.

### 6.3 Reuse guidance

**Do not store public avatars in `private-media` ride-video storage.** That path is signed, driver-scoped, video-MIME, and retention-deletes recordings. Mixing public JPEGs into it would either leak video URLs or block avatar reads.

**Do not put avatars in the same public `/uploads/videos` tree** as legacy recordings.

Need a **new** prefix (e.g. `uploads/avatars/{role}/{uuid}.jpg`) or a dedicated public bucket, with delete-on-replace and delete-on-remove. No Cloudinary/S3 provider is implemented; local disk is the only existing file backend.

---

## 7. Image security (recommendation vs current middleware)

Current upload middleware **cannot** be reused for avatars: it allows only MP4/MOV, 500MB, ftyp magic bytes.

Recommended limits for a **new** image middleware (not implemented):

| Control | Recommendation |
|---|---|
| MIME | `image/jpeg`, `image/png`, `image/webp` only (allowlist, not client-supplied filename) |
| Magic bytes | Validate actual file header, not only `Content-Type` |
| Size | 2–5 MB max |
| Dimensions | e.g. max 2048px edge; optionally re-encode (no `sharp` in `package.json` today) |
| Filename | Server-generated UUID + extension; never use original name in path |
| Path | Role-scoped directory; no `..` |
| Auth | Own profile only |
| Rate limit | Separate bucket from video upload |

`BLOCKED_EXTENSIONS` in video middleware is not an image allowlist. `helmet` is on, but `/uploads` is still world-readable.

---

## 8. Email change

### Today

- Login identity = Auth0 email + DB unique `email`.
- Passenger register marks email verified in **both** Auth0 (`emailVerified: true`) and DB (`emailVerifiedAt = now()`). **No confirmation-link flow is implemented.**
- No old-email / new-email confirmation.
- No backend method to PATCH Auth0 email.
- Admin cannot change email via `PUT /api/drivers/:id`.

### Proper flow if Auth0 remains SoT (do not implement yet)

1. Authenticated request with new email.
2. Rate-limit + uniqueness check in DB **and** Auth0 `users-by-email`.
3. Management API `PATCH` user (`email`, usually `email_verified: false`) **or** Auth0 verification ticket / change-email template.
4. User confirms via Auth0 email.
5. Webhook or poll: when verified, update `customers.email` / `drivers.email` and `emailVerifiedAt`.
6. Invalidate sessions (email is in HS256 JWT claims).
7. Do not update DB first and leave Auth0 on the old address.

Until that exists, **email must be read-only** in profile PATCH.

---

## 9. Phone change

### Today

- **No OTP / SMS verification service** in this repo.
- `normalizePhone` and `sendPasswordResetForPhone` are leftovers from pre-0012 phone-username passenger auth. Unique phone index was dropped. Phone is optional.
- Passenger register does not collect phone.
- Driver phone is optional, admin-set, no format/OTP.
- Driver booking passenger payload **hardcodes `phone: null`** even though `customers.phone_*` exist (`src/services/driverBooking.service.ts`).
- Admin ride-video **does** join passenger phone for display/search.

### Can phone change be direct / OTP / unsupported?

| Option | Verdict |
|---|---|
| Direct edit | Technically possible (DB-only, not login). Unsafe if shown to drivers as contact. |
| OTP verified | **Unsupported currently** — no OTP infrastructure. |
| Identity-critical | **Not today** (email is login). Do not promote phone to identifier without OTP + unique constraint. |

Recommendation: keep phone optional; if the apps show it as contact, add OTP **before** driver-visible writes. Do not silently expose unverified phone on offers.

---

## 10. Password / security

| Question | Answer |
|---|---|
| Where are passwords? | **Auth0 Username-Password-Authentication only** |
| Local DB hashes? | **No** |
| Passwordless / social? | Create path is DB connection only. No social/passwordless implementation in backend. |
| Change password (logged in) | **Missing** — use Auth0 hosted change-password or Management API; do not add local password columns |
| Reset password | Passenger: `POST /api/v1/passenger/auth/forgot-password`. Driver/admin: `POST /api/admin/users/:id/reset-password`. No driver-app forgot-password. |
| Logout all sessions | Driver login on another device deletes all `sessions` for that user and replaces `activeSessionId`. Explicit “logout all” API **does not exist**. Passenger login **does not** call `deleteAllForUser`. |
| Session invalidation | Driver: `sessions` row + `activeSessionId` + `trackDriverDevice` (`SESSION_INVALID`). Passenger: token row deleted on logout; no device-mismatch middleware. |

`Auth0Permissions.UPDATE_OWN_DATA` is defined in `src/config/auth0.ts` and **never referenced** in middleware.

---

## 11. Logout semantics (reuse these; do not add a second implementation)

### 11.1 Driver `POST /api/auth/logout`

**Does:**

- Delete `sessions` row for bearer token
- Clear `active_session_id` / `active_device_id` / `active_device_info`
- Delete all `driver_push_tokens` for that driver

**Does not:**

- Set `drivers.status` to `offline`
- End `duty_sessions`
- Clear Redis location / cancel `booking_offers`
- Disconnect Socket.IO (HTTP logout cannot; client must disconnect; server `disconnect` handler only emits `driver:offline` to admin and does **not** persist offline)
- Delete other session rows besides the current token (`deleteByToken` only)

Duty leftover after logout is existing behavior. Profile work must **call this route**, not reimplement push/session clearing. If product wants “logout = off duty”, that is a **duty** change, not a new logout.

Covered by test: `tests/driver-push-token.service.test.ts` (`logout removes all push targets`) at service level, not HTTP.

### 11.2 Passenger `POST /api/v1/passenger/auth/logout`

**Does:** delete current session token + clear customer `active_*`.

**Does not:** disconnect passenger sockets; no passenger FCM table; no `deleteAllForUser`.

### 11.3 Profile implication

Account screens should call:

- Driver → `POST /api/auth/logout`
- Passenger → `POST /api/v1/passenger/auth/logout`

---

## 12. Account deletion / deactivation

### 12.1 Hard delete is not safe

**Passenger (`customers`)**

| Relation | On delete | Effect of hard delete |
|---|---|---|
| `bookings.customer_id` | **CASCADE** | Destroys booking/payment-status history |
| `customer_places` | CASCADE | OK |
| `booking_idempotency_keys` | CASCADE | OK |
| `trips.customer_id` | SET NULL | Trips remain, passenger unlinked |
| `video_sessions.passenger_id` | SET NULL | Session remains |
| `video_sessions.booking_id` | **RESTRICT** | **Blocks booking delete**, therefore **blocks customer delete** if any ride-video session exists |
| `sessions` | no FK | Orphans |

**Driver (`drivers`)**

| Relation | On delete | Effect |
|---|---|---|
| `locations`, `trips`, `driver_attendance`, `driver_push_tokens`, `duty_sessions`, `driver_fleet_memberships`, `driver_service_categories`, `driver_vehicle_assignments`, `booking_offers`, `trip_videos` | CASCADE | History loss / operational wipe |
| `bookings.assigned_driver_id` | SET NULL | Bookings remain without driver |
| `video_sessions.driver_id` | **RESTRICT** | **Hard delete fails** if any DVR session exists |
| `vehicle_exchange_requests` | Driver CASCADE but assignments/duty **RESTRICT** | Likely **FK failure** if exchange rows exist |
| `fleet_audit_events.driver_id` | **no FK** | Orphan audit ids |
| `logs.user_id` | **no FK** | Orphan |
| `sessions` | no FK | Orphan |

Admin `DELETE /api/admin/users/:id` already hard-deletes drivers/admins and Auth0. That is **admin ops**, not GDPR-style app self-delete, and will throw if video sessions exist.

`DELETE /api/drivers/:id` does **not** call Auth0 `deleteUser` — Auth0 orphan risk.

There is **no payments table**; payment state lives on `bookings.payment_status` / `final_fare`. Cascading bookings destroys that record.

### 12.2 Recommendation

**Soft-delete / deactivate, not hard delete**, for both roles:

- Passenger: set `customers.status = 'deactivated'` (or `deleted`), refuse login, keep bookings/videos.
- Driver: add an **account** status separate from duty `online`/`offline` (today those are overloaded on one column). Do not reuse `offline` as “account closed”.
- Optionally disable Auth0 user (`blocked: true`) via Management API rather than `deleteUser`.
- Self-serve delete should not call existing admin hard-delete.

Legal/business: ride video retention (`VIDEO_RETENTION_DAYS`) and booking history must survive account closure.

---

## 13. Admin visibility

### 13.1 Driver profile

Admin already sees driver name/email/phone/cab/vehicle hints:

- `GET /api/admin/users` (`mapDriver`)
- `GET /api/drivers` and `GET /api/drivers/:id`
- Ride-video admin DTO: driver `id`, `name`, `phone`, `email`

If a driver (or admin) updates `name`/`phone` in `drivers`, **these APIs read the table directly** — no extra DTO mapping is required for those columns.

**Gaps:** no driver avatar column, so Admin cannot show a photo until schema + list/detail DTOs add it. `GET /api/admin/users` does not include `vehicle` join (unlike `GET /api/drivers`).

### 13.2 Passenger profile

**No Admin passenger/user list.** `GET /api/admin/users` is drivers + `admin_users` only. Role filter has no `customer`.

Passenger name/email/phone appear **only as joins** on ride-video admin (`adminRideVideo.service.ts`) and booking history SQL (`customers.name`, `customers.email`). `profileImageUrl` is not selected.

**If passengers edit name/phone/photo, ride-video Admin will show new name/phone automatically; photo will not show until DTOs include `profileImageUrl`.** There is still no passenger management page API.

### 13.3 User management

`POST /api/admin/users` creates driver/admin in Auth0+DB.  
`PATCH /api/admin/users/:id/role` cannot move driver ↔ admin.  
Password reset and delete **exclude customers**.

---

## 14. Recommended profile DTOs

Strip session/device/QR/cab assignment from client profile responses. Do not return `...driver` spread.

### 14.1 Passenger

```json
{
  "id": "",
  "name": "",
  "email": "",
  "phone": null,
  "profileImageUrl": null,
  "createdAt": ""
}
```

| Field | Status | Source |
|---|---|---|
| `id` | **AVAILABLE** **READ_ONLY** | `customers.id` |
| `name` | **AVAILABLE** | `customers.name` |
| `email` | **AVAILABLE** **READ_ONLY** | `customers.email` (Auth0 SoT) |
| `phone` | **AVAILABLE** (often null) | join `phoneCountryCode` + `phoneNumber`; not in `/me` today |
| `profileImageUrl` | **AVAILABLE** (always null until upload) | `customers.profile_image_url` unused |
| `createdAt` | **AVAILABLE** | `customers.createdAt`; not in `/me` today |
| `firstName` / `lastName` | **MISSING** | |
| `dateOfBirth` / `gender` / emergency | **MISSING** | |
| `status` | **AVAILABLE** **READ_ONLY** | do not put on public DTO unless needed |

### 14.2 Driver

```json
{
  "id": "",
  "name": "",
  "email": "",
  "phone": null,
  "profileImageUrl": null,
  "status": "",
  "license": null,
  "vehicleSummary": null
}
```

| Field | Status | Source |
|---|---|---|
| `id` | **AVAILABLE** **READ_ONLY** | `drivers.id` |
| `name` | **AVAILABLE** | `drivers.name` |
| `email` | **AVAILABLE** **READ_ONLY** | `drivers.email` |
| `phone` | **AVAILABLE** | `drivers.phone` |
| `profileImageUrl` | **MISSING** | no column |
| `status` | **AVAILABLE** **READ_ONLY** on profile | duty `online`/`offline` — expose as operational, not editable via profile PATCH |
| `license` | **MISSING** as driver licence | do not map `cabLicence` here (wrong meaning) |
| `vehicleSummary` | **JOIN** | Active assignment → `vehicles` (make/model/plate/color). Legacy `drivers.vehicleId` is incomplete vs duty assignment |
| `cabLicence` / plate | **JOIN** **READ_ONLY** | admin/fleet |
| `approval` | **MISSING** | |
| `auth0Id` / session / QR | **AVAILABLE** but **omit from app DTO** | leak / not profile |

---

## 15. Security / authorization

### 15.1 What is already true

- Passenger `/me` and `/logout` use `requireCustomer` and `user.userId` from JWT — cannot pick another customer id.
- Driver `/me` looks up **by `auth0Id`**, not a client-supplied id.
- `PUT /api/drivers/:id` is admin-only.
- `GET /api/drivers/:id` allows self or admin; others 404.

### 15.2 Gaps for future PATCH

- No passenger/driver profile write surface, so mass-assignment is not exploitable yet — **unless** a new handler reuses `updateDriverSchema`.
- Clients must not send `userId`, `driverId`, `auth0Id`, `role`, `status` (duty), `verifiedAt`, fleet ids. Use a **strict Zod pick-list**.
- `GET /api/drivers/me` currently returns session ids and QR codes to the driver app — acceptable for own device, **not** a public profile DTO.
- `Auth0Permissions.UPDATE_OWN_DATA` is unused; do not rely on it until wired.
- Driver `PATCH /:id/status` already lets a driver change own duty status by id in the URL; verify `isOwnProfile`. Keep profile PATCH on `/me` only (ignore body ids).

---

## 16. Rate limit / abuse (audit only — do not add yet)

Existing buckets (`src/config/rate-limit.ts` + `src/middleware/rate-limiters.ts`):

| Bucket | Typical production | Applied to |
|---|---|---|
| `global` | 100 / 15 min / IP | Most routes including passenger `/me` |
| `auth` | 50 / 15 min / IP | `/api/auth/login`, `/refresh` **only** |
| `passengerMaps` / booking / cancel / recovery | per customer | Maps & bookings |
| `driver` / location / offer / recovery | per driver | Driver operational APIs |
| `videoUpload` | 30 / min / driver | Ride video |
| Passenger forgot-password | **Global only** (not `auth` limiter) | Abuse-sensitive |
| Admin reset-password | Global | |

**Suggested later (not implemented):**

| Action | Suggested |
|---|---|
| Profile PATCH | 10–20 / 15 min / user |
| Avatar upload | 5–10 / hour / user (separate from `videoUpload`) |
| Email change | 3 / day / user |
| Phone change / OTP | 5 send / hour / user + IP |
| Password reset | Move passenger forgot-password onto `auth` (or stricter) limiter; enumerate-safe responses |

---

## 17. Tests

### 17.1 Existing (related, not a profile suite)

| Area | Tests |
|---|---|
| Get profile | **None** for `/api/drivers/me` or `/api/v1/passenger/auth/me` in `tests/`. Script smoke: `scripts/api-test-report.ts`, `comprehensive-test.js` |
| Auth / logout | Push-token service logout invalidation; no HTTP logout/session tests |
| Session invalidation | No dedicated `trackDriverDevice` / `validate-session` tests |
| Image upload | Video magic-byte / MIME tests only (ride video), not avatars |
| User update | Admin vehicle “profile” tests are **vehicle** profile, not human profile |
| Authorization | Booking/duty/video/RBAC tests; none for profile PATCH |
| Passenger validators | Maps/quote only (`tests/validators.passenger.test.ts`) |
| Password reset | **None** |

### 17.2 Missing tests required before/with implementation

- `GET` passenger `/me` shape (phone/photo omitted vs included)
- `GET` driver `/me` does not require admin; other driver id 404
- `PATCH` own name/phone; reject `status`, `vehicleId`, `role`, `email` (until Auth0 flow)
- Cannot PATCH another user id
- Avatar: MIME/size reject; video file reject; replace deletes old object
- Email change: DB not updated if Auth0 fails
- Phone: unverified phone not exposed to driver offers (if that becomes policy)
- Logout still clears FCM + session (regression)
- Deactivate: login rejected; bookings/videos remain
- Admin list reflects name/phone without extra mapping
- Hard-delete **not** used on self-serve path
- Rate-limit hooks (once added)

---

## 18. Implementation implications (no code in this audit)

**Reusable as-is**

- Driver `GET /api/drivers/me` as a **read** starting point (then shrink DTO)
- Passenger `GET /api/v1/passenger/auth/me` (then expand DTO)
- Existing logout routes
- Auth0 password reset (passenger + admin)
- `customers.profile_image_url`, `customers.phone_*`, `customers.status`
- Admin driver reads of `name`/`phone`/`email`

**Must be built**

- Strict `PATCH /me` per role (new validators, not `updateDriverSchema`)
- Driver `profile_image_url` (or equivalent) column
- Public avatar storage + image middleware (not video/private-media)
- Auth0 name/email update helpers if those fields are editable
- Soft-delete / Auth0 block; never cascade bookings/videos
- Admin customer list **if** product needs passenger management
- OTP **if** phone is driver-visible or identity-grade
- Tests listed in §17.2

**Must not do**

- Local password storage
- DB email change without Auth0
- Driver self-edit of duty, vehicle, QR, cab licence, service verification
- Mapping `cabLicence` as driver licence
- Reusing ride-video private storage for avatars
- A second logout implementation
- Hard-delete of `customers` / `drivers` from the apps

---

## Final status

**AUDIT COMPLETE — PROFILE GAPS: no self-serve profile write APIs, no avatar pipeline, Auth0-owned identity cannot be edited in DB, hard-delete is unsafe, passenger Admin list is missing**

Foundation is enough to **start** a first slice (read DTOs + DB-only name/phone for passengers + driver name/phone with Auth0 name sync + new avatar store), but it is **not** sufficient to ship “complete Profile / Account Management” without the gaps above.
