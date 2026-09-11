# RYDU Backend — Market-Aware Transaction Currency

**Workspace:** `backend_rydu`  
**Date:** 2026-09-11  
**Scope:** Backend-only. No Passenger Flutter, Admin frontend, Driver Android, or Driver iOS changes.

**Final status:** **RYDU BACKEND MARKET CURRENCY IMPLEMENTATION COMPLETE**

---

## 1. Existing market / service-area architecture

There was **no** market, city, region, or service-area model that could determine booking currency.

Geography already in the repo:

| Piece | Role | Currency? |
|-------|------|-----------|
| `bookings` lat/lng/address/placeId | Ride geometry | No |
| `customer_places.country_code` | Saved places UX | No |
| Google Place Details / reverse geocode `countryCode` | Maps APIs | Not wired to fare/payment |
| `airports.country_code` + `airports.currency` | Airport fee config | Fee currency only |
| `GOOGLE_MAPS_REGION` default `BD` | Routes bias | No |
| Customer `phone_country_code`, driver `stripe_account_country` | Phone / Connect | Explicitly not fare currency |

Quote/create payloads had **no** country field. Pickup country was not persisted on bookings.

**Nothing was reused as a hidden market engine.** A new `ride_markets` table is the source of truth.

---

## 2. Current pricing architecture

`service_categories.base_fare` / `per_km_rate` / `min_fare` were **global**. One number served the whole platform and was always treated as BDT.

Those global numbers **cannot** mean 100 BDT in Bangladesh and 100 USD in the United States.

Promotions are per category, not per market.

---

## 3. Final market-resolution rule

**Pickup operating market defines the booking transaction currency for the entire lifecycle.**

```
pickup country → active ride_markets row → transactionCurrency
```

Pickup country source, in order (no home-grown lat/lng-to-country math):

1. Google Place Details `countryCode` when `pickup.placeId` is present
2. Existing Google reverse geocode of pickup coordinates
3. Client `pickupCountryCode` / `pickup.countryCode` **only if Google returned no country**, and only if it matches an active market

Google country **wins**. Flutter cannot force USD on a Bangladesh pickup.

Not used: typed address, airport code/name, device locale, phone locale, Stripe account, driver nationality.

Seeded markets:

| Code | Country | Currency |
|------|---------|----------|
| BD | Bangladesh | BDT |
| US | United States | USD |

Unsupported pickup country → `UNSUPPORTED_MARKET` (quote/booking fail safely).

---

## 4. Booking currency schema

Added on `bookings`:

| Column | Meaning |
|--------|---------|
| `currency` | Immutable transaction currency (`BDT` \| `USD`) |
| `market_code` | Snapshot (`BD` / `US`) |
| `pickup_country_code` | Resolved pickup ISO-2 |

`booking_payments.currency` and `booking_settlements.currency` already existed and now follow the booking snapshot.

Helper: `resolveBookingCurrency(booking)` — uses `bookings.currency`; historical null → `BDT`.

`getTransactionCurrency()` remains a **fallback default of BDT** only when no booking/quote market exists. Existing-booking retry/restore/cash/PI paths use the snapshot.

---

## 5. Migration / backfill

`0031_ride_markets_and_booking_currency`

- Creates `ride_markets` and `service_category_market_fares`
- Seeds BD/BDT and US/USD
- Copies **existing** `service_categories` rates into **BD only**
- Does **not** copy those rates to US
- Adds `bookings.currency` default/backfill `BDT`
- Sets historical `market_code = BD` where null
- No `UPDATE` of `final_fare`, `booking_payments`, or `booking_settlements`

Applied on local `localhost:5432/ryd_u`.

---

## 6. Bangladesh flow

Pickup country `BD` → market BD → currency `BDT` → BD market fares (copied from today’s global rates) → quote/booking/PI/cash/settlement all `BDT`.

Existing Bangladesh behavior is unchanged.

---

## 7. U.S. flow

Pickup country `US` → market US → currency `USD`.

U.S. fare rows were **not** invented. Until Admin enters US rates via `PUT /api/v1/admin/markets/US/fares`, a U.S. quote fails with `MARKET_PRICING_NOT_CONFIGURED`. It does **not** reuse Bangladesh numbers as USD.

Once US fares exist: quote `currency = USD`, booking snapshot `USD`, card PI `usd`, cash ledger `USD`, settlement `USD`.

---

## 8. Fare configuration changes

New table `service_category_market_fares` (`market_id`, `service_category_id`, `base_fare`, `per_km_rate`, `min_fare`).

Quote uses **only** the resolved market’s rows. Missing category in that market is skipped; empty market → error.

Global `service_categories` rates remain catalog defaults / BD seed source. They are not used as USD.

Admin (backend only):

| Method | Path |
|--------|------|
| GET | `/api/v1/admin/markets` |
| GET | `/api/v1/admin/markets/{code}/fares` |
| PUT | `/api/v1/admin/markets/{code}/fares` |

---

## 9. Quote behavior

Quote resolves market from pickup, then returns authoritative:

```
currency
market.code
market.countryCode
```

Bangladesh → `BDT`. United States → `USD`.

Passenger already reads backend `currency`. Flutter does not choose it.

Optional `pickupCountryCode` is a hint only.

---

## 10. Airport compatibility

Same-currency guard is unchanged:

```
airport.currency == booking/quote currency
```

Now:

- SAN-style USD airport + US booking USD → fee can apply
- USD airport + BD booking BDT → fee withheld
- BDT airport + BD booking → fee applies

Activation rules (generic, not SAN-specific):

- Currency must be `BDT` or `USD`
- If `airports.country_code` maps to a market, airport currency must match that market (US → USD, BD → BDT)

---

## 11. Card behavior

PaymentIntent currency comes from `bookings.currency` (via `resolveBookingCurrency` / quote snapshot).

Retry / restore / `getBookingPaymentHandler` no longer use `payment?.currency || 'BDT'`.

Manual capture lifecycle unchanged. No Stripe Transfer.

---

## 12. Cash behavior

Cash ledger `currency = resolveBookingCurrency({ currency: booking.currency })`.

BD cash → BDT. US cash → USD. No Stripe.

---

## 13. Settlement behavior

Uses `booking_payments.currency` (copied from the booking). Formula unchanged:

```
commissionable = gross − airportFee
driver / company split on commissionable only
```

Works in BDT and USD. No cross-currency arithmetic.

---

## 14. History / API currency changes

Replaced financial display hardcodes:

- `rideHistory.service` `HISTORY_CURRENCY = 'BDT'` → `resolveBookingCurrency(booking)`
- `driverBooking.service` fare `currency: 'BDT'` → booking snapshot
- Passenger payment restore `'BDT'` fallback → booking snapshot

Historical BDT bookings still return BDT. U.S. bookings return USD.

Driver Payment History already used ledger/settlement row currency.

---

## 15. Cross-market behavior

Current routing/dispatch has **no** same-country pickup/drop-off rule. A ride can geometrically leave the pickup country.

Payment currency **does not switch**. It stays the pickup-market snapshot for the booking’s life.

Airport cross-airport still withholds two fees. Destination market does not change the PaymentIntent or cash ledger.

---

## 16. Stripe capability findings

Credentials were not changed and no live Stripe probe was added.

- PI create already sends `currency` from the booking (`bdt` or `usd`).
- This environment already creates **BDT** PaymentIntents.
- `usd` is a standard Stripe currency. If this platform account cannot process USD, Stripe will reject PI create (`currency_unsupported`); existing error mapping reports that without changing fare currency.
- No production-account assumption is made here.

---

## 17. Files changed

**New:** `ride_markets` / `service_category_market_fares` schemas; migration `0031`; `rideMarket.repository.ts`; `rideMarket.service.ts`; Admin market controller/routes; `tests/market-currency.test.ts`; this report.

**Updated:** `payment.ts` (`SUPPORTED` = BDT+USD, `resolveBookingCurrency`); `bookings` schema; `fare.service`; `booking.service`; `cashPayment.service`; `airportAdmin.service`; `passengerBooking.controller`; `rideHistory.service`; `driverBooking.service`; validators; `v1` routes; related tests.

---

## 18. Migrations

| Tag | Effect |
|-----|--------|
| `0031_ride_markets_and_booking_currency` | Markets, per-market fares, booking currency snapshot, BDT backfill |

---

## 19. Tests / build

Coverage includes A–X from the request (BD/US resolve, snapshot, historical BDT default, quote currency, client cannot override, BD rates not reused as USD, US rates from US config, airport fee × currency, PI/cash/settlement currencies, no FX, no SAN/LAX/JFK hardcode, unsupported market fail-safe).

Also passed: fare, cash, settlement, airport, ride history, driver payment history, Stripe phases C/D, passenger validators.

```
npx tsc --noEmit   # pass
npm run build      # pass
npm run db:migrate # 0031 applied on ryd_u
```

---

## 20. Exact configuration still required for U.S. launch

1. **Enter U.S. category fares** via Admin `PUT /api/v1/admin/markets/US/fares` (or SQL). Do not copy BD numbers.
2. **Create SAN (and later US airports)** via Admin airports: `countryCode=US`, `currency=USD`, real center/radius/fees — still not invented here.
3. Confirm the **Stripe platform account** can create USD PaymentIntents in the target mode.
4. Admin frontend UI for markets/fares (backend API is ready).
5. Passenger already reads quote `currency`; no Flutter currency picker is required.

Until step 1, a U.S. quote fails closed (`MARKET_PRICING_NOT_CONFIGURED`).

---

## 21. Whether SAN can now safely be activated as USD

**Airport row: yes.** A SAN record with `countryCode=US` and `currency=USD` may be activated. There is no SAN-specific exception; it is a U.S.-market airport.

**Charging SAN rides: only after U.S. fares exist.** Currency matching will then allow the USD airport fee on a USD booking. A Bangladesh booking still will not receive a USD fee.

Do not activate SAN as USD against a Bangladesh booking. Do not use BDT fare numbers as USD.

---

**RYDU BACKEND MARKET CURRENCY IMPLEMENTATION COMPLETE**
