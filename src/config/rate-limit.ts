/**
 * Centralized rate-limit configuration.
 * Env vars override tier defaults; production stays stricter than dev/staging.
 */

export type RateLimitTier = 'development' | 'staging' | 'production' | 'test';

export interface RateLimitBucketConfig {
  windowMs: number;
  max: number;
}

export interface RateLimitConfig {
  enabled: boolean;
  useRedisStore: boolean;
  tier: RateLimitTier;
  global: RateLimitBucketConfig;
  auth: RateLimitBucketConfig;
  passengerMaps: RateLimitBucketConfig;
  passengerBooking: RateLimitBucketConfig;
  passengerCancel: RateLimitBucketConfig;
  passengerRecovery: RateLimitBucketConfig;
  driver: RateLimitBucketConfig;
  driverLocation: RateLimitBucketConfig;
  driverOffer: RateLimitBucketConfig;
  driverRecovery: RateLimitBucketConfig;
  videoUpload: RateLimitBucketConfig;
}

type TierDefaults = Omit<RateLimitConfig, 'enabled' | 'useRedisStore' | 'tier'>;

const TIER_DEFAULTS: Record<Exclude<RateLimitTier, 'test'>, TierDefaults> = {
  development: {
    global: { windowMs: 60_000, max: 5_000 },
    auth: { windowMs: 60_000, max: 100 },
    passengerMaps: { windowMs: 60_000, max: 300 },
    passengerBooking: { windowMs: 60_000, max: 100 },
    passengerCancel: { windowMs: 60_000, max: 30 },
    passengerRecovery: { windowMs: 60_000, max: 300 },
    driver: { windowMs: 60_000, max: 600 },
    driverLocation: { windowMs: 60_000, max: 1_000 },
    driverOffer: { windowMs: 60_000, max: 300 },
    driverRecovery: { windowMs: 60_000, max: 300 },
    videoUpload: { windowMs: 60_000, max: 120 },
  },
  staging: {
    global: { windowMs: 60_000, max: 500 },
    auth: { windowMs: 60_000, max: 50 },
    passengerMaps: { windowMs: 60_000, max: 300 },
    passengerBooking: { windowMs: 60_000, max: 100 },
    passengerCancel: { windowMs: 60_000, max: 30 },
    passengerRecovery: { windowMs: 60_000, max: 200 },
    driver: { windowMs: 60_000, max: 600 },
    driverLocation: { windowMs: 60_000, max: 1_000 },
    driverOffer: { windowMs: 60_000, max: 300 },
    driverRecovery: { windowMs: 60_000, max: 200 },
    videoUpload: { windowMs: 60_000, max: 120 },
  },
  production: {
    global: { windowMs: 900_000, max: 100 },
    auth: { windowMs: 900_000, max: 50 },
    passengerMaps: { windowMs: 60_000, max: 60 },
    passengerBooking: { windowMs: 60_000, max: 20 },
    passengerCancel: { windowMs: 60_000, max: 10 },
    passengerRecovery: { windowMs: 60_000, max: 60 },
    driver: { windowMs: 900_000, max: 200 },
    driverLocation: { windowMs: 60_000, max: 20 },
    driverOffer: { windowMs: 60_000, max: 30 },
    driverRecovery: { windowMs: 60_000, max: 60 },
    videoUpload: { windowMs: 60_000, max: 30 },
  },
};

export function resolveRateLimitTier(): RateLimitTier {
  const nodeEnv = process.env.NODE_ENV?.trim() || 'development';
  if (nodeEnv === 'test') return 'test';
  if (nodeEnv === 'production') return 'production';
  if (nodeEnv === 'staging') return 'staging';
  return 'development';
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function bucket(
  windowEnv: string | undefined,
  maxEnv: string | undefined,
  defaults: RateLimitBucketConfig
): RateLimitBucketConfig {
  return {
    windowMs: parsePositiveInt(windowEnv, defaults.windowMs),
    max: parsePositiveInt(maxEnv, defaults.max),
  };
}

export function loadRateLimitConfig(): RateLimitConfig {
  const tier = resolveRateLimitTier();
  const tierDefaults =
    tier === 'test' ? TIER_DEFAULTS.development : TIER_DEFAULTS[tier];

  const enabled =
    tier === 'test'
      ? process.env.RATE_LIMIT_ENABLED === 'true'
      : process.env.RATE_LIMIT_ENABLED !== 'false';

  const useRedisStore =
    process.env.RATE_LIMIT_USE_REDIS === 'true' ||
    (tier === 'production' && process.env.RATE_LIMIT_USE_REDIS !== 'false' && Boolean(process.env.REDIS_URL));

  return {
    enabled,
    useRedisStore,
    tier,
    global: bucket(
      process.env.RATE_LIMIT_WINDOW_MS,
      process.env.RATE_LIMIT_MAX_REQUESTS,
      tierDefaults.global
    ),
    auth: bucket(
      process.env.AUTH_RATE_LIMIT_WINDOW_MS ?? process.env.RATE_LIMIT_WINDOW_MS,
      process.env.AUTH_RATE_LIMIT_MAX,
      tierDefaults.auth
    ),
    passengerMaps: bucket(
      process.env.PASSENGER_MAPS_RATE_LIMIT_WINDOW_MS ?? process.env.MAPS_RATE_LIMIT_WINDOW_MS,
      process.env.PASSENGER_MAPS_RATE_LIMIT_MAX ?? process.env.MAPS_RATE_LIMIT_MAX,
      tierDefaults.passengerMaps
    ),
    passengerBooking: bucket(
      process.env.BOOKING_RATE_LIMIT_WINDOW_MS ?? process.env.RATE_LIMIT_WINDOW_MS,
      process.env.BOOKING_RATE_LIMIT_MAX,
      tierDefaults.passengerBooking
    ),
    passengerCancel: bucket(
      process.env.PASSENGER_CANCEL_RATE_LIMIT_WINDOW_MS ?? process.env.CANCEL_RATE_LIMIT_WINDOW_MS,
      process.env.PASSENGER_CANCEL_RATE_LIMIT_MAX ?? process.env.CANCEL_RATE_LIMIT_MAX,
      tierDefaults.passengerCancel
    ),
    passengerRecovery: bucket(
      process.env.PASSENGER_RECOVERY_RATE_LIMIT_WINDOW_MS ?? process.env.RATE_LIMIT_WINDOW_MS,
      process.env.PASSENGER_RATE_LIMIT_MAX ?? process.env.PASSENGER_RECOVERY_RATE_LIMIT_MAX,
      tierDefaults.passengerRecovery
    ),
    driver: bucket(
      process.env.DRIVER_RATE_LIMIT_WINDOW_MS ?? process.env.RATE_LIMIT_WINDOW_MS,
      process.env.DRIVER_RATE_LIMIT_MAX,
      tierDefaults.driver
    ),
    driverLocation: bucket(
      process.env.DRIVER_LOCATION_RATE_LIMIT_WINDOW_MS,
      process.env.DRIVER_LOCATION_RATE_LIMIT_MAX,
      tierDefaults.driverLocation
    ),
    driverOffer: bucket(
      process.env.DRIVER_OFFER_RATE_LIMIT_WINDOW_MS,
      process.env.DRIVER_OFFER_RATE_LIMIT_MAX,
      tierDefaults.driverOffer
    ),
    driverRecovery: bucket(
      process.env.DRIVER_RECOVERY_RATE_LIMIT_WINDOW_MS ?? process.env.RATE_LIMIT_WINDOW_MS,
      process.env.DRIVER_RECOVERY_RATE_LIMIT_MAX,
      tierDefaults.driverRecovery
    ),
    videoUpload: bucket(
      process.env.VIDEO_UPLOAD_RATE_LIMIT_WINDOW_MS,
      process.env.VIDEO_UPLOAD_RATE_LIMIT_MAX,
      tierDefaults.videoUpload
    ),
  };
}

export const rateLimitConfig = loadRateLimitConfig();
