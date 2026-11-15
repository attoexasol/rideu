# DriveWize backend — metered on-demand booking without upfront authorization

A new instant On-Demand booking for a canonical vehicle class is created as `searching` and dispatched without a quoted-fare Stripe PaymentIntent. The passenger pays the finalized Soft Meter fare after the ride, through the existing Stripe test Checkout. Production metered charging stays off.

Passenger Flutter, Driver Android, Driver iOS, and Admin Web were not modified.

## 1. Files changed

- `src/services/softMeter/billingMode.ts` — server classification, create plan, completion plan, public billing fields
- `src/services/booking.service.ts` — metered create skips quote authorization and dispatches immediately; the meter starts when the ride starts; a missing meter stays unresolved
- `src/services/fare.service.ts` — each instant quote carries the billing classification
- `src/controllers/passengerBooking.controller.ts` — create and quote responses, and the payment endpoint no longer creates a PaymentIntent for a metered booking
- `src/services/rideHistory.service.ts` — active booking, booking detail, and history include the billing fields
- `src/services/softMeter/onDemandMeterPayment.service.ts` — `markMeterSettlementUnresolved` for a classified ride with no payable meter fare
- `src/db/schema/bookings.ts` — nullable `billingMode`
- `src/db/migrations/0040_metered_post_trip_billing.sql`
- `src/db/migrations/meta/_journal.json` — idx 39
- `tests/soft-meter-metered-booking.test.ts`

The post-trip Checkout module, walk-up Checkout, fare calculator, and pause/stopped-time rules were not rewritten.

## 2. Previous upfront authorization flow

An instant card booking was inserted as `quoted`. `confirmBooking` called `prepareCardPaymentForBooking`, which created a manual-capture PaymentIntent for the quoted fare and returned `payment.clientSecret`. Dispatch did not start. The passenger had to authorize that intent. `GET /api/v1/passenger/bookings/:bookingId/payment` created the intent again when the booking was still `quoted`, then moved it to `searching` only after Stripe reported the authorization.

Cash instant bookings already went to `searching` and dispatched immediately. At completion, a card booking without a meter session captured the quote. A cash booking without a meter session was marked `paid` and written to the cash quote ledger.

There is no `needsPayment` field in this API. The PaymentSheet requirement was the `quoted` status plus `payment.clientSecret`.

## 3. New metered booking flow

For a new `metered_post_trip` booking, card or cash:

1. The server classifies the product. A passenger fare or billing-mode flag is not accepted.
2. The booking is stored as `searching`, `paymentStatus: pending`, `billingMode: metered_post_trip`.
3. `prepareCardPaymentForBooking` is not called, including on an idempotent replay.
4. Dispatch starts under the existing driver-availability and service-area rules.
5. When the driver moves the ride to `in_progress`, the server starts the Soft Meter. A second start for the same booking returns the existing session.
6. If that start fails, the trip still proceeds. The failure is logged.
7. On completion, a running, paused, stopped, or finalized meter is finalized and the existing `ensureOnDemandMeterSettlement` stores a pending `stripe_test` payment for `fare.totalCents`. The quote is not captured and the cash quote ledger is not written.
8. The passenger pays with the existing empty-body Checkout:

- `GET /api/v1/passenger/bookings/:bookingId/meter-payment`
- `POST /api/v1/passenger/bookings/:bookingId/meter-payment/checkout`
- `GET /api/v1/passenger/bookings/:bookingId/meter-payment/receipt`
- `GET /api/v1/passenger/bookings/unpaid-meter-payment`

The booking is not marked paid at creation or at completion. Payment Pending, Checkout Open, Paid, Failed, and Refunded still come from the webhook-confirmed meter payment.

## 4. Billing-mode classification

Trusted inputs are the service-category code stored for the booking and `schedulingType`.

| Product | Stored `billing_mode` | Settlement |
| --- | --- | --- |
| Instant `economy`, `executive`, `suv`, `van`, `minivan`, `ada` | `metered_post_trip` | Finalized meter, test Checkout |
| Scheduled booking, including scheduled economy (Reserve) | `quoted_prepay` | Existing quote authorization and capture |
| `rental`, `reserve`, legacy codes (`ride`, `bike`, `cng`, `moto`, `premium`, `comfort`), unknown codes | `quoted_prepay` | Existing quote path |
| Bookings created before this change (`billing_mode` null) | unchanged null | Original quote capture or cash ledger, unless a meter session is already attached |

`fareClassification` for a metered booking is `test_only_unapproved_tariff`. A quoted booking returns `null`.

Quote responses classify the product as an instant ride. Creating that same category as `scheduled` returns `quoted_prepay` and still requires card authorization. The create response is the one Flutter should follow.

## 5. Booking and dispatch lifecycle

Metered instant create:

- status `searching`
- `searchStartedAt` set
- `startDispatch` runs
- drivers can accept through the existing offer flow
- no change to availability, service-area, booking validation, or auth checks

Quoted card instant is still `quoted` until the existing authorization activation moves it to `searching`.

Quoted cash instant is still `searching` and still dispatches.

Scheduled bookings stay `scheduled` and are not dispatched by this change.

## 6. Stripe authorization removal

Removed only for `metered_post_trip`:

- no `prepareCardPaymentForBooking` on create or idempotent replay
- no quote PaymentIntent and no `clientSecret`
- `GET /api/v1/passenger/bookings/:bookingId/payment` returns before the PaymentIntent branch and does not call `activateAuthorizedCardBooking`
- completion does not call `captureAuthorizedBookingPayment`
- completion does not call `recordCompletedCashBookingPayment`

Fixed-price card bookings still create and capture the quote PaymentIntent. `METERED_CHARGING_RELEASED` remains `false`. Meter Checkout still requires `ONDEMAND_STRIPE_TEST_PAYMENTS=true`, `sk_test`, and, in production, `ONDEMAND_STRIPE_TEST_SANDBOX=authorized`.

## 7. Meter start and missing-meter safeguards

The meter starts after the booking row is `in_progress`, which is what `startOnDemandMeter` requires. Start is idempotent per booking, so a later driver start does not create a second session or a second fare record. Pause, resume, and stopped-time billing are unchanged.

If a `metered_post_trip` booking is completed with no running or finalized meter, or the meter cannot produce a positive fare:

- the quote is not captured
- the cash quote ledger is not written
- `paymentStatus` becomes `meter_unresolved`
- one `meter_settlement_unresolved` booking event is stored
- a later completion replay does not write that event again
- an already `paid` or `refunded` booking, a captured quote row, or an existing meter payment is left as it is

That unresolved state is the recovery signal. It does not open Checkout, because there is no finalized server fare to charge.

## 8. Passenger API contract

Create `POST /api/v1/passenger/bookings`, HTTP 201.

Metered card or cash. The body is the booking itself, not `{ booking, payment }`. Additive fields:

| Field | Value |
| --- | --- |
| `billingMode` | `metered_post_trip` |
| `paymentRequiredBeforeDispatch` | `false` |
| `paymentRequiredAfterCompletion` | `true` |
| `fareClassification` | `test_only_unapproved_tariff` |
| `status` | `searching` |
| `paymentStatus` | `pending` |

There is no `payment` object, no `paymentIntentId`, and no `clientSecret`.

Quoted card instant still returns `{ booking, payment }`. `payment` still has `method`, `paymentIntentId`, `clientSecret`, and `status`. The booking adds:

| Field | Value |
| --- | --- |
| `billingMode` | `quoted_prepay` |
| `paymentRequiredBeforeDispatch` | `true` |
| `paymentRequiredAfterCompletion` | `false` |
| `fareClassification` | `null` |
| `status` | `quoted` |

Quoted cash returns the booking with `paymentRequiredBeforeDispatch: false` and status `searching`.

Quote `POST` responses, on every quote object:

- `billingMode`
- `paymentRequiredBeforeDispatch`
- `paymentRequiredAfterCompletion`
- `fareClassification`

Current canonical instant quotes are `metered_post_trip` with `paymentRequiredBeforeDispatch: false`. Rental quotes are still omitted.

`GET /api/v1/passenger/bookings/:bookingId`, the active-booking response, and ride history add the same four billing fields. `payment.status` remains the booking payment status. `fare.amount` remains the stored quote. `meterPayment.finalFareCents` remains the payable meter amount when a meter payment exists. A null `billing_mode` is presented as `quoted_prepay` so older rows stay on the quote path.

`GET /api/v1/passenger/bookings/:bookingId/payment` for a metered booking:

```json
{
  "billingMode": "metered_post_trip",
  "paymentRequiredBeforeDispatch": false,
  "paymentRequiredAfterCompletion": true,
  "fareClassification": "test_only_unapproved_tariff",
  "bookingStatus": "searching",
  "paymentStatus": "pending",
  "paymentIntentId": null,
  "clientSecret": null
}
```

Post-trip Checkout request and response bodies are unchanged. The Checkout POST body stays empty.

## 9. Migrations

`0040_metered_post_trip_billing` is additive. It adds nullable `bookings.billing_mode` and a check for null, `metered_post_trip`, or `quoted_prepay`. It does not update or backfill existing rows.

Journal idx 39, `when` 1790600000000. Migrations 0036–0039 were not edited.

`npm run db:migrate` was not run. Until it is applied, booking selects that include `billing_mode` will fail in PostgreSQL.

`payment_status` already allows a 50-character value, so `meter_unresolved` did not need a new check.

## 10. Tests and build results

Command:

`npx jest --maxWorkers=1 --forceExit` on the 11 suites listed below.

Result: 11 suites passed, 116 tests passed, exit code 0.

- `tests/soft-meter-metered-booking.test.ts`
- `tests/soft-meter-ondemand-payment.test.ts`
- `tests/soft-meter-walkup-stripe-test.test.ts`
- `tests/soft-meter.test.ts`
- `tests/soft-meter-pause.test.ts`
- `tests/soft-meter.payment.test.ts`
- `tests/soft-meter.webhook.test.ts`
- `tests/soft-meter-stopped-time.test.ts`
- `tests/cash-booking-payment.test.ts`
- `tests/stripe-phase-d.test.ts`
- `tests/ride-history.test.ts`

The new suite covers classification, the no-PaymentIntent create plan, dispatch-eligible `searching`, missing-meter `meter_unresolved`, historical null still using quote settlement, the payment-handler short circuit, the additive migration, walk-up purpose isolation, and `METERED_CHARGING_RELEASED === false`.

The existing on-demand suite still covers exact-fare Checkout, unpaid recovery, webhook amount and currency checks, duplicate payment prevention, and the non-metered capture branch. Cash and Stripe phase D still require quote settlement only when `!metered`.

`npx tsc --noEmit` exit code 0.

`npm run build` exit code 0.

Redis printed “Cannot log after tests are done” after ride history. That is existing connection noise. The suite exit code was 0.

## 11. Required Flutter follow-up

Flutter was not changed. For `billingMode === "metered_post_trip"`:

- do not open PaymentSheet
- do not read a quoted-fare `clientSecret`
- treat `paymentRequiredBeforeDispatch` as false and `paymentRequiredAfterCompletion` as true
- follow status `searching` into the existing dispatch and ride screens
- after completion, use the existing meter-payment Checkout endpoints
- do not send an amount, currency, `testMode`, or billing mode

For `quoted_prepay` with `paymentRequiredBeforeDispatch: true`, keep the current PaymentSheet flow. A scheduled booking of an otherwise metered vehicle class is `quoted_prepay` even if the quote response said `metered_post_trip`.

## 12. Remaining limitations

- Production metered charging is not enabled. Test Checkout still depends on the on-demand test flag and `sk_test` credentials.
- The stopped-time partial-minute rule remains `test_only_completed_minutes` and is not a regulator-approved tariff.
- Migration 0040 has not been applied to the database.
- Historical bookings stay on quote settlement. A quote that was already captured is not refunded and is not charged again through meter Checkout.
- A metered ride whose meter never starts is `meter_unresolved`. It is not silently charged the estimate, and it has no Checkout amount until a meter fare exists.
- Rentals, Reserve/scheduled rides, and non-canonical products still authorize and capture the quote.
- Walk-up Stripe test Checkout is unchanged.
