# DRIVEWIZE BACKEND — DRIVER LICENSE AND INSURANCE DOCUMENTS

**Status: DRIVER DOCUMENT BACKEND IMPLEMENTED — APP/ADMIN INTEGRATION REQUIRED**

Scope is backend only. Android, iOS, and Admin UI were not modified.

## 1. Existing architecture / storage audit

| Area | Existing pattern | Reused? |
| --- | --- | --- |
| Driver auth | `requireAuth` + `extractUserInfo` + `requireDriver`; identity from JWT `auth0Id` via `driverUtils.findByAuth0Id` | Yes. Driver ID in the request body/query is ignored. |
| Admin auth | `requireAuth` + `extractUserInfo` + `requireAdmin` (`admin` / `super_admin`) | Yes, same stack as `/api/v1/admin/fleet/drivers/:driverId/*`. |
| Avatars | Public `uploads/avatars/…`, JPEG re-encode, 5 MB | **Not used.** Avatars are public static files and must not store licenses/insurance. |
| Ride video | Private files under `VIDEO_STORAGE_ROOT` (`private-media` / `ride-recordings/…`), HMAC read tokens, authenticated or token-gated streaming | **Yes.** Documents use the same private root (or `DRIVER_DOCUMENT_STORAGE_ROOT`), a separate container `driver-documents/`, and the same signed-read + `sendFile` model. |
| Driver details | `GET /api/drivers/:id` (own driver or admin) | Metadata attached as `documents` for authorized callers. |
| Existing document APIs | None for driving license / insurance | New table and routes; no duplicate of video/avatar APIs. |

Out of scope (not added): approval, verification, expiry, OCR, duty eligibility gates.

## 2. Schema and migration

Table `driver_documents` (one current file per driver per type):

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `driver_id` | uuid FK → `drivers.id` ON DELETE CASCADE | |
| `document_type` | varchar(32) | `driving_license` \| `insurance` |
| `original_filename` | varchar(255) | Sanitized original name |
| `mime_type` | varchar(100) | `application/pdf`, `image/jpeg`, `image/png` |
| `size_bytes` | integer | `> 0` |
| `storage_key` | text | Internal object key only; never a public URL |
| `uploaded_at` | timestamptz | |
| `created_at` / `updated_at` | timestamptz | |

Constraints: unique `(driver_id, document_type)`.

Migration: `src/db/migrations/0034_driver_documents.sql` (journal tag `0034_driver_documents`).

Deploy with existing `npm run db:migrate`.

## 3. Exact endpoints and response contracts

Envelope is unchanged:

```json
{ "success": true, "data": { } }
```

```json
{ "success": false, "error": { "code": "…", "message": "…" } }
```

Document metadata (no `storageKey`, no filesystem path, no bucket credentials):

```json
{
  "id": "<uuid>",
  "documentType": "driving_license",
  "originalFilename": "license.png",
  "mimeType": "image/png",
  "sizeBytes": 10240,
  "uploadedAt": "2026-10-08T00:00:00.000Z",
  "downloadUrl": "/api/v1/driver/documents/driving_license/content?token=…",
  "downloadUrlExpiresAt": "2026-10-08T00:05:00.000Z"
}
```

`downloadUrl` is a short-lived relative path, or absolute when `API_PUBLIC_BASE_URL` / `VIDEO_API_PUBLIC_BASE_URL` is set. Default token TTL is 300 seconds.

Map payload:

```json
{
  "driving_license": { },
  "insurance": null
}
```

### Driver (Bearer driver JWT)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/driver/documents` | List my documents |
| `PUT` | `/api/v1/driver/documents/:documentType` | Upload or replace (`multipart/form-data` field `file`) |
| `GET` | `/api/v1/driver/documents/:documentType` | Metadata + signed `downloadUrl` |
| `GET` | `/api/v1/driver/documents/:documentType/content` | Stream bytes (driver JWT; optional `token`) |

`:documentType` is `driving_license` or `insurance` only.

**List success (200)**

```json
{ "success": true, "data": { "documents": { "driving_license": null, "insurance": null } } }
```

**Upload success (200)** — body is the metadata object.

**Content success (200)** — raw file, `Content-Type` = stored MIME, `Cache-Control: private, no-store`, `Content-Disposition: inline`.

### Admin (Bearer admin JWT, except tokened content)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/admin/fleet/drivers/:driverId/documents` | List selected driver’s documents |
| `GET` | `/api/v1/admin/fleet/drivers/:driverId/documents/:documentType` | Metadata + admin signed URL |
| `GET` | `/api/v1/admin/fleet/drivers/:driverId/documents/:documentType/content` | Stream bytes |

**List success (200)**

```json
{
  "success": true,
  "data": {
    "driverId": "<uuid>",
    "documents": { "driving_license": { }, "insurance": null }
  }
}
```

Admin `downloadUrl` example:

`/api/v1/admin/fleet/drivers/<driverId>/documents/driving_license/content?token=…`

If `token` is present on content, the HMAC token is the authorization (same pattern as ride-video segment content). If `token` is omitted, admin JWT is required.

### Existing Driver Details

`GET /api/drivers/:id` (own driver or admin) now includes `documents` using the same map. Admins receive admin content URLs; the driver receives driver content URLs.

### Errors

| HTTP | Code | When |
| --- | --- | --- |
| 401 | `AUTH_FAILED` | Missing/invalid JWT |
| 403 | `UNAUTHORIZED` | Wrong role |
| 403 | `INVALID_DOCUMENT_READ_AUTHORIZATION` | Bad/expired/mismatched read token |
| 403 | `FORBIDDEN` | Path-traversal / invalid storage key |
| 404 | `NOT_FOUND` | Driver or document missing |
| 404 | `DOCUMENT_OBJECT_NOT_FOUND` | DB row exists, file missing |
| 400 | `VALIDATION_ERROR` | Bad type, missing `file` |
| 400 | `INVALID_DOCUMENT_TYPE` | MIME/signature not PDF/JPEG/PNG |
| 413 | `FILE_TOO_LARGE` | Over `DRIVER_DOCUMENT_MAX_BYTES` (default 10 MB) |
| 500 | `DOCUMENT_STORAGE_ERROR` | Object write failed |

## 4. Storage and authorization design

- Root: `DRIVER_DOCUMENT_STORAGE_ROOT` or `VIDEO_STORAGE_ROOT` or `private-media`.
- Key: `driver-documents/{driverId}/{documentType}/{uuid}.{pdf|jpg|png}`.
- Not served by `express.static('/uploads')`.
- Keys must stay under the container; `..` and other containers are rejected.
- Read tokens: HMAC-SHA256, purpose `driver_document_read`, bound to `documentId`, `driverId`, `documentType`, `storageKey`, expiry. Signing secret: `DRIVER_DOCUMENT_SIGNING_SECRET` or `VIDEO_SIGNING_SECRET` or `JWT_SECRET`.
- Driver handlers always resolve the driver from the JWT. Cross-driver list/download is not possible via a client-supplied `driverId`.
- Admin handlers use the path `driverId` only after admin role checks.
- Logs record `driverId`, `documentType`, MIME, size. File bytes and tokens are not logged.

## 5. Upload / replacement behavior

1. Multer memory upload, field `file`, MIME filter + size limit.
2. Magic-byte check (`%PDF`, JPEG SOI, PNG signature). Declared MIME must match bytes.
3. Filename sanitized (`path.basename`, strip control chars / `..`, keep `[A-Za-z0-9._-]`).
4. Write a **new** object (`wx`). Previous object is left in place until the DB row is updated.
5. Upsert the unique `(driver_id, document_type)` row to the new key.
6. If DB write fails, the new object is deleted (no orphan pointer).
7. If DB write succeeds, the previous object is deleted. Cleanup failure is logged and does not roll back the new current document.

## 6. Admin retrieval behavior

1. Admin opens Driver Details (`GET /api/drivers/:id`) or `GET /api/v1/admin/fleet/drivers/:driverId/documents`.
2. UI shows filename, type, size, `uploadedAt` when present.
3. Open/download uses `downloadUrl` (short-lived token) or JWT + content GET.
4. Token cannot be reused for another driver, type, or storage key.

## 7. Files changed

**Added**

- `src/config/driverDocuments.ts`
- `src/db/schema/driver_documents.ts`
- `src/db/migrations/0034_driver_documents.sql`
- `src/repositories/driverDocument.repository.ts`
- `src/services/driver-document-storage.service.ts`
- `src/services/driverDocument.service.ts`
- `src/middleware/driverDocumentUpload.ts`
- `src/controllers/driverDocument.controller.ts`
- `src/routes/v1/driver/documents.ts`
- `src/routes/v1/admin/driverDocuments.ts`
- `tests/driver-document-storage.test.ts`
- `tests/driver-documents.service.test.ts`
- `tests/driver-documents.routes.test.ts`
- `DRIVEWIZE_BACKEND_DRIVER_DOCUMENTS_IMPLEMENTATION_REPORT.md`

**Updated**

- `src/db/schema/index.ts`, `src/db/migrations/meta/_journal.json`
- `src/routes/v1/index.ts`, `src/routes/v1/admin/fleet.ts`, `src/routes/drivers.ts`
- `src/validators/index.ts`
- `src/config/rate-limit.ts`, `src/middleware/rate-limiters.ts`, `src/middleware/rate-limit-paths.ts`
- `src/config/env-validator.ts`, `src/index.ts`
- `.env.example`, `.gitignore` (`private-media/driver-documents/`)
- `tests/rate-limit-config.test.ts`

## 8. Targeted tests

Command:

```bash
npx jest tests/driver-document-storage.test.ts tests/driver-documents.service.test.ts tests/driver-documents.routes.test.ts tests/rate-limit-config.test.ts --runInBand --no-coverage
```

Result: **52 passed**. Full suite was not run.

Coverage:

- MIME + magic-byte validation, oversized files, filename sanitization
- Path traversal rejected; private write/replace/delete
- Signed token bound to driver/document
- Upload replace does not leave the previous object; failed DB write deletes the new object
- Driver JWT ownership (client `driverId` ignored)
- Admin authorization; driver cannot use admin list
- Invalid type/MIME rejected before storage
- Retrieval with signed token

## 9. Deployment / storage prerequisites

1. Run migration `0034_driver_documents`.
2. Ensure the process can write `private-media/driver-documents/` (or `DRIVER_DOCUMENT_STORAGE_ROOT`). This is the same private volume as ride video when `VIDEO_STORAGE_ROOT` is used.
3. Optional env:

```
DRIVER_DOCUMENT_MAX_BYTES=10485760
DRIVER_DOCUMENT_READ_URL_TTL_SECONDS=300
DRIVER_DOCUMENT_STORAGE_ROOT=private-media
DRIVER_DOCUMENT_STORAGE_CONTAINER=driver-documents
DRIVER_DOCUMENT_SIGNING_SECRET=<32+ chars in production>
API_PUBLIC_BASE_URL=https://api.example.com
```

4. Do not expose `private-media` as a public bucket or static route.
5. Restart the API after migrate so `ensureDriverDocumentDirectories` can create the container folder.

## 10. Android, iOS, and Admin integration requirements

Backend contracts only. No mobile or Admin URLs were invented on those codebases.

### Android / iOS (driver app)

- Authenticate with the existing driver JWT.
- `GET /api/v1/driver/documents` to render license/insurance slots.
- `PUT /api/v1/driver/documents/driving_license` and `…/insurance` with multipart field **`file`**. PDF, JPEG, PNG only, max 10 MB (or configured limit).
- Preview/download: `GET …/content` with `Authorization: Bearer`, or open `downloadUrl` before `downloadUrlExpiresAt`.
- Do not send `driverId`. Do not use avatar or ride-video upload APIs.
- Handle `INVALID_DOCUMENT_TYPE`, `FILE_TOO_LARGE`, `AUTH_FAILED`.

### Admin web

- Driver Details: read `documents` from `GET /api/drivers/:id`, or call `GET /api/v1/admin/fleet/drivers/:driverId/documents`.
- Open/download via `downloadUrl` (token) or authenticated content GET.
- Empty slot = `null`. No approval UI is provided by this backend.

---

**DRIVER DOCUMENT BACKEND IMPLEMENTED — APP/ADMIN INTEGRATION REQUIRED**
