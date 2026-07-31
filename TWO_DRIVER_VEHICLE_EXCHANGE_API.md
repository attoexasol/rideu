# Two-Driver Vehicle Exchange API

Phase 3 of the RYD U multi-fleet system: atomic two-driver vehicle swap while both drivers remain on duty.

## Business flow

1. **Driver A** is on duty with **Vehicle A** (active duty session + active assignment).
2. **Driver B** is on duty with **Vehicle B**.
3. Neither driver has an active ride; neither is accepting a booking offer.
4. Driver A scans **Vehicle B** QR → `POST /api/v1/driver/vehicle-exchanges`.
5. Driver B receives `vehicle_exchange:requested` socket event.
6. Driver B scans **Vehicle A** QR → `POST /api/v1/driver/vehicle-exchanges/:id/confirm`.
7. Backend atomically swaps assignments and `drivers.vehicle_id`; both duty sessions stay **active**.

Assignments are **not** changed during initiation — only on successful confirm.

---

## Database schema

### `vehicle_exchange_requests`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| fleet_id | FK → fleets | Same fleet required (v1) |
| organization_id | FK → organizations | |
| initiator_driver_id | FK → drivers | Driver A |
| partner_driver_id | FK → drivers | Driver B |
| initiator_vehicle_id | FK → vehicles | Vehicle A at initiate time |
| partner_vehicle_id | FK → vehicles | Vehicle B at initiate time |
| initiator_assignment_id | FK → driver_vehicle_assignments | Locked snapshot |
| partner_assignment_id | FK → driver_vehicle_assignments | Locked snapshot |
| initiator_duty_session_id | FK → duty_sessions | Remains active after swap |
| partner_duty_session_id | FK → duty_sessions | Remains active after swap |
| initiator_scanned_token_id | FK → vehicle_qr_tokens | Partner vehicle QR |
| partner_scanned_token_id | FK → vehicle_qr_tokens nullable | Initiator vehicle QR on confirm |
| status | string | `pending`, `completed`, `cancelled`, `expired`, `failed` |
| idempotency_key | string | Per initiator |
| expires_at | timestamp | Default TTL 300s |
| initiated_at, confirmed_at, cancelled_at | timestamps | |
| cancelled_by_driver_id | FK nullable | |
| cancel_reason | string nullable | |
| completed_by | string | e.g. `mutual_qr` |
| version | integer | Optimistic versioning |
| created_at, updated_at | timestamps | |

Unique: `(initiator_driver_id, idempotency_key)`.

### `vehicle_exchange_events` (append-only audit)

| Column | Type |
|--------|------|
| id | UUID PK |
| exchange_request_id | FK |
| event_type | string (`initiated`, `completed`, `cancelled`, `expired`, …) |
| actor_type | string (`driver`, `admin`, `system`) |
| actor_id | UUID nullable |
| payload | JSONB |
| created_at | timestamp |

### `vehicle_exchange_resource_locks`

Child rows released on terminal status. Enforces **global** one-pending-lock per driver and per vehicle.

---

## Concurrency guarantee (exact)

Separate unique indexes on `initiator_driver_id` and `partner_driver_id` alone **do not** prevent the same driver appearing as partner in exchange A and initiator in exchange B.

**Strategy:** `vehicle_exchange_resource_locks` with partial unique indexes:

```sql
uq_verl_active_driver ON (resource_id) WHERE resource_type = 'driver' AND released_at IS NULL
uq_verl_active_vehicle ON (resource_id) WHERE resource_type = 'vehicle' AND released_at IS NULL
```

On initiate, four lock rows are inserted (both drivers, both vehicles). Any second pending exchange touching the same driver or vehicle fails with `23505` → `EXCHANGE_ALREADY_PENDING`.

Combined with `SELECT … FOR UPDATE` in deterministic UUID order inside transactions, this guarantees:

- At most one pending exchange per driver (any role).
- At most one pending exchange per vehicle (any role).
- Confirm/expire/cancel races resolve to exactly one terminal status via conditional `UPDATE … WHERE status = 'pending'`.

### Locking order (all exchange transactions)

1. Drivers (sorted UUID)
2. Duty sessions (sorted)
3. Assignments (sorted)
4. Vehicles (sorted)
5. Exchange row (`FOR UPDATE` on confirm/cancel/expire)

---

## Driver endpoints

Base path: `/api/v1/driver/vehicle-exchanges`  
Auth: Driver JWT (`requireAuth` + `requireDriver`)

### Initiate exchange

`POST /api/v1/driver/vehicle-exchanges`

**Headers**

| Header | Required |
|--------|----------|
| `Authorization` | Bearer driver JWT |
| `Idempotency-Key` | Yes |

**Body**

```json
{
  "scannedVehicleQrToken": "VQR_…",
  "location": { "latitude": 23.81, "longitude": 90.41 }
}
```

**Success:** `201` (or `200` if idempotent replay)

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "pending",
    "role": "initiator",
    "expiresAt": "2026-07-12T10:05:00.000Z",
    "initiatorDriverId": "…",
    "partnerDriverId": "…",
    "initiatorVehicleId": "…",
    "partnerVehicleId": "…",
    "idempotent": false
  }
}
```

**After commit (not in DB transaction):**

- Both drivers dispatch-suspended in Redis (`exchange:dispatch_suspended:{driverId}`)
- Pending booking offers cancelled with reason `vehicle_exchange_pending`
- `vehicle_exchange:requested` → partner driver
- Expiration poller will expire at `expires_at`

### Confirm exchange

`POST /api/v1/driver/vehicle-exchanges/:exchangeId/confirm`

**Body:** same shape as initiate (partner scans **initiator's vehicle** QR).

**Caller:** partner driver only.

**Success:**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "completed",
    "role": "partner",
    "idempotent": false,
    "assignments": {
      "assignmentId": "new-assignment-uuid",
      "vehicleId": "swapped-vehicle-uuid"
    }
  }
}
```

**Atomic swap (single transaction):**

1. Close both predecessor assignments (`unassigned_reason = vehicle_exchange`)
2. Insert two new active assignments (cross-linked `predecessor_assignment_id`, `exchange_request_id`)
3. Update `drivers.vehicle_id` for both drivers
4. Mark exchange `completed`, release resource locks
5. Append `completed` audit event with before/after payload

**After commit:** clear dispatch suspension, refresh Redis driver status, emit `vehicle_exchange:completed` and `vehicle_assignment:changed` to both drivers. Service category eligibility is recalculated from new vehicle via existing `vehicleEligibility` / `vehicle_service_categories` (no requirement for identical categories pre-swap).

### Cancel exchange

`POST /api/v1/driver/vehicle-exchanges/:exchangeId/cancel`

**Body**

```json
{ "reason": "changed_mind" }
```

Either participant may cancel while `pending`. Idempotent if already `cancelled`. Assignments unchanged.

### Current pending exchange

`GET /api/v1/driver/vehicle-exchanges/current`

Returns pending exchange for authenticated driver as initiator or partner, or `null`.

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "pending",
    "role": "partner",
    "expiresAt": "…",
    "partner": { "driverId": "…", "displayName": "…" },
    "yourVehicle": { "id": "…", "plateNumber": "…" },
    "partnerVehicle": { "id": "…", "plateNumber": "…" }
  }
}
```

Use on Kotlin cold start / resume.

---

## Socket events

All emitted **after** DB commit via driver socket channel.

| Event | Recipient | Key payload fields |
|-------|-----------|-------------------|
| `vehicle_exchange:requested` | Partner | `exchangeId`, `status`, `expiresAt`, `partner`, `yourVehicle`, `partnerVehicle` |
| `vehicle_exchange:cancelled` | Both | `exchangeId`, `status`, `reason` |
| `vehicle_exchange:expired` | Both | `exchangeId`, `status` |
| `vehicle_exchange:completed` | Both | `exchangeId`, `status`, `yourVehicle`, `partnerVehicle`, `assignmentId` |
| `vehicle_assignment:changed` | Both | `exchangeId`, `assignmentId`, `vehicleId` |

---

## Dispatch protection

| State | Eligibility code | HTTP on offer accept |
|-------|----------------|---------------------|
| Pending exchange (DB) | `EXCHANGE_PENDING` | 409 |
| Dispatch suspended (Redis) | `EXCHANGE_PENDING` | 409 |
| Accepting offer (Redis) | `EXCHANGE_PENDING` / `BOOKING_ACCEPTANCE_IN_PROGRESS` | 409 |

On initiate: pending offers cancelled immediately (`vehicle_exchange_pending`). New offers blocked until complete/cancel/expire.

---

## Expiration

| Variable | Default |
|----------|---------|
| `VEHICLE_EXCHANGE_TTL_SECONDS` | `300` |

**Implementation:** `vehicleExchangeExpiration.service` polls every 15s, calls `expireVehicleExchange` for rows where `status = pending` AND `expires_at < now()`.

Confirm uses `WHERE status = pending AND expires_at > now()` — confirm vs expire race yields exactly one winner.

---

## Admin endpoints

Base: `/api/v1/admin/fleet` (admin JWT)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/vehicle-exchanges` | List (`?status=&fleetId=`) |
| GET | `/vehicle-exchanges/:id` | Detail |
| GET | `/vehicle-exchanges/:id/events` | Audit trail |
| POST | `/vehicle-exchanges/:id/cancel` | Force cancel pending |

**Force complete:** disabled by default (`VEHICLE_EXCHANGE_FORCE_COMPLETE_ENABLED=false`). Returns `501` if enabled without full v1 implementation.

---

## Error codes

| Code | HTTP | When |
|------|------|------|
| `ACTIVE_RIDE_BLOCKS_EXCHANGE` | 409 | Active booking on either driver |
| `DRIVER_NOT_ON_DUTY` | 409 | No active duty/assignment |
| `OTHER_DRIVER_NOT_ON_DUTY` | 409 | Partner not on duty |
| `VEHICLE_NOT_ASSIGNED` | 409 | Scanned vehicle has no active assignment |
| `FLEET_MISMATCH` | 409 | Different fleets (v1) |
| `EXCHANGE_ALREADY_PENDING` | 409 | Driver/vehicle locked |
| `ASSIGNMENT_CHANGED` | 409 | Assignment IDs/vehicles changed since initiate |
| `VEHICLE_NOT_APPROVED` | 409 | Vehicle status not approved |
| `QR_TOKEN_INVALID` | 400 | Bad/revoked QR or wrong vehicle on confirm |
| `EXCHANGE_EXPIRED` | 410 | Past `expires_at` |
| `EXCHANGE_ALREADY_COMPLETED` | 200 | Idempotent confirm |
| `EXCHANGE_CONFLICT` | 409 | Race / not found terminal conflict |
| `BOOKING_ACCEPTANCE_IN_PROGRESS` | 409 | Driver accepting offer |
| `CANNOT_SWAP_OWN_VEHICLE` | 400 | Scanned own vehicle |
| `PARTNER_REQUIRED` | 403 | Non-partner confirm |
| `EXCHANGE_PENDING` | 409 | Dispatch/accept blocked |

---

## Kotlin integration sequence

```
1. On duty start (existing) → duty session + assignment active
2. Poll GET /vehicle-exchanges/current on app resume
3. Driver A scans partner vehicle QR
   → POST /vehicle-exchanges with Idempotency-Key (UUID per tap)
   → Show waiting UI with expiresAt countdown
4. Driver B receives socket vehicle_exchange:requested
   → Navigate to confirm screen
5. Driver B scans initiator vehicle QR
   → POST /vehicle-exchanges/:id/confirm
6. Both receive vehicle_exchange:completed + vehicle_assignment:changed
   → Refresh local vehicle context from assignmentId / vehicleId
7. On cancel or expiry → clear UI, resume dispatch
```

**Idempotency:** reuse same `Idempotency-Key` for initiate retries; confirm is idempotent when already completed.

---

## Deployment variables

```env
VEHICLE_EXCHANGE_TTL_SECONDS=300
VEHICLE_EXCHANGE_FORCE_COMPLETE_ENABLED=false
QR_DUTY_REQUIRED=false   # unchanged; do not enable automatically
```

**Deploy steps:**

1. `npm run db:migrate` (applies `0016_vehicle_exchange.sql`)
2. `npm run build`
3. Restart API (expiration poller starts in `src/index.ts`)
4. Ensure Redis available for dispatch suspension keys

---

## Known limitations (v1)

- Same fleet only; no cross-fleet swaps
- No public fleet onboarding / payments / settlements
- Admin force-complete not implemented (flag off)
- QR duty not required by default (`QR_DUTY_REQUIRED=false`)
- Socket/Redis failures after commit do not roll back completed swaps (clients should reconcile via `GET /current` and assignment APIs)
- Historical bookings retain original `assigned_vehicle_id` (by design)

---

## Tests

- Unit/config: `tests/vehicle-exchange.test.ts`
- DB integration (20 scenarios): `tests/vehicle-exchange.integration.test.ts`
- Fixtures: `tests/helpers/vehicleExchange.fixtures.ts`

Run: `npm test`
