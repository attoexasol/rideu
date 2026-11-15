import fs from 'fs';
import path from 'path';
import {
  DRAFT_SOFT_METER_RATES,
  METERED_CHARGING_RELEASED,
  MeterSessionStatus,
  unconfiguredMeterRules,
} from '../src/constants/softMeter';
import { previewFare } from '../src/services/softMeter/fare';
import { distanceMillimeters, emptyTrackState, type GpsPointInput } from '../src/services/softMeter/gps';
import {
  assertCanPause,
  assertCanResume,
  assertCanStart,
  beginFinalization,
  KeyedMutex,
} from '../src/services/softMeter/lifecycle';
import {
  applyGpsBatch,
  buildMeterTiming,
  finalizeSoftMeter,
  isStaleMeterEvent,
  pauseSoftMeter,
  reloadPausedMeter,
  resumeSoftMeter,
  type SoftMeterClockState,
} from '../src/services/softMeter/pause';
import { evaluateCharging, type RateSnapshot } from '../src/services/softMeter/rules';
import { meterPauseSchema } from '../src/validators/softMeter';

const DRIVER = 'driver-1';
const OTHER = 'driver-2';
const ROOT = path.resolve(__dirname, '..');

function errorCode(run: () => void): string | undefined {
  try {
    run();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function draftSnapshot(): RateSnapshot {
  return {
    scheduleId: 'sched-1',
    code: 'coronado_soft_meter',
    version: 1,
    status: 'draft',
    currency: DRAFT_SOFT_METER_RATES.currency,
    flagDropCents: DRAFT_SOFT_METER_RATES.flagDropCents,
    distanceRateCentsPerMile: DRAFT_SOFT_METER_RATES.distanceRateCentsPerMile,
    distanceIncrementMicroMiles: DRAFT_SOFT_METER_RATES.distanceIncrementMicroMiles,
    distanceIncrementCents: DRAFT_SOFT_METER_RATES.distanceIncrementCents,
    waitingCentsPerHour: DRAFT_SOFT_METER_RATES.waitingCentsPerHour,
    waitingCentsPerMinute: DRAFT_SOFT_METER_RATES.waitingCentsPerMinute,
    chargingEnabled: false,
    rules: unconfiguredMeterRules(),
    capturedAt: '2026-10-29T00:00:00.000Z',
  };
}

function point(id: string, latitude: number, longitude: number, recordedAtMs: number): GpsPointInput {
  return {
    clientPointId: id,
    latitude,
    longitude,
    accuracyMeters: 5,
    speedMps: 8,
    recordedAtMs,
  };
}

function runningMeter(nowMs: number, tripKind: 'on_demand' | 'walk_up' = 'on_demand'): SoftMeterClockState {
  const startedAtMs = nowMs - 100_000;
  return {
    status: MeterSessionStatus.RUNNING,
    driverId: DRIVER,
    tripKind,
    startedAtMs,
    stoppedAtMs: null,
    acceptedDistanceMillimeters: 0,
    waitingSeconds: 12,
    provisionalTotalCents: DRAFT_SOFT_METER_RATES.flagDropCents,
    totalPausedSeconds: 0,
    pausedAtMs: null,
    pauseReason: null,
    needsNewAnchor: false,
    stateVersion: 1,
    pauses: [],
    billable: false,
    track: {
      ...emptyTrackState(),
      lastAcceptedRecordedAtMs: startedAtMs,
      lastAcceptedLat: 32.6859,
      lastAcceptedLng: -117.1831,
      lastSequence: 1,
    },
  };
}

describe('soft meter pause and resume', () => {
  const now = Date.parse('2026-10-29T12:00:00.000Z');

  it('pauses a running meter without changing the accumulated fare', () => {
    const before = runningMeter(now);
    const paused = pauseSoftMeter(before, now, DRIVER);
    expect(paused.idempotent).toBe(false);
    expect(paused.state.status).toBe('paused');
    expect(paused.state.pauseReason).toBe('driver_personal_stop');
    expect(paused.state.acceptedDistanceMillimeters).toBe(before.acceptedDistanceMillimeters);
    expect(paused.state.waitingSeconds).toBe(12);
    expect(paused.state.provisionalTotalCents).toBe(before.provisionalTotalCents);
    expect(paused.state.pauses).toHaveLength(1);
    expect(paused.state.pauses[0].resumedAtMs).toBeNull();
    const timing = buildMeterTiming({
      status: paused.state.status,
      startedAtMs: paused.state.startedAtMs,
      stoppedAtMs: null,
      pausedAtMs: paused.state.pausedAtMs,
      totalPausedSeconds: paused.state.totalPausedSeconds,
      pauseReason: paused.state.pauseReason,
      nowMs: now,
    });
    expect(timing.fareFrozen).toBe(true);
    expect(timing.pausedAt).toBe(new Date(now).toISOString());
    expect(timing.currentPauseSeconds).toBe(0);
    expect(timing.pauseReason).toBe('driver_personal_stop');
  });

  it('resumes a paused meter from the preserved totals and clears the GPS anchor', () => {
    const paused = pauseSoftMeter(runningMeter(now), now, DRIVER).state;
    const resumed = resumeSoftMeter(paused, now + 30_000, DRIVER);
    expect(resumed.idempotent).toBe(false);
    expect(resumed.state.status).toBe('running');
    expect(resumed.state.needsNewAnchor).toBe(true);
    expect(resumed.state.track.lastAcceptedLat).toBeNull();
    expect(resumed.state.totalPausedSeconds).toBe(30);
    expect(resumed.state.provisionalTotalCents).toBe(DRAFT_SOFT_METER_RATES.flagDropCents);
    expect(resumed.state.waitingSeconds).toBe(12);
    expect(resumed.state.pauses[0].durationSeconds).toBe(30);
    const timing = buildMeterTiming({
      status: resumed.state.status,
      startedAtMs: resumed.state.startedAtMs,
      stoppedAtMs: null,
      pausedAtMs: resumed.state.pausedAtMs,
      totalPausedSeconds: resumed.state.totalPausedSeconds,
      pauseReason: resumed.state.pauseReason,
      nowMs: now + 40_000,
    });
    expect(timing.fareFrozen).toBe(false);
    expect(timing.pausedAt).toBeNull();
    expect(timing.currentPauseSeconds).toBe(0);
    expect(timing.pauseReason).toBeNull();
    expect(timing.chargeableElapsedSeconds).toBe(timing.tripElapsedSeconds - 30);
  });

  it('keeps the provisional fare constant while the meter is paused', () => {
    const paused = pauseSoftMeter(runningMeter(now), now, DRIVER).state;
    const atPause = previewFare(draftSnapshot(), paused.acceptedDistanceMillimeters, paused.waitingSeconds);
    const moved = applyGpsBatch(
      paused,
      [point('during', 32.7, -117.2, now + 10_000)],
      now + 20_000
    );
    const still = previewFare(
      draftSnapshot(),
      moved.state.acceptedDistanceMillimeters,
      moved.state.waitingSeconds
    );
    expect(still.totalCents).toBe(atPause.totalCents);
    expect(moved.state.provisionalTotalCents).toBe(paused.provisionalTotalCents);
    const later = buildMeterTiming({
      status: 'paused',
      startedAtMs: paused.startedAtMs,
      stoppedAtMs: null,
      pausedAtMs: now,
      totalPausedSeconds: 0,
      pauseReason: 'driver_personal_stop',
      nowMs: now + 30_000,
    });
    const atStartOfPause = buildMeterTiming({
      status: 'paused',
      startedAtMs: paused.startedAtMs,
      stoppedAtMs: null,
      pausedAtMs: now,
      totalPausedSeconds: 0,
      pauseReason: 'driver_personal_stop',
      nowMs: now,
    });
    expect(later.currentPauseSeconds).toBe(30);
    expect(later.chargeableElapsedSeconds).toBe(atStartOfPause.chargeableElapsedSeconds);
    expect(later.fareFrozen).toBe(true);
  });

  it('excludes distance, waiting, and time charges during a pause', () => {
    const paused = pauseSoftMeter(runningMeter(now), now, DRIVER).state;
    const moved = applyGpsBatch(
      paused,
      [point('far', 32.71, -117.2, now + 5_000)],
      now + 15_000
    );
    expect(moved.state.acceptedDistanceMillimeters).toBe(0);
    expect(moved.state.waitingSeconds).toBe(12);
    expect(moved.results[0].distanceDeltaMillimeters).toBe(0);
    expect(moved.results[0].rejectReason).toBe('paused_interval');
    const fare = previewFare(draftSnapshot(), moved.state.acceptedDistanceMillimeters, moved.state.waitingSeconds);
    expect(fare.waitingChargeCents).toBe(0);
    expect(fare.distanceChargeCents).toBe(0);
    expect(fare.totalCents).toBe(DRAFT_SOFT_METER_RATES.flagDropCents);
    expect(fare.billable).toBe(false);
  });

  it('supports multiple pause and resume cycles without overlapping intervals', () => {
    let state = runningMeter(now);
    state = pauseSoftMeter(state, now, DRIVER).state;
    state = resumeSoftMeter(state, now + 10_000, DRIVER).state;
    state = pauseSoftMeter(state, now + 20_000, DRIVER).state;
    state = resumeSoftMeter(state, now + 40_000, DRIVER).state;
    expect(state.pauses).toHaveLength(2);
    expect(state.pauses.every((pause) => pause.resumedAtMs != null)).toBe(true);
    expect(state.pauses[0].resumedAtMs).toBeLessThanOrEqual(state.pauses[1].pausedAtMs);
    expect(state.totalPausedSeconds).toBe(30);
    expect(state.status).toBe('running');
    expect(state.provisionalTotalCents).toBe(DRAFT_SOFT_METER_RATES.flagDropCents);
  });

  it('does not bill GPS movement during a pause or jump the anchor on resume', () => {
    let state = runningMeter(now);
    const prePauseLat = state.track.lastAcceptedLat as number;
    const prePauseLng = state.track.lastAcceptedLng as number;
    state = pauseSoftMeter(state, now, DRIVER).state;
    const during = applyGpsBatch(
      state,
      [point('pause-move', 32.7, -117.19, now + 5_000)],
      now + 8_000
    );
    expect(during.state.acceptedDistanceMillimeters).toBe(0);
    expect(during.state.track.lastAcceptedLat).toBe(prePauseLat);
    state = resumeSoftMeter(during.state, now + 60_000, DRIVER).state;
    const resumedAt = now + 60_000;
    const receivedAt = resumedAt + 70_000;
    const applied = applyGpsBatch(
      state,
      [
        point('late-before', 32.9, -117.3, now - 5_000),
        point('inside', 32.72, -117.2, now + 20_000),
        point('anchor', 32.6864, -117.1831, resumedAt + 1_000),
        point('after', 32.6882, -117.1831, resumedAt + 11_000),
      ],
      receivedAt
    );
    expect(applied.results.find((row) => row.clientPointId === 'late-before')?.rejectReason).toBe(
      'before_resume_boundary'
    );
    expect(applied.results.find((row) => row.clientPointId === 'inside')?.rejectReason).toBe(
      'paused_interval'
    );
    expect(applied.results.find((row) => row.clientPointId === 'anchor')?.distanceDeltaMillimeters).toBe(0);
    const after = applied.results.find((row) => row.clientPointId === 'after');
    expect(after?.disposition).toBe('accepted');
    expect(after?.distanceDeltaMillimeters).toBeGreaterThan(0);
    const jump = distanceMillimeters(prePauseLat, prePauseLng, 32.6882, -117.1831);
    expect(after?.distanceDeltaMillimeters).toBeLessThan(jump);
    expect(applied.state.acceptedDistanceMillimeters).toBe(after?.distanceDeltaMillimeters);
    const frozenFare = previewFare(draftSnapshot(), 0, 12);
    const continued = previewFare(draftSnapshot(), applied.state.acceptedDistanceMillimeters, 12);
    expect(continued.totalCents).toBeGreaterThanOrEqual(frozenFare.totalCents);
    expect(applied.state.waitingSeconds).toBe(12);
  });

  it('treats duplicate pause and resume requests as the same transition', () => {
    const paused = pauseSoftMeter(runningMeter(now), now, DRIVER);
    const again = pauseSoftMeter(paused.state, now + 5_000, DRIVER);
    expect(again.idempotent).toBe(true);
    expect(again.state.pauses).toHaveLength(1);
    expect(again.state.pausedAtMs).toBe(now);
    const resumed = resumeSoftMeter(again.state, now + 10_000, DRIVER);
    const resumedAgain = resumeSoftMeter(resumed.state, now + 15_000, DRIVER);
    expect(resumedAgain.idempotent).toBe(true);
    expect(resumedAgain.state.pauses).toHaveLength(1);
    expect(resumedAgain.state.totalPausedSeconds).toBe(10);
  });

  it('finalizes a paused meter without adding pause charges, including under a race', async () => {
    const paused = pauseSoftMeter(runningMeter(now), now, DRIVER).state;
    const finalized = finalizeSoftMeter(paused, now + 25_000, DRIVER);
    expect(finalized.state.status).toBe('finalized');
    expect(finalized.state.billable).toBe(false);
    expect(finalized.state.acceptedDistanceMillimeters).toBe(0);
    expect(finalized.state.provisionalTotalCents).toBe(DRAFT_SOFT_METER_RATES.flagDropCents);
    expect(finalized.state.totalPausedSeconds).toBe(25);
    expect(finalized.state.pauses.some((pause) => pause.resumedAtMs == null)).toBe(false);
    const timing = buildMeterTiming({
      status: finalized.state.status,
      startedAtMs: finalized.state.startedAtMs,
      stoppedAtMs: finalized.state.stoppedAtMs,
      pausedAtMs: finalized.state.pausedAtMs,
      totalPausedSeconds: finalized.state.totalPausedSeconds,
      pauseReason: finalized.state.pauseReason,
      nowMs: now + 90_000,
    });
    expect(timing.fareFrozen).toBe(false);
    expect(timing.pausedAt).toBeNull();
    expect(timing.currentPauseSeconds).toBe(0);
    expect(timing.chargeableElapsedSeconds).toBe(
      buildMeterTiming({
        status: finalized.state.status,
        startedAtMs: finalized.state.startedAtMs,
        stoppedAtMs: finalized.state.stoppedAtMs,
        pausedAtMs: null,
        totalPausedSeconds: finalized.state.totalPausedSeconds,
        pauseReason: null,
        nowMs: now + 25_000,
      }).chargeableElapsedSeconds
    );

    const mutex = new KeyedMutex();
    let shared = runningMeter(now);
    const distance = shared.acceptedDistanceMillimeters;
    const fare = shared.provisionalTotalCents;
    await Promise.all([
      mutex.run('session', async () => {
        await delay(5);
        try {
          shared = pauseSoftMeter(shared, now + 1_000, DRIVER).state;
        } catch {
          return;
        }
      }),
      mutex.run('session', async () => {
        shared = finalizeSoftMeter(shared, now + 2_000, DRIVER).state;
      }),
    ]);
    expect(shared.status).toBe('finalized');
    expect(shared.acceptedDistanceMillimeters).toBe(distance);
    expect(shared.provisionalTotalCents).toBe(fare);
    expect(shared.billable).toBe(false);
    expect(shared.pauses.filter((pause) => pause.resumedAtMs == null)).toHaveLength(0);
  });

  it('reloads an unfinished pause after a restart and still resumes from it', () => {
    const paused = pauseSoftMeter(runningMeter(now), now, DRIVER).state;
    const restored = reloadPausedMeter(JSON.parse(JSON.stringify(paused)) as SoftMeterClockState);
    expect(restored.status).toBe('paused');
    expect(restored.pausedAtMs).toBe(now);
    expect(restored.acceptedDistanceMillimeters).toBe(0);
    expect(restored.provisionalTotalCents).toBe(DRAFT_SOFT_METER_RATES.flagDropCents);
    const resumed = resumeSoftMeter(restored, now + 8_000, DRIVER).state;
    expect(resumed.status).toBe('running');
    expect(resumed.totalPausedSeconds).toBe(8);
    expect(resumed.needsNewAnchor).toBe(true);
  });

  it('rejects another driver and illegal transitions', () => {
    const running = runningMeter(now);
    expect(errorCode(() => pauseSoftMeter(running, now, OTHER))).toBe('METER_NOT_FOUND');
    expect(running.status).toBe('running');
    expect(errorCode(() => pauseSoftMeter({ ...running, status: 'stopped' }, now, DRIVER))).toBe(
      'METER_NOT_PAUSABLE'
    );
    expect(errorCode(() => pauseSoftMeter({ ...running, status: 'finalized' }, now, DRIVER))).toBe(
      'METER_NOT_PAUSABLE'
    );
    expect(errorCode(() => pauseSoftMeter({ ...running, status: 'voided' }, now, DRIVER))).toBe(
      'METER_NOT_PAUSABLE'
    );
    expect(errorCode(() => resumeSoftMeter(running, now, DRIVER))).not.toBe('METER_NOT_RESUMABLE');
    expect(resumeSoftMeter(running, now, DRIVER).idempotent).toBe(true);
    const paused = pauseSoftMeter(running, now, DRIVER).state;
    expect(errorCode(() => resumeSoftMeter({ ...paused, status: 'stopped' }, now, DRIVER))).toBe(
      'METER_NOT_RESUMABLE'
    );
    expect(assertCanStart(MeterSessionStatus.PAUSED).idempotent).toBe(true);
    expect(beginFinalization(MeterSessionStatus.PAUSED)).toBe('stop_then_claim');
    expect(assertCanPause(MeterSessionStatus.RUNNING).idempotent).toBe(false);
    expect(assertCanResume(MeterSessionStatus.PAUSED).idempotent).toBe(false);
    expect(isStaleMeterEvent(3, 4)).toBe(true);
    expect(isStaleMeterEvent(4, 4)).toBe(false);
  });

  it('uses the same pause rules for on-demand and walk-up, and leaves charging disabled', () => {
    const quotedFareCents = 1200;
    const onDemand = pauseSoftMeter(runningMeter(now, 'on_demand'), now, DRIVER).state;
    const walkUp = pauseSoftMeter(runningMeter(now, 'walk_up'), now, DRIVER).state;
    expect(onDemand.status).toBe('paused');
    expect(walkUp.status).toBe('paused');
    expect(onDemand.tripKind).toBe('on_demand');
    expect(walkUp.tripKind).toBe('walk_up');
    expect(quotedFareCents).toBe(1200);
    expect(onDemand.billable).toBe(false);
    expect(walkUp.billable).toBe(false);
    expect(METERED_CHARGING_RELEASED).toBe(false);
    expect(evaluateCharging(draftSnapshot()).chargingEnabled).toBe(false);
    expect(finalizeSoftMeter(onDemand, now + 1_000, DRIVER).state.billable).toBe(false);
    expect(meterPauseSchema.safeParse({ durationSeconds: 30, fareCents: 999 }).success).toBe(false);
    expect(meterPauseSchema.parse({}).idempotencyKey).toBeUndefined();
  });

  it('wires pause and resume into the driver meter routes and the pause migration', () => {
    const routes = fs.readFileSync(path.join(ROOT, 'src/routes/v1/driver/meter.ts'), 'utf8');
    const migration = fs.readFileSync(
      path.join(ROOT, 'src/db/migrations/0037_soft_meter_pause.sql'),
      'utf8'
    );
    const service = fs.readFileSync(
      path.join(ROOT, 'src/services/softMeter/meterSession.service.ts'),
      'utf8'
    );
    const repository = fs.readFileSync(
      path.join(ROOT, 'src/repositories/meterSession.repository.ts'),
      'utf8'
    );
    const payment = fs.readFileSync(
      path.join(ROOT, 'src/services/softMeter/meterPayment.service.ts'),
      'utf8'
    );
    expect(routes).toContain('/:sessionId/pause');
    expect(routes).toContain('/:sessionId/resume');
    expect(migration).toContain('uq_meter_pauses_one_open');
    expect(migration).toContain("reason\" = 'driver_personal_stop'");
    expect(migration).toContain("'paused'");
    expect(service).toContain('classifyMeterGps');
    expect(service).toContain('closeOpenPause');
    expect(service).toContain('findMeterForGpsIngest');
    expect(service).not.toContain('paymentIntents');
    expect(repository).toContain(".for('update')");
    expect(payment).not.toContain('paymentIntents.capture');
    expect(payment).toContain('METERED_CHARGING_RELEASED');
  });
});
