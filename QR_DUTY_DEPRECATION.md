# QR Duty Deprecation Notes

## Legacy (still supported during rollout)

| Feature | Legacy path | Replacement |
|---------|-------------|-------------|
| Go online | `PATCH /api/drivers/:id/status` → `online` | `POST /api/v1/driver/duty/start` |
| Go offline | `PATCH /api/drivers/:id/status` → `offline` | `POST /api/v1/driver/duty/end` |
| Vehicle QR | `drivers.vehicle_qr_code`, `vehicles.qr_code` | `vehicle_qr_tokens` (opaque `VQR_*`) |
| Vehicle assignment | `drivers.vehicle_id` admin update | Active `driver_vehicle_assignments` |
| Depot check-in | `POST /api/drivers/check-in` (`COMPANY_CHECKIN`) | Duty start via vehicle QR |
| Dispatch vehicle | `drivers.vehicle_id` | Active assignment → vehicle (synced cache) |
| Service categories | `driver_service_categories` | `vehicle_service_categories` (driver fallback) |

## Feature flag

- `QR_DUTY_REQUIRED=false` (default): legacy online/GPS/dispatch paths remain available.
- `QR_DUTY_REQUIRED=true`: PATCH online requires active duty; GPS does not force off-duty drivers online; dispatch requires active duty + assignment.

## Compatibility cache

`drivers.vehicle_id` is updated on every duty start/end and remains the dispatch fallback until Kotlin duty flow is fully deployed.

## Passenger impact

None during rollout. `bookings.assigned_vehicle_id` snapshots are unchanged.

## Phase 3

Two-driver vehicle exchange will add `vehicle_exchange_requests` — not included in this release.
