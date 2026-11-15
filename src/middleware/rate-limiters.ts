import type { Request } from 'express';
import { rateLimitConfig } from '../config/rate-limit';
import { shouldSkipGlobalRateLimit } from './rate-limit-paths';
import {
  createRateLimiter,
  keyByAuthenticatedOrIp,
  keyByCustomer,
  keyByDriver,
  keyByIp,
} from './create-rate-limiter';

/**
 * Global API fallback.
 * Authenticated requests are keyed by stable identity (not shared NAT IP).
 * Unauthenticated requests use a stricter IP budget.
 * Routes with dedicated limiters are skipped via shouldSkipGlobalRateLimit.
 */
export const globalRateLimiter = createRateLimiter({
  name: 'global',
  bucket: rateLimitConfig.global,
  unauthenticatedBucket: rateLimitConfig.globalUnauthenticated,
  keyGenerator: keyByAuthenticatedOrIp,
  skip: (req) => shouldSkipGlobalRateLimit(req.path),
});

export const authRateLimiter = createRateLimiter({
  name: 'auth',
  bucket: rateLimitConfig.auth,
  keyGenerator: keyByIp,
});

export const passengerMapsRateLimit = createRateLimiter({
  name: 'passenger_maps',
  bucket: rateLimitConfig.passengerMaps,
  keyGenerator: keyByCustomer,
});

export const passengerBookingRateLimit = createRateLimiter({
  name: 'passenger_booking',
  bucket: rateLimitConfig.passengerBooking,
  keyGenerator: keyByCustomer,
});

/** Booking detail / history reads during ride tracking. */
export const passengerBookingReadRateLimit = createRateLimiter({
  name: 'passenger_booking_read',
  bucket: rateLimitConfig.passengerBookingRead,
  keyGenerator: keyByCustomer,
});

export const passengerBookingCancelRateLimit = createRateLimiter({
  name: 'passenger_cancel',
  bucket: rateLimitConfig.passengerCancel,
  keyGenerator: (req: Request) => {
    const userId = (req as any).user?.userId;
    const bookingId = req.params?.bookingId;
    return userId && bookingId
      ? `cancel:${userId}:${bookingId}`
      : keyByCustomer(req);
  },
  skipSuccessfulRequests: true,
});

export const passengerRecoveryRateLimit = createRateLimiter({
  name: 'passenger_recovery',
  bucket: rateLimitConfig.passengerRecovery,
  keyGenerator: keyByCustomer,
});

/** Stripe Checkout / payment-link creation — strict financial protection. */
export const passengerCheckoutRateLimit = createRateLimiter({
  name: 'passenger_checkout',
  bucket: rateLimitConfig.passengerCheckout,
  keyGenerator: keyByCustomer,
});

/** Driver-initiated Soft Meter payment-link / Checkout creation. */
export const driverCheckoutRateLimit = createRateLimiter({
  name: 'driver_checkout',
  bucket: rateLimitConfig.passengerCheckout,
  keyGenerator: keyByDriver,
});

export const driverLocationRateLimit = createRateLimiter({
  name: 'driver_location',
  bucket: rateLimitConfig.driverLocation,
  keyGenerator: keyByDriver,
});

export const driverOfferRateLimit = createRateLimiter({
  name: 'driver_offer',
  bucket: rateLimitConfig.driverOffer,
  keyGenerator: keyByDriver,
});

export const driverRecoveryRateLimit = createRateLimiter({
  name: 'driver_recovery',
  bucket: rateLimitConfig.driverRecovery,
  keyGenerator: keyByDriver,
});

export const driverGeneralRateLimit = createRateLimiter({
  name: 'driver_general',
  bucket: rateLimitConfig.driver,
  keyGenerator: keyByDriver,
});

/** Soft Meter GPS batches, pause/resume, finalize, walk-up meter ops. */
export const softMeterRateLimit = createRateLimiter({
  name: 'soft_meter',
  bucket: rateLimitConfig.softMeter,
  keyGenerator: keyByDriver,
});

export const videoUploadRateLimit = createRateLimiter({
  name: 'video_upload',
  bucket: rateLimitConfig.videoUpload,
  keyGenerator: keyByDriver,
});

export function keyByAccount(req: Request): string {
  const userId =
    (req as any).user?.userId ||
    (req as any).user?.auth0Id ||
    req.rateLimitIdentity?.userId;
  const role =
    (req as any).user?.role ||
    req.rateLimitIdentity?.role ||
    'user';
  return userId ? `profile:${role}:${userId}` : keyByIp(req);
}

export const profilePatchRateLimit = createRateLimiter({
  name: 'profile_patch',
  bucket: rateLimitConfig.profilePatch,
  keyGenerator: keyByAccount,
});

export const avatarUploadRateLimit = createRateLimiter({
  name: 'avatar_upload',
  bucket: rateLimitConfig.avatarUpload,
  keyGenerator: keyByAccount,
});

export const profileDeactivateRateLimit = createRateLimiter({
  name: 'profile_deactivate',
  bucket: rateLimitConfig.profileDeactivate,
  keyGenerator: keyByAccount,
});

export function keyByAdmin(req: Request): string {
  const userId = (req as any).user?.userId || (req as any).user?.auth0Id;
  return userId ? `admin:${userId}` : keyByIp(req);
}

export const adminRideVideoListRateLimit = createRateLimiter({
  name: 'admin_ride_video_list',
  bucket: rateLimitConfig.adminRideVideoList,
  keyGenerator: keyByAdmin,
});

export const adminRideVideoPlaybackRateLimit = createRateLimiter({
  name: 'admin_ride_video_playback',
  bucket: rateLimitConfig.adminRideVideoPlayback,
  keyGenerator: (req: Request) => {
    const adminKey = keyByAdmin(req);
    const sessionId = req.params?.sessionId;
    return sessionId ? `${adminKey}:session:${sessionId}` : adminKey;
  },
});

export const adminRideVideoDownloadRateLimit = createRateLimiter({
  name: 'admin_ride_video_download',
  bucket: rateLimitConfig.adminRideVideoDownload,
  keyGenerator: keyByAdmin,
});

export const driverDocumentUploadRateLimit = createRateLimiter({
  name: 'driver_document_upload',
  bucket: rateLimitConfig.driverDocumentUpload,
  keyGenerator: keyByDriver,
});

export const adminDriverDocumentRateLimit = createRateLimiter({
  name: 'admin_driver_document',
  bucket: rateLimitConfig.adminDriverDocument,
  keyGenerator: keyByAdmin,
});
