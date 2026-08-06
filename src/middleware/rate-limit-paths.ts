/**
 * Paths excluded from the global API rate limiter.
 * Each skipped route must have its own dedicated limiter (or be health/unauthenticated).
 */
const GLOBAL_RATE_LIMIT_SKIP_PATTERNS: RegExp[] = [
  /^\/health$/,
  /^\/api\/health$/,
  /^\/api\/locations$/,
  /^\/api\/auth\//,
  /^\/api\/v1\/passenger\/places\//,
  /^\/api\/v1\/passenger\/pickup-spots$/,
  /^\/api\/v1\/passenger\/routes\//,
  /^\/api\/v1\/passenger\/bookings\/quote$/,
  /^\/api\/v1\/passenger\/bookings$/,
  /^\/api\/v1\/passenger\/bookings\/active$/,
  /^\/api\/v1\/passenger\/bookings\/[0-9a-f-]{36}\/cancel$/i,
  /^\/api\/v1\/driver\/bookings(\/|$)/,
  /^\/api\/v1\/admin\/ride-videos(\/|$)/,
  /^\/api\/v1\/admin\/bookings\/[0-9a-f-]{36}\/ride-video$/i,
];

export function shouldSkipGlobalRateLimit(path: string): boolean {
  const normalized = (path.split('?')[0] || '/').replace(/\/$/, '') || '/';
  return GLOBAL_RATE_LIMIT_SKIP_PATTERNS.some((pattern) => pattern.test(normalized));
}
