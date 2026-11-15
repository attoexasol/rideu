/**
 * Soft-meter foundation.
 *
 * Money is integer cents. Distance billing units are integer micro-miles
 * (1 mile = 1_000_000). GPS geometry is stored as integer millimeters.
 *
 * Live metered charging is latched off. Approving a draft schedule does not
 * authorize capture, Checkout, or a billable fare.
 */

export const MICRO_MILES_PER_MILE = 1_000_000;
/** 1 international mile = 1609.344 meters. */
export const MILLIMETERS_PER_MILE = 1_609_344;

/** Process-wide latch. A database flag cannot turn charging on while this is false. */
export const METERED_CHARGING_RELEASED = false;

export const DRAFT_SOFT_METER_CODE = 'coronado_soft_meter';

export const DRAFT_SOFT_METER_RATES = {
  currency: 'USD',
  flagDropCents: 420,
  distanceRateCentsPerMile: 460,
  distanceIncrementMicroMiles: 100_000,
  distanceIncrementCents: 46,
  waitingCentsPerHour: 3600,
  waitingCentsPerMinute: 60,
} as const;

export const MeterTripKind = {
  ON_DEMAND: 'on_demand',
  WALK_UP: 'walk_up',
} as const;

export type MeterTripKindType = (typeof MeterTripKind)[keyof typeof MeterTripKind];

export const MeterSessionStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  PAUSED: 'paused',
  STOPPED: 'stopped',
  FINALIZED: 'finalized',
  VOIDED: 'voided',
} as const;

export type MeterSessionStatusType =
  (typeof MeterSessionStatus)[keyof typeof MeterSessionStatus];

export const OPEN_METER_STATUSES: MeterSessionStatusType[] = [
  MeterSessionStatus.PENDING,
  MeterSessionStatus.RUNNING,
  MeterSessionStatus.PAUSED,
  MeterSessionStatus.STOPPED,
];

export const WalkUpStatus = {
  CREATED: 'created',
  IN_PROGRESS: 'in_progress',
  ENDED: 'ended',
  FINALIZED: 'finalized',
  CANCELLED: 'cancelled',
} as const;

export type WalkUpStatusType = (typeof WalkUpStatus)[keyof typeof WalkUpStatus];

export const OPEN_WALK_UP_STATUSES: WalkUpStatusType[] = [
  WalkUpStatus.CREATED,
  WalkUpStatus.IN_PROGRESS,
  WalkUpStatus.ENDED,
];

export const RateScheduleStatus = {
  DRAFT: 'draft',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  ACTIVE: 'active',
  RETIRED: 'retired',
} as const;

export type RateScheduleStatusType =
  (typeof RateScheduleStatus)[keyof typeof RateScheduleStatus];

export const MeterPaymentStatus = {
  NOT_BILLABLE: 'not_billable',
  PENDING: 'pending',
  CHECKOUT_OPEN: 'checkout_open',
  PAID: 'paid',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
} as const;

export type MeterPaymentStatusType =
  (typeof MeterPaymentStatus)[keyof typeof MeterPaymentStatus];

export const PartialIncrementRule = {
  UNCONFIGURED: 'unconfigured',
  COMPLETED_INCREMENTS_ONLY: 'completed_increments_only',
  ROUND_NEAREST_INCREMENT: 'round_nearest_increment',
  PRORATE_REMAINDER: 'prorate_remainder',
} as const;

export type PartialIncrementRuleType =
  (typeof PartialIncrementRule)[keyof typeof PartialIncrementRule];

export const WaitingEligibilityRule = {
  UNCONFIGURED: 'unconfigured',
  NOT_CHARGED: 'not_charged',
  MANUAL_WAIT: 'manual_wait',
} as const;

export type WaitingEligibilityRuleType =
  (typeof WaitingEligibilityRule)[keyof typeof WaitingEligibilityRule];

export const DistanceTimePolicy = {
  UNCONFIGURED: 'unconfigured',
  DISTANCE_ONLY: 'distance_only',
  ADDITIVE: 'additive',
} as const;

export type DistanceTimePolicyType =
  (typeof DistanceTimePolicy)[keyof typeof DistanceTimePolicy];

export const PaymentAuthorizationPolicy = {
  UNCONFIGURED: 'unconfigured',
  SETUP_ONLY_NO_CAPTURE: 'setup_only_no_capture',
  AUTH_ESTIMATED_SEPARATE_SETTLEMENT: 'auth_estimated_then_separate_settlement',
} as const;

export type PaymentAuthorizationPolicyType =
  (typeof PaymentAuthorizationPolicy)[keyof typeof PaymentAuthorizationPolicy];

export interface MeterRules {
  partialIncrementRounding: PartialIncrementRuleType;
  waitingEligibility: WaitingEligibilityRuleType;
  distanceTimePolicy: DistanceTimePolicyType;
  localMeterApproved: boolean;
  paymentAuthorizationPolicy: PaymentAuthorizationPolicyType;
  /** The below-10-mph switch is not an approved billing behavior. */
  speedSwitchBelow10Mph: boolean;
}

export function unconfiguredMeterRules(): MeterRules {
  return {
    partialIncrementRounding: PartialIncrementRule.UNCONFIGURED,
    waitingEligibility: WaitingEligibilityRule.UNCONFIGURED,
    distanceTimePolicy: DistanceTimePolicy.UNCONFIGURED,
    localMeterApproved: false,
    paymentAuthorizationPolicy: PaymentAuthorizationPolicy.UNCONFIGURED,
    speedSwitchBelow10Mph: false,
  };
}

/**
 * Engineering defaults for GPS acceptance. These are reliability controls,
 * not an approved waiting or speed-switch tariff.
 */
export const METER_GPS_POLICY = {
  maxAccuracyMeters: 20,
  maxFutureSkewMs: 5_000,
  maxLateArrivalMs: 10 * 60_000,
  duplicateWindowMs: 1_500,
  duplicateDistanceMillimeters: 3_000,
  maxSpeedMps: 45,
  outageGapMs: 30_000,
} as const;

/**
 * Stop detection for the test-only stopped-time charge.
 * Displacement inside the accuracy budget is drift, not travel.
 * A reported speed is not enough, by itself, to bill distance or time.
 * 10 mph is about 4.47 m/s and is not a billing switch: slower travel still bills distance.
 */
export const METER_STOP_POLICY = {
  /** Displacement above this is travel, including travel below 10 mph. */
  stopRadiusMillimeters: 20_000,
  /** Only a quieter fix can accrue stopped time. Wider drift is not a confirmed stop. */
  maxStoppedDisplacementMillimeters: 8_000,
  maxStoppedSpeedMps: 0.5,
  maxStoppedGapMs: 30_000,
  /** First stationary interval confirms the stop and is not billed. */
  confirmationIntervals: 1,
  /** $0.60/minute is billed per completed minute. Leftover seconds are stored, not rounded up. */
  partialMinutePolicy: 'test_only_completed_minutes',
  /** Documentation only. The meter does not switch billing mode at 10 mph. */
  below10MphMps: 4.4704,
} as const;

export const MeterSocketEvent = {
  STATE: 'meter:state',
  FARE: 'meter:fare',
  PAYMENT: 'walkup:payment',
  BOOKING_PAYMENT: 'booking:meter_payment',
} as const;

export const METER_CHECKOUT_PURPOSE = {
  WALK_UP: 'walk_up_meter',
  ON_DEMAND: 'on_demand_meter',
  WALK_UP_TEST: 'walk_up_meter_test',
  ON_DEMAND_TEST: 'on_demand_meter_test',
} as const;

/** Server classification for a Stripe test Checkout. It is not a production charge. */
export const MeterSettlementMode = {
  PRODUCTION_DISABLED: 'production_disabled',
  STRIPE_TEST: 'stripe_test',
} as const;

export type MeterSettlementModeType =
  (typeof MeterSettlementMode)[keyof typeof MeterSettlementMode];

export const TEST_ONLY_UNAPPROVED_TARIFF = 'test_only_unapproved_tariff';
