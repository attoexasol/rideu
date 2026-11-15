import {
  METERED_CHARGING_RELEASED,
  MICRO_MILES_PER_MILE,
  DistanceTimePolicy,
  PartialIncrementRule,
  PaymentAuthorizationPolicy,
  RateScheduleStatus,
  WaitingEligibilityRule,
  type DistanceTimePolicyType,
  type MeterRules,
  type PartialIncrementRuleType,
  type PaymentAuthorizationPolicyType,
  type RateScheduleStatusType,
  type WaitingEligibilityRuleType,
} from '../../constants/softMeter';
import { MeterError } from './errors';

export interface RateDefinition {
  currency: string;
  flagDropCents: number;
  distanceRateCentsPerMile: number;
  distanceIncrementMicroMiles: number;
  distanceIncrementCents: number;
  waitingCentsPerHour: number;
  waitingCentsPerMinute: number;
  chargingEnabled: boolean;
  rules: MeterRules;
}

export interface RateSnapshot extends RateDefinition {
  scheduleId: string;
  code: string;
  version: number;
  status: RateScheduleStatusType;
  capturedAt: string;
}

const PARTIAL = new Set<string>(Object.values(PartialIncrementRule));
const WAITING = new Set<string>(Object.values(WaitingEligibilityRule));
const DISTANCE_TIME = new Set<string>(Object.values(DistanceTimePolicy));
const PAYMENT_POLICY = new Set<string>(Object.values(PaymentAuthorizationPolicy));

function assertSafeNonNegative(value: number, label: string): void {
  if (!Number.isInteger(value) || !Number.isSafeInteger(value) || value < 0) {
    throw new MeterError('INVALID_METER_RATE', `${label} must be a non-negative integer`, 400);
  }
}

export function normalizeMeterRules(input: Partial<MeterRules> | null | undefined): MeterRules {
  const partial = input?.partialIncrementRounding ?? PartialIncrementRule.UNCONFIGURED;
  const waiting = input?.waitingEligibility ?? WaitingEligibilityRule.UNCONFIGURED;
  const distanceTime = input?.distanceTimePolicy ?? DistanceTimePolicy.UNCONFIGURED;
  const payment = input?.paymentAuthorizationPolicy ?? PaymentAuthorizationPolicy.UNCONFIGURED;
  if (!PARTIAL.has(partial)) {
    throw new MeterError('INVALID_METER_RULE', 'Unknown partial-increment rule', 400);
  }
  if (!WAITING.has(waiting)) {
    throw new MeterError('INVALID_METER_RULE', 'Unknown waiting-eligibility rule', 400);
  }
  if (!DISTANCE_TIME.has(distanceTime)) {
    throw new MeterError('INVALID_METER_RULE', 'Unknown distance/time policy', 400);
  }
  if (!PAYMENT_POLICY.has(payment)) {
    throw new MeterError('INVALID_METER_RULE', 'Unknown payment authorization policy', 400);
  }
  if (input?.speedSwitchBelow10Mph) {
    throw new MeterError(
      'SPEED_SWITCH_BELOW_10_MPH_NOT_APPROVED',
      'The below-10-mph distance/time switch is not an approved billing behavior.',
      400
    );
  }
  return {
    partialIncrementRounding: partial as PartialIncrementRuleType,
    waitingEligibility: waiting as WaitingEligibilityRuleType,
    distanceTimePolicy: distanceTime as DistanceTimePolicyType,
    localMeterApproved: input?.localMeterApproved === true,
    paymentAuthorizationPolicy: payment as PaymentAuthorizationPolicyType,
    speedSwitchBelow10Mph: false,
  };
}

export function validateRateDefinition(rate: RateDefinition): string[] {
  const errors: string[] = [];
  const checks: Array<[number, string]> = [
    [rate.flagDropCents, 'flagDropCents'],
    [rate.distanceRateCentsPerMile, 'distanceRateCentsPerMile'],
    [rate.distanceIncrementMicroMiles, 'distanceIncrementMicroMiles'],
    [rate.distanceIncrementCents, 'distanceIncrementCents'],
    [rate.waitingCentsPerHour, 'waitingCentsPerHour'],
    [rate.waitingCentsPerMinute, 'waitingCentsPerMinute'],
  ];
  for (const [value, label] of checks) {
    if (!Number.isInteger(value) || !Number.isSafeInteger(value) || value < 0) {
      errors.push(`${label} must be a non-negative integer`);
    }
  }
  if (!/^[A-Z]{3}$/.test(rate.currency)) {
    errors.push('currency must be a 3-letter code');
  }
  if (
    rate.distanceIncrementMicroMiles > 0 &&
    MICRO_MILES_PER_MILE % rate.distanceIncrementMicroMiles !== 0
  ) {
    errors.push('distance increment must divide one mile into equal integer increments');
  }
  if (rate.distanceIncrementMicroMiles > 0) {
    const incrementsPerMile = MICRO_MILES_PER_MILE / rate.distanceIncrementMicroMiles;
    if (incrementsPerMile * rate.distanceIncrementCents !== rate.distanceRateCentsPerMile) {
      errors.push('distance rate does not match increment price times increments per mile');
    }
  }
  if (rate.waitingCentsPerMinute * 60 !== rate.waitingCentsPerHour) {
    errors.push('waiting hourly rate must equal the per-minute rate times 60');
  }
  if (rate.rules.speedSwitchBelow10Mph) {
    errors.push('below-10-mph switching is not approved');
  }
  if (rate.chargingEnabled) {
    errors.push('metered charging is not released');
  }
  return errors;
}

export function assertValidRateDefinition(rate: RateDefinition): void {
  const errors = validateRateDefinition(rate);
  if (errors.length) {
    throw new MeterError('INVALID_METER_RATE', errors.join('; '), 400, { errors });
  }
  assertSafeNonNegative(rate.flagDropCents, 'flagDropCents');
}

export interface ChargingDecision {
  billable: boolean;
  chargingEnabled: boolean;
  blockedReasons: string[];
}

/**
 * Billable only when every unresolved rule is explicitly approved AND the
 * process latch is released. Production keeps the latch false.
 */
export function evaluateCharging(
  rate: RateDefinition,
  releaseLatch: boolean = METERED_CHARGING_RELEASED
): ChargingDecision {
  const blockedReasons: string[] = [];
  if (!releaseLatch) blockedReasons.push('METERED_CHARGING_NOT_RELEASED');
  if (!rate.chargingEnabled) blockedReasons.push('CHARGING_NOT_ENABLED');
  if (rate.rules.speedSwitchBelow10Mph) {
    blockedReasons.push('SPEED_SWITCH_BELOW_10_MPH_NOT_APPROVED');
  }
  if (rate.rules.partialIncrementRounding === PartialIncrementRule.UNCONFIGURED) {
    blockedReasons.push('PARTIAL_INCREMENT_UNCONFIGURED');
  }
  if (rate.rules.waitingEligibility === WaitingEligibilityRule.UNCONFIGURED) {
    blockedReasons.push('WAITING_ELIGIBILITY_UNCONFIGURED');
  }
  if (rate.rules.distanceTimePolicy === DistanceTimePolicy.UNCONFIGURED) {
    blockedReasons.push('DISTANCE_TIME_POLICY_UNCONFIGURED');
  }
  if (!rate.rules.localMeterApproved) blockedReasons.push('LOCAL_METER_NOT_APPROVED');
  if (rate.rules.paymentAuthorizationPolicy === PaymentAuthorizationPolicy.UNCONFIGURED) {
    blockedReasons.push('PAYMENT_AUTHORIZATION_UNCONFIGURED');
  }
  return {
    billable: blockedReasons.length === 0,
    chargingEnabled: blockedReasons.length === 0,
    blockedReasons,
  };
}

export function assertChargingReleaseAllowed(): void {
  throw new MeterError(
    'METERED_CHARGING_NOT_RELEASED',
    'Live metered charging stays disabled until increment, waiting, local-approval, and payment-authorization rules are approved.',
    409
  );
}

export function assertScheduleEditable(input: {
  status: RateScheduleStatusType;
  sessionCount: number;
}): void {
  if (input.status !== RateScheduleStatus.DRAFT) {
    throw new MeterError(
      'RATE_SCHEDULE_IMMUTABLE',
      'Only a draft schedule can be edited. Create a new version instead.',
      409
    );
  }
  if (input.sessionCount > 0) {
    throw new MeterError(
      'RATE_SCHEDULE_IN_USE',
      'Rates already copied onto a meter session cannot be changed.',
      409
    );
  }
}

export function transitionScheduleStatus(
  status: RateScheduleStatusType,
  action: 'submit' | 'approve' | 'activate' | 'retire'
): RateScheduleStatusType {
  const allowed: Record<string, RateScheduleStatusType> = {
    [`${RateScheduleStatus.DRAFT}:submit`]: RateScheduleStatus.PENDING_APPROVAL,
    [`${RateScheduleStatus.PENDING_APPROVAL}:approve`]: RateScheduleStatus.APPROVED,
    [`${RateScheduleStatus.APPROVED}:activate`]: RateScheduleStatus.ACTIVE,
    [`${RateScheduleStatus.ACTIVE}:retire`]: RateScheduleStatus.RETIRED,
  };
  const next = allowed[`${status}:${action}`];
  if (!next) {
    throw new MeterError(
      'INVALID_RATE_TRANSITION',
      `Cannot ${action} a schedule in status ${status}.`,
      409
    );
  }
  return next;
}

export function materializeSnapshot(
  schedule: RateDefinition & {
    scheduleId: string;
    code: string;
    version: number;
    status: RateScheduleStatusType;
  },
  capturedAt: string
): RateSnapshot {
  return JSON.parse(
    JSON.stringify({
      ...schedule,
      rules: { ...schedule.rules },
      capturedAt,
    })
  ) as RateSnapshot;
}

export function nextDraftVersion<T extends { version: number; status: RateScheduleStatusType }>(
  current: T,
  changes: Partial<T>
): T {
  return {
    ...JSON.parse(JSON.stringify(current)),
    ...changes,
    version: current.version + 1,
    status: RateScheduleStatus.DRAFT,
  };
}
