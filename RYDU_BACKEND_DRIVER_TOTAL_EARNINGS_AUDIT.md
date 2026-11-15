# RYDU BACKEND — DRIVER TOTAL EARNINGS AUDIT

**Date:** 2026-09-18  
**Scope:** Read-only audit of `GET /api/v1/driver/payments/summary` and related settlement math.  
**Non-goals:** No backend, Android, or iOS changes. No settlement-formula changes.

---

## Final conclusion

**TOTAL DRIVER EARNINGS ALREADY AVAILABLE — APP INTEGRATION NEEDED**

The numeric driver share (after platform commission, with airport fee excluded from commission) is already calculated, stored, summed, and returned on the summary endpoint as `calculatedDriverEarnings[]` (grouped by currency). Apps must not treat `driverEarningsAvailable` or `capturedPassengerPayments` as that amount.

---

## Call path (current)

| Layer | File | Role |
|-------|------|------|
| Route | `src/routes/v1/driver/payments.ts` | `GET /summary` → `getDriverPaymentSummaryHandler` |
| Controller | `src/controllers/driverPayment.controller.ts` | Resolves self-driver; `sendSuccess(res, data)` |
| Service | `src/services/driverPaymentHistory.service.ts` | `getDriverPaymentSummary` / `formatDriverPaymentSummary` |
| Repository | `src/repositories/driverPaymentHistory.repository.ts` | Currency-grouped sums + settlement status counts |
| Settlement write | `src/services/settlement.service.ts` | Writes `booking_settlements.driver_amount` on capture |
| Cash ledger | `src/services/cashPayment.service.ts` | Cash → `captured` payment + settlement (`skipped_cash`) |

Envelope: `{ success: true, data: <summary> }` via `sendSuccess`.

---

## Answers

### 1. Does the backend currently calculate an actual driver's total/net earnings?

**Yes.** Per booking, `calculateSettlement` in `settlement.service.ts` computes:

- `commissionableFare = passengerGross − airportFee`
- `driverAmount = floor(commissionableFare × driver%)`
- `platformAmount = commissionableFare − driverAmount`
- Identity: `driverAmount + platformAmount + airportFee === passengerGross`

That `driverAmount` is persisted on `booking_settlements.driver_amount`.

The summary then **sums** those amounts by currency via `sumCalculatedDriverEarningsByCurrency` for settlement statuses:

- `pending`
- `processing`
- `settled`
- `skipped_cash`

Excluded: `unresolved`, `failed`, missing settlement rows (`notCreated`), and rows with `driver_amount IS NULL`.

### 2. Does `GET /api/v1/driver/payments/summary` currently return that numeric amount?

**Yes.** Field: **`calculatedDriverEarnings`**.

It is an array of per-currency totals:

```ts
Array<{ minor: number; formatted: string; currency: string; count: number }>
```

There is **no** single scalar `totalEarnings` field (tests explicitly assert that key is absent). For a one-currency driver/market UI, use the matching currency row’s `formatted` / `minor`.

### 3. What exactly is `driverEarningsAvailable`?

**Boolean, always `false`.**

Typed in source as:

```ts
driverEarningsAvailable: false;
```

Purpose (from service comment / tests / settlement report):

- Signals that **paid-out / bank / Stripe Transfer / available-balance** earnings are **not** implemented.
- Calculated share ≠ paid to driver.
- It is **not** an amount and must not be displayed as money.

### 4. What exactly does `capturedPassengerPayments[]` represent?

**Passenger gross money captured by Rydu’s payment ledger — not driver earnings.**

Source query: `sum(booking_payments.gross_amount)` where `status = 'captured'`, grouped by `booking_payments.currency`, scoped to `bookings.assigned_driver_id`.

Includes card **and** cash ledgers once cash rows are written as `captured`. Tests assert calculated driver share is **not** equal to this gross.

### 5. Which existing field/table is authoritative for the amount the DRIVER earns after platform commission/fees?

| Level | Authoritative source |
|-------|----------------------|
| Per booking | `booking_settlements.driver_amount` (+ `currency`) |
| Summary total(s) | Sum of that column → API `calculatedDriverEarnings[]` |
| Per-item API | `settlement.driverAmount` on list/detail |

**Not** authoritative for driver earn: `booking_payments.gross_amount`, `capturedPassengerPayments`, `driverEarningsAvailable`.

Airport fee sits in `booking_settlements.airport_fee` and is **not** added into the driver’s commission share.

### 6. Does `booking_settlements` already contain the driver's calculated share for each booking?

**Yes, when a settlement row was successfully claimed after capture** (and active settlement settings existed at write time).

Columns: `driver_amount`, `platform_amount`, `airport_fee`, `gross_amount`, `currency`, percentage snapshots, `status`.

Card → typically `pending` (pre-transfer).  
Cash → `skipped_cash` (same split math; no Stripe transfer).  
If settings were missing or allocation failed at capture time → no row / no amounts → not included in summary totals.

### 7. How are CASH rides represented? Can cash driver earnings be included safely in a total?

| Stage | Behavior |
|-------|----------|
| Ledger | `booking_payments` with `payment_method = cash`, `provider = cash`, `status = captured` |
| Settlement | Same split as card; `status = skipped_cash`; `driver_amount` populated |
| Summary calculated total | **Included** (`skipped_cash` is in `CALCULATED_DRIVER_EARNING_STATUSES`) |
| Stripe Transfer | Never (`transfer.status` remains `not_started`) |

**Safe for “Total Earnings” as calculated driver share:** yes — cash uses the same `driver_amount` formula and is intentionally summed.

**Caveats:**

- Legacy cash without a ledger/settlement row → **not** in `calculatedDriverEarnings` (may appear in history as `not_recorded` / `not_created`).
- Cash share is **not** paid by Rydu to the driver (passenger already paid cash); including it in UI “Total Earnings” is still correct as **earned share**, wrong as **payout balance**. Keep `driverEarningsAvailable === false`.

### 8. Multi-market / multi-currency — one total?

**No single cross-currency total. Do not FX-convert.**

Both `capturedPassengerPayments` and `calculatedDriverEarnings` are **grouped by currency**. Tests assert USD and BDT minors are never merged into one number.

App should show one total per currency (or only the driver’s active market currency).

### 9. Smallest backend-compatible extension if missing?

**Not required for exposing calculated total earnings.** The amount is already on the wire as `calculatedDriverEarnings`.

Optional (future, if product wants clearer naming — **do not implement in this audit**):

- Alias or document that apps map `calculatedDriverEarnings` → “Total Earnings”.
- Do **not** set `driverEarningsAvailable = true` until a real paid/transfer state exists.
- Do **not** add a cross-currency `totalEarnings` scalar.

### 10. Exact CURRENT JSON response contract (source + tests)

```json
{
  "success": true,
  "data": {
    "driverEarningsAvailable": false,
    "calculatedDriverEarnings": [
      {
        "minor": 25000,
        "formatted": "250.00",
        "currency": "BDT",
        "count": 1
      }
    ],
    "capturedPassengerPayments": [
      {
        "minor": 100000,
        "formatted": "1000.00",
        "currency": "BDT",
        "count": 1
      }
    ],
    "settlementCounts": {
      "notCreated": 0,
      "unresolved": 0,
      "pending": 1,
      "processing": 0,
      "settled": 0,
      "failed": 0,
      "skippedCash": 0
    }
  }
}
```

Multi-currency example (structure only):

```json
{
  "driverEarningsAvailable": false,
  "calculatedDriverEarnings": [
    { "minor": 25000, "formatted": "250.00", "currency": "BDT", "count": 2 },
    { "minor": 1000, "formatted": "10.00", "currency": "USD", "count": 1 }
  ],
  "capturedPassengerPayments": [
    { "minor": 100000, "formatted": "1000.00", "currency": "BDT", "count": 2 },
    { "minor": 4500, "formatted": "45.00", "currency": "USD", "count": 1 }
  ],
  "settlementCounts": { "...": "as above" }
}
```

Contract rules enforced by tests:

- `driverEarningsAvailable` is always `false`.
- No `totalEarnings`, `paidToDriver`, or `availableBalance` keys.
- Empty calculated array when no qualifying settlements: `"calculatedDriverEarnings": []`.

### 11. Proposed response contract for Total Earnings (only if missing)

**N/A — already exposed.** Apps should bind:

| UI label | API field | Notes |
|----------|-----------|--------|
| Total Earnings (per currency) | `data.calculatedDriverEarnings[]` | Use `formatted` + `currency`; pick market row |
| Gross passenger captured | `data.capturedPassengerPayments[]` | Do **not** label as earnings |
| Paid / withdrawable | — | Unavailable while `driverEarningsAvailable === false` |

If iOS currently hides all money when `driverEarningsAvailable === false`, that is an **app** gating bug relative to current backend: show `calculatedDriverEarnings` as unpaid calculated total, keep payout UI hidden.

---

## Evidence map

| Concern | Location |
|---------|----------|
| Summary types + always-false flag | `src/services/driverPaymentHistory.service.ts` (`DriverPaymentHistorySummary`) |
| Sum driver share by currency | `src/repositories/driverPaymentHistory.repository.ts` (`sumCalculatedDriverEarningsByCurrency`) |
| Sum passenger captured gross | same file (`sumCapturedPassengerPaymentsByCurrency`) |
| Split formula | `src/services/settlement.service.ts`, `src/utils/money.ts` (`allocateCommissionableByPercentages`) |
| Schema | `src/db/schema/booking_settlements.ts` (`driver_amount`) |
| Cash → settlement | `src/services/cashPayment.service.ts` + `ensureSettlementForCapturedPayment` |
| Summary contract tests | `tests/driver-payment-history.test.ts` (N, O), `tests/driver-payment-history-routes.test.ts` |
| Settlement / cash split tests | `tests/settlement-configuration.test.ts`, `tests/usd-end-to-end-financial.test.ts` |

---

## App integration guidance (no code changes here)

1. For **Total Earnings**, read `calculatedDriverEarnings` for the active market currency.
2. Never display `capturedPassengerPayments` as driver earnings.
3. Treat `driverEarningsAvailable === false` as “no paid balance / no bank payout,” not “no earnings number exists.”
4. Never sum across currencies.

---

## Final conclusion (exact enum)

**TOTAL DRIVER EARNINGS ALREADY AVAILABLE — APP INTEGRATION NEEDED**
