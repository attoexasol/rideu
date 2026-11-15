import { z } from 'zod';
import {
  DistanceTimePolicy,
  PartialIncrementRule,
  PaymentAuthorizationPolicy,
  WaitingEligibilityRule,
} from '../constants/softMeter';

const rulesSchema = z
  .object({
    partialIncrementRounding: z.enum([
      PartialIncrementRule.UNCONFIGURED,
      PartialIncrementRule.COMPLETED_INCREMENTS_ONLY,
      PartialIncrementRule.ROUND_NEAREST_INCREMENT,
      PartialIncrementRule.PRORATE_REMAINDER,
    ]),
    waitingEligibility: z.enum([
      WaitingEligibilityRule.UNCONFIGURED,
      WaitingEligibilityRule.NOT_CHARGED,
      WaitingEligibilityRule.MANUAL_WAIT,
    ]),
    distanceTimePolicy: z.enum([
      DistanceTimePolicy.UNCONFIGURED,
      DistanceTimePolicy.DISTANCE_ONLY,
      DistanceTimePolicy.ADDITIVE,
    ]),
    localMeterApproved: z.boolean(),
    paymentAuthorizationPolicy: z.enum([
      PaymentAuthorizationPolicy.UNCONFIGURED,
      PaymentAuthorizationPolicy.SETUP_ONLY_NO_CAPTURE,
      PaymentAuthorizationPolicy.AUTH_ESTIMATED_SEPARATE_SETTLEMENT,
    ]),
    speedSwitchBelow10Mph: z.boolean(),
  })
  .partial();

export const createWalkUpSchema = z.object({
  marketCode: z.string().trim().min(2).max(8).optional(),
  pickupLatitude: z.number().gte(-90).lte(90),
  pickupLongitude: z.number().gte(-180).lte(180),
  passengerLabel: z.string().trim().min(1).max(80).optional(),
  idempotencyKey: z.string().trim().min(8).max(80).optional(),
});

export const meterIdempotencySchema = z
  .object({
    idempotencyKey: z.string().trim().min(8).max(80).optional(),
  })
  .default({});

/** Pause and resume accept an idempotency key only. Fare, duration, and distance are rejected. */
export const meterPauseSchema = z
  .object({
    idempotencyKey: z.string().trim().min(8).max(80).optional(),
  })
  .strict()
  .default({});

export const meterPointSchema = z.object({
  clientPointId: z.string().trim().min(1).max(120),
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  accuracyMeters: z.number().nonnegative().nullable().optional(),
  speedMps: z.number().nullable().optional(),
  recordedAt: z.string().datetime(),
});

export const meterPointsSchema = z.object({
  points: z.array(meterPointSchema).min(1).max(100),
});

export const walkUpIdParamSchema = z.object({
  tripId: z.string().uuid(),
});

/** The driver cannot choose test mode, a fare, or a duration. */
export const walkUpPaymentLinkSchema = z.preprocess(
  (value) => (value == null || value === '' ? {} : value),
  z.object({}).strict()
);

/** The passenger cannot choose an amount, currency, test mode, or fare. */
export const onDemandMeterCheckoutSchema = z.preprocess(
  (value) => (value == null || value === '' ? {} : value),
  z.object({}).strict()
);

export const meterSessionIdParamSchema = z.object({
  sessionId: z.string().uuid(),
});

export const rateScheduleIdParamSchema = z.object({
  scheduleId: z.string().uuid(),
});

export const createRateScheduleSchema = z.object({
  code: z.string().trim().min(2).max(64),
  name: z.string().trim().min(2).max(120),
  currency: z.string().trim().length(3).optional(),
  flagDropCents: z.number().int().nonnegative().optional(),
  distanceRateCentsPerMile: z.number().int().nonnegative().optional(),
  distanceIncrementMicroMiles: z.number().int().positive().optional(),
  distanceIncrementCents: z.number().int().nonnegative().optional(),
  waitingCentsPerHour: z.number().int().nonnegative().optional(),
  waitingCentsPerMinute: z.number().int().nonnegative().optional(),
  rules: rulesSchema.optional(),
});

export const patchRateScheduleSchema = createRateScheduleSchema
  .omit({ code: true })
  .partial()
  .extend({
    chargingEnabled: z.boolean().optional(),
  });

export const adminMeterListQuerySchema = z.object({
  status: z.string().trim().max(32).optional(),
  reviewRequired: z.enum(['true', 'false']).optional(),
  driverId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
