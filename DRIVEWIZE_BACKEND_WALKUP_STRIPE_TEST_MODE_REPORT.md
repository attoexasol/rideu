# DriveWize backend — walk-up Stripe test mode

A completed walk-up trip can create a Stripe **test** Checkout URL when the server is explicitly configured for it. The driver app encodes that URL as a QR code. Payment is marked paid only from a verified webhook. Production metered charging stays off, and on-demand quoted-fare Stripe settlement is unchanged.

Apply the new migration before using the columns:

```bash
npm run db:migrate
```

## Fare rules actually used

The test charge uses the existing server meter. It does not use a second formula.

Draft schedule `coronado_soft_meter` version 1, USD:

| Client proposal | Stored rate | What the test charge does |
| --- | --- | --- |
| Flag drop $4.20 | 420 cents | Included |
| Distance $4.60 per mile | 460 cents per mile | Included as completed 0.1-mile increments |
| $0.46 per 0.1 mile | 100,000 micro-miles = 46 cents | Included only when a full increment is completed |
| Waiting $0.60 per minute ($36/hour) | 3600 cents/hour and 60 cents/minute | Not charged |

One exact mile is `1,609,344` millimeters. The test amount is flag 420 + distance 460 = **880 cents**. A remainder under 0.1 mile is stored and is not rounded up. Waiting seconds can be stored on the meter and stay at `waitingChargeCents = 0`.

Paused distance and paused time never enter `acceptedDistanceMillimeters`. The Checkout amount is the finalized fare record, and that record must match `previewFare` for the same distance and waiting seconds. A mismatch is rejected (`FARE_EVIDENCE_MISMATCH`).

The amount is labeled `test_only_unapproved_tariff`. `billable` and `chargingEnabled` stay `false`.

## Unresolved tariff questions

These are not treated as approved, and the test charge does not invent them:

- Partial-increment rounding is still `unconfigured`. The test uses completed increments only and labels that policy `withheld_completed_increments_only`.
- Waiting eligibility is `unconfigured`, so waiting time is not billed.
- The below-10-mph distance/time switch is not approved. A snapshot with that switch on is refused (`TARIFF_RULE_NOT_APPROVED`).
- Distance/time exclusivity is `unconfigured`, so time is not added on top of distance.
- Local meter approval and payment-authorization policy are still unconfigured.
- This test amount is not a legal production fare.

`METERED_CHARGING_RELEASED` remains `false`. Migration `0036` still forces `charging_enabled = false` and `billable = false`.

## Test payment isolation

The client cannot send `testMode`. `POST /payment-link` rejects any body field.

The server enables the workflow only when all of these are true:

| Setting | Required value |
| --- | --- |
| `WALKUP_STRIPE_TEST_PAYMENTS` | `true` |
| `STRIPE_SECRET_KEY` | `sk_test_...` |
| `STRIPE_PUBLISHABLE_KEY`, if set | `pk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | set |
| `METER_CHECKOUT_SUCCESS_URL` | set |
| `METER_CHECKOUT_CANCEL_URL` | set |
| `NODE_ENV=production` | also `WALKUP_STRIPE_TEST_SANDBOX=authorized` |

Anything else fails closed:

- Flag unset or not exactly `true`: the old `409 METER_CHARGING_DISABLED` path. No Stripe call.
- `sk_live_` or `pk_live_`: `409 STRIPE_LIVE_CREDENTIALS_REJECTED`.
- Production without sandbox authorization: `409 WALKUP_TEST_SANDBOX_NOT_AUTHORIZED`.
- Missing test configuration: `503 WALKUP_STRIPE_TEST_NOT_CONFIGURED`.
- No finalized fare, a non-positive amount, or a non-USD trip: rejected. BDT walk-ups are not converted.

Migration `0038_walkup_stripe_test.sql` (journal idx 37) adds a settlement class without weakening the fare locks:

- `production_disabled` rows can only be `not_billable`.
- `stripe_test` rows are `test_only = true` and use the test payment statuses.
- `stripe_livemode` must be `false`.
- `fare_classification` is null or `test_only_unapproved_tariff`.

## Files changed

| File | Change |
| --- | --- |
| `src/db/migrations/0038_walkup_stripe_test.sql` | Test settlement class and refunded status |
| `src/db/migrations/meta/_journal.json` | Journal idx 37 |
| `src/db/schema/meter_payments.ts` | Test columns and checks |
| `src/db/schema/walk_up_trips.ts` | Allow `refunded` on the trip payment status |
| `src/constants/softMeter.ts` | Test purpose, settlement mode, refunded status |
| `src/services/softMeter/testPayment.ts` | Gate, fare check, Checkout, webhook verdict |
| `src/services/softMeter/meterPayment.service.ts` | Walk-up test Checkout and webhook settlement |
| `src/services/softMeter/paymentState.ts` | Live-mode rejection, amount, refunds |
| `src/repositories/meterPayment.repository.ts` | Lookup by PaymentIntent |
| `src/validators/softMeter.ts` | Strict empty payment-link body |
| `src/routes/v1/driver/walkUp.ts` | Body validation on the payment link |
| `src/controllers/adminSoftMeter.controller.ts` | Test flags on the existing payments list |
| `src/config/env-validator.ts` | Warning if the test flag is paired with a live key |
| `.env.example` | Test-mode configuration comments |
| `tests/soft-meter-walkup-stripe-test.test.ts` | Isolation, fare, Checkout, and webhook tests |

Driver Android, Driver iOS, Passenger Flutter, and Admin Web were not modified.

## Checkout contract

```http
POST /api/v1/driver/meter is not used
POST /api/v1/driver/walk-up/:tripId/payment-link
```

Authenticated driver who owns a finalized USD walk-up. Body is `{}` only.

Success:

```json
{
  "tripId": "…",
  "testMode": true,
  "testOnly": true,
  "billable": false,
  "productionCharge": false,
  "fareClassification": "test_only_unapproved_tariff",
  "limitations": ["…"],
  "amountCents": 880,
  "currency": "USD",
  "paymentStatus": "checkout_open",
  "checkoutState": "checkout_open",
  "hostedUrl": "https://checkout.stripe.com/c/pay/cs_test_…",
  "qrPayload": "https://checkout.stripe.com/c/pay/cs_test_…",
  "stripeCheckoutSessionId": "cs_test_…",
  "expiresAt": "2026-10-31T12:31:00.000Z",
  "idempotent": false,
  "receiptAvailable": false,
  "fareRecordId": "…",
  "paymentId": "…"
}
```

`qrPayload` is the hosted Checkout URL. The app draws the QR. The secret key is not in the response.

The session expires in about 31 minutes. A repeat call while it is open returns the same URL (`idempotent: true`). An expired unpaid session is expired in Stripe and replaced. If Stripe says that session is already paid, no second session is created. A paid or refunded trip does not get another charge.

Stripe metadata includes `purpose=walk_up_meter_test`, the trip, session, and fare ids, `settlementMode=stripe_test`, and `testOnly=true`. The line item is `DriveWize walk-up test fare (test mode)` for the exact finalized cent amount. The passenger does not need a DriveWize account.

## Webhook contract

Existing `POST /api/v1/webhooks/stripe` signature verification is unchanged.

For this flow the handler accepts only `livemode=false`. A live-mode Checkout or refund event is logged and does not mark the trip paid.

| Event | Result |
| --- | --- |
| `checkout.session.completed` with `payment_status=paid`, USD, and the exact stored cents | `paid` |
| Same event unpaid, or a success redirect | Not paid |
| `checkout.session.async_payment_succeeded` | `paid` after the same amount and currency checks |
| `checkout.session.async_payment_failed` | `failed` |
| `checkout.session.expired` | `cancelled` |
| Amount or currency mismatch | `failed` with `AMOUNT_MISMATCH` or `CURRENCY_MISMATCH`. Not paid |
| Duplicate Stripe event id | Existing claim skips it |
| Duplicate paid notification | Status stays `paid` |
| `charge.refunded` for a test PaymentIntent | `refunded` |

`walkup:payment` is emitted on the driver room when the Checkout is first created and when the webhook changes status. The payload includes `testMode: true` for test payments. It does not include secrets.

## Payment status

`GET /api/v1/driver/walk-up/:tripId/payment` and `GET /api/v1/driver/walk-up/:tripId/receipt` keep the previous fields and add:

- `testMode`, `testOnly`, `settlementMode`, `fareClassification`
- `paymentState`, `checkoutState`
- `qrPayload` while Checkout is open and unexpired
- `receiptAvailable`
- `expiresAt`, `paidAt`, `createdAt`, `updatedAt`, `serverTime`
- `productionCharge: false` and `billable: false`
- `limitations` while the payment is a test payment

A customer return does not mark the trip paid. `hostedUrl` is omitted once the session is no longer open.

`GET /api/v1/admin/meter/payments` returns the same payment rows plus `testMode`, `testOnly`, `productionCharge`, and `stripeLivemode`. It does not create paid rows. The Admin Web app was not changed; it can read these fields when it is updated.

## Test and build results

`npx tsc --noEmit` passed. `npm run build` passed.

`tests/soft-meter-walkup-stripe-test.test.ts`: 7 passed. They cover:

- Test mode stays off unless the server flag is exactly `true`
- Live secret and live publishable key rejected
- Production without sandbox authorization rejected
- Missing webhook or return URL rejected
- Client `testMode` rejected
- Finalized fare is 880 cents for one mile, waiting charge 0, not billable
- Pause movement is excluded and does not raise the fare
- One Checkout URL, replayed on the second request
- Paid trip does not create another session
- Expired session that Stripe reports as paid does not create another session
- Expired unpaid session is replaced
- Another driver is `WALK_UP_NOT_FOUND`
- Webhook marks paid once when amount and currency match
- Wrong amount becomes `AMOUNT_MISMATCH` and is not paid
- Wrong currency and `livemode=true` are rejected
- Customer return and expiry do not mark paid
- Refund signal and admin test flags
- `requestHostedMeterPayment` still returns `METER_CHARGING_DISABLED` and does not call Stripe, even if the fare says billable
- On-demand settlement still has `captureMeterFare: false`
- Migrations `0036` and `0038` keep the production locks

Also passed in the same check: `soft-meter.payment.test.ts`, `soft-meter.webhook.test.ts`, `soft-meter.test.ts`, `soft-meter-pause.test.ts`, `stripe-webhook.test.ts`, `stripe-phase-d.test.ts`, `cash-booking-payment.test.ts`.

## Remaining app work

- Driver Android and iOS: after the trip is finalized, call the payment-link endpoint, render a QR from `qrPayload`, and show `testMode` plus the limitations. Do not send `testMode`, a fare, or a duration. Poll `GET .../payment` or listen for `walkup:payment`. Do not mark paid from the Stripe success page.
- Admin Web: the payments API already includes `testMode` and status. The dashboard UI can show those fields. This task did not change that app.
- Passenger Flutter: no account and no change are required for this Checkout.
- Do not point this flow at `sk_live` keys. Quoted-fare card capture remains the existing on-demand path.
