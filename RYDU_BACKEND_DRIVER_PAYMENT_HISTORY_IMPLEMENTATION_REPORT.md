# RYDU Backend — Driver Payment / Earnings History Implementation Report

**Workspace:** `backend_rydu`  
**Date:** 2026-09-09  
**Scope:** Read-only Driver financial history API. No Stripe Transfer, no commission calculation, no Android/iOS changes.

**Final status:** **RYDU BACKEND DRIVER PAYMENT HISTORY COMPLETE — ANDROID INTEGRATION REQUIRED**

---

## 1. Endpoints added

All routes are Driver JWT only: `requireAuth` + `extractUserInfo` + `requireDriver` (includes `trackDriverDevice` session invalidation) + `driverGeneralRateLimit`.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/v1/driver/payments` | Paginated payment/financial history for the authenticated Driver |
| `GET` | `/api/v1/driver/payments/summary` | Authoritative totals that exist today (not driver earnings) |
| `GET` | `/api/v1/driver/payments/{paymentId}` | Read-only detail for one history item |

`/summary` is registered before `/:paymentId`.

Resource identity:

- Preferred `id` is `booking_payments.id` when a ledger row exists.
- If a cash ride has no `booking_payments` row, `id` is the booking UUID.
- Detail lookup tries `booking_payments.id` first, then booking UUID, both scoped to `bookings.assigned_driver_id = authenticated driver`.

`driverId` from query/body is ignored. The Driver is resolved only from the JWT (`driverUtils.findByAuth0Id`).

---

## 2. Exact response contract

Standard Rydu envelope:

```json
{
  "success": true,
  "data": {},
  "metadata": { "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 } },
  "error": { "code": "...", "message": "..." }
}
```

### List / detail item

```json
{
  "id": "3f77185c-cb7d-4398-9070-a32ce9523b95",
  "bookingId": "2a7198b2-9de3-4c1d-a6bd-3a6b93ac45bc",
  "bookingNumber": "RYD-MTTAVE2S-UIRZ",
  "paymentRecordId": "3f77185c-cb7d-4398-9070-a32ce9523b95",
  "ride": {
    "status": "completed",
    "completedAt": "2026-09-08T23:29:03.774Z",
    "pickup": {
      "latitude": 23.7638495,
      "longitude": 90.4288118,
      "address": "35 Road No. 2, Dhaka 1212, Bangladesh",
      "spotLabel": "35 Road No. 2"
    },
    "dropoff": {
      "latitude": 23.2195505,
      "longitude": 90.3482463,
      "address": "Shariatpur, Bangladesh"
    },
    "serviceName": "Ride",
    "serviceCode": "ride"
  },
  "passengerPayment": {
    "amount": { "minor": 144235, "formatted": "1442.35", "currency": "BDT" },
    "status": "captured",
    "methodCode": "card",
    "capturedAt": "2026-09-08T23:29:05.156Z"
  },
  "settlement": {
    "status": "not_created",
    "driverAmount": null,
    "platformAmount": null,
    "airportFee": null,
    "settledAt": null
  },
  "transfer": {
    "status": "not_started",
    "transferredAt": null
  }
}
```

Detail adds only existing timestamps / failure fields:

```json
{
  "passengerPayment": {
    "authorizedAt": "...",
    "failedAt": null,
    "refundedAt": null,
    "failureCode": null,
    "failureMessage": null
  },
  "settlement": {
    "createdAt": null,
    "updatedAt": null
  }
}
```

Field-name adaptations from the conceptual shape:

| Conceptual | Actual |
|------------|--------|
| `otherFeeAmount` | `airportFee` (schema column `booking_settlements.airport_fee`) |
| `methodCode` | kept (`booking_payments.payment_method`, else catalog `payment_methods.code`) |
| ride pickup/dropoff strings | structured objects matching existing Driver ride-history convention |

Never returned: `client_secret`, Stripe secrets, PaymentIntent/charge/transfer IDs, Account Link, bank/routing, identity/tax, raw Stripe payloads.

---

## 3. Exact DB tables / fields used

Audited from schema + migration `0027_stripe_payment_foundation.sql`. No speculative columns.

### `booking_payments`

`id`, `booking_id`, `payment_method` (`cash` \| `card`), `currency`, `gross_amount` (integer minor units), `provider` (`none` \| `cash` \| `stripe`), `provider_payment_intent_id`, `provider_charge_id`, `status`, `authorized_at`, `captured_at`, `failed_at`, `refunded_at`, `failure_code`, `failure_message`, `created_at`, `updated_at`

Driver API **reads** amount/status/method/timestamps/failure fields only. Provider IDs are **not selected**.

### `booking_settlements`

`id`, `booking_id`, `payment_id`, `status`, `gross_amount`, `driver_amount` (nullable), `platform_amount` (nullable), `airport_fee` (nullable), `currency`, `provider_transfer_id`, `calculation_version`, `created_at`, `updated_at`

There is **no** `settled_at` column. `settledAt` in the API is therefore always `null`. `provider_transfer_id` is not exposed.

Phase D does **not write** settlement rows. Live sandbox card rides currently have no settlement row.

### `bookings`

Used: `id`, `booking_number`, `status`, `completed_at`, `assigned_driver_id`, `pickup_*`, `dropoff_*`, `service_category_id`, `payment_method_id`

Ownership filter: `assigned_driver_id = authenticated driver`. `bookings.payment_status` (`pending` / `paid`) is **not** used as passenger-payment ledger status.

### `payment_methods`

`code` used only as fallback method for cash rides that have no `booking_payments` row.

### `service_categories`

`name`, `code` for ride display.

### Eligibility

A row is returned when the booking is assigned to the Driver **and**:

- a `booking_payments` row exists (any ledger status), **or**
- catalog payment method is `cash` and booking status is `completed` or `cancelled`

Existing cash bookings were never required to have a `booking_payments` row (Phase A). Those appear with `passengerPayment.status = not_recorded` and `amount = null`.

No new indexes. Existing unique/status indexes are sufficient; no speculative schema change.

---

## 4. Pagination

Query: `page` (default `1`, min `1`), `limit` (default `20`, max `50`) — same ceiling as Driver booking history.

Pagination is applied in SQL (`LIMIT` / `OFFSET = (page-1)*limit`). Count is a separate `count(*)` with the same eligibility filter.

Response:

```json
"metadata": {
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

Ordering (newest financial/ride records first, deterministic):

1. `COALESCE(bookings.completed_at, booking_payments.captured_at, booking_payments.created_at, bookings.created_at) DESC`
2. `COALESCE(booking_payments.id, bookings.id) DESC`

---

## 5. Normalized passenger payment statuses

Driver-facing `passengerPayment.status` is the **actual** `booking_payments.status` when a row exists. These are not collapsed:

`pending`  
`requires_payment_method`  
`requires_action`  
`authorized`  
`capture_pending`  
`captured`  
`failed`  
`cancelled`  
`refund_pending`  
`refunded`

`captured` means **passenger payment captured by the Rydu platform**. It does **not** mean the Driver was paid.

API-only state when no ledger row exists:

`not_recorded`

---

## 6. Settlement statuses

Authoritative source is `booking_settlements.status` when a row exists:

`unresolved`  
`pending`  
`processing`  
`settled`  
`failed`  
`skipped_cash`

API-only state when no settlement row exists:

`not_created`

The API never silently claims `settled`.

---

## 7. Null driver / platform amounts

`driver_amount`, `platform_amount`, and `airport_fee` are nullable in the schema and stay `null` until commission rules exist.

`calculateSettlement()` still throws `SettlementRulesNotConfiguredError`. This task does not invent splits.

Mapped fields:

- `settlement.driverAmount = null`
- `settlement.platformAmount = null`
- `settlement.airportFee = null`

when the DB values are NULL or the settlement row is missing.

---

## 8. Treatment of cash

- No Stripe calls.
- Method comes from `booking_payments.payment_method` or catalog `payment_methods.code`.
- A cash ledger row is returned as-is, including `skipped_cash` if that settlement status exists.
- A completed/cancelled cash booking **without** a ledger row is still listed: `methodCode = cash`, `status = not_recorded`, `amount = null`.
- Existing cash completion (`bookings.payment_status = paid`, no Stripe) is unchanged.

---

## 9. Summary semantics

`GET /api/v1/driver/payments/summary`

```json
{
  "driverEarningsAvailable": false,
  "capturedPassengerPayments": [
    { "minor": 144235, "formatted": "1442.35", "currency": "BDT", "count": 1 }
  ],
  "settlementCounts": {
    "notCreated": 1,
    "unresolved": 0,
    "pending": 0,
    "processing": 0,
    "settled": 0,
    "failed": 0,
    "skippedCash": 0
  }
}
```

Rules:

- `driverEarningsAvailable` is always `false`.
- No `totalEarnings`, `paidToDriver`, or `availableBalance`.
- Captured **passenger** gross is grouped by currency. Currencies are never added together.
- `settlementCounts.notCreated` counts history-eligible assigned bookings with no settlement row.

---

## 10. Authorization rules

| Case | Result |
|------|--------|
| Missing/invalid JWT | `401 AUTH_FAILED` |
| Non-driver role | `403 UNAUTHORIZED` |
| Driver row missing | `404 NOT_FOUND` |
| Session mismatch (`requireDriver` / `trackDriverDevice`) | `401 SESSION_INVALID`, `sessionInvalidated: true` |
| Another Driver’s payment or unknown id | `404 PAYMENT_NOT_FOUND` (does not leak existence) |

Driver A cannot select Driver B by query/body `driverId`.

---

## 11. Completed sandbox ride result

Live DB probe (read-only) found completed card booking **`RYD-MTTAVE2S-UIRZ`**.

| Concept | Value |
|---------|--------|
| Ride | `completed` at `2026-09-08T23:29:03.774Z` |
| Passenger payment | `captured`, card, `144235` BDT poisha (`1442.35`) |
| Captured at | `2026-09-08T23:29:05.156Z` |
| Settlement row | **absent** → API `not_created` |
| `driverAmount` / `platformAmount` / `airportFee` | `null` |
| Transfer | `not_started` (no `provider_transfer_id`) |
| Appears in `listDriverPaymentHistory` for assigned driver | **yes** |

Historical financial values were **not** modified.

Semantic split held:

`booking completed` ≠ `passenger payment captured` ≠ `settlement resolved` ≠ `Stripe transfer completed` ≠ `bank payout completed`

---

## 12. Files changed

### New

| File | Purpose |
|------|---------|
| `src/repositories/driverPaymentHistory.repository.ts` | Joined, paginated, driver-scoped queries |
| `src/services/driverPaymentHistory.service.ts` | Mapping, status normalization, summary (no Stripe) |
| `src/controllers/driverPayment.controller.ts` | JWT Driver resolution + response envelope |
| `src/routes/v1/driver/payments.ts` | Route registration |
| `tests/driver-payment-history.test.ts` | Status, cash, settlement, pagination, summary, secrets |
| `tests/driver-payment-history-routes.test.ts` | HTTP auth, ownership, session, pagination |
| `RYDU_BACKEND_DRIVER_PAYMENT_HISTORY_IMPLEMENTATION_REPORT.md` | This report |

### Modified

| File | Change |
|------|--------|
| `src/constants/payment.ts` | API-only `not_recorded`, `not_created`, `not_started` |
| `src/validators/index.ts` | `driverPaymentHistoryQuerySchema`, `paymentIdParamSchema` |
| `src/routes/v1/index.ts` | Mount `/driver/payments` |
| `src/middleware/rate-limit-paths.ts` | Skip global limiter; dedicated Driver limiter applies |
| `tests/rate-limit-config.test.ts` | Skip-path assertions |

No migrations. No Android / iOS / Admin UI.

---

## 13. Tests / build

```
npm run build
npx jest tests/driver-payment-history.test.ts tests/driver-payment-history-routes.test.ts tests/rate-limit-config.test.ts tests/stripe-phase-a.test.ts tests/ride-history-routes.test.ts tests/ride-history-service.test.ts
```

**Build:** passed  
**Focused suites:** passed

Covered:

| ID | Case |
|----|------|
| A | Completed card + captured ≠ driver paid |
| B | `authorized` not collapsed |
| C | `capture_pending` not collapsed |
| D | `failed` / `cancelled` distinct |
| E | `refunded` / `refund_pending` distinct |
| F | Cash without Stripe; `skipped_cash` preserved |
| G | Missing settlement → `not_created` |
| H | `unresolved` exposed |
| I | Null driver/platform/airport amounts |
| J | DB-level pagination |
| K | Newest-first delegated to SQL sort keys |
| L | Other Driver → `PAYMENT_NOT_FOUND` |
| M | `SESSION_INVALID` + `sessionInvalidated` |
| N | Summary never labels captured gross as earnings |
| O | Multi-currency not summed |
| P | No `client_secret` / Stripe secrets / provider IDs |

---

## 14. Known limitation — Stripe Transfer is not implemented

`transfer.status = "not_started"` is a **backend-normalized application state**, not a Stripe Transfer object status.

This API does **not**:

- create or query Stripe Transfers
- calculate commission / driver share / platform share
- allocate airport fees
- track bank payouts
- call Stripe Payouts
- refund beyond exposing existing ledger states
- apply cancellation fees

Until settlement rules and Transfers exist, a completed captured card ride will correctly look like:

```
ride: completed
passengerPayment: captured
settlement: not_created
driverAmount: null
transfer: not_started
```

That is financially true, not a UI gap to paper over.

---

## Android integration notes

1. Call `GET /api/v1/driver/payments` with the existing Driver JWT and device/session headers.
2. Treat `passengerPayment.status = captured` as **platform captured passenger fare**, never as “Driver paid”.
3. Hide or label settlement/transfer as pending/unavailable while `settlement.status` is `not_created` / `unresolved` and `transfer.status` is `not_started`.
4. Do not display `capturedPassengerPayments` as earnings. Use `driverEarningsAvailable === false`.
5. Detail: `GET /api/v1/driver/payments/{id}` using list `id` (payment UUID, or booking UUID for cash-without-ledger).

**RYDU BACKEND DRIVER PAYMENT HISTORY COMPLETE — ANDROID INTEGRATION REQUIRED**
