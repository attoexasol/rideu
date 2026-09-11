# RYDU Backend — Airport / Booking Currency Consistency

**Workspace:** `backend_rydu`  
**Date:** 2026-09-11  
**Scope:** Backend-only financial-safety follow-up. No Admin frontend, Passenger Flutter, Driver Android, or Driver iOS changes.

**Final status:** **RYDU BACKEND AIRPORT CURRENCY CONSISTENCY COMPLETE**

---

## 1. Actual current fare currency architecture

Rydu today is **BDT-only**. This was read from code, not inferred from client examples.

| Surface | Currency source | Storage |
|---------|-----------------|--------|
| Fare / quote | Hardcoded transaction currency `BDT` (`getTransactionCurrency()` → `DEFAULT_PAYMENT_CURRENCY`) | Not stored on quote |
| `bookings` | **No currency column** | Amounts only (`final_fare`, `regular_trip_fare`, `airport_fee_amount`, …) |
| Card PaymentIntent | `prepareCardPaymentForBooking({ currency })` from quote/`getTransactionCurrency()` | `booking_payments.currency` |
| Cash ledger | `DEFAULT_PAYMENT_CURRENCY` (`BDT`) | `booking_payments.currency` |
| Settlement | `booking_payments.currency` (fallback `BDT`) | `booking_settlements.currency` |
| Driver payment history | Ledger/settlement row currency | Grouped by currency |
| Passenger ride history | Hardcoded `HISTORY_CURRENCY = 'BDT'` | Display only |
| Driver booking payloads | Hardcoded `'BDT'` | Display only |
| Airport config | `airports.currency` (Admin-supplied) | Persisted per airport |

There is **no** market/country-based fare currency switch. There is **no** FX conversion. Stripe Connect country is a separate setting and is explicitly not derived from fare currency.

**Model: A. BDT only** — not USD-only, not market-based, not genuine multi-currency.

---

## 2. Authoritative transaction currency source

No booking-level currency field was added. That would duplicate the existing single-currency contract.

Authoritative source:

```
DEFAULT_PAYMENT_CURRENCY = 'BDT'
getTransactionCurrency() → 'BDT'
SUPPORTED_TRANSACTION_CURRENCIES = ['BDT']
```

Every booking, quote, card PI, cash ledger, and settlement in the current product operates in this one currency.

Helpers (no FX):

- `normalizeCurrencyCode` — trim + uppercase
- `currenciesAreEqual` — case-insensitive equality
- `isSupportedTransactionCurrency`
- `isAirportFeeChargeable(airportCurrency, transactionCurrency)`

---

## 3. Airport currency behavior

`airports.currency` was **kept**. It is the configured fee currency for that airport.

A matched airport fee is applied **only when**:

```
normalize(airport.currency) == normalize(transaction currency)
```

Same-currency example (valid):

```
regular 1500 BDT + airport 5 BDT = 1505 BDT
```

Zero-fee same-currency airport: classification may still occur; charged fee stays 0.

---

## 4. Mismatch behavior

**Decision: fail safe by omitting the airport fee. Do not fail the quote. Do not convert.**

Failing the quote would block a normal ride just because an airport was configured in the wrong currency. Charging `1500 BDT + 5 USD = 1505` is worse. Financial correctness takes priority over collecting an airport fee.

When detection matches an airport whose currency ≠ booking currency:

1. Log `airport.detection.currency_mismatch` with airport id/code, airport currency, transaction currency, trip type, and withheld fee.
2. Set `feeMinor = 0`, `currencyMismatch = true`.
3. Do **not** expose `airport` on the public quote (`airportPublicView` returns null).
4. `finalFare` remains the regular BDT fare.
5. Booking snapshot airport fee is 0; card/cash/settlement never see mixed arithmetic.

Fare addition has a second guard: even if detection returned a positive fee, `applyAirportFeeToRegularFare` will not add it unless `isAirportFeeChargeable` passes.

Admin: an airport whose currency is not in `SUPPORTED_TRANSACTION_CURRENCIES` **cannot be activated**. It may be saved `isActive: false` for a future market. No SAN-specific rule.

---

## 5. SAN impact

SAN must **not** be activated as `currency = USD` against the current BDT booking flow.

This task does **not** invent SAN fees, coordinates, or FX, and does **not** change any SAN row (none is seeded).

If an operator tries `POST /admin/airports` with `currency=USD` and `isActive=true`, the backend rejects `UNSUPPORTED_AIRPORT_CURRENCY`.

If the U.S. market should later charge USD, the **minimum** backend work (not done here) is:

1. Make transaction currency selectable per market (or replace the hardcoded `BDT` constant) for quote, booking amounts, PI, cash, and settlement.
2. Optionally add `bookings.currency` once more than one transaction currency exists.
3. Then activate SAN with `currency=USD` so `airport.currency ==` booking currency.
4. Still no implicit FX — a USD airport fee would only apply to USD bookings.

That is a market-currency change, not an airport-only change. It was not performed here.

---

## 6. PaymentIntent impact

Card PI amount is `majorToMinorUnits(finalFare)` in `quote.currency` / `getTransactionCurrency()` (`BDT`).

After this guard, a USD airport match cannot inflate `finalFare`. PI amount stays the regular BDT fare. PI currency stays BDT. No second PI. No mixed-currency `gross_amount`.

---

## 7. Cash impact

Cash ledger still writes `currency = DEFAULT_PAYMENT_CURRENCY` (`BDT`) and `gross_amount` from `bookings.final_fare`.

Mismatch bookings have `final_fare` = regular BDT fare only. Cash never adds a USD 5 as BDT 5.

---

## 8. Settlement impact

Settlement uses `booking_payments.currency` (BDT) and `bookings.airport_fee_amount` (0 on mismatch).

```
commissionable = gross − airportFeeSnapshot
```

On mismatch, airport snapshot is 0, so the 25/75 split is unchanged and stays in BDT.

---

## 9. Files changed

- `src/constants/payment.ts` — transaction-currency helpers; no FX
- `src/services/airportDetection.service.ts` — mismatch log + withhold fee
- `src/services/fare.service.ts` — refuse mixed-currency add; quote currency from `getTransactionCurrency()`
- `src/services/airportAdmin.service.ts` — reject activating an unchargeable airport currency
- `src/services/booking.service.ts` — card retry uses `getTransactionCurrency()`
- `tests/airport-currency-consistency.test.ts` — new
- `tests/fare.service.test.ts` — USD-on-BDT quote case
- `RYDU_BACKEND_AIRPORT_CURRENCY_CONSISTENCY_REPORT.md` — this report

---

## 10. Tests / build

| Case | Result |
|------|--------|
| A same-currency BDT fee applies | pass |
| B USD airport + BDT fare does not add fee | pass |
| C mismatch never reaches PI as mixed arithmetic | pass (`finalFare` only, BDT) |
| D mismatch never reaches cash as mixed arithmetic | pass |
| E settlement currency remains BDT | pass |
| F non-airport booking unchanged | pass |
| G zero-fee airport remains safe | pass |
| H lowercase/uppercase normalize | pass |
| I existing BDT flow unchanged | pass |
| J no FX conversion introduced | pass |

Also passed: airport fixed-fee, settlement configuration, Admin airport routes, cash booking payment.

```
npm run build   # pass
```

---

## 11. Whether Passenger work can safely proceed

**Yes, for the current BDT market.**

Passenger quote `currency` remains `BDT`. `airportFee` is only non-zero when the airport is also BDT. A USD SAN configuration cannot go live against this flow, and even a rogue active USD row would quote/book as a regular BDT trip (fee 0).

Passenger UI can show `regularFare` / `airportFee` / `airport` without taking a mixed-currency total.

Do **not** start a U.S. Passenger USD fare UI until backend transaction currency is USD for that market.

---

## 12. Exact remaining currency work

1. **Do not activate SAN as USD** until booking fare/payment currency is USD for that market.
2. If/when the U.S. market is launched: introduce a real transaction-currency source (market config or `bookings.currency`) and keep the same-currency airport rule. No FX unless product later specifies one.
3. Optional later: replace remaining display hardcodes (`rideHistory` `HISTORY_CURRENCY`, some driver booking `'BDT'` strings) with `getTransactionCurrency()` — behavior is already BDT.
4. Admin frontend should surface `UNSUPPORTED_AIRPORT_CURRENCY` when activating a non-BDT airport (frontend not changed here).

---

**RYDU BACKEND AIRPORT CURRENCY CONSISTENCY COMPLETE**
