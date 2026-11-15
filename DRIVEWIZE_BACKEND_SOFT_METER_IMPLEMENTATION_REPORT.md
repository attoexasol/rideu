# DriveWize backend — soft meter and walk-up implementation

The existing booking, dispatch, quoted-fare, and Stripe capture flow is unchanged. Soft meter and walk-up are an additional server-authoritative path. **Live metered charging is not enabled.**

A provisional fare can be calculated and shown. It is not billable, and Stripe is not called to collect it.

## Charging block

Two independent locks keep money from moving:

1. `METERED_CHARGING_RELEASED` in `src/constants/softMeter.ts` is `false`. Approving rules in memory still does not make a fare billable while this latch is off.
2. Migration `0036_soft_meter.sql` rejects `charging_enabled = true` on rate schedules and `billable = true` on meter sessions and fare records.

`POST /api/v1/driver/walk-up/:tripId/payment-link` records a `not_billable` reconciliation row and returns `409 METER_CHARGING_DISABLED`. It does not create a Checkout Session.

The Checkout creation function exists for a later release. It is not reached while the latch is off, including when a caller forces `billable: true` in a test.

## Draft rates

Seeded as schedule `coronado_soft_meter` version 1, status `draft`, currency `USD`:

| Component | Value |
| --- | --- |
| Flag drop | 420 cents |
| Distance | 460 cents per mile |
| Increment | 0.1 mile = 100,000 micro-miles = 46 cents |
| Waiting | 3600 cents per hour = 60 cents per minute |

Money is integer cents. Distance samples are integer millimeters. Billing units are integer micro-miles (`1 mile = 1,000,000`). One exact mile is `1,609,344` millimeters and prices as ten 46-cent increments in the **provisional** preview: flag 420 + distance 460 = 880 cents. Waiting seconds are stored and are not charged.

The below-10-mph distance/time switch is rejected if an admin tries to turn it on (`SPEED_SWITCH_BELOW_10_MPH_NOT_APPROVED`).

While partial-increment rounding is `unconfigured`, the preview counts **completed increments only** and labels the policy `withheld_completed_increments_only`. That is a display preview, not an approved rounding rule. Remainder distance is stored and is not rounded up.

## Database migration

`src/db/migrations/0036_soft_meter.sql` (journal idx 35).

| Table | Role |
| --- | --- |
| `meter_rate_schedules` | Versioned drafts, approval, one active version per code |
| `meter_rate_schedule_events` | Append-only admin audit |
| `walk_up_trips` | Driver + vehicle trip with no passenger account |
| `meter_sessions` | Durable session, rate snapshot, server start/stop/finalize times |
| `meter_gps_samples` | Accepted and rejected points |
| `meter_calculation_events` | Append-only calculation history |
| `meter_fare_records` | One immutable fare per session |
| `meter_payments` | Walk-up / future on-demand reconciliation, separate from `booking_payments` |

Apply with `npm run db:migrate`. This session did not run the migration against the configured database.

Open trips are unique per driver (`walk_up_trips` statuses `created`, `in_progress`, `ended`; meter statuses `pending`, `running`, `stopped`). A booking or walk-up can have only one meter session. Fare records are unique per session and are insert-only in application code. Finalize takes a row lock (`FOR UPDATE`) plus an in-process lock so concurrent finalize calls return the same record.

Rates copied onto a session live in `rate_snapshot`. Later edits to a schedule do not change that JSON. A draft that already has sessions cannot be edited; create the next version instead.

## GPS

The existing `location:update` socket path still stores and broadcasts driver tracking. Before the tracking accuracy filter, the same raw point is offered to a running meter. Map-matched coordinates are not used for the meter.

Reconnect and offline batches use `POST .../points`. `clientPointId` is the idempotency key. The server sorts the batch by device time and does not trust a client distance or fare total.

Engineering defaults in `METER_GPS_POLICY` (not a tariff):

| Check | Behavior |
| --- | --- |
| Accuracy missing or above 20 m | Sample rejected, distance unchanged |
| Device time missing, in the future, or older than 10 minutes | Rejected |
| Same place within 1.5 s and 3 m | Duplicate, distance unchanged |
| Device time before the last accepted point | Out of order, not inserted into the path |
| Faster than 45 m/s inside a 30 s window | Implausible movement, session flagged |
| Gap longer than 30 s | New anchor accepted, **straight-line distance across the gap is 0**, `reviewRequired` with `gps_outage` |

A GPS outage does not invent distance. Waiting time is not accrued, because waiting eligibility is unconfigured.

## Walk-up

A walk-up trip belongs to the authenticated driver and the vehicle from the existing assignment resolver (`resolveDispatchVehicle`). Rules that stay in force:

- Account must be active.
- When `QR_DUTY_REQUIRED` is on, an active duty session and assignment are required.
- Vehicle status must be approved.
- No active booking, open walk-up, or open meter for that driver.
- Pickup is checked with `evaluateDriverServiceArea`. Bangladesh stays unrestricted. Coronado applies only when the US area is enforced. Omitting `marketCode` does not invent a fence.

Dispatch treats an open walk-up as `DRIVER_BUSY`, so the driver is not offered an on-demand ride at the same time.

Currency on the walk-up row is `BDT` when `marketCode` is `BD`, otherwise `USD` (the draft schedule currency). This does not change booking currency.

## On-demand meter

The meter starts only after the existing trip is `in_progress`, and only when the driver calls the meter start endpoint. Accepting a booking does not start a meter and does not require a final capture.

`bookings.final_fare` and `bookings.estimated_fare` are not rewritten. Card completion still captures the existing quoted authorization. Cash completion still records the quoted fare. If a meter session is running at completion, it is finalized as a non-billable preview after that existing settlement. A missing meter table does not fail the booking.

The settlement view tells clients:

- quoted fare remains the booking charge
- meter fare is not captured
- an authorization is not assumed to be increasable
- an authorization is not assumed to be held indefinitely
- final meter settlement is separate from booking acceptance

No second PaymentIntent or SetupIntent was added. The current card flow remains the quoted-fare authorization.

## API contracts

Base path: `/api/v1`. Auth is the existing driver, passenger, or admin JWT. Errors use `{ success: false, error: { code, message } }`.

Meter state body (REST and sockets):

```json
{
  "sessionId": "uuid",
  "tripKind": "walk_up | on_demand",
  "bookingId": null,
  "walkUpTripId": "uuid",
  "status": "pending | running | stopped | finalized | voided",
  "startedAt": "ISO-8601 server time or null",
  "stoppedAt": null,
  "finalizedAt": null,
  "acceptedDistanceMillimeters": 0,
  "waitingSeconds": 0,
  "reviewRequired": false,
  "reviewReasons": [],
  "rate": { "scheduleId": "uuid", "code": "coronado_soft_meter", "version": 1, "currency": "USD" },
  "fare": {
    "flagDropCents": 420,
    "distanceChargeCents": 0,
    "waitingChargeCents": 0,
    "totalCents": 420,
    "billable": false,
    "chargingEnabled": false,
    "provisional": true,
    "blockedReasons": ["METERED_CHARGING_NOT_RELEASED"]
  },
  "serverTime": "ISO-8601"
}
```

`fare.billable` is false in this release. Clients must not collect or display this total as a confirmed charge.

### Driver Android and Driver iOS

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/driver/walk-up` | Create a walk-up. Body: `pickupLatitude`, `pickupLongitude`, optional `marketCode`, `passengerLabel`, `idempotencyKey`. `201`, or `200` with `idempotent: true`. |
| GET | `/driver/walk-up` | List this driver's walk-up trips. |
| GET | `/driver/walk-up/:tripId` | One trip. |
| POST | `/driver/walk-up/:tripId/cancel` | Cancel only while status is `created`. |
| POST | `/driver/walk-up/:tripId/meter/start` | Start meter. Optional `idempotencyKey`. Repeat start returns the running session. |
| POST | `/driver/walk-up/:tripId/meter/points` | GPS batch, max 100. |
| POST | `/driver/walk-up/:tripId/end` | Stop and finalize. Idempotent once finalized. |
| POST | `/driver/walk-up/:tripId/payment-link` | Hosted payment. **Currently `409 METER_CHARGING_DISABLED`.** |
| GET | `/driver/walk-up/:tripId/payment` | DB payment status. Opening or returning from Checkout does not set `paid`. |
| GET | `/driver/walk-up/:tripId/receipt` | Fare record, blocked reasons, receipt URL (null until a verified webhook stores one). |
| GET | `/driver/meter/active` | Open meter for this driver, if any. |
| GET | `/driver/meter/:sessionId` | Meter state. |
| POST | `/driver/meter/:sessionId/points` | Same GPS batch for either trip kind. |
| POST | `/driver/bookings/:bookingId/meter/start` | Attach a meter to an `in_progress` booking. Does not change the quoted fare. |
| GET | `/driver/bookings/:bookingId/meter` | Meter plus settlement view. |
| POST | `/driver/bookings/:bookingId/meter/stop` | Stop. Idempotent. |
| POST | `/driver/bookings/:bookingId/meter/finalize` | Finalize a non-billable preview. |
| POST | `/driver/bookings/:bookingId/meter/points` | GPS batch for that booking. |

GPS point:

```json
{
  "points": [
    {
      "clientPointId": "stable-id",
      "latitude": 32.6859,
      "longitude": -117.1831,
      "accuracyMeters": 5,
      "speedMps": 8.5,
      "recordedAt": "2026-10-29T00:00:00.000Z"
    }
  ]
}
```

Each result is `accepted` or `rejected` with `rejectReason`, `distanceDeltaMillimeters`, and `idempotent`.

### Passenger Flutter

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/passenger/bookings/:bookingId/meter` | Provisional meter for that passenger's booking, plus the settlement view. `404` if the booking is not theirs. |

No passenger account is required for walk-up. Passenger booking create, quote, dispatch, and cancel are unchanged.

### Admin web

All routes require the existing admin role.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/admin/meter/rate-schedules` | List versions. |
| POST | `/admin/meter/rate-schedules` | New draft. Numeric fields optional; omitted fields use the Coronado draft. `chargingEnabled` cannot be set. |
| GET | `/admin/meter/rate-schedules/:scheduleId` | Schedule plus audit events. |
| PATCH | `/admin/meter/rate-schedules/:scheduleId` | Draft only, and only when no meter session references it. |
| POST | `/admin/meter/rate-schedules/:scheduleId/submit` | `draft` → `pending_approval` |
| POST | `.../approve` | → `approved` |
| POST | `.../activate` | → `active`, retires the previous active version of the same code. Does not enable charging. |
| POST | `.../retire` | `active` → `retired` |
| GET | `/admin/meter/sessions` | History. Query: `status`, `reviewRequired`, `driverId`, `limit`, `offset`. |
| GET | `/admin/meter/sessions/:sessionId` | State, GPS samples, calculation events, fare record. |
| GET | `/admin/meter/reviews` | Sessions with `reviewRequired`. |
| GET | `/admin/meter/payments` | Reconciliation rows. Query: `status`. |

Workflow: `draft` → `pending_approval` → `approved` → `active` → `retired`. Active and completed trips keep the snapshot taken at meter start.

## Socket.IO

Emitted on the existing driver, passenger, and admin rooms.

| Event | When | Who |
| --- | --- | --- |
| `meter:state` | Start, stop, finalize | Driver, passenger when the session has a customer, admins |
| `meter:fare` | After a GPS batch | Driver and passenger |
| `walkup:payment` | Verified webhook changes payment status | Driver and admins |

Payload for `meter:state` and `meter:fare` is the meter state object above. `walkup:payment` is `{ walkUpTripId, paymentStatus, paid, hostedUrl, receiptUrl }`. `paid` is true only after the webhook transition. `hostedUrl` is null unless status is `checkout_open`.

`location:update` is unchanged for tracking. A running meter also consumes that point.

## Stripe

Existing booking PaymentIntents, capture on quoted completion, authorization release, Connect, and webhook signature checks are reused.

Walk-up collection, once charging is released, will be a Stripe Checkout Session in `mode: payment` with metadata `purpose=walk_up_meter`, `walkUpTripId`, `meterSessionId`, and `fareRecordId`. Success and cancel URLs come from `METER_CHECKOUT_SUCCESS_URL` and `METER_CHECKOUT_CANCEL_URL`. Those variables are optional and unused while charging is blocked.

Webhook rules on the existing `POST /api/v1/webhooks/stripe` endpoint:

- Signature is verified with `STRIPE_WEBHOOK_SECRET`.
- `checkout.session.completed` with `payment_status !== paid` does not mark the trip paid.
- `checkout.session.completed` with `payment_status=paid`, or `checkout.session.async_payment_succeeded`, marks `meter_payments` paid and stores the PaymentIntent id and receipt URL when present.
- `checkout.session.async_payment_failed` and `checkout.session.expired` move the row to `failed` or `cancelled`. A paid row is not downgraded.
- A repeated Stripe event id is ignored by the existing webhook claim.
- A paid webhook for a `not_billable` row does not mark it paid.
- Returning from Checkout is a read of the database only.

Failed payment can be retried later by requesting a new link after status is `failed` or `cancelled`. That request still stops at the charging latch today.

## Tests and build

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | Pass |
| `npm run build` | Pass |
| `tests/soft-meter.test.ts` | 19 passed |
| `tests/soft-meter.payment.test.ts` | 2 passed |
| `tests/soft-meter.webhook.test.ts` | 3 passed |
| `tests/stripe-webhook.test.ts` | Pass (existing signature and idempotency) |
| `tests/service-area.dispatch.test.ts` | Pass, including Bangladesh without a walk-up fence |
| `tests/cash-booking-payment.test.ts` | Pass |
| `tests/stripe-phase-d.test.ts` | Pass, including quoted-fare capture order |

Covered: fare arithmetic, rate snapshot isolation, version transitions, duplicate and out-of-order GPS, outages with no invented distance, implausible movement, concurrent finalize, driver eligibility, walk-up idempotency, payment idempotency, Checkout unpaid vs paid, webhook signature failure, and on-demand settlement staying on the quoted fare.

## Outstanding business-rule decisions

These stay unresolved. Charging must stay off until they are approved and a later migration drops the `billable = false` / `charging_enabled = false` checks and the code latch.

1. Partial-increment rounding: completed increments only, nearest increment, or prorate the remainder.
2. Waiting eligibility: not charged, or manual wait, and the rule for when the server may accrue seconds. No speed-based waiting is implemented.
3. Whether distance and time are additive or distance-only. Mutual exclusion is not implemented. The below-10-mph switch is not an approved behavior.
4. Local meter approval for the operating city.
5. Payment authorization for a variable on-demand fare: keep the quoted authorization only, use a setup-only flow, or some other policy. This release does not assume an authorization can be increased or held indefinitely.
6. Confirm the GPS engineering defaults (20 m accuracy, 30 s outage, 45 m/s, 10 minute late upload) if they should differ from the tracking pipeline.
7. Walk-up market when the driver does not send `marketCode` (stored as USD and not geofenced).

## Remaining mobile and Admin tasks

- Driver Android and iOS: walk-up create, meter start/points/end, provisional fare UI that does not call the total a charge, payment-link button that handles `409 METER_CHARGING_DISABLED`, payment and receipt screens that trust `GET .../payment` rather than the Checkout return URL, and GPS batch upload after reconnect using stable `clientPointId`s.
- Passenger Flutter: optional `GET /passenger/bookings/:bookingId/meter` and `meter:fare` / `meter:state` listeners. Do not replace the quoted fare until a migration is approved.
- Admin web: rate draft editor, submit/approve/activate/retire, session history, GPS audit, review queue, and payment reconciliation. Do not add a control that sets charging on; the API and database reject it.
- Run `npm run db:migrate` before drivers call the new routes.
- Set Checkout return URLs only in the release that turns charging on.

## Files changed

New:

- `src/constants/softMeter.ts`
- `src/services/softMeter/errors.ts`
- `src/services/softMeter/rules.ts`
- `src/services/softMeter/fare.ts`
- `src/services/softMeter/gps.ts`
- `src/services/softMeter/lifecycle.ts`
- `src/services/softMeter/paymentState.ts`
- `src/services/softMeter/eligibility.ts`
- `src/services/softMeter/meterNotify.service.ts`
- `src/services/softMeter/meterSession.service.ts`
- `src/services/softMeter/walkUp.service.ts`
- `src/services/softMeter/onDemandMeter.service.ts`
- `src/services/softMeter/meterPayment.service.ts`
- `src/services/softMeter/rateSchedule.service.ts`
- `src/db/schema/meter_rate_schedules.ts`
- `src/db/schema/walk_up_trips.ts`
- `src/db/schema/meter_sessions.ts`
- `src/db/schema/meter_payments.ts`
- `src/db/migrations/0036_soft_meter.sql`
- `src/repositories/meterRateSchedule.repository.ts`
- `src/repositories/meterSession.repository.ts`
- `src/repositories/walkUp.repository.ts`
- `src/repositories/meterPayment.repository.ts`
- `src/controllers/softMeter.controller.ts`
- `src/controllers/adminSoftMeter.controller.ts`
- `src/routes/v1/driver/walkUp.ts`
- `src/routes/v1/driver/meter.ts`
- `src/routes/v1/admin/meter.ts`
- `src/validators/softMeter.ts`
- `tests/soft-meter.test.ts`
- `tests/soft-meter.payment.test.ts`
- `tests/soft-meter.webhook.test.ts`

Updated:

- `src/db/schema/index.ts`
- `src/db/migrations/meta/_journal.json`
- `src/routes/v1/index.ts`
- `src/routes/v1/driver/bookings.ts`
- `src/routes/v1/passenger/index.ts`
- `src/services/booking.service.ts`
- `src/services/driverAvailability.service.ts`
- `src/services/stripeWebhook.service.ts`
- `src/websocket/handlers/location.ts`
- `tests/service-area.dispatch.test.ts`
- `.env.example`
