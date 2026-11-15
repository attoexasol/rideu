import fs from 'fs';
import path from 'path';
import {
  DRAFT_SOFT_METER_RATES,
  METER_STOP_POLICY,
  METERED_CHARGING_RELEASED,
  unconfiguredMeterRules,
} from '../src/constants/softMeter';
import { MeterError } from '../src/services/softMeter/errors';
import { previewFare } from '../src/services/softMeter/fare';
import {
  emptyTrackState,
  evaluateGpsPoint,
  type GpsPointInput,
  type MeterTrackState,
} from '../src/services/softMeter/gps';
import { onDemandSettlementView } from '../src/services/softMeter/paymentState';
import type { RateSnapshot } from '../src/services/softMeter/rules';
import { applyStoppedInterval, stoppedTimeChargeCents } from '../src/services/softMeter/stoppedTime';
import {
  assertWalkUpTestFare,
  verifyTestCheckoutWebhook,
  type TestFareInput,
} from '../src/services/softMeter/testPayment';

const ONE_MILE_MM = 1_609_344;
const BASE_LAT = 32.6859;
const BASE_LNG = -117.1831;

function draftSnapshot(): RateSnapshot {
  return {
    scheduleId: 'rate-1',
    code: 'coronado_soft_meter',
    version: 1,
    status: 'active',
    currency: 'USD',
    flagDropCents: DRAFT_SOFT_METER_RATES.flagDropCents,
    distanceRateCentsPerMile: DRAFT_SOFT_METER_RATES.distanceRateCentsPerMile,
    distanceIncrementMicroMiles: DRAFT_SOFT_METER_RATES.distanceIncrementMicroMiles,
    distanceIncrementCents: DRAFT_SOFT_METER_RATES.distanceIncrementCents,
    waitingCentsPerHour: DRAFT_SOFT_METER_RATES.waitingCentsPerHour,
    waitingCentsPerMinute: DRAFT_SOFT_METER_RATES.waitingCentsPerMinute,
    chargingEnabled: false,
    rules: unconfiguredMeterRules(),
    capturedAt: '2026-10-31T00:00:00.000Z',
  };
}

interface Sim {
  track: MeterTrackState;
  distance: number;
  waiting: number;
  excluded: number;
  streak: number;
  remainder: number;
  disposition: string;
  delta: number;
}

function fresh(): Sim {
  return {
    track: emptyTrackState(),
    distance: 0,
    waiting: 0,
    excluded: 0,
    streak: 0,
    remainder: 0,
    disposition: 'none',
    delta: 0,
  };
}

function pointAt(
  id: string,
  recordedAtMs: number,
  northMeters: number,
  speedMps: number | null,
  accuracyMeters = 5
): GpsPointInput {
  return {
    clientPointId: id,
    latitude: BASE_LAT + northMeters / 111_320,
    longitude: BASE_LNG,
    accuracyMeters,
    speedMps,
    recordedAtMs,
  };
}

function push(
  state: Sim,
  point: GpsPointInput,
  extra?: { excludedFromFare?: boolean; resetAnchor?: boolean; clearAnchor?: boolean }
): Sim {
  const track = extra?.clearAnchor ? emptyTrackState() : state.track;
  const decision = evaluateGpsPoint(track, point, point.recordedAtMs ?? 0);
  const elapsedMs =
    track.lastAcceptedRecordedAtMs != null && point.recordedAtMs != null
      ? point.recordedAtMs - track.lastAcceptedRecordedAtMs
      : null;
  const applied = applyStoppedInterval({
    acceptedDistanceMillimeters: state.distance,
    waitingSeconds: state.waiting,
    excludedStopSeconds: state.excluded,
    stopStreak: extra?.clearAnchor ? 0 : state.streak,
    stopRemainderMs: extra?.clearAnchor ? 0 : state.remainder,
    accepted: decision.disposition === 'accepted',
    excludedFromFare: extra?.excludedFromFare ?? false,
    gapBefore: decision.gapBefore,
    resetAnchor: extra?.resetAnchor ?? false,
    displacementMillimeters: decision.distanceDeltaMillimeters,
    elapsedMs,
    speedMps: point.speedMps,
    rejectReason: decision.rejectReason,
  });
  const keepAnchor = decision.disposition === 'accepted' && !extra?.excludedFromFare;
  return {
    track: keepAnchor ? decision.next : track,
    distance: applied.acceptedDistanceMillimeters,
    waiting: applied.waitingSeconds,
    excluded: applied.excludedStopSeconds,
    streak: applied.stopStreak,
    remainder: applied.stopRemainderMs,
    disposition: applied.classification.disposition,
    delta: applied.distanceDeltaMillimeters,
  };
}

function fareFor(distanceMillimeters: number, waitingSeconds: number): TestFareInput {
  const preview = previewFare(draftSnapshot(), distanceMillimeters, waitingSeconds);
  return {
    id: 'fare-1',
    sessionId: 'session-1',
    totalCents: preview.totalCents,
    currency: 'USD',
    billable: false,
    chargingEnabled: false,
    acceptedDistanceMillimeters: distanceMillimeters,
    waitingSeconds,
    waitingChargeCents: preview.waitingChargeCents,
    rateSnapshot: draftSnapshot(),
  };
}

function errorCode(error: unknown): string {
  return error instanceof MeterError ? error.code : '';
}

describe('soft meter stopped time', () => {
  const t0 = Date.parse('2026-10-31T18:00:00.000Z');

  it('bills distance at normal speed and does not bill time', () => {
    let state = push(fresh(), pointAt('a', t0, 0, 0));
    state = push(state, pointAt('b', t0 + 10_000, 200, 20));
    expect(state.disposition).toBe('moving');
    expect(state.delta).toBeGreaterThan(METER_STOP_POLICY.stopRadiusMillimeters);
    expect(state.waiting).toBe(0);
    expect(previewFare(draftSnapshot(), state.distance, state.waiting).waitingChargeCents).toBe(0);
  });

  it('keeps billing distance below 10 mph and does not bill time for that movement', () => {
    let state = push(fresh(), pointAt('a', t0, 0, 0));
    state = push(state, pointAt('b', t0 + 12_000, 40, 3.3));
    expect(state.disposition).toBe('moving');
    expect(3.3).toBeLessThan(METER_STOP_POLICY.below10MphMps);
    expect(state.delta).toBeGreaterThan(METER_STOP_POLICY.stopRadiusMillimeters);
    expect(state.waiting).toBe(0);
    state = push(fresh(), pointAt('c', t0, 0, 0));
    state = push(state, pointAt('d', t0 + 8_000, 10, 3.5));
    expect(state.disposition).toBe('moving');
    expect(state.delta).toBeGreaterThan(0);
    expect(state.waiting).toBe(0);
  });

  it('bills confirmed stopped time and ignores the confirmation interval', () => {
    let state = push(fresh(), pointAt('s0', t0, 0, 0));
    state = push(state, pointAt('s1', t0 + 10_000, 0, 0));
    expect(state.disposition).toBe('stop_unconfirmed');
    expect(state.waiting).toBe(0);
    expect(state.excluded).toBe(10);
    for (let step = 2; step <= 7; step += 1) {
      state = push(state, pointAt(`s${step}`, t0 + step * 10_000, 0, 0));
      expect(state.disposition).toBe('stopped');
    }
    expect(state.waiting).toBe(60);
    expect(state.distance).toBe(0);
    const fare = previewFare(draftSnapshot(), state.distance, state.waiting);
    expect(fare.waitingChargeCents).toBe(60);
    expect(fare.flagDropCents).toBe(420);
    expect(fare.totalCents).toBe(480);
    expect(fare.billable).toBe(false);
  });

  it('stops the time charge when the vehicle moves again', () => {
    let state = push(fresh(), pointAt('s0', t0, 0, 0));
    state = push(state, pointAt('s1', t0 + 10_000, 0, 0));
    state = push(state, pointAt('s2', t0 + 20_000, 0, 0));
    expect(state.waiting).toBe(10);
    state = push(state, pointAt('go', t0 + 30_000, 100, 12));
    expect(state.disposition).toBe('moving');
    expect(state.waiting).toBe(10);
    expect(state.streak).toBe(0);
    expect(state.distance).toBeGreaterThan(METER_STOP_POLICY.stopRadiusMillimeters);
  });

  it('does not bill GPS drift inside the stop tolerance as distance', () => {
    let state = push(fresh(), pointAt('d0', t0, 0, 0));
    state = push(state, pointAt('d1', t0 + 10_000, 6, 0));
    expect(state.disposition).toBe('stop_unconfirmed');
    expect(state.delta).toBe(0);
    state = push(state, pointAt('d2', t0 + 20_000, 1, null));
    expect(state.disposition).toBe('stopped');
    expect(state.distance).toBe(0);
    expect(state.waiting).toBe(10);
  });

  it('excludes an ambiguous fix that is too wide to be a confirmed stop', () => {
    let state = push(fresh(), pointAt('a', t0, 0, 0));
    state = push(state, pointAt('b', t0 + 10_000, 12, 0));
    expect(state.disposition).toBe('ambiguous_excluded');
    expect(state.distance).toBe(0);
    expect(state.waiting).toBe(0);
    expect(state.excluded).toBe(10);
    expect(state.streak).toBe(0);
  });

  it('rejects a low-accuracy sample and does not accrue time across it', () => {
    let state = push(fresh(), pointAt('a', t0, 0, 0));
    state = push(state, pointAt('b', t0 + 10_000, 0, 0));
    state = push(state, pointAt('c', t0 + 20_000, 0, 0));
    const waiting = state.waiting;
    state = push(state, pointAt('bad', t0 + 25_000, 0, 0, 40));
    expect(state.disposition).toBe('ignored');
    expect(state.waiting).toBe(waiting);
    expect(state.streak).toBe(0);
    state = push(state, pointAt('next', t0 + 30_000, 0, 0));
    expect(state.disposition).toBe('stop_unconfirmed');
    expect(state.waiting).toBe(waiting);
  });

  it('does not bill a sparse gap', () => {
    let state = push(fresh(), pointAt('a', t0, 0, 0));
    state = push(state, pointAt('b', t0 + 45_000, 0, 0));
    expect(state.disposition).toBe('gap_excluded');
    expect(state.waiting).toBe(0);
    expect(state.distance).toBe(0);
    expect(state.excluded).toBe(45);
    expect(state.streak).toBe(0);
  });

  it('freezes stopped time during a manual pause and requires a new confirmation after resume', () => {
    let state = push(fresh(), pointAt('s0', t0, 0, 0));
    state = push(state, pointAt('s1', t0 + 10_000, 0, 0));
    state = push(state, pointAt('s2', t0 + 20_000, 0, 0));
    const waiting = state.waiting;
    const distance = state.distance;
    state = push(state, pointAt('paused', t0 + 40_000, 0, 0), { excludedFromFare: true });
    expect(state.disposition).toBe('paused');
    expect(state.waiting).toBe(waiting);
    expect(state.distance).toBe(distance);
    expect(state.streak).toBe(0);
    state = push(state, pointAt('resume-anchor', t0 + 50_000, 0, 0), {
      resetAnchor: true,
      clearAnchor: true,
    });
    expect(state.disposition).toBe('anchor_reset');
    expect(state.waiting).toBe(waiting);
    state = push(state, pointAt('resume-confirm', t0 + 60_000, 0, 0));
    expect(state.disposition).toBe('stop_unconfirmed');
    expect(state.waiting).toBe(waiting);
    state = push(state, pointAt('resume-bill', t0 + 70_000, 0, 0));
    expect(state.disposition).toBe('stopped');
    expect(state.waiting).toBe(waiting + 10);
  });

  it('does not double-count a duplicate GPS point', () => {
    let state = push(fresh(), pointAt('s0', t0, 0, 0));
    state = push(state, pointAt('s1', t0 + 10_000, 0, 0));
    state = push(state, pointAt('s2', t0 + 20_000, 0, 0));
    const waiting = state.waiting;
    const streak = state.streak;
    state = push(state, pointAt('dup', t0 + 20_400, 0, 0));
    expect(state.disposition).toBe('ignored');
    expect(state.waiting).toBe(waiting);
    expect(state.streak).toBe(streak);
    state = push(state, pointAt('s3', t0 + 30_000, 0, 0));
    expect(state.disposition).toBe('stopped');
    expect(state.waiting).toBe(waiting + 10);
  });

  it('carries sub-second remainders only across confirmed stopped intervals', () => {
    let state = push(fresh(), pointAt('s0', t0, 0, 0));
    state = push(state, pointAt('s1', t0 + 10_500, 0, 0));
    expect(state.waiting).toBe(0);
    state = push(state, pointAt('s2', t0 + 21_100, 0, 0));
    expect(state.waiting).toBe(10);
    expect(state.remainder).toBe(600);
    state = push(state, pointAt('s3', t0 + 31_600, 0, 0));
    expect(state.waiting).toBe(21);
    expect(state.remainder).toBe(100);
  });

  it('prices completed stopped minutes without rounding a partial minute up', () => {
    expect(stoppedTimeChargeCents(12, 60)).toMatchObject({ cents: 0, remainderSeconds: 12 });
    expect(stoppedTimeChargeCents(59, 60)).toMatchObject({ cents: 0, billedMinutes: 0 });
    expect(stoppedTimeChargeCents(60, 60)).toMatchObject({ cents: 60, remainderSeconds: 0 });
    expect(stoppedTimeChargeCents(90, 60)).toMatchObject({
      cents: 60,
      billedMinutes: 1,
      remainderSeconds: 30,
      policy: 'test_only_completed_minutes',
    });
    const combined = previewFare(draftSnapshot(), ONE_MILE_MM, 90);
    expect(combined.flagDropCents).toBe(420);
    expect(combined.distanceChargeCents).toBe(460);
    expect(combined.waitingChargeCents).toBe(60);
    expect(combined.totalCents).toBe(940);
    expect(combined.billable).toBe(false);
    expect(combined.chargingEnabled).toBe(false);
    expect(combined.provisional).toBe(true);
    const partialDistance = previewFare(draftSnapshot(), ONE_MILE_MM - 20_000, 0);
    expect(partialDistance.completedIncrements).toBe(9);
    expect(partialDistance.distanceChargeCents).toBe(414);
  });

  it('uses the combined finalized fare for walk-up test Checkout and checks the webhook amount', () => {
    const fare = fareFor(ONE_MILE_MM, 90);
    expect(fare.totalCents).toBe(940);
    expect(fare.waitingChargeCents).toBe(60);
    expect(assertWalkUpTestFare(fare)).toBeUndefined();
    const paid = verifyTestCheckoutWebhook({
      livemode: false,
      action: 'paid',
      amountTotal: 940,
      currency: 'usd',
      expectedAmountCents: fare.totalCents,
      expectedCurrency: 'USD',
      currentStatus: 'checkout_open',
      testPayment: true,
    });
    expect(paid.acceptPaid).toBe(true);
    const mismatch = verifyTestCheckoutWebhook({
      livemode: false,
      action: 'paid',
      amountTotal: 880,
      currency: 'usd',
      expectedAmountCents: fare.totalCents,
      expectedCurrency: 'USD',
      currentStatus: 'checkout_open',
      testPayment: true,
    });
    expect(mismatch.acceptPaid).toBe(false);
    expect(mismatch.failureCode).toBe('AMOUNT_MISMATCH');
    const wrong = fareFor(ONE_MILE_MM, 90);
    wrong.waitingChargeCents = 0;
    expect(() => assertWalkUpTestFare(wrong)).toThrow(MeterError);
    try {
      assertWalkUpTestFare(wrong);
    } catch (error) {
      expect(errorCode(error)).toBe('FARE_EVIDENCE_MISMATCH');
    }
  });

  it('leaves production charging locks unchanged', () => {
    expect(METERED_CHARGING_RELEASED).toBe(false);
    const fare = previewFare(draftSnapshot(), ONE_MILE_MM, 120);
    expect(fare.billable).toBe(false);
    expect(fare.chargingEnabled).toBe(false);
    expect(onDemandSettlementView({ billable: fare.billable, blockedReasons: fare.blockedReasons }).captureMeterFare).toBe(
      false
    );
    const root = path.resolve(__dirname, '..');
    const foundation = fs.readFileSync(path.join(root, 'src/db/migrations/0036_soft_meter.sql'), 'utf8');
    expect(foundation).toContain('CHECK ("billable" = false)');
    expect(foundation).toContain('CHECK ("charging_enabled" = false)');
    const stopped = fs.readFileSync(
      path.join(root, 'src/db/migrations/0039_soft_meter_stopped_time.sql'),
      'utf8'
    );
    expect(stopped).not.toContain('charging_enabled');
    expect(stopped).not.toContain('DROP CONSTRAINT "meter_sessions_billable_check"');
  });
});
