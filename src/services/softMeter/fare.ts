import {
  MICRO_MILES_PER_MILE,
  MILLIMETERS_PER_MILE,
  DistanceTimePolicy,
  PartialIncrementRule,
  WaitingEligibilityRule,
} from '../../constants/softMeter';
import { evaluateCharging, type RateSnapshot } from './rules';
import { stoppedTimeChargeCents } from './stoppedTime';

export interface FarePreview {
  currency: string;
  flagDropCents: number;
  distanceChargeCents: number;
  waitingChargeCents: number;
  totalCents: number;
  acceptedDistanceMillimeters: number;
  acceptedDistanceMicroMiles: number;
  completedIncrements: number;
  remainderMicroMiles: number;
  waitingSeconds: number;
  billable: boolean;
  chargingEnabled: boolean;
  provisional: boolean;
  blockedReasons: string[];
  partialIncrementPolicyApplied: string;
  waitingPolicyApplied: string;
  distanceTimePolicyApplied: string;
  billedStoppedMinutes: number;
  unbilledStoppedRemainderSeconds: number;
}

function assertDistance(value: number, label: string): void {
  if (!Number.isInteger(value) || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

/** Floor millimeters into micro-miles. Sub-micro-mile remainder is not billed. */
export function millimetersToMicroMiles(millimeters: number): number {
  assertDistance(millimeters, 'millimeters');
  return Number(
    (BigInt(millimeters) * BigInt(MICRO_MILES_PER_MILE)) / BigInt(MILLIMETERS_PER_MILE)
  );
}

export function completedIncrementParts(
  microMiles: number,
  incrementMicroMiles: number
): { completed: number; remainder: number } {
  assertDistance(microMiles, 'micro-miles');
  assertDistance(incrementMicroMiles, 'increment');
  if (incrementMicroMiles === 0) return { completed: 0, remainder: microMiles };
  const distance = BigInt(microMiles);
  const increment = BigInt(incrementMicroMiles);
  return {
    completed: Number(distance / increment),
    remainder: Number(distance % increment),
  };
}

function prorateCents(microMiles: number, incrementMicroMiles: number, incrementCents: number): number {
  if (incrementMicroMiles === 0) return 0;
  return Number(
    (BigInt(microMiles) * BigInt(incrementCents)) / BigInt(incrementMicroMiles)
  );
}

function distanceCentsForRule(
  rule: string,
  microMiles: number,
  incrementMicroMiles: number,
  incrementCents: number
): { cents: number; completed: number; remainder: number; policy: string } {
  const parts = completedIncrementParts(microMiles, incrementMicroMiles);
  if (rule === PartialIncrementRule.PRORATE_REMAINDER) {
    return {
      cents: prorateCents(microMiles, incrementMicroMiles, incrementCents),
      ...parts,
      policy: rule,
    };
  }
  if (rule === PartialIncrementRule.ROUND_NEAREST_INCREMENT) {
    const roundUp = parts.remainder * 2 >= incrementMicroMiles;
    const increments = parts.completed + (roundUp ? 1 : 0);
    return {
      cents: increments * incrementCents,
      completed: increments,
      remainder: roundUp ? 0 : parts.remainder,
      policy: rule,
    };
  }
  return {
    cents: parts.completed * incrementCents,
    completed: parts.completed,
    remainder: parts.remainder,
    policy:
      rule === PartialIncrementRule.COMPLETED_INCREMENTS_ONLY
        ? rule
        : 'withheld_completed_increments_only',
  };
}

/**
 * Provisional fare: flag drop + completed distance increments + stopped time.
 * Stopped time uses completed minutes only and is not a production charge.
 * The release latch stays off, so billable remains false.
 */
export function previewFare(
  snapshot: RateSnapshot,
  acceptedDistanceMillimeters: number,
  waitingSeconds: number,
  releaseLatch?: boolean
): FarePreview {
  assertDistance(acceptedDistanceMillimeters, 'accepted distance');
  assertDistance(waitingSeconds, 'waiting seconds');
  const charging = evaluateCharging(snapshot, releaseLatch);
  const microMiles = millimetersToMicroMiles(acceptedDistanceMillimeters);
  const distanceRule = charging.billable
    ? snapshot.rules.partialIncrementRounding
    : PartialIncrementRule.UNCONFIGURED;
  const distance = distanceCentsForRule(
    distanceRule,
    microMiles,
    snapshot.distanceIncrementMicroMiles,
    snapshot.distanceIncrementCents
  );
  const stopped = stoppedTimeChargeCents(waitingSeconds, snapshot.waitingCentsPerMinute);
  const waitingChargeCents =
    snapshot.rules.waitingEligibility === WaitingEligibilityRule.NOT_CHARGED ||
    snapshot.rules.distanceTimePolicy === DistanceTimePolicy.DISTANCE_ONLY
      ? 0
      : stopped.cents;
  const waitingPolicyApplied =
    waitingChargeCents === 0 && stopped.cents > 0
      ? 'not_charged'
      : stopped.policy;
  const blockedReasons = charging.blockedReasons.includes('STOPPED_TIME_PARTIAL_MINUTE_TEST_ONLY')
    ? charging.blockedReasons
    : [...charging.blockedReasons, 'STOPPED_TIME_PARTIAL_MINUTE_TEST_ONLY'];
  const flagDropCents = snapshot.flagDropCents;
  const totalCents = flagDropCents + distance.cents + waitingChargeCents;
  return {
    currency: snapshot.currency,
    flagDropCents,
    distanceChargeCents: distance.cents,
    waitingChargeCents,
    totalCents,
    acceptedDistanceMillimeters,
    acceptedDistanceMicroMiles: microMiles,
    completedIncrements: distance.completed,
    remainderMicroMiles: distance.remainder,
    waitingSeconds,
    billable: false,
    chargingEnabled: false,
    provisional: true,
    blockedReasons,
    partialIncrementPolicyApplied: distance.policy,
    waitingPolicyApplied,
    distanceTimePolicyApplied: 'test_only_stopped_while_stationary',
    billedStoppedMinutes: waitingChargeCents === 0 ? 0 : stopped.billedMinutes,
    unbilledStoppedRemainderSeconds: stopped.remainderSeconds,
  };
}
