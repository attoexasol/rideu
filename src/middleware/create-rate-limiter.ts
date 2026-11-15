import rateLimit, {
  type Options,
  type RateLimitExceededEventHandler,
  type RateLimitRequestHandler,
  type ValueDeterminingMiddleware,
} from 'express-rate-limit';
import type { Request, Response } from 'express';
import { rateLimitConfig, type RateLimitBucketConfig } from '../config/rate-limit';
import { logRateLimitExceeded } from './rate-limit-log';
import { RedisRateLimitStore } from './redis-rate-limit-store';

export const RATE_LIMIT_RESPONSE = {
  success: false,
  error: {
    code: 'RATE_LIMITED',
    message: 'Too many requests. Please try again shortly.',
    retryable: true,
    details: null,
  },
} as const;

export function keyByCustomer(req: Request): string {
  const userId =
    (req as any).user?.userId ||
    req.rateLimitIdentity?.userId;
  return userId ? `customer:${userId}` : `ip:${req.ip ?? 'unknown'}`;
}

export function keyByDriver(req: Request): string {
  const userId =
    (req as any).user?.userId ||
    req.rateLimitIdentity?.userId;
  return userId ? `driver:${userId}` : `ip:${req.ip ?? 'unknown'}`;
}

export function keyByIp(req: Request): string {
  return `ip:${req.ip ?? 'unknown'}`;
}

/**
 * Global key: authenticated identity when available, otherwise IP.
 * Passenger and driver identities never share a counter even behind the same NAT.
 */
export function keyByAuthenticatedOrIp(req: Request): string {
  const identity = req.rateLimitIdentity;
  if (identity?.userId) {
    const role = identity.role || 'user';
    return `auth:${role}:${identity.userId}`;
  }
  const user = (req as any).user;
  if (user?.userId) {
    const role =
      user.role === 'customer' ? 'passenger' : user.role || user.userType || 'user';
    return `auth:${role}:${user.userId}`;
  }
  return keyByIp(req);
}

export function isAuthenticatedRateLimitRequest(req: Request): boolean {
  return Boolean(
    req.rateLimitIdentity?.userId ||
      (req as any).user?.userId ||
      (req as any).user?.auth0Id
  );
}

function createRedisStore(prefix: string) {
  return new RedisRateLimitStore(prefix);
}

export interface CreateRateLimiterOptions {
  name: string;
  bucket: RateLimitBucketConfig;
  /** Optional alternate bucket when the request is unauthenticated (global limiter). */
  unauthenticatedBucket?: RateLimitBucketConfig;
  keyGenerator?: (req: Request) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  skip?: (req: Request) => boolean;
}

export function createRateLimiter(options: CreateRateLimiterOptions): RateLimitRequestHandler {
  const {
    name,
    bucket,
    unauthenticatedBucket,
    keyGenerator = keyByIp,
    skipSuccessfulRequests,
    skipFailedRequests,
    skip: customSkip,
  } = options;

  const resolveBucket = (req: Request): RateLimitBucketConfig => {
    if (unauthenticatedBucket && !isAuthenticatedRateLimitRequest(req)) {
      return unauthenticatedBucket;
    }
    return bucket;
  };

  const maxFn: ValueDeterminingMiddleware<number> = (req) => resolveBucket(req).max;

  const limiterOptions: Partial<Options> = {
    windowMs: bucket.windowMs,
    max: maxFn,
    standardHeaders: true,
    legacyHeaders: false,
    // Custom keyGenerator: authenticated identity keys intentionally omit IP.
    keyGenerator,
    skip: (req) => {
      if (!rateLimitConfig.enabled) return true;
      if (customSkip?.(req)) return true;
      return false;
    },
    skipSuccessfulRequests,
    skipFailedRequests,
    handler: ((req, res, _next, handlerOptions) => {
      const rateLimitInfo = (req as Request & { rateLimit?: { current?: number; limit?: number } })
        .rateLimit;
      const resolvedKey = keyGenerator(req);
      const activeBucket = resolveBucket(req);
      logRateLimitExceeded(name, req, handlerOptions, {
        key: resolvedKey,
        limit: activeBucket.max,
        windowMs: activeBucket.windowMs,
        currentCount: rateLimitInfo?.current,
      });
      const resetTime = (handlerOptions as { resetTime?: Date }).resetTime;
      let retryAfterSeconds: number | undefined;
      if (resetTime instanceof Date) {
        retryAfterSeconds = Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
      } else {
        retryAfterSeconds = Math.max(1, Math.ceil(activeBucket.windowMs / 1000));
      }
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please try again shortly.',
          retryable: true,
          details: { retryAfterSeconds },
        },
      });
    }) as RateLimitExceededEventHandler,
  };

  if (rateLimitConfig.useRedisStore) {
    limiterOptions.store = createRedisStore(name);
  }

  // When unauthenticated window differs, prefer the longer window for store TTL safety.
  if (unauthenticatedBucket && unauthenticatedBucket.windowMs !== bucket.windowMs) {
    limiterOptions.windowMs = Math.max(bucket.windowMs, unauthenticatedBucket.windowMs);
  }

  return rateLimit(limiterOptions);
}

/** Resolve which policy label applies for diagnostics. */
export function resolveGlobalRateLimitPolicy(req: Request): string {
  return isAuthenticatedRateLimitRequest(req) ? 'global_authenticated' : 'global_unauthenticated';
}

export function resolveGlobalRateLimitBucket(req: Request): RateLimitBucketConfig {
  if (isAuthenticatedRateLimitRequest(req)) {
    return rateLimitConfig.global;
  }
  return rateLimitConfig.globalUnauthenticated;
}

export type { Response };
