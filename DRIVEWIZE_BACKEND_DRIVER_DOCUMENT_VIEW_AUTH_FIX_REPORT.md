# DRIVEWIZE BACKEND — DRIVER DOCUMENT VIEW AUTH FIX

**Status: DRIVER DOCUMENT SIGNED URL AUTH FIX IMPLEMENTED — DEVICE RETEST REQUIRED**

## Confirmed root cause

`GET /api/v1/driver/documents/:documentType` already returns a valid HMAC `downloadUrl`:

`/api/v1/driver/documents/{documentType}/content?token=...`

The token is bound to the document id, driver id, document type, and storage key, and it expires (default 300 seconds).

The browser request failed before that token was read. `GET /:documentType/content` in `src/routes/v1/driver/documents.ts` applied `requireAuth` on every request. A browser open has no `Authorization` header, so `requireAuth` returned:

```json
{"success":false,"error":{"code":"AUTH_FAILED","message":"No token provided"}}
```

Ride-video content does not do this. `GET /api/v1/admin/video/segments/:segmentId/content` treats the signed query token as the authorization and does not require a Bearer JWT.

The admin document content route already followed that pattern: a non-empty `token` is verified without JWT; a request with no token still requires an admin JWT. No parent router or global auth middleware blocks either content path. The global rate limiter already skips these routes.

## Middleware / route correction

Driver content now matches the ride-video signed-read pattern:

| Request | Authorization |
| --- | --- |
| `GET .../content?token=<valid>` | HMAC token only. No Driver JWT. |
| `GET .../content` with no token | Existing Driver JWT (`requireAuth` + `requireDriver`). |
| Missing JWT and missing token | `401 AUTH_FAILED`. |
| Expired, tampered, or wrong document/driver/storage key | `403 INVALID_DOCUMENT_READ_AUTHORIZATION`. |

The driver URL has no `driverId` in the path. After the signature, purpose, and expiry checks succeed, the driver id is taken from the signed claims, the current row is loaded, and the token is checked again against that row’s document id, driver id, type, and storage key. A token cannot be used for another driver, the other document type, or a replaced object.

Metadata (`GET /` and `GET /:documentType`) and upload (`PUT /:documentType`) still require the Driver JWT.

Admin content was already correct and was left on the same rule: signed token without JWT, or admin JWT when no token is present. Anonymous access without a valid signed token is still rejected.

## Files changed

- `src/routes/v1/driver/documents.ts` — signed token bypasses JWT only on the content route
- `src/controllers/driverDocument.controller.ts` — `streamSignedOwnDriverDocumentHandler`
- `src/services/driverDocument.service.ts` — `resolveSignedDriverDocumentFile`
- `src/services/driver-document-storage.service.ts` — `readDocumentReadToken` (signature, purpose, expiry) used before row binding
- `tests/driver-documents.routes.test.ts`
- `tests/driver-documents.service.test.ts`

Upload APIs, metadata JSON, storage, replacement, and mobile/admin clients were not changed.

## Security checks

- No public static path and no permanent URL
- Token still HMAC-SHA256, short-lived, and bound to one stored object
- Cross-driver and cross-type tokens are rejected
- Invalid token does not fall through to anonymous access
- JWT-only access remains limited to the authenticated driver’s own file, or an authorized admin

## Targeted tests

```bash
npx jest tests/driver-document-storage.test.ts tests/driver-documents.service.test.ts tests/driver-documents.routes.test.ts --runInBand --no-coverage
```

**29 passed.** Covered:

1. Valid signed driver URL without `Authorization` → 200
2. Driver JWT without signed token → 200 for own document
3. No JWT and no token → 401
4. Expired and tampered tokens → rejected
5. Token for another driver or the other document type → rejected
6. Admin signed content URL without JWT → 200
7. Metadata and upload still require JWT

## Deployment

No migration. Restart the API process so this route change is loaded, then retest View Document on Android and iOS. Open the document within the `downloadUrlExpiresAt` window (default 5 minutes). If the link is older than that, the app should call the metadata endpoint again and open the new `downloadUrl`.

**DRIVER DOCUMENT SIGNED URL AUTH FIX IMPLEMENTED — DEVICE RETEST REQUIRED**
