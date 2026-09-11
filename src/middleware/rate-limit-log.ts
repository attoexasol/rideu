import type { Request } from 'express';
import type { Options } from 'express-rate-limit';
import {
  isRateLimitDebugEnabled,
  logRateLimitExceededDebug,
  resolveUserRole,
} from './rate-limit-debug';

export function logRateLimitExceeded(
  limiterName: string,
  req: Request,
  options: Options & { resetTime?: Date },
  debugContext?: {
    key: string;
    limit: number;
    windowMs: number;
    currentCount?: number;
  }
): void {
  const resetTime = options.resetTime;
  const retryAfterSec =
    resetTime instanceof Date
      ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
      : undefined;

  console.warn('[RateLimit] exceeded', {
    limiter: limiterName,
    method: req.method,
    path: req.path,
    status: 429,
    retryAfter: retryAfterSec,
    userRole: resolveUserRole(req),
    requestId: req.headers['x-request-id'] ?? undefined,
  });

  if (isRateLimitDebugEnabled() && debugContext) {
    logRateLimitExceededDebug(req, {
      limiter: limiterName,
      key: debugContext.key,
      limit: debugContext.limit,
      windowMs: debugContext.windowMs,
      currentCount: debugContext.currentCount,
    });
  }
}
