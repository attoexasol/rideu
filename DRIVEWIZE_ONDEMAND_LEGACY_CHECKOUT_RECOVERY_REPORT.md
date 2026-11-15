# DriveWize on-demand legacy Checkout recovery

Booking: `85e81415-e257-4225-a9b8-92f7f8193443`
Stripe mode: TEST (`livemode=false`). No second charge was created.

## Exact HTTP 409

`POST /api/v1/passenger/bookings/85e81415-e257-4225-a9b8-92f7f8193443/meter-payment/payment-intent` returned **409 `ONDEMAND_CHECKOUT_RETIRED`**.

The PaymentIntent handler threw that code whenever a meter payment was `checkout_open` and still stored a hosted Checkout session id. It did that before asking Stripe whether the session had already been paid. That is why a successful external Checkout stayed Payment Pending in the app.

## Database state before reconciliation

| Record | State |
| --- | --- |
| Booking | `completed`, `billing_mode=metered_post_trip`, `payment_status=checkout_open` |
| Meter payment | one row, `checkout_open`, `settlement_mode=stripe_test`, `test_only=true`, `stripe_livemode=false`, **480 cents USD**, Checkout session present, **no PaymentIntent id**, no receipt, `paid_at` null |
| Meter fare | finalized, `total_cents=480`, `billable=false`, `charging_enabled=false` |
| Quote `booking_payments` | none |
| `stripe_webhook_events` | no delivery recorded for this payment |

The browser return URL does not mark a booking paid. With no webhook row, the local row stayed `checkout_open` after Stripe had already collected the fare.

## Verified Stripe TEST state

Retrieved the stored Checkout session with its PaymentIntent expanded. No PaymentIntent was created and the session was not expired.

- Session: `complete`, `payment_status=paid`, `livemode=false`, `amount_total=480`, currency `usd`, mode `payment`
- Metadata purpose: `on_demand_meter_test`
- Metadata booking id matches this booking
- Linked PaymentIntent: `succeeded`, `livemode=false`, amount `480`, currency `usd`
- The PaymentIntent metadata did not itself carry this booking id. Ownership was taken from the Checkout session that owns that PaymentIntent, plus the local meter-payment row.

The original Checkout payment **succeeded**. Amount, currency, test mode, and booking identity matched the finalized meter fare.

## Reconciliation action

The paid session was persisted through the server-side reconcile path (`readPassengerOnDemandMeterPayment` → Stripe retrieve → `assessLegacyCheckout` = paid). That path:

- stored the existing succeeded PaymentIntent id and the Stripe receipt
- set the meter payment and `bookings.payment_status` to `paid`
- cleared the hosted Checkout URL and kept the Checkout session id as the audit reference
- emitted `booking:meter_payment`
- did **not** call `paymentIntents.create` and did **not** expire the completed session

A second read returned the same paid row and did not emit another payment event.

## What the Passenger app should show

**Paid.** `paymentRequired` is false. Final fare remains 480 cents USD, `testMode` true, receipt available, hosted URL null.

GET meter-payment and history both read this stored status, so a refresh shows Paid. Pay Now is no longer the correct state for this booking.

## Compatibility behavior now

Historical on-demand Checkout rows are no longer stuck on 409 when Stripe can be retrieved:

- Paid session: reconcile to Paid, return no client secret, create no PaymentIntent.
- Open unpaid session: expire it in Stripe TEST, keep the session id, then create one PaymentSheet PaymentIntent for the finalized fare.
- Already expired unpaid session: create one PaymentIntent without treating the old session as collectable.
- Processing: 409 `PAYMENT_PROCESSING`, no replacement charge.
- Live mode, amount/currency mismatch, or wrong booking/purpose: 409, no new PaymentIntent.
- If Stripe cannot be consulted, the old 409 `ONDEMAND_CHECKOUT_RETIRED` still blocks a second charge.

New on-demand bookings stay on PaymentSheet. `POST .../meter-payment/checkout` still returns 409 `ONDEMAND_CHECKOUT_DISABLED`. Walk-up Checkout is unchanged. `METERED_CHARGING_RELEASED` stays false. Quoted-prepay flows were not changed.

## Tests and build

- `npx tsc --noEmit`: exit 0
- `npm run build`: exit 0
- Jest (`--maxWorkers=1 --forceExit`): 5 suites, **31 tests, all passed**
  - paid legacy Checkout reconciles with zero PaymentIntent creates and a repeat call stays paid
  - open Checkout is expired once, then one PaymentIntent is created; the session id is kept
  - processing Checkout rejects with `PAYMENT_PROCESSING` and does not expire or create
  - wrong booking identity and amount mismatch are blocked
  - missing Stripe retrieve still returns `ONDEMAND_CHECKOUT_RETIRED`
  - new booking PaymentSheet, disabled on-demand Checkout, walk-up Checkout, and production charging off remain covered

## Unresolved

- The original Checkout success never arrived as a stored webhook. Reconciliation used a direct Stripe TEST retrieve. Future `payment_intent.succeeded` / `checkout.session.completed` events for this payment are idempotent because the row is already paid.
- The device must call GET meter-payment again (or receive `booking:meter_payment`) to replace the Payment Pending screen. The app binary was not changed.
- Stripe CLI forwarding was not reconfigured in this change. Dashboard webhooks still need to reach this server for later rides to flip to Paid without a GET reconcile.
