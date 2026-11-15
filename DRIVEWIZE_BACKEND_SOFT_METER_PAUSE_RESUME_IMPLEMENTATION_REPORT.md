# DriveWize backend — soft meter pause and resume

A driver can pause a running soft meter for a personal stop, then resume it. Distance, waiting time, and the provisional fare stay where they were. Driver location tracking for the passenger map is unchanged. **Live metered charging stays disabled.** Quoted-fare Stripe settlement is unchanged.

Apply migration `0037` before using the new columns:

```bash
npm run db:migrate
```

Until that migration is applied, meter reads that select the new columns will fail. Location ingest already treats a missing table or column as a quiet skip.

## Migration

`src/db/migrations/0037_soft_meter_pause.sql` (journal idx 36, tag `0037_soft_meter_pause`). Migration `0036` is unchanged.

`meter_sessions` changes:

- Status `paused` is allowed.
- A paused session still counts as an open meter, so the driver cannot start a second one.
- Columns: `paused_at`, `total_paused_seconds`, `pause_reason`, `needs_new_anchor`, `state_version`.
- `pause_reason` is null or `driver_personal_stop`. The server writes it. The client cannot send it.

New table `meter_pauses`:

| Column | Meaning |
| --- | --- |
| `session_id`, `driver_id` | Session and the driver who owns it |
| `reason` | Always `driver_personal_stop` |
| `paused_at` | Server time when the pause opened |
| `resumed_at` | Server time when it closed. Null while open |
| `duration_seconds` | Whole seconds, written when the interval closes |
| `provisional_total_cents`, `accepted_distance_millimeters`, `waiting_seconds` | Totals copied at pause for audit |
| `state_version_at_pause` | Meter version at the pause |
| `idempotency_key`, `metadata` | Optional client key and server audit metadata |

One open interval per session is enforced by `uq_meter_pauses_one_open` (`resumed_at is null`). Overlapping pauses cannot be inserted. An unfinished row is the recovery record after a process restart. There is no in-memory pause state.

## Files changed

| File | Change |
| --- | --- |
| `src/db/migrations/0037_soft_meter_pause.sql` | Pause columns, status, open-driver index, `meter_pauses` |
| `src/db/migrations/meta/_journal.json` | Journal entry idx 36 |
| `src/db/schema/meter_sessions.ts` | Drizzle columns and `meterPauses` |
| `src/db/schema/index.ts` | Schema export |
| `src/constants/softMeter.ts` | Status `paused` is an open meter status |
| `src/services/softMeter/pause.ts` | Pause math, timing fields, GPS exclusion |
| `src/services/softMeter/lifecycle.ts` | Pause, resume, stop, and finalize guards |
| `src/services/softMeter/meterSession.service.ts` | Persistence, sockets, GPS ingest |
| `src/repositories/meterSession.repository.ts` | Pause rows and GPS lookup for running or paused |
| `src/validators/softMeter.ts` | Strict pause/resume body |
| `src/routes/v1/driver/meter.ts` | `POST .../pause` and `POST .../resume` |
| `src/controllers/softMeter.controller.ts` | Driver handlers |
| `src/controllers/adminSoftMeter.controller.ts` | Pause history on the admin session read |
| `tests/soft-meter-pause.test.ts` | Pause, GPS, race, and charging tests |

Android, iOS, Passenger Flutter, and Admin Web were not modified.

## State machine

```text
pending → running → paused → running → stopped → finalized
```

A paused meter can also go straight to stopped and then finalized. Stop and finalize close the open pause at the server clock and do not add fare for that interval.

| From | Action | Result |
| --- | --- | --- |
| `running` | pause | `paused`. Distance, waiting seconds, and provisional total stay the same |
| `paused` | pause again | Same open interval. No second row |
| `paused` | resume | `running`. New GPS anchor. Previous totals kept |
| `running` with no open pause | resume | Current state. No new interval |
| `paused` | stop or finalize | Open interval closed, then the existing stop/finalize path |
| `stopped`, `finalized`, `voided`, `pending` | pause | `409 METER_NOT_PAUSABLE` |
| anything except `paused` | resume, unless it is already `running` | `409 METER_NOT_RESUMABLE` |
| `paused` | start | Returns the paused session. It does not resume |

Pause, resume, stop, finalize, and GPS ingest for one session share one in-process lock and a `SELECT … FOR UPDATE` row lock. A unique-index race on the open pause returns the paused session instead of inserting a second interval.

The client cannot send a pause duration, a distance adjustment, or a fare. The body schema is strict and accepts only an optional `idempotencyKey`.

## API contracts

Both on-demand and walk-up sessions use the same session id.

```http
POST /api/v1/driver/meter/:sessionId/pause
POST /api/v1/driver/meter/:sessionId/resume
```

Authenticated driver only. If the session belongs to another driver, the response is `404 METER_NOT_FOUND`.

```json
{ "idempotencyKey": "optional-8-to-80-chars" }
```

Success:

```json
{
  "meter": { },
  "idempotent": false
}
```

`idempotent` is `true` when the meter was already in the requested state. Existing meter fields are still present. These fields are added:

| Field | `running` | `paused` | `stopped` or `finalized` |
| --- | --- | --- | --- |
| `status` | `running` | `paused` | `stopped` or `finalized` |
| `pausedAt` | `null` | ISO time of the open pause | `null`. The interval was closed |
| `totalPausedSeconds` | Sum of closed pauses | Sum of closed pauses. The open pause is not included | Includes the interval closed at stop or finalize |
| `currentPauseSeconds` | `0` | Whole seconds since `pausedAt` | `0` |
| `chargeableElapsedSeconds` | Wall time since start, minus closed pauses | Same, and the open pause is subtracted too, so it does not grow | Frozen at `stoppedAt`. It does not grow after stop |
| `tripElapsedSeconds` | Wall time since start | Wall time since start, including the pause | Frozen at `stoppedAt` |
| `pauseReason` | `null` | `driver_personal_stop` | `null` |
| `fareFrozen` | `false` | `true` | `false` |
| `stateVersion` | Increments when distance is accepted, and on pause, resume, stop, and finalize | Same | Same |

`chargeableElapsedSeconds` is never negative. Excluded GPS samples do not increment `stateVersion`.

## Socket.IO

Existing driver, customer, and admin rooms are reused.

| Event | When |
| --- | --- |
| `meter:state` | Pause and resume, and the existing start, stop, and finalize events |
| `meter:fare` | A running meter accepted billable distance. **Not emitted while the meter is paused** |

The payload is the meter state above, including `stateVersion`. A later event with a lower `stateVersion` is not emitted. Clients should ignore a `meter:state` or `meter:fare` whose `stateVersion` is lower than the one they already applied.

## GPS exclusion

Passenger map updates keep using the normal driver location path. Meter distance does not.

A sample is stored for audit and then kept out of the fare when any of these are true:

1. `recordedAt` falls inside a server pause interval, including a delay that arrives after resume. Reason `paused_interval`. Review flag `pause_gps_excluded`.
2. The meter is paused now, even if the device clock says the sample is outside the pause. Reason `meter_paused`. Review flag `pause_timestamp_conflict`.
3. Resume cleared the anchor, and `recordedAt` is before the latest resume. Reason `before_resume_boundary`. That sample does not become the new anchor.

The first accepted sample after resume is a new anchor with distance delta `0`. Later samples measure only from that anchor. The straight line from the last pre-pause point to the first post-resume point is not billed. Movement during the pause is not billed later.

Excluded samples are `rejected`, delta `0`, and a `gps_excluded_pause` calculation event. Accepted distance, waiting seconds, and the provisional total are not changed.

## Fare freeze

At pause the server copies the current distance, waiting seconds, and provisional total onto the pause row and leaves those session columns unchanged.

While paused, GPS and the growing pause duration do not change those totals. Waiting seconds are still not a charge. The draft tariff is unchanged, and `waitingChargeCents` stays `0` because waiting eligibility is unconfigured.

On resume, calculation continues from those totals. New distance after the new anchor can raise the provisional preview. The paused interval cannot.

Stop and finalize from `paused` close the interval, preview the fare from the unchanged distance and waiting seconds, and write `billable: false`. On-demand completion still settles the quoted fare, then calls the same finalize path. A paused on-demand meter is finalized there. `bookings.final_fare` is not rewritten.

`METERED_CHARGING_RELEASED` remains `false`. The `0036` checks that force `charging_enabled = false` and `billable = false` are unchanged.

## Test results

`npx tsc --noEmit` passed. `npm run build` passed.

`tests/soft-meter-pause.test.ts`: 12 passed. They cover:

1. Pause a running meter
2. Resume a paused meter
3. Fare frozen while paused
4. Distance excluded during pause
5. Waiting and time excluded
6. Multiple pause/resume cycles
7. GPS movement during pause
8. Delayed GPS that crosses pause boundaries
9. No GPS jump onto the pre-pause anchor
10. Duplicate pause
11. Duplicate resume
12. Pause and finalize race
13. Finalize while paused
14. Reload of an unfinished pause
15. Another driver is `METER_NOT_FOUND`
16. On-demand uses the same pause
17. Walk-up uses the same pause
18. Charging stays disabled, and a body that sends a duration or fare is rejected

Also passed: `soft-meter.test.ts`, `soft-meter.payment.test.ts`, `soft-meter.webhook.test.ts`, `stripe-webhook.test.ts`, `stripe-phase-d.test.ts`, `cash-booking-payment.test.ts`, `service-area.dispatch.test.ts`.

## Android and iOS integration

Call the two endpoints with the driver token and the meter `sessionId` from the existing meter state. Send an empty JSON object, or only `idempotencyKey`. Do not send a duration, distance, or fare.

Show the meter as paused when `meter.status` is `paused` or `meter.fareFrozen` is `true`. Display `meter.fare.totalCents` as a provisional amount. It is not a charge.

Keep uploading GPS with stable `clientPointId` values during the pause. The server stores those points and excludes them from the fare. Trust `pausedAt` and `totalPausedSeconds` from the server.

On `meter:state` and `meter:fare`, apply the payload only when `stateVersion` is greater than the last one applied. Ignore an older version.

`409 METER_NOT_PAUSABLE` means the meter is not running. `409 METER_NOT_RESUMABLE` means it is not paused. A repeat pause or resume returns `200` with `idempotent: true` and the current meter.

The driver can complete the trip while the meter is paused. Use the existing stop or complete action. The server closes the pause and does not add fare for it.
