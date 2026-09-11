import rateLimit, {
  type Options,
  type RateLimitExceededEventHandler,
  type RateLimitRequestHandler,
} from 'express-rate-limit';
import type { Request } from 'express';
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
  const userId = (req as any).user?.userId;
  return userId ? `customer:${userId}` : `ip:${req.ip ?? 'unknown'}`;
}

export function keyByDriver(req: Request): string {
  const userId = (req as any).user?.userId;
  return userId ? `driver:${userId}` : `ip:${req.ip ?? 'unknown'}`;
}

export function keyByIp(req: Request): string {
  return `ip:${req.ip ?? 'unknown'}`;
}

function createRedisStore(prefix: string) {
  return new RedisRateLimitStore(prefix);
}

export interface CreateRateLimiterOptions {
  name: string;
  bucket: RateLimitBucketConfig;
  keyGenerator?: (req: Request) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  skip?: (req: Request) => boolean;
}

export function createRateLimiter(options: CreateRateLimiterOptions): RateLimitRequestHandler {
  const {
    name,
    bucket,
    keyGenerator = keyByIp,
    skipSuccessfulRequests,
    skipFailedRequests,
    skip: customSkip,
  } = options;

  const limiterOptions: Partial<Options> = {
    windowMs: bucket.windowMs,
    max: bucket.max,
    standardHeaders: true,
    legacyHeaders: false,
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
      logRateLimitExceeded(name, req, handlerOptions, {
        key: resolvedKey,
        limit: bucket.max,
        windowMs: bucket.windowMs,
        currentCount: rateLimitInfo?.current,
      });
      const resetTime = (handlerOptions as { resetTime?: Date }).resetTime;
      let retryAfterSeconds: number | undefined;
      if (resetTime instanceof Date) {
        retryAfterSeconds = Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
      } else {
        // Fallback to window length when resetTime is unavailable.
        retryAfterSeconds = Math.max(1, Math.ceil(bucket.windowMs / 1000));
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

  return rateLimit(limiterOptions);
}
