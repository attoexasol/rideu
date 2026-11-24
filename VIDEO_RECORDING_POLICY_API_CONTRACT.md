# Global Video Recording Policy — API Contract

One global switch controls ride video recording for every Driver app.
It is stored in PostgreSQL (`platform_settings.video_recording_enabled`), defaults to **OFF**,
and persists across restarts and deployments. OpenAPI: `VIDEO_RECORDING_POLICY_API.openapi.yaml`.

All responses use the standard envelope: `{ "success": true, "data": … }` or
`{ "success": false, "error": { "code", "message", "details?" } }`.

## Two gates

| Field | Meaning | Who changes it |
|---|---|---|
| `enabled` (Admin view) | Saved Admin preference | Admin Dashboard, no redeploy |
| `serverRecordingAvailable` | Server recording pipeline, env `VIDEO_RECORDING_ENABLED` | VPS `.env.production` + backend restart |
| `effectiveEnabled` | `enabled AND serverRecordingAvailable` | — |

Drivers only ever see the effective value, named `enabled`.

**Production today:** `VIDEO_RECORDING_ENABLED=false`, so the Admin toggle is saved but cannot
start recording until operations set `VIDEO_RECORDING_ENABLED=true` (with `VIDEO_SIGNING_SECRET`,
`VIDEO_STORAGE_ROOT`, `VIDEO_STORAGE_CONTAINER` and the numeric `VIDEO_*` settings the env
validator requires) and restart the backend. After that one-time step, Admin ON/OFF takes effect
immediately with no redeploy.

**Dashboard display:** when `serverRecordingAvailable` is `false`, keep the toggle usable but show
"Recording pipeline unavailable on the server — drivers will not record" and render the status from
`effectiveEnabled`, not `enabled`.

## Admin

### GET `/api/v1/admin/settings/video-recording`

Auth: role `admin` or `super_admin` **and** permission `ride_video.view`.

```json
{
  "success": true,
  "data": {
    "enabled": false,
    "effectiveEnabled": false,
    "serverRecordingAvailable": false,
    "version": 1,
    "updatedAt": "2026-11-23T10:00:00.000Z",
    "updatedBy": null
  }
}
```

`version: 0` with `updatedAt: null` means the row is missing; it is treated as OFF.

### PATCH `/api/v1/admin/settings/video-recording`

Auth: role `admin` or `super_admin` **and** permission `ride_video.manage`.
By default only `super_admin` has `ride_video.manage`. An `admin` can change the policy only if
Auth0 grants `ride_video.manage` explicitly. If a token carries any `ride_video.*` permissions,
those are authoritative and the role defaults are ignored (same rule as all ride-video Admin APIs).

Request (`enabled` must be a JSON boolean; `expectedVersion` is optional):

```json
{ "enabled": true, "expectedVersion": 1 }
```

Response `200`:

```json
{
  "success": true,
  "data": {
    "enabled": true,
    "effectiveEnabled": true,
    "serverRecordingAvailable": true,
    "version": 2,
    "updatedAt": "2026-11-23T10:05:00.000Z",
    "updatedBy": { "email": "ops@example.com" },
    "changed": true
  }
}
```

Saving the value that is already stored returns `changed: false`, keeps the version, writes no
audit row and emits no event.

| Status | `error.code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `enabled` missing or not a boolean (`"true"`, `1`, `null`), unknown field, negative/fractional `expectedVersion` |
| 401 | `AUTH_FAILED` | No or invalid token |
| 403 | `UNAUTHORIZED` / `MISSING_PERMISSION` | Not an admin / lacks `ride_video.manage` |
| 409 | `VIDEO_RECORDING_POLICY_VERSION_CONFLICT` | `expectedVersion` is stale — reload with GET and retry |
| 503 | `VIDEO_RECORDING_POLICY_UNAVAILABLE` | PostgreSQL unreachable; nothing was changed |

**Audit:** every change inserts a `ride_video_audit_events` row with
`action = 'RECORDING_POLICY_UPDATED'`, the admin's user id, Auth0 id, email, IP and user agent, and
`metadata = { setting, previousValue, newValue, previousVersion, newVersion, changedAt }`.
The update and its audit row commit in one transaction under a row lock, so concurrent writers apply
one at a time.

## Driver

### GET `/api/v1/driver/video/recording-config`

Auth: role `driver`. Response is `Cache-Control: no-store`.

```json
{ "success": true, "data": { "enabled": false, "version": 1, "updatedAt": "2026-11-23T10:00:00.000Z" } }
```

`enabled` is the **effective** permission to record now. Clients must treat any non-200 response
(including `503 VIDEO_RECORDING_POLICY_UNAVAILABLE`), a missing body, or a non-boolean `enabled`
as OFF.

## Socket.IO

Event: **`video_recording_config_updated`**

Driver payload:

```json
{ "enabled": true, "version": 2, "updatedAt": "2026-11-23T10:05:00.000Z", "reason": "admin_update" }
```

- `reason: "admin_update"` — broadcast to every authenticated driver socket after the change is
  committed to PostgreSQL.
- `reason: "connection_sync"` — sent to a driver socket right after `authenticated`, on every
  connect and reconnect, with the latest persisted value.
- Delivery: drivers whose token resolves to a database driver join both `driver-{uuid}` and
  `drivers`; the event goes to `drivers` (via Redis pub/sub when enabled). Customers, unresolved
  driver identities and rejected tokens never receive it.
- Admin sockets (room `admin`) receive the same event name with the Admin view
  (`enabled`, `effectiveEnabled`, `serverRecordingAvailable`, `version`, `updatedAt`, `updatedBy`)
  plus `reason`.
- If PostgreSQL is unreadable at connect time no sync event is sent; REST then returns 503 and
  recording stays OFF.

**Client rule:** apply the event with the highest `version`; on app start, foreground and socket
reconnect, also call the REST endpoint. REST is authoritative.

## Server-side enforcement

While the effective policy is OFF the server refuses new recording authorisation:

| Operation | When OFF |
|---|---|
| `POST /api/v1/driver/bookings/:bookingId/video/session` (new session) | `503 VIDEO_RECORDING_DISABLED` |
| Same call when a recoverable session already exists | Returns it (lets recorded footage drain) |
| `POST /api/v1/driver/video/sessions/:sessionId/resume` | `503 VIDEO_RECORDING_DISABLED` |
| `POST /api/v1/driver/video/sessions/:sessionId/segments` (new segment) | Allowed only if `recordedAt` ≤ switch-off time (+1 segment duration) in a session that started before switch-off; otherwise `503 VIDEO_RECORDING_DISABLED` |
| Re-registering an already registered segment, PUT upload, complete, failed/retry, list, pause, finalize | Unchanged |
| Session status GET | Unchanged, plus `recordingEnabled`; `shouldContinueRecording` is `false` |
| Admin playback, downloads, audits, history | Unchanged |
| Legacy `POST /api/videos/live-chunk` | Rejected (`VIDEO_RECORDING_DISABLED`) while the Admin setting is OFF |
| `POST /api/videos/upload` (finished trip file) | Unchanged |

An unreadable policy is treated as OFF (`503 VIDEO_RECORDING_POLICY_UNAVAILABLE` where a gate needs
a decision). The server cannot stop a camera on the device; Driver apps must stop recording when
they receive `enabled: false`, and should send `recordedAt` when registering segments so footage
recorded before a switch-off can still upload.
