# DriveWize backend — on-demand metered Stripe test payment

A completed On-Demand ride that has a running Soft Meter now settles on the finalized server meter fare. The passenger pays that fare in Stripe test Checkout after the ride. Ride completion does not wait for payment. Production metered charging stays off.

No new database migration was required. `meter_payments` already accepts an `on_demand` subject and a `stripe_test` settlement.

## 1. Files changed

- `src/services/booking.service.ts` — metered completion no longer captures or records the quote
- `src/services/softMeter/onDemandMeterPayment.ts` — settlement decision, Checkout rules, passenger view
- `src/services/softMeter/onDemandMeterPayment.service.ts` — pending payment, passenger Checkout, receipt, unpaid recovery
- `src/services/softMeter/meterPayment.service.ts` — the existing webhook also updates an on-demand booking payment
- `src/services/softMeter/meterNotify.service.ts` — `booking:meter_payment`
- `src/services/rideHistory.service.ts` — additive `meterPayment` on passenger history
- `src/controllers/passengerBooking.controller.ts`
- `src/routes/v1/passenger/index.ts`
- `src/repositories/meterPayment.repository.ts`
- `src/constants/softMeter.ts` — `booking:meter_payment` and `on_demand_meter_test`
- `src/validators/softMeter.ts` — empty Checkout body
- `tests/soft-meter-ondemand-payment.test.ts`
- `tests/cash-booking-payment.test.ts` and `tests/stripe-phase-d.test.ts` — non-metered completion still matches the source

Driver Android, Driver iOS, Passenger Flutter, and Admin Web were not modified.

## 2. Database

No migration. A metered ride stores one `meter_payments` row:

| Column | Value |
| --- | --- |
| `subject_type` | `on_demand` |
| `booking_id` | The completed booking |
| `meter_session_id`, `fare_record_id` | The finalized meter |
| `amount_cents`, `currency` | The finalized fare, copied once |
| `settlement_mode` | `stripe_test` |
| `test_only` | true |
| `stripe_livemode` | false |
| `fare_classification` | `test_only_unapproved_tariff` |
| `status` | `pending`, then `checkout_open`, `paid`, `failed`, `cancelled`, or `refunded` |

The unique fare and idempotency indexes keep one payment per finalized fare. `bookings.final_fare` is not rewritten. Historical `booking_payments` rows are not deleted.

## 3. Old quoted-fare settlement

Before this change, driver completion did two things:

- Card rides called `captureAuthorizedBookingPayment`, which captured the PaymentIntent authorized for `bookings.final_fare` (the quote) and marked the booking paid.
- Cash rides set `payment_status` to `paid` and wrote a cash ledger row for that same quote through `recordCompletedCashBookingPayment`.
- The Soft Meter was finalized beside that settlement and was not the amount collected.
- Booking creation for a card still calls `prepareCardPaymentForBooking`. That authorizes the quote. It does not capture it. That creation path is unchanged so current clients still receive a client secret.

What changed for a booking whose meter is `running`, `paused`, `stopped`, or `finalized`:

- Completion does not capture the quote.
- Completion does not write the quote as a cash ledger row and does not mark the booking paid because the ride finished.
- An uncaptured card authorization is released, so it cannot be captured later as a second charge.
- If that authorization was already captured, the historical capture is left in place and no meter Checkout is created.
- A pending `stripe_test` meter payment is stored for the finalized `totalCents`.
- A ride with no meter, or only a `pending` meter that never started, still uses the old quote capture or cash ledger.

## 4. Lifecycle

1. The passenger creates a booking. The quote remains an estimate on `estimated_fare` and `final_fare`.
2. The driver accepts and starts the trip, then starts the Soft Meter.
3. The existing meter engine updates the live fare. Moving, including below 10 mph, bills distance. Stopped time bills only while fully stopped, per completed minute. Pause adds nothing.
4. The driver completes the ride. The booking status becomes `completed` even when payment is still pending.
5. The backend finalizes the meter and stores the fare record.
6. A meter payment row is created with status `pending`.
7. The passenger opens Stripe test Checkout. The amount is the stored finalized total.
8. A verified `livemode=false` webhook marks the payment `paid` and stores the receipt URL.
9. A refund webhook can move `paid` to `refunded`.

Ride status and payment status stay separate. A completed ride can be `payment_pending`, `checkout_open`, `payment_failed`, `paid`, or `refunded`. Redirecting back from Stripe does not mark it paid.

## 5. REST API

All routes require the authenticated passenger who owns the booking. The Checkout body must be empty. `amount`, `currency`, `testMode`, and any fare field are rejected.

| Method | Path | Result |
| --- | --- | --- |
| `GET` | `/api/v1/passenger/bookings/:bookingId/meter-payment` | Current meter payment view |
| `POST` | `/api/v1/passenger/bookings/:bookingId/meter-payment/checkout` | Opens or reuses Stripe test Checkout |
| `GET` | `/api/v1/passenger/bookings/:bookingId/meter-payment/receipt` | Same view plus flag, distance, and stopped-time cents |
| `GET` | `/api/v1/passenger/bookings/unpaid-meter-payment` | Most recent completed unpaid metered ride, or null |

`GET /api/v1/passenger/bookings` adds `meterPayment` on each item when a meter payment exists. Existing fare and payment fields stay. `meterPayment` is null when the ride has no on-demand meter payment.

`meterPayment` fields:

- `bookingId`
- `rideStatus`
- `paymentStatus` — `payment_pending`, `checkout_open`, `payment_failed`, `paid`, or `refunded`
- `paymentRequired`
- `paymentMode` — `stripe_test` or null
- `finalFareCents`
- `currency`
- `meterSessionId`
- `completedAt`
- `paidAt`
- `receiptAvailable`
- `receiptUrl` — only after a verified paid webhook
- `hostedUrl` — only while Checkout is open and unexpired
- `testMode`
- `fareClassification`
- `paymentVersion` — server `updatedAt` milliseconds
- `productionCharge` — always false

Checkout requires a completed booking, a finalized meter, a positive USD fare that still matches the meter preview, and the server test gate. An open unexpired Checkout URL is reused. An expired or failed Checkout can be replaced. The stored amount is not recalculated from the quote and is not taken from the client. A paid or refunded ride does not get another Checkout. Another passenger receives 404.

The test gate is server-only:

- `ONDEMAND_STRIPE_TEST_PAYMENTS=true`
- `STRIPE_SECRET_KEY` must be `sk_test_`
- A publishable key, when set, must be `pk_test_`
- `STRIPE_WEBHOOK_SECRET`, `METER_CHECKOUT_SUCCESS_URL`, and `METER_CHECKOUT_CANCEL_URL`
- In production, `ONDEMAND_STRIPE_TEST_SANDBOX=authorized`

Live keys are rejected. The Walk-Up gate remains `WALKUP_STRIPE_TEST_PAYMENTS` and is not turned on by the on-demand flag.

## 6. Socket

Event: `booking:meter_payment`.

It is emitted to the passenger, the assigned driver, and admins when the payment becomes pending, Checkout opens, a webhook confirms, fails, expires, or refunds the payment. The payload is the same view as the REST payment resource, including `bookingId`, `paymentStatus`, and `paymentVersion`.

The passenger can recover with `GET /bookings/:bookingId/meter-payment` or `GET /bookings/unpaid-meter-payment` if the socket event was missed.

## 7. Webhook

The existing signed Stripe webhook is unchanged for Walk-Up. For an on-demand `stripe_test` payment it also:

- Ignores `livemode=true`
- Loads the payment by the stored Checkout session, not by a client booking id
- Checks USD and the exact stored `amount_cents`
- Leaves a mismatch or wrong currency unpaid and records `AMOUNT_MISMATCH` or `CURRENCY_MISMATCH`
- Applies paid, failed, and expired transitions once
- Applies a refund only from `paid`
- Updates `bookings.payment_status` to the meter payment status
- Does not capture the quoted PaymentIntent as a fallback

## 8. Unpaid recovery

The pending row is in Postgres, keyed by the fare record. It survives app termination, logout, reinstall, and an expired Checkout session. `GET /api/v1/passenger/bookings/unpaid-meter-payment` returns the latest completed on-demand ride whose meter payment is `pending`, `checkout_open`, `failed`, or `cancelled`. Passenger history includes the same view, so Pay Now can call the Checkout route again.

## 9. Tests

Focused Jest run, `--maxWorkers=1`: 9 suites, 95 tests, all passed.

| Suite | Result |
| --- | --- |
| `tests/soft-meter-ondemand-payment.test.ts` | 6 passed |
| `tests/soft-meter-walkup-stripe-test.test.ts` | passed |
| `tests/soft-meter.test.ts` | passed |
| `tests/soft-meter-pause.test.ts` | passed |
| `tests/soft-meter.payment.test.ts` | passed |
| `tests/soft-meter.webhook.test.ts` | passed |
| `tests/cash-booking-payment.test.ts` | passed |
| `tests/stripe-phase-d.test.ts` | passed |
| `tests/ride-history.test.ts` | passed |

The new suite covers quote capture staying off for a metered ride, Checkout at the finalized total (one mile plus 90 stopped seconds is 940 cents), duplicate Checkout, expired replacement, failed retry, paid and refunded rides, amount mismatch, wrong currency, live mode, browser return, another passenger, unpaid recovery, an empty Checkout body, and the Walk-Up and production locks.

Redis connect logs after Jest are existing process noise. They did not fail the suites.

## 10. Build

`npx tsc --noEmit` exited 0. `npm run build` exited 0.

## 11. Passenger Flutter still to do

The app was not changed. It can:

- After completion, read `meterPayment` from history or `GET /bookings/:bookingId/meter-payment`
- Show Pay Now while `paymentRequired` is true
- `POST /bookings/:bookingId/meter-payment/checkout` with an empty body and open `hostedUrl`
- Listen for `booking:meter_payment`, and reload the GET if the socket is missed
- On launch, call `GET /bookings/unpaid-meter-payment`
- Show the receipt only when `receiptAvailable` is true

It must not send an amount or treat the booking quote as the payable fare.

## 12. Still unresolved

- `METERED_CHARGING_RELEASED` remains false. This Checkout is a Stripe test settlement, not a production charge.
- The draft Coronado rates and the completed-minute stopped-time rule are not regulator-approved.
- Test Checkout does nothing until `ONDEMAND_STRIPE_TEST_PAYMENTS=true` and the test Stripe settings above are present. The ride still completes and stays payment pending.
- Card booking creation can still authorize the quote for existing clients. Metered completion releases that hold instead of capturing it. A quote that was captured before this change is not charged again and does not receive a meter Checkout.
- Walk-Up test Checkout is unchanged.
