# RYDU Backend — Settlement Configuration Implementation

**Workspace:** `backend_rydu`  
**Date:** 2026-09-11  
**Scope:** Persist Admin-editable settlement percentages and use them to create real `booking_settlements` rows. No Android/iOS/Admin UI. No Stripe Transfer.

**Final status:** **RYDU BACKEND SETTLEMENT CONFIGURATION COMPLETE — 0% AIRPORT / 25% DRIVER / 75% COMPANY**

---

## 1. Schema / settings design

No generic application-settings table existed. A dedicated table was added.

### `settlement_settings`

| Column | Type | Notes |
|--------|------|--------|
| `id` | uuid PK | |
| `airport_fee_percentage` | numeric(6,2) | 0–100 |
| `driver_percentage` | numeric(6,2) | 0–100 |
| `company_percentage` | numeric(6,2) | 0–100 |
| `version` | integer UNIQUE | increments on each Admin change |
| `is_active` | boolean | at most one `true` (partial unique index) |
| `created_at` / `updated_at` | timestamptz | |

Check: `airport + driver + company = 100`.

Admin PATCH **deactivates** the current row and **inserts** a new active version. Old config rows remain for audit. Historical booking settlements do **not** read this table again.

### `booking_settlements` snapshot columns (additive)

Existing: `gross_amount`, `driver_amount`, `platform_amount`, `airport_fee`, `currency`, `status`, `calculation_version`, `provider_transfer_id`.

Added (nullable for any pre-existing empty rows):

- `airport_fee_percentage`
- `driver_percentage`
- `company_percentage`

`platform_amount` = company / Rydu share. Columns were not renamed.

---

## 2. Migration

`src/db/migrations/0029_settlement_settings.sql`  
Down: `0029_settlement_settings.down.sql`  
Journal: `0029_settlement_settings`

Safe for existing data:

- `CREATE TABLE IF NOT EXISTS`
- seed only when no active row
- `ADD COLUMN IF NOT EXISTS` on settlements
- **no** `UPDATE`/`DELETE` of `booking_settlements`

Applied on local/dev `localhost/ryd_u`.

---

## 3. Initial values

| Field | Value |
|-------|--------|
| airport | `0.00` |
| driver | `25.00` |
| company | `75.00` |
| version | `1` |
| is_active | `true` |

Not stored in env. Editable via Admin API.

---

## 4. Validation rules

Single parser: `parseSettlementPercentages()` in `settlementSettings.service.ts`.

- Each percentage ≥ 0 and ≤ 100
- Max **2 decimal places** (`25.50` allowed)
- Sum checked in scaled integers (×100): must equal `10000` (exactly 100.00%)
- `0+30+70` valid; `5+25+70` valid; `0+25+80` rejected; negatives rejected

Admin frontend totals are ignored. The backend re-validates every PATCH.

---

## 5. Calculation formula

Authoritative gross: `booking_payments.gross_amount` (integer minor units) when ledger `status = captured`.

- Card captured → that gross  
- Completed cash with ledger → that same gross  

```
settings = getActiveSettlementSettings()
driverAmount  = floor(gross * driverScaled / 10000)
airportFee    = floor(gross * airportScaled / 10000)
platformAmount = gross - driverAmount - airportFee
```

`25.00%` → scaled `2500`. BDT 1000.00 = `100000` poisha → driver `25000`, company `75000`, airport `0`.

No binary floating-point in the money path (`BigInt` integer division). Helpers: `percentageToScaled`, `allocateGrossByPercentages` in `src/utils/money.ts`.

Calculation **must** receive settings from `getActiveSettlementSettings()`. `0/25/75` is not hardcoded in the allocator.

---

## 6. Rounding strategy

Airport and driver use **integer floor**.

**Remainder always goes to company (`platform_amount`).**

Guarantee:

`driverAmount + platformAmount + airportFee === grossAmount`

Example odd gross `100001`: driver `25000`, airport `0`, company `75001`.

---

## 7. Settlement snapshot / versioning

Each new `booking_settlements` row stores:

- `calculation_version` = `"1"`, `"2"`, … (string, existing column)
- `driver_percentage`, `company_percentage`, `airport_fee_percentage` at calculate time
- computed `driver_amount`, `platform_amount`, `airport_fee`

Later Admin change to 30/70/0 becomes version 2 for **new** rows only. Existing rows stay 25/75/0.

`ensureSettlementForCapturedPayment` returns an existing row without recalculating.

---

## 8. Card behavior

When `booking_payments` becomes `captured`:

`markBookingPaidIfCaptured` still marks `bookings.payment_status = paid`, then calls `ensureSettlementForCapturedPayment`.

That covers:

- driver complete → `captureAuthorizedBookingPayment`
- already-captured retry
- Stripe webhook `payment_intent.succeeded` → same helper

Settlement status: **`pending`** (amounts calculated; Stripe Transfer not started).

Not `settled` (that would claim transfer/payout). No `transfers.create`.

Idempotent: `uq_booking_settlements_booking_id` + `ON CONFLICT DO NOTHING`.

---

## 9. Cash behavior

When `recordCompletedCashBookingPayment` writes or finds a **captured cash** ledger row, it calls the same `ensureSettlementForCapturedPayment`.

Settlement status: **`skipped_cash`** (split calculated; Stripe Transfer not applicable).

`cashPayment.service.ts` and `settlement.service.ts` do not import Stripe or create transfers.

Driver Payment History already maps `skipped_cash`. Transfer block stays `not_started`.

Cancelled cash still has no ledger and no settlement.

---

## 10. Admin endpoints

Auth: `requireAuth` + `extractUserInfo` + `requireAdmin` (admin / super_admin), same as other v1 Admin routes.

| Method | Path |
|--------|------|
| GET | `/api/v1/admin/settings/settlement` |
| PATCH | `/api/v1/admin/settings/settlement` |

GET:

```json
{
  "airportFeePercentage": "0.00",
  "driverPercentage": "25.00",
  "companyPercentage": "75.00",
  "version": 1,
  "updatedAt": "2026-09-11T00:00:00.000Z"
}
```

PATCH body:

```json
{
  "airportFeePercentage": 0,
  "driverPercentage": 30,
  "companyPercentage": 70
}
```

Invalid total → `400 INVALID_SETTLEMENT_SETTINGS`.  
No active row → GET `404 COMMISSION_RULES_NOT_CONFIGURED`.

No Admin UI in this task.

---

## 11. Driver Payment History impact

List/detail already expose `settlement.status`, `driverAmount`, `platformAmount`, `airportFee` from `booking_settlements`. Once a row exists they are populated. Android formatting unchanged.

BDT 1000 example:

| Field | Minor | Formatted |
|-------|------:|-----------|
| passenger payment | 100000 | 1000.00 |
| `settlement.driverAmount` | 25000 | 250.00 |
| `settlement.platformAmount` | 75000 | 750.00 |
| `settlement.airportFee` | 0 | 0.00 |

Card: `settlement.status = pending`.  
Cash: `settlement.status = skipped_cash`.  
`transfer.status` remains `not_started`.

Legacy cash with no ledger is unchanged (`not_recorded`, `amount = null`, settlement `not_created`) until those bookings get a ledger + settlement.

---

## 12. Driver earnings summary impact

`GET /api/v1/driver/payments/summary`

| Field | Meaning |
|-------|---------|
| `driverEarningsAvailable` | **Still `false`.** Calculated share is **not** paid to driver or bank. |
| `calculatedDriverEarnings` | **New.** Sum of `booking_settlements.driver_amount` by currency for statuses `pending`, `processing`, `settled`, `skipped_cash`. |
| `capturedPassengerPayments` | Unchanged (captured passenger gross). |
| `settlementCounts` | Unchanged. |

Do **not** display `calculatedDriverEarnings` as paid-to-driver, paid-to-bank, or available balance. No `totalEarnings` / `paidToDriver` / `availableBalance` fields.

Android that already hides earnings when `driverEarningsAvailable === false` stays safe. It may optionally show calculated share as unpaid.

---

## 13. Stripe Transfer status

**Not implemented.**

Card settlement `pending` is the pre-transfer state. Later transfer should move only `driver_amount` to the driver’s connected account. Platform keeps `platform_amount`. Airport is currently 0.

`provider_transfer_id` stays null. Cash never transfers.

---

## 14. Files changed

### New

| File | Purpose |
|------|---------|
| `src/db/schema/settlement_settings.ts` | Settings table |
| `src/db/migrations/0029_settlement_settings.sql` | Forward + seed |
| `src/db/migrations/0029_settlement_settings.down.sql` | Reverse |
| `src/repositories/settlementSettings.repository.ts` | Active row / versioned replace |
| `src/services/settlementSettings.service.ts` | `getActiveSettlementSettings`, Admin update |
| `src/controllers/adminSettlementSettings.controller.ts` | GET/PATCH |
| `src/routes/v1/admin/settings.ts` | Admin routes |
| `tests/settlement-configuration.test.ts` | Validation, math, idempotency |
| `tests/admin-settlement-settings-routes.test.ts` | Admin HTTP |
| `RYDU_BACKEND_SETTLEMENT_CONFIGURATION_IMPLEMENTATION_REPORT.md` | This report |

### Modified

| File | Change |
|------|--------|
| `src/db/schema/booking_settlements.ts` | Percentage snapshot columns |
| `src/db/schema/index.ts` | Export settings |
| `src/db/migrations/meta/_journal.json` | 0029 |
| `src/utils/money.ts` | Percentage scale + integer allocation |
| `src/services/payment.errors.ts` | `SettlementSettingsError` |
| `src/services/settlement.service.ts` | Real calculate + `ensureSettlementForCapturedPayment` |
| `src/repositories/bookingPayment.repository.ts` | `claimBookingSettlement` |
| `src/services/stripeCapture.service.ts` | Create settlement after card captured |
| `src/services/cashPayment.service.ts` | Create settlement after cash captured ledger |
| `src/services/payment.service.ts` | Re-exports |
| `src/services/stripeWebhook.service.ts` | Comment: settlement after captured PI |
| `src/services/driverPaymentHistory.service.ts` | `calculatedDriverEarnings` |
| `src/repositories/driverPaymentHistory.repository.ts` | Sum calculated driver share |
| `src/routes/v1/index.ts` | Mount `/admin/settings` |
| `src/validators/index.ts` | `updateSettlementSettingsSchema` |
| Existing payment-history / Stripe tests | Mocks + summary contract |

---

## 15. Tests / build

```
npx jest tests/settlement-configuration.test.ts tests/admin-settlement-settings-routes.test.ts tests/cash-booking-payment.test.ts tests/driver-payment-history.test.ts tests/driver-payment-history-routes.test.ts tests/stripe-phase-a.test.ts tests/stripe-phase-b.test.ts tests/stripe-phase-c.test.ts tests/stripe-phase-d.test.ts --no-coverage
npm run build
```

**Tests:** 9 suites, **165 passed**  
**Build:** `tsc` passed

| ID | Case |
|----|------|
| A | Default 0 / 25 / 75 |
| B | Total must be 100 |
| C | Negative rejected |
| D | 25.5 / 74.5 / 0 accepted |
| E | BDT 1000 → 250 / 750 / 0 |
| F | Odd minor units reconcile |
| G | Settlement insert idempotent |
| H | Card captured → pending settlement |
| I | Cash captured ledger → skipped_cash |
| J | Cash/settlement never call Stripe Transfer |
| K | Admin GET settings |
| L | Admin PATCH 25/75 → 30/70 |
| M | Version increments |
| N | Existing settlement keeps old version/amount |
| O | History returns driver/platform/airport amounts |
| P | No payment secrets |
| Q | Card capture flow still captures once, then settles |
| R | Cash history unchanged except settlement when a ledger exists |

`calculateSettlement()` without `settings` still throws `COMMISSION_RULES_NOT_CONFIGURED` (Phase A/B/C/D stubs). Production paths always load DB settings.

---

## 16. Remaining work

1. **Admin Panel UI** for GET/PATCH settlement settings.  
2. **Stripe Transfer** of `driver_amount` only, after connected-account readiness; then move card settlement `pending` → `processing` / `settled`.  
3. **Bank payout** reporting — still out of scope; do not set `driverEarningsAvailable = true` until a paid state exists.  
4. **Optional backfill** (not run): captured card (and cash-with-ledger) bookings that predate this deploy have no settlement row. A retry of complete/webhook will create one using **current** active settings. A dedicated backfill should snapshot v1 0/25/75 and skip rows that already exist.  
5. **Legacy cash without ledger** still need the cash-payment backfill before they can get a settlement.

---

**RYDU BACKEND SETTLEMENT CONFIGURATION COMPLETE — 0% AIRPORT / 25% DRIVER / 75% COMPANY**
