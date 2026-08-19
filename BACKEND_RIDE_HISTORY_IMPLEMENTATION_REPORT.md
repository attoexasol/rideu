# Backend Ride History Implementation Report

**Date:** 2026-08-17  
**Scope:** Backend only. Driver Android and Passenger Flutter were not modified.  
**Final status:** `READY FOR DRIVER AND PASSENGER HISTORY INTEGRATION`

---

## What shipped

Active restore is unchanged:

- `GET /api/v1/passenger/bookings/active`
- `GET /api/v1/driver/bookings/active`

History:

- Passenger `GET /api/v1/passenger/bookings` now returns a paginated ride snapshot (not raw rows) and **excludes ongoing statuses**.
- Driver `GET /api/v1/driver/bookings` is a new collection route, registered **before** `/:bookingId`. It lists only rides with `assigned_driver_id =` the authenticated driver, excluding active statuses.

Detail:

- `GET /api/v1/passenger/bookings/:bookingId` uses the same additive snapshot (timestamps, payment, vehicle, `recording.available`).
- `GET /api/v1/driver/bookings/:bookingId` keeps the nested live payload and adds the same history fields. Pending-offer access for live dispatch is preserved. History list never uses offer access.

Authoritative table: **`bookings`**. `trips` is not queried. Google Maps is not called for history lists; historical driver detail uses stored route fields only.

No new sockets. Ride video DVR, dispatch, accept, cancel, duty, and exchange were not redesigned.

---

## Filters

| filter | Passenger | Driver |
|--------|-----------|--------|
| `all` (default) | `completed`, `cancelled`, `no_drivers` | `completed`, `cancelled` |
| `completed` | `completed` | `completed` |
| `cancelled` | `cancelled`, `no_drivers` | `cancelled` |

`no_drivers` is never mapped to `completed`. Recommended passenger UI label for `no_drivers`: **Expired**.

Not included: `quoted`, booking status `expired`, `searching`, `offered`, `scheduled`, active ride statuses.

---

## Pagination

`page` (default 1), `limit` (default 20, max 50), `filter`. Invalid values return `400 VALIDATION_ERROR`.

Sort: `created_at DESC, id DESC`.

---

## `recording.available`

`true` when the booking has at least one playable stored segment (`uploaded`/`verified`, `storage_key` present, not retention-deleted). No session internals, signed URLs, or segment counts.

---

## Index

Migration `0023_bookings_driver_created_at.sql`:

```sql
CREATE INDEX IF NOT EXISTS "idx_bookings_driver_created_at"
  ON "bookings" ("assigned_driver_id", "created_at" DESC, "id" DESC);
```

Apply with the normal migrate path before production traffic.

---

## Tests

`npm run build` — pass  
`npm test` — **31 suites, 336 tests passed**

Coverage added for:

- Active statuses excluded from history queries
- Passenger completed / cancelled / `no_drivers`
- Driver assigned-only history (no offers, no `no_drivers`, no other driver id)
- Pagination offset and max limit
- Snapshot fields: timestamps, payment, vehicle, cancellation, `recording.available`
- Driver historical detail + preserved pending-offer detail
- Existing booking, dispatch, and DVR tests still pass

---

## Mobile integration notes

1. Keep using `/active` for the Active Ride card.
2. History screen: `/active` + `/bookings?page=1&filter=all`.
3. Do not render history rows with ongoing statuses; the backend already excludes them.
4. On terminal socket events, refetch history page 1.
5. Tap-through: existing `/:bookingId` detail routes.

Contract: `RIDE_HISTORY_API_CONTRACT.md`.
