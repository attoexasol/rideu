import { METER_GPS_POLICY, METER_STOP_POLICY } from '../../constants/softMeter';

export const STOPPED_TIME_PARTIAL_MINUTE_POLICY = METER_STOP_POLICY.partialMinutePolicy;

/**
 * Completed minutes only. 90 eligible seconds bill as one minute.
 * This is a test calculation, not a regulator-approved partial-minute rule.
 */
export function stoppedTimeChargeCents(
  eligibleStoppedSeconds: number,
  centsPerMinute: number
): {
  cents: number;
  billedMinutes: number;
  remainderSeconds: number;
  policy: typeof STOPPED_TIME_PARTIAL_MINUTE_POLICY;
} {
  if (!Number.isInteger(eligibleStoppedSeconds) || eligibleStoppedSeconds < 0) {
    throw new Error('eligible stopped seconds must be a non-negative integer');
  }
  if (!Number.isInteger(centsPerMinute) || centsPerMinute < 0) {
    throw new Error('cents per minute must be a non-negative integer');
  }
  const seconds = BigInt(eligibleStoppedSeconds);
  const billedMinutes = Number(seconds / 60n);
  const remainderSeconds = Number(seconds % 60n);
  return {
    cents: Number(BigInt(billedMinutes) * BigInt(centsPerMinute)),
    billedMinutes,
    remainderSeconds,
    policy: STOPPED_TIME_PARTIAL_MINUTE_POLICY,
  };
}

export type StopDisposition =
  | 'ignored'
  | 'paused'
  | 'anchor_reset'
  | 'gap_excluded'
  | 'moving'
  | 'stop_unconfirmed'
  | 'stopped'
  | 'ambiguous_excluded';

export interface StopClassification {
  billDistance: boolean;
  addedStoppedSeconds: number;
  excludedStoppedSeconds: number;
  nextStreak: number;
  nextRemainderMs: number;
  disposition: StopDisposition;
  reason: string | null;
}

function unchanged(input: {
  stopStreak: number;
  stopRemainderMs: number;
}): StopClassification {
  return {
    billDistance: false,
    addedStoppedSeconds: 0,
    excludedStoppedSeconds: 0,
    nextStreak: input.stopStreak,
    nextRemainderMs: input.stopRemainderMs,
    disposition: 'ignored',
    reason: null,
  };
}

function wholeSeconds(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return Math.floor(elapsedMs / 1000);
}

/**
 * Decide whether one accepted GPS interval bills distance, stopped time, or neither.
 * Paused, gapped, and unconfirmed intervals never add stopped seconds.
 */
export function classifyStoppedInterval(input: {
  accepted: boolean;
  excludedFromFare: boolean;
  gapBefore: boolean;
  resetAnchor: boolean;
  displacementMillimeters: number;
  elapsedMs: number | null;
  speedMps: number | null;
  stopStreak: number;
  stopRemainderMs: number;
  rejectReason?: string | null;
}): StopClassification {
  if (!input.accepted) {
    if (input.rejectReason === 'duplicate') return unchanged(input);
    return {
      ...unchanged(input),
      nextStreak: 0,
      nextRemainderMs: 0,
      reason: input.rejectReason ?? 'gps_rejected',
    };
  }
  if (input.excludedFromFare) {
    return {
      billDistance: false,
      addedStoppedSeconds: 0,
      excludedStoppedSeconds: 0,
      nextStreak: 0,
      nextRemainderMs: 0,
      disposition: 'paused',
      reason: 'paused_interval',
    };
  }
  if (input.resetAnchor || input.elapsedMs == null) {
    return {
      billDistance: false,
      addedStoppedSeconds: 0,
      excludedStoppedSeconds: 0,
      nextStreak: 0,
      nextRemainderMs: 0,
      disposition: 'anchor_reset',
      reason: 'new_distance_anchor',
    };
  }
  if (input.gapBefore || input.elapsedMs > METER_STOP_POLICY.maxStoppedGapMs) {
    return {
      billDistance: false,
      addedStoppedSeconds: 0,
      excludedStoppedSeconds: wholeSeconds(input.elapsedMs),
      nextStreak: 0,
      nextRemainderMs: 0,
      disposition: 'gap_excluded',
      reason: 'gps_gap',
    };
  }

  const movedBeyondRadius = input.displacementMillimeters > METER_STOP_POLICY.stopRadiusMillimeters;
  const speed = input.speedMps;
  const speedSaysMoving =
    speed != null &&
    Number.isFinite(speed) &&
    speed > METER_STOP_POLICY.maxStoppedSpeedMps &&
    input.displacementMillimeters > METER_GPS_POLICY.duplicateDistanceMillimeters;
  if (movedBeyondRadius || speedSaysMoving) {
    return {
      billDistance: true,
      addedStoppedSeconds: 0,
      excludedStoppedSeconds: 0,
      nextStreak: 0,
      nextRemainderMs: 0,
      disposition: 'moving',
      reason: movedBeyondRadius ? 'displacement' : 'speed_above_stop',
    };
  }

  const quietStop =
    input.displacementMillimeters <= METER_STOP_POLICY.maxStoppedDisplacementMillimeters &&
    (speed == null || !Number.isFinite(speed) || speed <= METER_STOP_POLICY.maxStoppedSpeedMps);
  if (!quietStop) {
    return {
      billDistance: false,
      addedStoppedSeconds: 0,
      excludedStoppedSeconds: wholeSeconds(input.elapsedMs),
      nextStreak: 0,
      nextRemainderMs: 0,
      disposition: 'ambiguous_excluded',
      reason: 'insufficient_stationary_evidence',
    };
  }

  if (input.stopStreak < METER_STOP_POLICY.confirmationIntervals) {
    return {
      billDistance: false,
      addedStoppedSeconds: 0,
      excludedStoppedSeconds: wholeSeconds(input.elapsedMs),
      nextStreak: input.stopStreak + 1,
      nextRemainderMs: 0,
      disposition: 'stop_unconfirmed',
      reason: 'stationary_confirmation',
    };
  }

  const totalMs = input.stopRemainderMs + input.elapsedMs;
  return {
    billDistance: false,
    addedStoppedSeconds: Math.floor(totalMs / 1000),
    excludedStoppedSeconds: 0,
    nextStreak: input.stopStreak + 1,
    nextRemainderMs: totalMs % 1000,
    disposition: 'stopped',
    reason: null,
  };
}

export function applyStoppedInterval(input: {
  acceptedDistanceMillimeters: number;
  waitingSeconds: number;
  excludedStopSeconds: number;
  stopStreak: number;
  stopRemainderMs: number;
  accepted: boolean;
  excludedFromFare: boolean;
  gapBefore: boolean;
  resetAnchor: boolean;
  displacementMillimeters: number;
  elapsedMs: number | null;
  speedMps: number | null;
  rejectReason: string | null;
}): {
  acceptedDistanceMillimeters: number;
  waitingSeconds: number;
  excludedStopSeconds: number;
  stopStreak: number;
  stopRemainderMs: number;
  distanceDeltaMillimeters: number;
  classification: StopClassification;
} {
  const classification = classifyStoppedInterval({
    accepted: input.accepted,
    excludedFromFare: input.excludedFromFare,
    gapBefore: input.gapBefore,
    resetAnchor: input.resetAnchor,
    displacementMillimeters: input.displacementMillimeters,
    elapsedMs: input.elapsedMs,
    speedMps: input.speedMps,
    stopStreak: input.stopStreak,
    stopRemainderMs: input.stopRemainderMs,
    rejectReason: input.rejectReason,
  });
  const distanceDeltaMillimeters =
    input.excludedFromFare || !classification.billDistance ? 0 : input.displacementMillimeters;
  return {
    acceptedDistanceMillimeters: input.acceptedDistanceMillimeters + distanceDeltaMillimeters,
    waitingSeconds:
      input.waitingSeconds + (input.excludedFromFare ? 0 : classification.addedStoppedSeconds),
    excludedStopSeconds: input.excludedStopSeconds + classification.excludedStoppedSeconds,
    stopStreak: classification.nextStreak,
    stopRemainderMs: classification.nextRemainderMs,
    distanceDeltaMillimeters,
    classification,
  };
}
