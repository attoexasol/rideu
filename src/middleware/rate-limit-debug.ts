/**
 * Development-only rate-limit diagnostics.
 * Safe counters: endpoint, method, role, IP (masked), policy, 429 counts.
 * Never logs JWTs, Stripe secrets, or request bodies.
 */

import type { Request, Response, NextFunction } from 'express';
import { resolveRateLimitTier } from '../config/rate-limit';

function hasRateLimitIdentity(req: Request): boolean {
  return Boolean(
    req.rateLimitIdentity?.userId ||
      (req as Request & { user?: { userId?: string; auth0Id?: string } }).user?.userId ||
      (req as Request & { user?: { userId?: string; auth0Id?: string } }).user?.auth0Id
  );
}

function resolveGlobalPolicy(req: Request): string {
  return hasRateLimitIdentity(req) ? 'global_authenticated' : 'global_unauthenticated';
}

const DEBUG_PREFIX = '[RATE_LIMIT_DEBUG]';
const LOG_INTERVAL_MS = 30_000;

type EndpointKey = `${string} ${string}`;

interface EndpointStats {
  count: number;
  byRole: Map<string, number>;
  byPolicy: Map<string, number>;
  limited429: number;
}

const endpointStats = new Map<EndpointKey, EndpointStats>();
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

export function maskIp(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const parts = ip.split('.');
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.***`;
  }
  if (ip.includes(':')) {
    return 'ipv6:***';
  }
  return '***';
}

export function inferKeyType(key: string): string {
  if (key.startsWith('customer:')) return 'customer';
  if (key.startsWith('driver:')) return 'driver';
  if (key.startsWith('auth:')) return 'authenticated';
  if (key.startsWith('ip:')) return 'ip';
  if (key.startsWith('profile:')) return 'profile';
  if (key.startsWith('admin:')) return 'admin';
  if (key.startsWith('cancel:')) return 'customer+booking';
  return 'unknown';
}

export function resolveUserRole(req: Request): string {
  const identityRole = req.rateLimitIdentity?.role;
  if (identityRole === 'passenger' || identityRole === 'customer') return 'passenger';
  if (identityRole === 'driver') return 'driver';
  if (identityRole === 'admin' || identityRole === 'super_admin') return 'admin';

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

function getOrCreateStats(endpoint: EndpointKey): EndpointStats {
  let stats = endpointStats.get(endpoint);
  if (!stats) {
    stats = { count: 0, byRole: new Map(), byPolicy: new Map(), limited429: 0 };
    endpointStats.set(endpoint, stats);
  }
  return stats;
}

function flushEndpointCounts(): void {
  if (endpointStats.size === 0) return;

  const sorted = [...endpointStats.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [endpoint, stats] of sorted) {
    const roles = [...stats.byRole.entries()]
      .map(([role, n]) => `${role}=${n}`)
      .join(',');
    const policies = [...stats.byPolicy.entries()]
      .map(([policy, n]) => `${policy}=${n}`)
      .join(',');
    console.info(
      `${DEBUG_PREFIX} ${endpoint} count=${stats.count} roles={${roles}} policies={${policies}} limited429=${stats.limited429}`
    );
  }
  endpointStats.clear();
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
  const stats = getOrCreateStats(endpoint);
  stats.count += 1;

  const role = resolveUserRole(req);
  stats.byRole.set(role, (stats.byRole.get(role) ?? 0) + 1);

  const policy = resolveGlobalPolicy(req);
  stats.byPolicy.set(policy, (stats.byPolicy.get(policy) ?? 0) + 1);

  scheduleEndpointCountFlush();
  next();
}

/** For tests and graceful shutdown — flushes pending counts immediately. */
export function flushRateLimitDebugCounts(): void {
  flushEndpointCounts();
}

/** For tests — resets counter state. */
export function resetRateLimitDebugCounters(): void {
  endpointStats.clear();
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
  const endpoint = `${req.method} ${normalizePath(req.path)}` as EndpointKey;
  const stats = getOrCreateStats(endpoint);
  stats.limited429 += 1;

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
  console.warn(`${DEBUG_PREFIX} ip=${maskIp(req.ip)}`);
  console.warn(
    `${DEBUG_PREFIX} policy=${
      context.limiter === 'global' ? resolveGlobalPolicy(req) : context.limiter
    }`
  );
}
