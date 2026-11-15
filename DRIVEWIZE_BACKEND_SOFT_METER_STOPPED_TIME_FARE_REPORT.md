# DriveWize backend — soft meter distance and stopped-time fare

On-Demand and Walk-Up soft meters now price three provisional components: flag drop, completed distance increments, and eligible stopped time. The same server meter calculates both trip kinds. **Live metered charging stays disabled.** On-Demand quoted-fare Stripe capture is unchanged. The completed-minute waiting rule is a test calculation and is not a regulator-approved tariff.

Apply migration `0039` before using the new columns:

```bash
npm run db:migrate
```

Until that migration is applied, meter reads that select the new columns will fail. Location ingest already treats a missing column as a quiet skip.

## Stop detection

`METER_STOP_POLICY` in `src/constants/softMeter.ts` is an engineering reliability control. It is not an approved tariff rule.

| Control | Value | Effect |
| --- | --- | --- |
| Travel radius | 20 m (`20_000` mm) | Displacement above this bills distance, including travel below 10 mph |
| Quiet-stop radius | 8 m (`8_000` mm) | Only a fix this quiet can accrue stopped time |
| Stopped speed | 0.5 m/s | A higher reported speed contradicts a full stop |
| Movement noise floor | 3 m | Speed can confirm slow travel only when the fix also moved at least this far |
| Unverified gap | 30 s | Same as the existing GPS outage gap. No distance and no time are invented |
| Confirmation | 1 interval | The first quiet interval confirms the stop and is stored as excluded |
| 10 mph reference | 4.4704 m/s | Documentation only. The meter does not switch billing mode at 10 mph |

A sample bills **distance** when the vehicle moved more than 20 m, or when reported speed is above 0.5 m/s and the fix moved more than 3 m. That covers normal speed and travel below 10 mph.

A sample bills **stopped time** only when all of these are true:

- The previous accepted fix is no more than 30 seconds old.
- Displacement is 8 m or less.
- Reported speed is missing, or it is 0.5 m/s or less.
- The previous interval already confirmed a quiet stop.
- The meter is running, and the sample was accepted.

The first quiet interval after movement, resume, a gap, or a rejected sample is confirmation only. Its seconds are stored on `excluded_stop_seconds` and are not billed. Later consecutive quiet intervals add whole seconds. Sub-second remainders carry forward only across those confirmed intervals, in `stop_remainder_ms`, so short samples are not dropped forever and are not billed twice.

These intervals add neither distance nor stopped time:

- Manual pause. Both components stay frozen. Resume clears the GPS anchor and the stop streak, so a stop must be confirmed again.
- GPS gap longer than 30 seconds, including a reconnect hole.
- A fix between 8 m and 20 m when speed does not confirm travel. That is drift or creep, and the evidence is not strong enough for either component.
- Reported speed above 0.5 m/s with less than 3 m of movement. The speed reading is not trusted by itself.
- Duplicate samples. The stop streak is left as it was, so the next real interval is not counted twice.
- Low accuracy, stale, out-of-order, or implausible samples. The streak resets, and the next quiet interval must confirm the stop again.

## Time rounding

Policy name: `test_only_completed_minutes`.

Eligible stopped seconds are stored in the existing `waiting_seconds` column. The charge is:

`floor(eligibleStoppedSeconds / 60) * 60 cents`

| Eligible stopped seconds | Billed | Remainder stored |
| --- | --- | --- |
| 12 | $0.00 | 12 s |
| 59 | $0.00 | 59 s |
| 60 | $0.60 | 0 s |
| 90 | $0.60 | 30 s |
| 120 | $1.20 | 0 s |

Leftover seconds are returned as `unbilledStoppedRemainderSeconds`. They are not rounded up and they are not prorated. This policy is labeled `STOPPED_TIME_PARTIAL_MINUTE_TEST_ONLY` on every preview. It is not regulator-approved.

Distance still uses completed 0.1-mile increments only. A partial increment is not rounded up. One completed increment remains $0.46. The below-10-mph distance/time switch stays rejected if a rate snapshot turns it on.

## Fare examples

Draft Coronado rates, integer cents, `billable` false, `chargingEnabled` false:

| Trip evidence | Flag | Distance | Stopped time | Total |
| --- | --- | --- | --- | --- |
| Meter running, no accepted distance | $4.20 | $0.00 | $0.00 | $4.20 |
| 1 mile moving, 0 stopped seconds | $4.20 | $4.60 | $0.00 | $8.80 |
| 1 mile plus 90 eligible stopped seconds | $4.20 | $4.60 | $0.60 | $9.40 |
| 1 mile plus 120 eligible stopped seconds | $4.20 | $4.60 | $1.20 | $10.00 |
| Fully stopped for 60 eligible seconds, no distance | $4.20 | $0.00 | $0.60 | $4.80 |
| Just under 1 mile (`1_609_344 - 20_000` mm), 0 stopped seconds | $4.20 | $4.14 | $0.00 | $8.34 |

Nine increments are billed for that short mile. The remainder stays unbilled. Forty meters of travel below 10 mph increases accepted distance and adds no stopped time. It does not by itself complete a $0.46 increment.

The live provisional total is flag drop + distance charge + stopped-time charge. `stateVersion` increases when accepted distance increases or when eligible stopped seconds increase. `meter:fare` is emitted for a running meter after that change. It is not emitted while the meter is paused.

## Schema

`src/db/migrations/0039_soft_meter_stopped_time.sql` (journal idx 38, tag `0039_soft_meter_stopped_time`). Migrations `0036`, `0037`, and `0038` are unchanged. Their `billable = false` and `charging_enabled = false` checks remain.

New `meter_sessions` columns, all defaulting to 0:

| Column | Meaning |
| --- | --- |
| `excluded_stop_seconds` | Seen seconds that were not billed: confirmation, gaps, and ambiguous fixes |
| `stop_streak` | Consecutive quiet intervals. 0 means the next quiet interval only confirms |
| `stop_remainder_ms` | Sub-second remainder carried across confirmed stopped intervals. Always under 1000 |

`waiting_seconds` remains the eligible stopped-seconds total. Pause rows still copy that value and do not add pause duration to it.

Finalizing the session writes one fare record in the same transaction. The record stores flag drop, distance charge, stopped-time charge, total cents, accepted distance, eligible stopped seconds, rate snapshot, and the full preview. `billable` and `chargingEnabled` are written false. The `meter_finalized` event also stores excluded seconds, both charge components, the waiting policy, and the rate version. Each accepted GPS point stores `stopDisposition`, seconds added, and the running excluded total. A point that adds stopped time is recorded as `stopped_time_accrued`.

## API

Existing driver, passenger, and admin fields are unchanged. These fields are added:

- `eligibleStoppedSeconds` — same value as `waitingSeconds`
- `excludedStopSeconds`
- `stopStreak`
- `stopPolicy` — the thresholds above, `partialMinutePolicy: test_only_completed_minutes`, `confirmedBusinessRule: time_only_when_fully_stopped`, and `partialMinuteRegulatorApproved: false`
- `fare.billedStoppedMinutes`
- `fare.unbilledStoppedRemainderSeconds`
- `fare.waitingChargeCents` — completed stopped minutes, still inside a non-billable preview
- `fare.waitingPolicyApplied` — `test_only_completed_minutes`
- `fare.distanceTimePolicyApplied` — `test_only_stopped_while_stationary`

Walk-Up Stripe test Checkout uses the finalized `totalCents`, which now includes the stopped-time component when the meter calculated one. The webhook still requires the exact amount and currency, ignores live mode, and does not mark the trip paid on a mismatch. Checkout stays idempotent. The fare classification remains test-only. A client still cannot send `testMode`.

On-Demand settlement still reports `captureMeterFare: false`. The meter does not rewrite the booking's quoted fare and does not capture a PaymentIntent.

`METERED_CHARGING_RELEASED` remains false.

## Tests and build

Focused Jest run, `--maxWorkers=1`:

| Suite | Result |
| --- | --- |
| `tests/soft-meter-stopped-time.test.ts` | 14 passed |
| `tests/soft-meter.test.ts` | passed |
| `tests/soft-meter-pause.test.ts` | passed |
| `tests/soft-meter-walkup-stripe-test.test.ts` | passed |
| `tests/soft-meter.payment.test.ts` | passed |
| `tests/soft-meter.webhook.test.ts` | passed |

57 tests passed across those 6 suites. The stopped-time suite covers normal speed, travel below 10 mph, a confirmed stop, stop-to-move, GPS drift, a wide ambiguous fix, low accuracy, a sparse gap, pause while stopped, resume while stopped, a duplicate point, finalization, the combined $9.40 Stripe test amount, a mismatched webhook amount, and the production charging locks.

`npx tsc --noEmit` exited 0. `npm run build` exited 0.

Redis connection logs after Jest finishes are existing test-process noise. They did not fail the suites.

## Still needs approval

- A regulator has not approved `test_only_completed_minutes`. Partial stopped minutes stay unbilled until a separate rule is approved.
- Partial distance increments stay unbilled. Completed-increment distance is not a newly approved rounding rule.
- The 8 m / 20 m / 0.5 m/s thresholds can under-count a noisy stop or a very slow creep inside 8 m. They are there so the meter does not bill unsupported time or treat GPS drift as travel.
- Driver Android, Driver iOS, Passenger Flutter, and Admin Web were not changed. They can ignore the new fields. They do not yet have a product decision to display stopped time as a production fare.
- Migration `0039` has not been applied to a database in this change.
- Production metered charging remains off. Walk-Up Checkout remains a Stripe test settlement, and only when the existing server test gate is enabled.
