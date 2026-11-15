# DriveWize on-demand PaymentSheet sync fix

Booking: `7ee40579-449b-46ce-b1f4-191604d79c71`
Stripe mode: TEST. No second PaymentIntent was created and nothing was captured again.

## Root cause

**A. The PaymentIntent succeeded in Stripe TEST, and the webhook never arrived.**

This is not a failed or in-progress payment, and it was not a backend row that was already Paid. The Passenger app kept showing Pay Now because GET meter-payment read the stale local status `pending` (`paymentRequired=true`). PaymentSheet success does not mark a ride paid.

## Verified Stripe PaymentIntent

Retrieved the PaymentIntent already stored on the meter payment. Prefix `pi_3UYWN`. No create and no capture.

| Check | Result |
| --- | --- |
| livemode | false |
| status | succeeded |
| amount / currency | 480 / usd |
| purpose | `on_demand_meter_test` |
| booking, payment, fare, and meter session metadata | all match this ride |
| settlement metadata | `stripe_test`, testOnly true |
| charge | succeeded and paid |
| receipt | present |

## Database before reconciliation

| Record | State |
| --- | --- |
| Booking | completed, `metered_post_trip`, `payment_status=pending` |
| Meter payment | `pending`, 480 USD, test-only, PaymentIntent stored, no Checkout session, no receipt, `paid_at` null |
| Finalized fare | 480 cents, billable false, charging enabled false |
| `stripe_webhook_events` | empty. No received, processed, or failed row |

Request logs for this booking show the completed ride and later driver video calls. They do not show a `stripe.webhook` delivery for `payment_intent.succeeded`. The same missing-webhook condition left the earlier hosted Checkout ride pending until that session was reconciled from Stripe.

## Reconciliation

Authenticated `GET /api/v1/passenger/bookings/:bookingId/meter-payment` now retrieves the stored PaymentIntent when the local meter payment is unpaid.

- It queries only that stored id. It does not create or capture a PaymentIntent.
- It accepts Paid only when livemode is false, purpose is `on_demand_meter_test`, booking, payment, and fare ids match, and amount and currency match the finalized fare.
- Settlement uses the same PaymentIntent decision as the verified webhook, inside the fare payment lock, so a webhook and a GET cannot both settle.
- A succeeded intent stores the receipt, sets `meter_payments.status` and `bookings.payment_status` to paid, bumps `updated_at` (`paymentVersion`), and emits `booking:meter_payment`.
- A repeated read of an already paid row does not call Stripe and does not emit again.
- Unpaid reads are throttled to one Stripe retrieve per 15 seconds while the intent is still open.
- `processing` and `requires_action` stay pending.
- A failed or canceled intent uses the existing failed/cancelled statuses, which remain retryable.
- Amount, currency, or identity mismatches are not marked Paid.
- A `checkout_open` historical Checkout row still uses the Checkout reconcile path and is not replaced by this read.

This booking was reconciled through that path.

## API state after correction

| Field | Value |
| --- | --- |
| paymentStatus | paid |
| paymentRequired | false |
| finalFareCents | 480 |
| currency | USD |
| receiptAvailable | true |
| testMode | true |
| paymentVersion | `1793907877487` (meter payment `updated_at`) |
| booking payment_status | paid |
| unpaid-recovery match for this booking | 0 |

A second read returned the same version and did not emit another `booking:meter_payment`. History reads this stored meter payment, so the ride is no longer unpaid.

The Passenger app should show **Paid** after it refetches GET meter-payment, history, or unpaid-recovery, or after it applies `booking:meter_payment`.

## Tests and build

- `npx tsc --noEmit`: exit 0
- `npm run build`: exit 0
- Jest (`--maxWorkers=1 --forceExit`): 5 suites, **32 tests, all passed**
  - succeeded intent with no webhook reconciles to Paid, stores the receipt, and a second read does not call Stripe
  - processing stays pending and is throttled
  - failed intent becomes retryable `failed`
  - wrong booking identity and wrong currency do not settle
  - duplicate paid webhook decision does not mark paid again
  - Checkout-open rows are not retrieved by the PaymentIntent read
  - the read path does not create or capture a payment
  - paid rides are excluded from unpaid recovery
  - new PaymentSheet, disabled on-demand Checkout, walk-up Checkout, and production charging off remain covered

## Remaining Flutter-side issue

The app binary was not changed. If it keeps Pay Now from the PaymentSheet completion callback or from a cached GET taken before this reconcile, it will stay stale until it refetches meter-payment or handles `booking:meter_payment`. The backend response for this booking is now Paid.

Stripe webhooks are still not reaching this server (`stripe_webhook_events` is empty). Later rides stay pending until GET reconciliation or until webhook forwarding is pointed at `POST /api/v1/webhooks/stripe` with the matching test signing secret. Reconciliation does not depend on the browser return URL or on a client-supplied success flag.
