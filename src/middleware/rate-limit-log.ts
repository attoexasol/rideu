import type { Request } from 'express';
import type { Options } from 'express-rate-limit';

export function logRateLimitExceeded(
  limiterName: string,
  req: Request,
  options: Options & { resetTime?: Date }
): void {
  const resetTime = options.resetTime;
  const retryAfterSec =
    resetTime instanceof Date
      ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
      : undefined;

  const user = (req as any).user;
  console.warn('[RateLimit] exceeded', {
    limiter: limiterName,
    method: req.method,
    path: req.path,
    status: 429,
    retryAfter: retryAfterSec,
    userRole: user?.role ?? user?.userType ?? 'anonymous',
    requestId: req.headers['x-request-id'] ?? undefined,
  });
}
