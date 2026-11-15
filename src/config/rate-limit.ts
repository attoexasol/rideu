/**
 * Centralized rate-limit configuration.
 * Env vars override tier defaults; production stays stricter than dev/staging.
 *
 * Global limiter is identity-aware:
 * - authenticated → per-user budget (passenger/driver do not share NAT IP quota)
 * - unauthenticated → strict IP budget
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
  /** Authenticated identity budget for the global limiter. */
  global: RateLimitBucketConfig;
  /** Unauthenticated IP budget for the global limiter (stricter). */
  globalUnauthenticated: RateLimitBucketConfig;
  auth: RateLimitBucketConfig;
  passengerMaps: RateLimitBucketConfig;
  passengerBooking: RateLimitBucketConfig;
  passengerBookingRead: RateLimitBucketConfig;
  passengerCancel: RateLimitBucketConfig;
  passengerRecovery: RateLimitBucketConfig;
  passengerCheckout: RateLimitBucketConfig;
  driver: RateLimitBucketConfig;
  driverLocation: RateLimitBucketConfig;
  driverOffer: RateLimitBucketConfig;
  driverRecovery: RateLimitBucketConfig;
  softMeter: RateLimitBucketConfig;
  videoUpload: RateLimitBucketConfig;
  profilePatch: RateLimitBucketConfig;
  avatarUpload: RateLimitBucketConfig;
  profileDeactivate: RateLimitBucketConfig;
  adminRideVideoList: RateLimitBucketConfig;
  adminRideVideoPlayback: RateLimitBucketConfig;
  adminRideVideoDownload: RateLimitBucketConfig;
  driverDocumentUpload: RateLimitBucketConfig;
  adminDriverDocument: RateLimitBucketConfig;
}

type TierDefaults = Omit<RateLimitConfig, 'enabled' | 'useRedisStore' | 'tier'>;

const TIER_DEFAULTS: Record<Exclude<RateLimitTier, 'test'>, TierDefaults> = {
  development: {
    global: { windowMs: 60_000, max: 5_000 },
    globalUnauthenticated: { windowMs: 60_000, max: 300 },
    auth: { windowMs: 60_000, max: 100 },
    passengerMaps: { windowMs: 60_000, max: 300 },
    passengerBooking: { windowMs: 60_000, max: 100 },
    passengerBookingRead: { windowMs: 60_000, max: 600 },
    passengerCancel: { windowMs: 60_000, max: 30 },
    passengerRecovery: { windowMs: 60_000, max: 300 },
    passengerCheckout: { windowMs: 60_000, max: 30 },
    driver: { windowMs: 60_000, max: 600 },
    driverLocation: { windowMs: 60_000, max: 1_000 },
    driverOffer: { windowMs: 60_000, max: 300 },
    driverRecovery: { windowMs: 60_000, max: 300 },
    softMeter: { windowMs: 60_000, max: 1_000 },
    videoUpload: { windowMs: 60_000, max: 120 },
    profilePatch: { windowMs: 900_000, max: 30 },
    avatarUpload: { windowMs: 3_600_000, max: 10 },
    profileDeactivate: { windowMs: 3_600_000, max: 3 },
    adminRideVideoList: { windowMs: 60_000, max: 300 },
    adminRideVideoPlayback: { windowMs: 60_000, max: 120 },
    adminRideVideoDownload: { windowMs: 60_000, max: 20 },
    driverDocumentUpload: { windowMs: 3_600_000, max: 20 },
    adminDriverDocument: { windowMs: 60_000, max: 120 },
  },
  staging: {
    global: { windowMs: 60_000, max: 1_200 },
    globalUnauthenticated: { windowMs: 60_000, max: 120 },
    auth: { windowMs: 60_000, max: 50 },
    passengerMaps: { windowMs: 60_000, max: 300 },
    passengerBooking: { windowMs: 60_000, max: 100 },
    passengerBookingRead: { windowMs: 60_000, max: 300 },
    passengerCancel: { windowMs: 60_000, max: 30 },
    passengerRecovery: { windowMs: 60_000, max: 200 },
    passengerCheckout: { windowMs: 60_000, max: 20 },
    driver: { windowMs: 60_000, max: 600 },
    driverLocation: { windowMs: 60_000, max: 1_000 },
    driverOffer: { windowMs: 60_000, max: 300 },
    driverRecovery: { windowMs: 60_000, max: 200 },
    softMeter: { windowMs: 60_000, max: 600 },
    videoUpload: { windowMs: 60_000, max: 120 },
    profilePatch: { windowMs: 900_000, max: 20 },
    avatarUpload: { windowMs: 3_600_000, max: 10 },
    profileDeactivate: { windowMs: 3_600_000, max: 3 },
    adminRideVideoList: { windowMs: 60_000, max: 200 },
    adminRideVideoPlayback: { windowMs: 60_000, max: 90 },
    adminRideVideoDownload: { windowMs: 60_000, max: 10 },
    driverDocumentUpload: { windowMs: 3_600_000, max: 20 },
    adminDriverDocument: { windowMs: 60_000, max: 90 },
  },
  production: {
    // Per authenticated identity (not shared NAT IP). ~1 req/s sustained headroom.
    global: { windowMs: 900_000, max: 900 },
    // Strict unauthenticated IP floor (enumeration / scraping).
    globalUnauthenticated: { windowMs: 900_000, max: 100 },
    auth: { windowMs: 900_000, max: 50 },
    passengerMaps: { windowMs: 60_000, max: 60 },
    passengerBooking: { windowMs: 60_000, max: 20 },
    // Booking detail / history reads during active ride tracking.
    passengerBookingRead: { windowMs: 60_000, max: 120 },
    passengerCancel: { windowMs: 60_000, max: 10 },
    passengerRecovery: { windowMs: 60_000, max: 60 },
    // Stripe Checkout / payment-link creation — keep strict.
    passengerCheckout: { windowMs: 60_000, max: 10 },
    driver: { windowMs: 900_000, max: 600 },
    // GPS every 5–10s ≈ 6–12/min; allow headroom without permitting abuse floods.
    driverLocation: { windowMs: 60_000, max: 30 },
    driverOffer: { windowMs: 60_000, max: 30 },
    driverRecovery: { windowMs: 60_000, max: 60 },
    // Soft Meter GPS batches, pause/resume, finalize under normal ride load.
    softMeter: { windowMs: 60_000, max: 180 },
    videoUpload: { windowMs: 60_000, max: 60 },
    profilePatch: { windowMs: 900_000, max: 20 },
    avatarUpload: { windowMs: 3_600_000, max: 10 },
    profileDeactivate: { windowMs: 86_400_000, max: 3 },
    adminRideVideoList: { windowMs: 60_000, max: 120 },
    adminRideVideoPlayback: { windowMs: 60_000, max: 60 },
    adminRideVideoDownload: { windowMs: 60_000, max: 5 },
    driverDocumentUpload: { windowMs: 3_600_000, max: 10 },
    adminDriverDocument: { windowMs: 60_000, max: 60 },
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
    globalUnauthenticated: bucket(
      process.env.RATE_LIMIT_UNAUTH_WINDOW_MS ?? process.env.RATE_LIMIT_WINDOW_MS,
      process.env.RATE_LIMIT_UNAUTH_MAX_REQUESTS,
      tierDefaults.globalUnauthenticated
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
    passengerBookingRead: bucket(
      process.env.PASSENGER_BOOKING_READ_RATE_LIMIT_WINDOW_MS ?? process.env.RATE_LIMIT_WINDOW_MS,
      process.env.PASSENGER_BOOKING_READ_RATE_LIMIT_MAX,
      tierDefaults.passengerBookingRead
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
    passengerCheckout: bucket(
      process.env.PASSENGER_CHECKOUT_RATE_LIMIT_WINDOW_MS ?? process.env.RATE_LIMIT_WINDOW_MS,
      process.env.PASSENGER_CHECKOUT_RATE_LIMIT_MAX,
      tierDefaults.passengerCheckout
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
    softMeter: bucket(
      process.env.SOFT_METER_RATE_LIMIT_WINDOW_MS,
      process.env.SOFT_METER_RATE_LIMIT_MAX,
      tierDefaults.softMeter
    ),
    videoUpload: bucket(
      process.env.VIDEO_UPLOAD_RATE_LIMIT_WINDOW_MS,
      process.env.VIDEO_UPLOAD_RATE_LIMIT_MAX,
      tierDefaults.videoUpload
    ),
    profilePatch: bucket(
      process.env.PROFILE_PATCH_RATE_LIMIT_WINDOW_MS,
      process.env.PROFILE_PATCH_RATE_LIMIT_MAX,
      tierDefaults.profilePatch
    ),
    avatarUpload: bucket(
      process.env.AVATAR_UPLOAD_RATE_LIMIT_WINDOW_MS,
      process.env.AVATAR_UPLOAD_RATE_LIMIT_MAX,
      tierDefaults.avatarUpload
    ),
    profileDeactivate: bucket(
      process.env.PROFILE_DEACTIVATE_RATE_LIMIT_WINDOW_MS,
      process.env.PROFILE_DEACTIVATE_RATE_LIMIT_MAX,
      tierDefaults.profileDeactivate
    ),
    adminRideVideoList: bucket(
      process.env.ADMIN_RIDE_VIDEO_LIST_RATE_LIMIT_WINDOW_MS,
      process.env.ADMIN_RIDE_VIDEO_LIST_RATE_LIMIT_MAX,
      tierDefaults.adminRideVideoList
    ),
    adminRideVideoPlayback: bucket(
      process.env.ADMIN_RIDE_VIDEO_PLAYBACK_RATE_LIMIT_WINDOW_MS,
      process.env.ADMIN_RIDE_VIDEO_PLAYBACK_RATE_LIMIT_MAX,
      tierDefaults.adminRideVideoPlayback
    ),
    adminRideVideoDownload: bucket(
      process.env.ADMIN_RIDE_VIDEO_DOWNLOAD_RATE_LIMIT_WINDOW_MS,
      process.env.ADMIN_RIDE_VIDEO_DOWNLOAD_RATE_LIMIT_MAX,
      tierDefaults.adminRideVideoDownload
    ),
    driverDocumentUpload: bucket(
      process.env.DRIVER_DOCUMENT_UPLOAD_RATE_LIMIT_WINDOW_MS,
      process.env.DRIVER_DOCUMENT_UPLOAD_RATE_LIMIT_MAX,
      tierDefaults.driverDocumentUpload
    ),
    adminDriverDocument: bucket(
      process.env.ADMIN_DRIVER_DOCUMENT_RATE_LIMIT_WINDOW_MS,
      process.env.ADMIN_DRIVER_DOCUMENT_RATE_LIMIT_MAX,
      tierDefaults.adminDriverDocument
    ),
  };
}

export const rateLimitConfig = loadRateLimitConfig();
