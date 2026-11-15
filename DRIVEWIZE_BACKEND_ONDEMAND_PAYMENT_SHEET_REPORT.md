# DriveWize backend — On-Demand Soft Meter PaymentSheet

On-Demand Soft Meter rides still book without an upfront PaymentSheet. After the driver completes the ride, the passenger pays the finalized server fare inside the app with a Stripe **test** PaymentIntent. Hosted Checkout is no longer created for that ride.

Walk-Up Checkout is unchanged. Production metered charging stays off (`METERED_CHARGING_RELEASED = false`). No new migration was added. No live Stripe charge was made.

## 1. Endpoint and JSON response

`POST /api/v1/passenger/bookings/:bookingId/meter-payment/payment-intent`

- Passenger Auth0 JWT
- Body must be `{}`. Amount, currency, `testMode`, quote, and fare fields are rejected.
- The ride must be completed, owned by that passenger, and have a finalized positive meter fare.
- The PaymentIntent amount is the stored `fare.totalCents` in USD. The client cannot choose it.

```json
{
  "bookingId": "uuid",
  "paymentIntentClientSecret": "pi_..._secret_...",
  "paymentIntentId": "pi_...",
  "publishableKey": "pk_test_...",
  "finalFareCents": 940,
  "currency": "USD",
  "paymentStatus": "payment_pending",
  "testMode": true,
  "paymentVersion": 1710000000000,
  "productionCharge": false
}
```

`paymentIntentClientSecret` is null when the fare is already paid, refunded, or Stripe already shows the intent as succeeded. That response still does not mark the ride paid. Only the webhook does.

A paid or refunded ride is not given a new PaymentIntent.

Unchanged reads:

- `GET /api/v1/passenger/bookings/:bookingId/meter-payment`
- `GET /api/v1/passenger/bookings/:bookingId/meter-payment/receipt`
- `GET /api/v1/passenger/bookings/unpaid-meter-payment`
- `GET /api/v1/passenger/bookings`

`POST /api/v1/passenger/bookings/:bookingId/meter-payment/checkout` now returns `409 ONDEMAND_CHECKOUT_DISABLED` and does not create a Checkout Session. If a ride already has an open hosted Checkout, the PaymentIntent endpoint returns `409 ONDEMAND_CHECKOUT_RETIRED` instead of creating a second charge.

Walk-Up payment-link creation is untouched.

## 2. Existing Stripe implementation reused

- `getStripeClient()` and `pk_test` / `sk_test` classification from `src/config/stripe.ts`
- The existing webhook route `POST /api/v1/webhooks/stripe`, signature check, and `stripe_webhook_events` dedupe
- `meter_payments.stripe_payment_intent_id`, which already has a unique index
- `publishOnDemandMeterPayment`, which updates `bookings.payment_status` and emits `booking:meter_payment` with `paymentVersion`
- Quote PaymentIntents in `prepareCardPaymentForBooking` stay manual-capture and are still not created for `metered_post_trip`
- Meter PaymentIntents use `capture_method: 'automatic'` so PaymentSheet can confirm and collect the final fare in one step. They are not the quote authorization.

`handleStripePaymentIntentEvent` ignores intents whose metadata purpose is `on_demand_meter_test`, so a meter payment is not written onto the quote ledger and does not capture the quote.

## 3. PaymentIntent lifecycle

1. Instant canonical booking is `metered_post_trip`, status `searching`, `paymentStatus` `pending`, with no quote client secret.
2. Dispatch and driver acceptance are unchanged.
3. The Soft Meter starts at `in_progress`. Distance, stopped time, pause, and resume are unchanged.
4. Completion finalizes the meter and stores one pending `stripe_test` `meter_payments` row for `fare.totalCents`. The ride stays completed while unpaid. A missing meter stays `meter_unresolved` and does not open a PaymentIntent.
5. The passenger calls the PaymentIntent endpoint.
6. A reusable intent (`requires_payment_method`, `requires_confirmation`, `requires_action`, `processing`) is returned again. Concurrent calls for the same fare are serialized and share that intent. Stripe idempotency key is `ondemand_meter_pi:{fareId}`.
7. A canceled intent is replaced with a new test intent. A failed local status returns to `pending` so PaymentSheet can retry. Paid and refunded rows do not get another charge.
8. Flutter initializes Stripe with `publishableKey` and presents PaymentSheet with `paymentIntentClientSecret`.
9. Sheet success does not change payment status.
10. `payment_intent.succeeded` with `livemode=false`, the same amount, and USD marks the meter payment and `bookings.payment_status` paid and stores the receipt URL when Stripe includes one.

Live keys, a live-mode intent, and an amount or currency mismatch are rejected. A mismatch does not mark the ride paid.

The test gate is `ONDEMAND_STRIPE_TEST_PAYMENTS=true`, `sk_test`, `pk_test`, and `STRIPE_WEBHOOK_SECRET`. Checkout success and cancel URLs are not required for this PaymentIntent. Production still needs `ONDEMAND_STRIPE_TEST_SANDBOX=authorized` and still refuses live keys.

## 4. Webhook behavior

Handled on the existing verified webhook, and only when metadata purpose is `on_demand_meter_test`:

| Event | Result |
| --- | --- |
| `payment_intent.succeeded` | Paid, if amount and USD match |
| `payment_intent.payment_failed` | Failed. A later PaymentIntent request can retry. |
| `payment_intent.canceled` | Cancelled. The next request creates a replacement intent. |
| `charge.refunded` | Refunded, using the existing meter refund path |

`livemode=true` is ignored and does not mark paid. Amount or currency mismatch sets `failed` / `amount_mismatch` unless the row is already paid or refunded. Duplicate Stripe events stay paid once. Walk-Up Checkout events are still interpreted by the Checkout handler and are not treated as this PaymentIntent purpose.

## 5. Database changes

None. The pending meter payment row already exists from ride completion. This flow stores `stripe_payment_intent_id` on that row. `stripe_livemode` remains false. Historical bookings and already-captured quotes are not rewritten.

## 6. Tests and build

`npx tsc --noEmit` exit 0.

`npm run build` exit 0.

`npx jest --maxWorkers=1 --forceExit` on:

- `tests/soft-meter-ondemand-payment-intent.test.ts`
- `tests/soft-meter-ondemand-payment.test.ts`
- `tests/soft-meter-walkup-stripe-test.test.ts`
- `tests/soft-meter-metered-booking.test.ts`
- `tests/soft-meter.webhook.test.ts`

Result: 5 suites passed, 30 tests passed, exit 0.

The new suite covers the 940-cent finalized fare, secret reuse, another passenger, concurrent create-once, no second charge after paid, canceled replacement, live and amount rejection, open Checkout refusal, webhook paid versus sheet return, failure, cancel, refund, retry, Walk-Up left intact, and production charging still disabled.

These tests use in-memory payments. A live PaymentSheet confirmation was not run.

## 7. Flutter integration

For `billingMode = metered_post_trip` after completion:

1. Do not open PaymentSheet at booking time.
2. Read `GET /meter-payment` or the unpaid-ride endpoint. Pay when `paymentRequired` is true.
3. `POST /meter-payment/payment-intent` with `{}`.
4. `Stripe.publishableKey` = `publishableKey` (`pk_test_...`).
5. Present PaymentSheet with `paymentIntentClientSecret`.
6. Do not mark Paid from the sheet result.
7. Refresh `GET /meter-payment`, history, or the `booking:meter_payment` socket. Paid arrives after the webhook. `paymentVersion` changes with that update.
8. Receipt: `GET /meter-payment/receipt` once `receiptAvailable` is true.
9. If the app was closed, `GET /bookings/unpaid-meter-payment` and history Pay Now call the same PaymentIntent endpoint.

Use Stripe test card `4242 4242 4242 4242`. Do not call the Checkout URL endpoint.

`stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe` must be running, and `STRIPE_WEBHOOK_SECRET` must be the secret that command prints.

## 8. Remaining limitations

- Production metered charging is not enabled. This is Stripe test mode only.
- Payment stays pending until a verified webhook. Sheet success alone is not Paid.
- A receipt URL is stored only when the succeeded event includes one.
- A ride that already has an open hosted Checkout is not converted into a PaymentIntent.
- The partial-minute stopped-time rule is still the unapproved test tariff.
- No physical-device or live Stripe PaymentSheet run was performed in this change.
