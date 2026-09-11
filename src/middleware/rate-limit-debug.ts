/**
 * Development-only rate-limit diagnostics.
 * Remove this module and its mount in src/index.ts when debugging is complete.
 */

import type { Request, Response, NextFunction } from 'express';
import { resolveRateLimitTier } from '../config/rate-limit';

const DEBUG_PREFIX = '[RATE_LIMIT_DEBUG]';
const LOG_INTERVAL_MS = 30_000;

type EndpointKey = `${string} ${string}`;

const endpointCounts = new Map<EndpointKey, number>();
let logTimer: NodeJS.Timeout | undefined;

export function isRateLimitDebugEnabled(): boolean {
  return resolveRateLimitTier() === 'development';
}

export function maskRateLimitKey(key: string): string {
  if (key.startsWith('ip:')) {
    const ip = key.slice(3);
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `ip:${parts[0]}.${parts[1]}.${parts[2]}.***`;
    }
    return 'ip:***';
  }

  const colonIdx = key.indexOf(':');
  if (colonIdx === -1) {
    return key.length <= 8 ? '***' : `${key.slice(0, 4)}…${key.slice(-4)}`;
  }

  const prefix = key.slice(0, colonIdx);
  const value = key.slice(colonIdx + 1);
  if (value.length <= 8) {
    return `${prefix}:***`;
  }
  return `${prefix}:${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function inferKeyType(key: string): string {
  if (key.startsWith('customer:')) return 'customer';
  if (key.startsWith('driver:')) return 'driver';
  if (key.startsWith('ip:')) return 'ip';
  if (key.startsWith('profile:')) return 'profile';
  if (key.startsWith('admin:')) return 'admin';
  if (key.startsWith('cancel:')) return 'customer+booking';
  return 'unknown';
}

export function resolveUserRole(req: Request): string {
  const user = (req as Request & { user?: { role?: string; userType?: string } }).user;
  const role = user?.role ?? user?.userType;
  if (role === 'customer') return 'passenger';
  if (role === 'driver') return 'driver';
  if (role === 'admin' || role === 'super_admin') return 'admin';
  return role ?? 'unknown';
}

function normalizePath(path: string): string {
  return (path.split('?')[0] || '/').replace(/\/$/, '') || '/';
}

function flushEndpointCounts(): void {
  if (endpointCounts.size === 0) return;

  const sorted = [...endpointCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [endpoint, count] of sorted) {
    console.info(`${DEBUG_PREFIX} ${endpoint} count=${count}`);
  }
  endpointCounts.clear();
}

function scheduleEndpointCountFlush(): void {
  if (logTimer) return;
  logTimer = setInterval(() => {
    flushEndpointCounts();
  }, LOG_INTERVAL_MS);
  logTimer.unref();
}

/**
 * Counts requests per method+path in development and logs aggregates every 30s.
 */
export function rateLimitRequestCounter(req: Request, _res: Response, next: NextFunction): void {
  if (!isRateLimitDebugEnabled()) {
    next();
    return;
  }

  const endpoint = `${req.method} ${normalizePath(req.path)}` as EndpointKey;
  endpointCounts.set(endpoint, (endpointCounts.get(endpoint) ?? 0) + 1);
  scheduleEndpointCountFlush();
  next();
}

/** For tests and graceful shutdown — flushes pending counts immediately. */
export function flushRateLimitDebugCounts(): void {
  flushEndpointCounts();
}

/** For tests — resets counter state. */
export function resetRateLimitDebugCounters(): void {
  endpointCounts.clear();
  if (logTimer) {
    clearInterval(logTimer);
    logTimer = undefined;
  }
}

export interface RateLimitExceededDebugContext {
  limiter: string;
  key: string;
  limit: number;
  windowMs: number;
  currentCount?: number;
}

export function logRateLimitExceededDebug(
  req: Request,
  context: RateLimitExceededDebugContext
): void {
  const maskedKey = maskRateLimitKey(context.key);
  const keyType = inferKeyType(context.key);

  console.warn(`${DEBUG_PREFIX} 429 triggered`);
  console.warn(`${DEBUG_PREFIX} method=${req.method}`);
  console.warn(`${DEBUG_PREFIX} path=${normalizePath(req.path)}`);
  console.warn(`${DEBUG_PREFIX} limiter=${context.limiter}`);
  console.warn(`${DEBUG_PREFIX} keyType=${keyType}`);
  console.warn(`${DEBUG_PREFIX} key=${maskedKey}`);
  console.warn(`${DEBUG_PREFIX} limit=${context.limit}`);
  console.warn(`${DEBUG_PREFIX} windowMs=${context.windowMs}`);
  console.warn(
    `${DEBUG_PREFIX} currentCount=${context.currentCount ?? 'unknown'}`
  );
  console.warn(`${DEBUG_PREFIX} userRole=${resolveUserRole(req)}`);
}
