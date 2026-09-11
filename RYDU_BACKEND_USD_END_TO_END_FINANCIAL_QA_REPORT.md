# RYDU Backend — U.S. USD End-to-End Payment + Airport Settlement QA

**Workspace:** `backend_rydu` only  
**Date:** 2026-09-11  
**Scope:** Verification / integration tests. No Admin frontend, Passenger Flutter, Driver Android, or Driver iOS changes. No market/airport/payment/settlement redesign.

**Final status:** **RYDU BACKEND USD END-TO-END FINANCIAL QA PARTIAL — local DB has no US fares or US airports; real Stripe authorization/capture of a confirmed PaymentIntent was not exercised**

---

## 1. Environment / config used

| Item | Value |
|------|--------|
| Host | local Windows, `backend_rydu` |
| Stripe secret | SET (value not printed) |
| Stripe publishable | SET |
| Stripe webhook secret | SET |
| Stripe mode | **test** (`sk_test_…`) |
| Live mode | refused |
| Local database | connected (read-only probe) |
| `ride_markets` | BD/BDT active, US/USD active |
| US market fare rows | **0** |
| BD market fare rows | 48 |
| US airports | **0** (TESTUS not present, not inserted) |
| Production migrations | US market seeded; US fares **not** copied from BD; TESTUS **not** seeded |

TEST fixtures used in automated tests only:

- `market = US`
- `currency = USD`
- `airport code = TESTUS`
- center `32.80000000, -117.15000000`, radius `1500` m
- pickup fee `$5.00` (500 minor), drop-off fee `$7.00` (700 minor)
- regular category rates `base 20.00 / perKm 2.00 / min 10.00` at `10.00` km → `$40.00`

These amounts are **not** hardcoded in business logic.

---

## 2. US market fare fixture / config

**Test fixture (automated only):** category `regular` / `cat-regular` with US rates `20.00 + 2.00/km`, min `10.00`. At 10 km with no promotion: **regularFare = 40.00 USD**.

**Local Admin DB:** US market exists, but **no** `service_category_market_fares` rows for US. A live US quote against this database would fail `MARKET_PRICING_NOT_CONFIGURED` until Admin enters US category fares. Existing BD rows were not overwritten.

---

## 3. Airport fixture / config

**Test fixture:** `TESTUS` / “Test United States Airport”, country `US`, currency `USD`, radius geofence, pickup `$5.00`, drop-off `$7.00`.

**Local Admin DB:** no US airports. TESTUS was **not** inserted (per “test fixtures only / do not overwrite Admin data”). Airport pickup/drop-off cannot be exercised physically on this DB until Admin creates a US/USD airport.

---

## 4. Quote result

Exercised through real `quoteAllServiceCategories` + real `detectAirportTrip` with mocked market fares, route distance, and TESTUS airport list.

| Case | regularFare | airportFee | finalFare | currency | airport |
|------|-------------|------------|-----------|----------|---------|
| US regular (outside geofence) | 40.00 | 0 | 40.00 | USD | null |
| US TESTUS pickup | 40.00 | 5.00 | **45.00** | USD | TESTUS / pickup |
| US TESTUS drop-off | 40.00 | 7.00 | 47.00 | USD | TESTUS / dropoff |
| BD regression (same 10 km, BD rates) | 250.00 | 0 | 250.00 | BDT | null |

Pickup country US → market US → currency USD → US category rates. BD quote does not use `$40.00`.

---

## 5. Booking snapshot

`confirmBooking` writes the quote snapshot (source-verified, mapping tested):

```
currency = USD
market_code = US
pickup_country_code = US
airport_id / airport_code_snapshot / airport_name_snapshot / airport_trip_type
regular_trip_fare = 40.00
airport_fee_amount = 5.00
final_fare = 45.00
```

Later TESTUS fee or US fare changes affect **new quotes only**. Existing snapshot values stay at book time.

No full HTTP `POST /bookings` against the local DB (no US fares to quote, and Google/auth not used in this QA).

---

## 6. Stripe USD capability result

**Real Stripe TEST platform, production PaymentService path** (`prepareCardPaymentForBooking` → `buildPlatformPaymentIntentParams` → `getStripeClient().paymentIntents.create`).

Not a throwaway Stripe script.

| Check | Result |
|-------|--------|
| Mode | test |
| Amount | **4500** (`$45.00`) |
| Currency | **usd** |
| Capture method | manual |
| Destination / transfer_data | none |
| Outcome | PaymentIntent created (`pi_…`), then cancelled for cleanup |
| USD rejection | **did not occur** |

Secret keys were not printed.

---

## 7. Authorization result

**Mocked Stripe** (Phase C path): ledger claimed `currency = USD`, `grossAmount = 4500`, status follows existing mapping (`requires_capture` → `authorized`). Booking activation semantics were not changed.

**Real Stripe:** PI was created in `requires_payment_method` (no test card attached, no confirm). Real authorization (`requires_capture`) was **not** exercised.

---

## 8. Capture result

**Mocked Stripe** (Phase D path): `captureAuthorizedBookingPayment` captured once; retry returned `alreadyCaptured`; booking `payment_status` marked paid when captured. Idempotency key remains `booking:{id}:capture`.

**Real Stripe:** capture of an authorized USD PI was **not** exercised.

---

## 9. Payment ledger result

| Path | currency | gross | status |
|------|----------|-------|--------|
| Card prepare (mocked) | USD | 4500 | authorized (from `requires_capture`) |
| Card after capture (mocked) | USD | 4500 | captured |
| Cash complete | USD | 4500 | captured, `provider = cash` |
| Real Stripe create | USD | 4500 | pending / requires_payment_method (cancelled after probe) |

---

## 10. Settlement result

Airport card example `$45` gross / `$5` airport / 25–75:

| Field | Value |
|-------|--------|
| commissionable | 4000 (`$40`) |
| driver | 1000 (`$10`) |
| company | 3000 (`$30`) |
| airport | 500 (`$5`) |
| sum | 4500 |
| currency | USD |
| card status | `pending` |
| cash status | `skipped_cash` |
| `provider_transfer_id` | **null** |
| Stripe Transfer | **none** |

Regular US `$40` (no airport): driver `$10` / company `$30` / airport `$0`.

---

## 11. Airport fee math

```
passengerGross - airportFee = commissionableFare
$45.00 - $5.00 = $40.00
driver = floor(40.00 * 25%) = $10.00
company = remainder = $30.00
driver + company + airport = passenger gross
```

25/75 is **not** calculated from `$45`. Airport fee is the booking snapshot, not a settlement percentage.

---

## 12. Cash USD result

Cash remains supported. Completed US cash booking path:

- ledger currency **USD**, gross = passenger total (4500)
- airport snapshot included when present
- settlement **skipped_cash**, split excludes airport fee
- **no Stripe call**

---

## 13. BD regression result

Pickup BD → market BD → BDT. Same 10 km uses BD rates (`50 + 20×10 = 250.00` BDT), not US `$40`. Settlement currency stays BDT. USD airport fees are not added onto BDT quotes (existing currency-guard tests). No FX.

---

## 14. Idempotency result

| Retry | Result |
|-------|--------|
| Payment prepare | existing `provider_payment_intent_id` retrieved; second create not called; fare change ignored |
| Capture | second completion does not capture twice |
| Settlement | existing row returned; second claim not inserted |

Idempotency keys unchanged (`booking:{id}:payment` / `:capture`). Unique `booking_id` on payments and settlements still applies.

---

## 15. API response verification

**Passenger quote (current contract, no new duplicate fields):**

- `currency = USD`
- `regularFare`
- `airportFee`
- `airport` `{ id, code, name, tripType }`
- `finalFare`
- `market.{ code, countryCode, currency }`

**Passenger payment view:** `amount` (minor units), `currency` (USD uppercase from Stripe/`prepare` view).

**Passenger ride/booking snapshot:** `fare.amount` + `fare.currency` from `bookings.currency`. History does not duplicate `regularFare` / `airportFee` (existing contract).

**Driver payment history:**

- `passengerPayment.amount` USD `$45.00`
- `settlement.driverAmount` USD `$10.00`
- `settlement.platformAmount` USD `$30.00`
- `settlement.airportFee` USD `$5.00`
- airport fee is **not** labeled as driver earnings
- `transfer.status = not_started`

---

## 16. Files changed

Production / schema / migrations: **none** (no defect found).

Added:

- `tests/usd-end-to-end-financial.test.ts` — TESTUS fixture matrix A–X
- `tests/usd-stripe-sandbox-financial.test.ts` — real TEST-mode PaymentIntent via PaymentService
- `RYDU_BACKEND_USD_END_TO_END_FINANCIAL_QA_REPORT.md` (this file)

---

## 17. Tests / build

| Command | Result |
|---------|--------|
| `tests/usd-end-to-end-financial.test.ts` | 24 passed |
| `tests/usd-stripe-sandbox-financial.test.ts` | 3 passed (including real USD PI) |
| market, fare, airport, settlement, cash, Stripe A/C/D, webhook, booking route, places-country, ride history, driver payment history | passed |
| `npx tsc --noEmit` | passed |
| `npm run build` | passed |

---

## 18. Mocked vs local DB vs real Stripe

| Layer | What was verified |
|-------|-------------------|
| **Mocked / unit** | US quotes, TESTUS pickup/drop-off, snapshot immutability, ledger, capture, settlement math, cash, BD regression, idempotency, passenger/driver contracts, no FX / no SAN-specific payment code |
| **Local DB (read-only)** | BD + US markets present; **0 US fares**; **0 US airports**; BD fares present (48). No TESTUS seed. No overwrite of Admin data |
| **Real Stripe sandbox** | TEST platform **accepted** a USD manual-capture PaymentIntent for **4500** through `prepareCardPaymentForBooking`. Confirm + capture of a card were **not** run |

---

## 19. Blockers

**Not a code defect.** Operational gaps for physical U.S. rides on this local DB:

1. Admin must enter **US category fares** (`PUT /api/v1/admin/markets/US/fares` or equivalent). Until then live US quotes return `MARKET_PRICING_NOT_CONFIGURED`.
2. Admin must create at least one **US/USD airport** (TESTUS or a real U.S. airport) before airport-fee physical QA. Do not invent production SAN values in migrations.
3. Real Stripe **authorization + capture** still needs a confirmed test card on a booking (Passenger app or a confirmed PaymentIntent). This QA only proved **USD PI create**.

Stripe did **not** reject USD. Currency was not switched to BDT. No FX was added.

---

## 20. Ready for Passenger physical U.S. QA?

**Not yet on this local database.**

The backend path is implemented and covered by TESTUS fixtures, and the Stripe TEST account can create USD PaymentIntents. Physical Passenger QA still needs:

1. US market fares in Admin
2. Optional US airport(s) for airport-fee rides
3. Passenger app using the existing quote/payment contract (`currency`, `regularFare`, `airportFee`, `finalFare`)

---

## 21. Safe to proceed to Stripe Connect transfer implementation?

**Yes, for the settlement/transfer layer.**

Card settlements are created as `pending` with `provider_transfer_id = null`. No Transfer is created today. Commission math (regular fare only; airport excluded) is in place. Transfer work should attach to that pending row and must not change fare currency, add FX, or bypass Stripe.

Do not wait for physical U.S. QA before starting Connect transfers, but do not treat U.S. passenger QA as unblocked until Admin US fares exist.

---

## Test matrix

| ID | Check | Result |
|----|--------|--------|
| A | US regular quote → USD | Pass (mocked) |
| B | US airport pickup → fixed USD fee | Pass (TESTUS $5) |
| C | US airport drop-off → fixed USD fee | Pass (TESTUS $7) |
| D | US airport total = regular + fee | Pass ($40+$5=$45) |
| E | booking snapshot currency USD | Pass (mapping + source) |
| F | booking airport snapshot immutable | Pass |
| G | USD PI amount uses total | Pass mocked + **real 4500** |
| H | USD PI currency is usd | Pass mocked + **real usd** |
| I | captured card ledger is USD | Pass (mocked capture) |
| J | airport settlement excludes fee from commission | Pass |
| K | 25/75 math correct | Pass ($10 / $30 / $5) |
| L | card settlement pending | Pass |
| M | no Stripe Transfer | Pass |
| N | regular US settlement airport fee zero | Pass |
| O | USD cash ledger | Pass |
| P | USD cash skipped_cash | Pass |
| Q | fee config change affects new bookings only | Pass |
| R | fare config change affects new bookings only | Pass |
| S | BD regression remains BDT | Pass |
| T | no FX conversion | Pass |
| U | no SAN-specific payment logic | Pass |
| V | retries remain idempotent | Pass |
| W | driver payment-history currency USD | Pass |
| X | passenger response currency USD | Pass |

---

**RYDU BACKEND USD END-TO-END FINANCIAL QA PARTIAL — local DB has no US fares or US airports; real Stripe authorization/capture of a confirmed PaymentIntent was not exercised**
