# DriveWize — final On-Demand Soft Meter backend integration audit

Audit date: 2026-11-03. Repository: `backend_rydu` only. No product code was changed. No passenger booking was created. No Stripe charge or Checkout session was opened.

The configured database for this workspace is local PostgreSQL `localhost:5432/ryd_u` (`NODE_ENV=development`). A separate staging host is not configured. The commented Neon URL in `.env` was not queried.

## 1. Migration status

Journal entries 0036–0040 are present. On `localhost/ryd_u`, `drizzle.__drizzle_migrations` has 40 rows. The last five `created_at` values match the journal:

| Journal | Tag | `created_at` in this database |
| --- | --- | --- |
| idx 35 | `0036_soft_meter` | `1790200000000` |
| idx 36 | `0037_soft_meter_pause` | `1790300000000` |
| idx 37 | `0038_walkup_stripe_test` | `1790400000000` |
| idx 38 | `0039_soft_meter_stopped_time` | `1790500000000` |
| idx 39 | `0040_metered_post_trip_billing` | `1790600000000` |

Read-only checks confirmed:

- Tables: `meter_rate_schedules`, `meter_sessions`, `meter_gps_samples`, `meter_calculation_events`, `meter_fare_records`, `meter_payments`, `meter_pauses`
- `bookings.billing_mode`
- Pause columns `paused_at`, `total_paused_seconds`, `needs_new_anchor`
- Stopped-time columns `stop_streak`, `excluded_stop_seconds`, `stop_remainder_ms`
- Stripe test columns `settlement_mode`, `test_only`, `stripe_livemode`, `fare_classification`, `expires_at`
- Checks: `meter_sessions_billable_check`, `meter_fare_records_billable_check`, `meter_fare_records_charging_check`, `meter_rate_schedules_charging_disabled_check`, `meter_payments_settlement_check`, `meter_payments_livemode_check`, `meter_sessions_stop_check`, `bookings_billing_mode_check`

All 154 existing bookings have `billing_mode` null. Nothing was backfilled.

This local database does not need another migrate for 0036–0040. Any other database that does not have `created_at = 1790600000000` needs:

`npm run db:migrate`

Run that from the backend root with that environment's `DATABASE_URL`. It is additive. It was not run as part of this audit. The dev server terminal shows an earlier `npm run db:migrate` against this same local database completed with exit code 0, including the `bookings_billing_mode_check` notice from 0040.

A remote staging database was **NOT VERIFIED**.

## 2. Booking lifecycle verification

Verified in code and in `tests/soft-meter-metered-booking.test.ts`. Not executed as a live passenger create.

Instant canonical `economy` (also executive, suv, van, minivan, ada) is classified by the stored category code and `schedulingType`. The create schema has no `billingMode` field. A client value is stripped by validation and is not read.

`planBookingCreate` for that classification returns:

- `billingMode = metered_post_trip`
- `paymentRequiredBeforeDispatch = false`
- `paymentRequiredAfterCompletion = true`
- `fareClassification = test_only_unapproved_tariff`
- initial status `searching`
- `createQuotePaymentIntent = false`
- `startDispatch = true`
- `paymentStatus` stored as `pending`

`confirmBooking` calls `prepareCardPaymentForBooking` only when `plan.createQuotePaymentIntent` is true. An idempotent replay calls it only when the stored booking is not `metered_post_trip`. The metered create response is the booking object. It has no `payment` object and no `clientSecret`.

`GET /api/v1/passenger/bookings/:bookingId/payment` returns before PaymentIntent creation when `billingMode` is `metered_post_trip`, with `paymentIntentId: null` and `clientSecret: null`.

Live result: **NOT VERIFIED**. No booking was created. The running dev server reported 0 online drivers, so a live dispatch offer could not be observed.

## 3. Meter lifecycle verification

Verified by code inspection and the existing synthetic Jest suites. These are not physical-device results.

When the driver sets `in_progress` on a `metered_post_trip` booking, `updateBookingStatusByDriver` calls `startOnDemandMeter` after the row is saved. `startMeterSession` returns the existing session for that booking, so a second start does not create another session. If start fails, the trip still proceeds and the failure is logged as `meter.ondemand.auto_start_failed`.

GPS samples are recorded only when the driver location ingest endpoint is called. Ride start does not invent points. Automated tests feed synthetic points and check:

- accepted distance and rejection of duplicates, stale, inaccurate, and out-of-order points
- distance billed while moving, including below 10 mph
- stopped time only while fully stopped, in completed minutes
- pause freezes distance and stopped time
- resume clears the GPS anchor and requires a new stop confirmation
- one fare record per session, including a concurrent finalize

Draft rates used by those tests: flag drop 420 cents, 46 cents per completed 0.1 mile, 60 cents per completed stopped minute. One mile and no stopped time is 880 cents. One mile and 90 stopped seconds is 940 cents. `billable` and `chargingEnabled` stay false.

Live driver accept, ride start, device GPS, pause, resume, and completion: **NOT VERIFIED**.

This database has two older on-demand sessions, both `finalized`, `billable = false`, with two fare records, `charging_enabled = false`. Both parent bookings are `completed`, `payment_status = paid`, card ledger `captured`, and `billing_mode` null. They predate the new classification. No new meter session was created for this audit.

## 4. Payment and webhook verification

Code and mocked tests, not a live Stripe call.

Completion of a `metered_post_trip` booking does not capture the quote and does not write the cash quote ledger. `ensureOnDemandMeterSettlement` finalizes a running, paused, or stopped meter once, copies `fare.totalCents` into one `stripe_test` payment, and leaves the booking completed and unpaid. `paymentRequired` is true and `finalFareCents` is that stored amount.

`POST /api/v1/passenger/bookings/:bookingId/meter-payment/checkout` uses `onDemandMeterCheckoutSchema`, which accepts only `{}`. Checkout uses `existing.amountCents` and rejects a mismatch with the finalized fare. An open unexpired session is returned again. An expired unpaid session is replaced. Paid and refunded sessions are not charged again.

Webhook handling:

- bad signatures are rejected
- `livemode = true` is rejected
- amount and USD currency must match the stored payment
- a duplicate Stripe event does not apply twice
- paid is stored only from a verified paid webhook
- a Checkout return without that webhook does not mark paid
- failed, cancelled, and refunded are distinct statuses
- a receipt is exposed after the paid webhook supplies it

`tests/soft-meter-ondemand-payment.test.ts` and `tests/soft-meter.webhook.test.ts` passed these cases with in-memory payments. No Stripe API request was made.

This process cannot open Checkout yet. `.env` has `sk_test` and `pk_test` prefixes and a webhook secret, but these are unset:

- `ONDEMAND_STRIPE_TEST_PAYMENTS`
- `WALKUP_STRIPE_TEST_PAYMENTS`
- `METER_CHECKOUT_SUCCESS_URL`
- `METER_CHECKOUT_CANCEL_URL`

With the on-demand flag unset, `evaluateOnDemandStripeTestConfig` returns disabled. A live Checkout or a Stripe-delivered webhook was **NOT VERIFIED**.

`meter_payments` has 0 rows, which matches the two historical rides: their quotes were already captured, so settlement must not create a second charge.

## 5. Unpaid recovery verification

Routes exist and are registered before `/:bookingId`:

- `GET /api/v1/passenger/bookings/unpaid-meter-payment`
- `GET /api/v1/passenger/bookings`
- `GET /api/v1/passenger/bookings/:bookingId/meter-payment`

The unpaid query selects the latest completed on-demand `stripe_test` payment in `pending`, `checkout_open`, `failed`, or `cancelled` for the authenticated customer. It does not depend on the previous socket. History includes `completed` rides and attaches `meterPayment` when a row exists. `fare.amount` stays the stored quote. `meterPayment.finalFareCents` is the payable amount.

The picker and history attachment are covered by unit tests. A reconnect with a real passenger token was **NOT VERIFIED**. There is no unpaid meter payment in this database to recover. The two historical completed rides are `paid` and captured, so they correctly stay out of unpaid recovery.

## 6. Regression results

| Check | Result |
| --- | --- |
| Scheduled economy and any scheduled ride | `quoted_prepay`. Card still creates a PaymentIntent. Status stays `scheduled`. Not dispatched by this path. |
| Rental, reserve, and legacy codes | `quoted_prepay`. Rental quotes are still skipped. |
| Historical null `billing_mode` | Quote capture or cash ledger remains the path unless a meter session is already attached. The two local captured rides stay paid and have no meter payment. |
| Walk-up test Checkout | Separate flag, purpose `walk_up_meter_test`. Suite passed. Live walk-up Checkout was not opened. Its flag is also unset. |
| Double payment | Open Checkout is reused. Paid and refunded do not create another session. Unique fare and idempotency constraints remain. |
| Client billing override | Create schema does not accept `billingMode`. Classification uses the category row. |
| Production charging | `METERED_CHARGING_RELEASED` is false. Database checks still force `billable = false`, `charging_enabled = false`, and `stripe_livemode = false`. |

Cash and Stripe phase D tests still require quote settlement only on the non-metered branch (`!metered`).

## 7. Tests and build

Command:

`npx jest --maxWorkers=1 --forceExit` on the 11 suites below.

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

`npx tsc --noEmit` exited 0, then `npm run build` exited 0.

Redis printed “Cannot log after tests are done”. That is existing connection noise. The Jest exit code was 0.

## 8. Exact staging blockers

Remote staging: **NOT VERIFIED**. No staging `DATABASE_URL` is active.

On this local development process, a live end-to-end ride is blocked by:

1. `ONDEMAND_STRIPE_TEST_PAYMENTS` is unset, so meter Checkout stays disabled.
2. `METER_CHECKOUT_SUCCESS_URL` and `METER_CHECKOUT_CANCEL_URL` are unset. Both are required once the flag is true.
3. No authenticated passenger or driver call was made.
4. The running server reported 0 online drivers.
5. No Stripe webhook delivery from Stripe to this server was observed. The webhook secret is set, but that only means the process can verify a signature.
6. `WALKUP_STRIPE_TEST_PAYMENTS` is unset, so live walk-up Checkout is also disabled.

Do not set those flags on a process that uses live Stripe keys. This process is using test-key prefixes.

## 9. Remaining physical-device QA

Still required on a driver device and the passenger app:

- book instant Economy and confirm Flutter does not open PaymentSheet
- driver accept, arrive, and start
- confirm the backend meter session is `running` without a second session
- real GPS: moving distance, a full stop long enough for a billed minute, pause, and resume
- complete the ride once and confirm one fare record
- unpaid ride remains completed
- Checkout `{}` charges the stored `finalFareCents` in Stripe test mode
- leaving the browser does not mark the ride paid
- a signed `livemode=false` webhook marks it paid and the receipt endpoint succeeds
- force-close the passenger app and recover the unpaid ride after a new login
- confirm a booking with no meter becomes `meter_unresolved` and does not open Checkout

The missing-meter branch is implemented and unit-tested. It was not executed against a live booking.

## 10. Production safety confirmation

Production metered charging was not enabled.

- `METERED_CHARGING_RELEASED` remains false
- fare preview stays `billable: false` and `chargingEnabled: false`
- the database rejects a billable meter, a billable fare, an enabled rate schedule, and `stripe_livemode = true`
- on-demand Checkout refuses an `sk_live` secret
- production also requires `ONDEMAND_STRIPE_TEST_SANDBOX=authorized` before test Checkout can run
- this audit did not capture a quote, create a PaymentIntent, or call Stripe
