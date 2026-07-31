import type { Request } from 'express';
import { rateLimitConfig } from '../config/rate-limit';
import { shouldSkipGlobalRateLimit } from './rate-limit-paths';
import { createRateLimiter, keyByCustomer, keyByDriver, keyByIp } from './create-rate-limiter';

/** Global API fallback — skipped for routes with dedicated limiters. */
export const globalRateLimiter = createRateLimiter({
  name: 'global',
  bucket: rateLimitConfig.global,
  keyGenerator: keyByIp,
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

export const videoUploadRateLimit = createRateLimiter({
  name: 'video_upload',
  bucket: rateLimitConfig.videoUpload,
  keyGenerator: keyByDriver,
});
