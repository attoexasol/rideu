# RYDU Backend — Cash Payment Amount Missing in Driver Payment History

**Workspace:** `backend_rydu`  
**Date:** 2026-09-11  
**Scope:** Audit why cash rides show `amount = null` in Driver Payment History, then the smallest backend fix for **new** cash completions. No Android/iOS changes. No production backfill executed.

**Classification:** **BOTH** — current cash completion never wrote `booking_payments`, and all inspected historical completed cash bookings also lack those rows.

**Final status:** **RYDU CASH PAYMENT HISTORY FIXED — NEW CASH RIDES NOW SHOW AMOUNT**

---

## 1. Root cause

Driver Payment History reads passenger amount **only** from `booking_payments.gross_amount`.

Cash completion never created that row. It only set `bookings.payment_status = 'paid'`.

When the list/detail query left-joins `booking_payments` and the join is empty:

| API field | Value |
|-----------|--------|
| `passengerPayment.methodCode` | catalog `payment_methods.code` = `cash` |
| `passengerPayment.status` | API-only `not_recorded` |
| `passengerPayment.amount` | `null` |

This is not an Android display bug and not a missing Stripe call. Cash is not supposed to use Stripe. The ledger row was simply never written.

Phase A documented that omission: *“Phase A does not insert payment rows on cash create/complete.”* That remained true until this fix.

---

## 2. Old data vs current flow

**BOTH**

| Question | Answer |
|----------|--------|
| Do older completed cash rides lack `booking_payments`? | **Yes — systematically.** Local/dev DB: **27 / 27** completed cash have no ledger row. |
| Does the current cash complete path create a ledger row? | **It did not**, before this change. |
| Are card rides affected? | **No.** Local/dev: **3 / 3** completed card rides have ledger rows. |

Local newest completed cash booking is `2026-09-01` (after `booking_payments` existed). It still has no ledger row. The gap is not “pre-ledger-table only.”

---

## 3. Authoritative cash amount source

**Column:** `bookings.final_fare` (`numeric(10,2)`)

Set once at booking create from the server quote (`quote.finalFare`). Grep of `src/` shows **no later write** to `finalFare` / `final_fare` on accept, start, or complete.

Related booking fare columns (not used as the payment-history source):

| Column | Role |
|--------|------|
| `bookings.final_fare` | **Authoritative passenger cash amount** (quote after promo) |
| `bookings.estimated_fare` | Same quote value at create; not the ledger source |
| `bookings.original_fare` | Pre-discount quote |
| `bookings.discount_amount` | Promo reduction |
| `bookings.payment_status` | Cash-era `pending` / `paid` only — not an amount |

Currency is **not** stored on `bookings`. Server convention is `BDT`:

- `fare.service.ts` quote `currency: 'BDT'`
- `DEFAULT_PAYMENT_CURRENCY` / ride-history `HISTORY_CURRENCY`
- card PI amount uses the same `final_fare` via `majorToMinorUnits`

**Immutability after completion:** `final_fare` is write-once at create. After completion it is unchanged. It is the same value ride history already returns as `fare.amount`.

Do **not** use client-supplied fare, estimated-only inference, or a recalculated distance fare.

Ledger conversion: `majorToMinorUnits(bookings.final_fare)` → `booking_payments.gross_amount` (BDT poisha). Example: `"249.37"` → `24937`.

---

## 4. Do new cash rides create `booking_payments`?

### Before this fix: no

Cash path:

1. `confirmBooking` — catalog method `cash`, `payment_status = pending`, **no** `booking_payments` insert
2. Accept / en_route / arrived / in_progress — no payment write
3. `updateBookingStatusByDriver` → `completed`:
   - `isCard` is true only if a `booking_payments` row exists with `payment_method = 'card'`
   - cash: `bookings.payment_status = 'paid'`, `completed_at` set
   - `captureAuthorizedBookingPayment` is **not** called
   - **no ledger insert**

`insertBookingPayment` / `claimPendingCardPayment` are used only by `prepareCardPaymentForBooking` (card).

`captureAuthorizedBookingPayment` returns `skipped` / `status: skipped_cash` when there is no card ledger. `skipped_cash` is **not** a `booking_payments.status` (settlement / skip label only).

### After this fix: yes, on complete

New completed cash rides insert one `booking_payments` row:

| Field | Value |
|-------|--------|
| `payment_method` | `cash` |
| `provider` | `cash` |
| `gross_amount` | `majorToMinorUnits(bookings.final_fare)` |
| `currency` | `BDT` |
| `status` | `captured` (existing schema success state; no cash-only status exists) |
| `captured_at` | booking `completed_at` |
| Stripe ids | null |

Card create/capture is unchanged. Cancelled cash still does **not** get a ledger row.

---

## 5. Example DB evidence

Read-only probe of local/dev PostgreSQL `localhost:5432/ryd_u` on 2026-09-11. No passenger PII.

### Totals

| Metric | Count |
|--------|------:|
| Bookings | 125 |
| Cash bookings | 121 |
| Cash completed | 27 |
| Cash completed **with** `booking_payments` | **0** |
| Cash completed **without** `booking_payments` | **27** |
| Cash cancelled | 86 |
| Cash cancelled with ledger | 0 |
| Card completed | 3 |
| `booking_payments` rows | 3 (all `card`) |
| Cash `booking_payments` | 0 |
| `booking_settlements` | 0 |
| Completed cash with `final_fare` null | 0 |
| Completed cash with `final_fare` present | 27 |

Completed-cash `completed_at` range: `2026-07-31` … `2026-09-01`.

### Recent completed cash (newest)

| booking_number | booking id | status | payment_method | payment_status | final_fare | ledger | settlement |
|----------------|------------|--------|----------------|----------------|------------|--------|------------|
| `RYD-MTJAOON2-WTG4` | `6b8a68a5-ed1a-4e51-805c-d619d45d0c08` | completed | cash | paid | 249.37 | **no** | **no** |
| `RYD-MTEIY33G-EFE2` | `f72ac6ea-3f49-47d6-8f55-015efb292550` | completed | cash | paid | 106.40 | **no** | **no** |
| `RYD-MTECFN2K-1SA6` | `cbca932b-21ca-4887-b3ff-3d379881c4ec` | completed | cash | paid | 212.80 | **no** | **no** |

### Older completed cash (oldest)

| booking_number | booking id | completed_at | final_fare | ledger |
|----------------|------------|--------------|------------|--------|
| `RYD-MS8ROTF0-NT0H` | `9cbbc1b1-370f-4a9e-a6d4-8c9330566247` | 2026-07-31T03:56:53.783Z | 205.62 | **no** |
| `RYD-MS8RQFJD-GNM9` | `7aa010fb-3ebd-423b-8373-2ca5e1e17d0f` | 2026-07-31T03:57:30.367Z | 270.72 | **no** |
| `RYD-MS8RUYW4-QBKQ` | `54c7dff4-df1b-42c9-a99a-77b3ab4f1386` | 2026-07-31T04:01:12.831Z | 284.37 | **no** |

Pattern: cash complete + `paid` + known `final_fare` + no ledger. Same on old and post–Phase A rows.

---

## 6. Did production code change?

**Yes**, after the audit confirmed BOTH.

No schema / migration change. No Android change. No backfill executed.

---

## 7. Fix implemented

### Files

| File | Change |
|------|--------|
| `src/services/cashPayment.service.ts` | **New.** `recordCompletedCashBookingPayment` |
| `src/repositories/bookingPayment.repository.ts` | `claimCompletedCashPayment` (`ON CONFLICT booking_id DO NOTHING`) |
| `src/services/booking.service.ts` | Call recorder after cash complete, and on completed→completed retry |
| `src/services/payment.service.ts` | Re-export recorder |
| `tests/cash-booking-payment.test.ts` | **New** |
| `tests/driver-payment-history.test.ts` | New cash-with-ledger + cancelled-cash mapping |
| `tests/stripe-phase-c.test.ts` / `tests/stripe-phase-d.test.ts` | Mock the new claim helper |

### Status choice (no new status)

`booking_payments.status` check allows only:

`pending`, `requires_payment_method`, `requires_action`, `authorized`, `capture_pending`, `captured`, `failed`, `cancelled`, `refund_pending`, `refunded`

There is no `collected` / `paid_cash`. Inventing one would be a schema change; this task stopped at that line and used the existing success state.

`captured` here means **passenger cash collected at ride completion** (same moment `bookings.payment_status` becomes `paid`). It is **not** a Stripe PaymentIntent capture. Distinguisher: `payment_method = cash`, `provider = cash`, no provider IDs.

Settlement is **not** created. `skipped_cash` remains a `booking_settlements` status only.

If `final_fare` is missing/invalid/≤0, completion still succeeds and no ledger row is written (logged). Ride history already uses the same `final_fare`; local completed cash all have it.

### Why the history API was not taught to guess `final_fare`

Legacy rows stay `not_recorded` / `amount = null` until an explicit backfill. That keeps “legacy no-ledger behavior preserved” and avoids a second unofficial amount path.

---

## 8. Legacy backfill recommendation (not executed)

Do **not** run this on production until explicitly requested.

### Eligibility

```sql
SELECT b.id, b.booking_number, b.final_fare, b.completed_at, b.payment_status
FROM bookings b
JOIN payment_methods pm ON pm.id = b.payment_method_id
LEFT JOIN booking_payments bp ON bp.booking_id = b.id
WHERE pm.code = 'cash'
  AND b.status = 'completed'
  AND b.payment_status = 'paid'
  AND b.final_fare IS NOT NULL
  AND bp.id IS NULL;
```

### Mapping

| Target | Source |
|--------|--------|
| `gross_amount` | `majorToMinorUnits(bookings.final_fare)` — reject >2 decimal places |
| `currency` | `BDT` (`DEFAULT_PAYMENT_CURRENCY`; bookings has no currency column) |
| `payment_method` | `cash` |
| `provider` | `cash` |
| `status` | `captured` |
| `captured_at` | `bookings.completed_at` |

### Avoid duplicates

`uq_booking_payments_booking_id` + `INSERT … ON CONFLICT (booking_id) DO NOTHING`. Never update an existing card or cash row.

### Cancelled cash

**Exclude.** Cancelled cash does not collect fare. Local/dev: 86 cancelled cash, 0 ledger rows. Leave as history `not_recorded` / `amount = null`.

### Completed vs other

Require `bookings.status = 'completed'` **and** `payment_status = 'paid'`. Do not backfill searching / in_progress / quoted.

### Dry-run counts (this local/dev DB)

| Set | Count |
|-----|------:|
| Eligible completed cash, no ledger, `final_fare` present | **27** |
| Eligible but `final_fare` null | **0** |
| Would conflict with existing ledger | **0** |
| Cancelled cash (must not insert) | 86 |
| Card rows that must stay untouched | 3 |

Production counts must be re-run against production before any apply.

### Apply shape (proposal only)

1. Transaction  
2. Select eligible ids `FOR UPDATE`  
3. Insert with conflict do nothing  
4. Persist inserted `booking_payments.id` list  
5. Commit  

### Rollback

Delete **only** rows from the inserted-id list (or `payment_method = 'cash' AND provider = 'cash' AND created_at` in the backfill window **and** id in the list). Do not delete card rows. Do not change `bookings`.

---

## 9. Driver Payment History contract

Endpoints unchanged:

- `GET /api/v1/driver/payments` → `listDriverPaymentsHandler` → `listDriverPayments`
- `GET /api/v1/driver/payments/{paymentId}` → `getDriverPaymentDetailHandler` → `getDriverPaymentDetail`

Amount still comes only from `booking_payments.gross_amount`.

### A. New completed cash with ledger

```json
{
  "id": "<booking_payments.id>",
  "paymentRecordId": "<booking_payments.id>",
  "passengerPayment": {
    "amount": { "minor": 24937, "formatted": "249.37", "currency": "BDT" },
    "status": "captured",
    "methodCode": "cash",
    "capturedAt": "<completed_at>"
  },
  "settlement": { "status": "not_created", "driverAmount": null, "platformAmount": null, "airportFee": null },
  "transfer": { "status": "not_started", "transferredAt": null }
}
```

`captured` + `methodCode = cash` = driver-collected cash, not platform Stripe capture.

### B. Legacy completed cash, no ledger, known `final_fare`

**Unchanged until backfill:**

```json
{
  "id": "<bookings.id>",
  "paymentRecordId": null,
  "passengerPayment": {
    "amount": null,
    "status": "not_recorded",
    "methodCode": "cash",
    "capturedAt": null
  }
}
```

After a deliberate backfill, these look like A.

### C. Cancelled cash

No new ledger. Listed if catalog method is cash and status is `cancelled`:

`methodCode = cash`, `status = not_recorded`, `amount = null`.

### D. Card

Unchanged: ledger status as stored (`captured`, `authorized`, …), amount from `gross_amount`, no secrets.

### Summary note

`GET /api/v1/driver/payments/summary` still sums `booking_payments.status = 'captured'` by currency. New cash ledgers use `captured`, so they **will** appear in `capturedPassengerPayments`. That is passenger-payment collected gross, still **not** driver earnings (`driverEarningsAvailable` stays `false`). Card math is unchanged; cash was previously absent because no row existed.

---

## 10. Tests / build

```
npx jest tests/cash-booking-payment.test.ts tests/driver-payment-history.test.ts tests/driver-payment-history-routes.test.ts tests/stripe-phase-d.test.ts tests/stripe-phase-c.test.ts tests/stripe-phase-a.test.ts tests/rate-limit-config.test.ts --no-coverage
npm run build
```

**Tests:** 7 suites, 142 passed  
**Build:** `tsc` passed

Covered:

| Case | Result |
|------|--------|
| New completed cash amount from `final_fare` minor units | pass |
| Card ledger not overwritten | pass |
| Duplicate cash insert not attempted when row exists | pass |
| `ON CONFLICT (booking_id)` claim | pass |
| No new schema status | pass |
| Legacy no-ledger still `not_recorded` / `amount = null` | pass |
| Cancelled cash no-ledger preserved | pass |
| Card history mapping unchanged | pass |
| Ownership / `PAYMENT_NOT_FOUND` | pass |
| Pagination `offset = (page-1)*limit` | pass |

---

## 11. Exact files / functions (audit map)

### Payment history cash fallback

| Piece | Location |
|-------|----------|
| Routes | `src/routes/v1/driver/payments.ts` |
| Handlers | `listDriverPaymentsHandler`, `getDriverPaymentDetailHandler` in `src/controllers/driverPayment.controller.ts` |
| Eligibility | `driverPaymentHistoryEligible` in `src/repositories/driverPaymentHistory.repository.ts` — ledger row **or** cash + `completed`/`cancelled` |
| Amount | `formatMoneyAmount(row.paymentGrossAmount, paymentCurrency)` in `formatDriverPaymentHistoryItem` |
| Missing ledger status | `normalizePassengerPaymentStatus(null)` → `not_recorded` |
| Method fallback | `row.paymentMethod ?? row.catalogPaymentMethodCode` |

Confirmed current (and previous) no-ledger behavior: **`paymentMethod = cash`, `status = not_recorded`, `amount = null`.**

### Cash completion (before fix)

| Step | Function | Ledger? |
|------|----------|---------|
| Create | `confirmBooking` | no |
| Accept / start | `updateBookingStatusByDriver` | no |
| Complete | `updateBookingStatusByDriver` sets `payment_status = paid` | **no** (before); **yes** (after) |
| Card PI | `prepareCardPaymentForBooking` / `claimPendingCardPayment` | card only |

---

## Android

Do **not** compute cash amount on the device.

- New completed cash after this deploy: use `passengerPayment.amount`.
- Legacy cash: `amount` stays null until server backfill.
- `status = captured` + `methodCode = cash` is cash collected, not “platform captured card” and not “driver payout.”

**RYDU CASH PAYMENT HISTORY FIXED — NEW CASH RIDES NOW SHOW AMOUNT**
