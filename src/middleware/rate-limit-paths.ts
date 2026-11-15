/**
 * Paths excluded from the global API rate limiter.
 * Each skipped route must have its own dedicated limiter (or be health/webhook).
 */
const GLOBAL_RATE_LIMIT_SKIP_PATTERNS: RegExp[] = [
  /^\/health$/,
  /^\/api\/health$/,
  /^\/meter\/payment\/(return|cancel)$/,
  /^\/api\/locations$/,
  /^\/api\/auth\//,
  /^\/api\/v1\/passenger\/places\//,
  /^\/api\/v1\/passenger\/pickup-spots$/,
  /^\/api\/v1\/passenger\/routes\//,
  /^\/api\/v1\/passenger\/bookings\/quote$/,
  /^\/api\/v1\/passenger\/bookings$/,
  /^\/api\/v1\/passenger\/bookings\/active$/,
  /^\/api\/v1\/passenger\/bookings\/unpaid-meter-payment$/,
  /^\/api\/v1\/passenger\/bookings\/[0-9a-f-]{36}$/i,
  /^\/api\/v1\/passenger\/bookings\/[0-9a-f-]{36}\/cancel$/i,
  /^\/api\/v1\/passenger\/bookings\/[0-9a-f-]{36}\/meter$/i,
  /^\/api\/v1\/passenger\/bookings\/[0-9a-f-]{36}\/meter-payment(\/|$)/i,
  /^\/api\/v1\/passenger\/push-token$/,
  /^\/api\/v1\/driver\/bookings(\/|$)/,
  /^\/api\/v1\/driver\/meter(\/|$)/,
  /^\/api\/v1\/driver\/walk-up(\/|$)/,
  /^\/api\/v1\/driver\/video(\/|$)/,
  /^\/api\/v1\/driver\/duty(\/|$)/,
  /^\/api\/v1\/driver\/vehicle-exchanges(\/|$)/,
  /^\/api\/v1\/driver\/profile(\/|$)/,
  /^\/api\/v1\/driver\/documents(\/|$)/,
  /^\/api\/v1\/driver\/payouts(\/|$)/,
  /^\/api\/v1\/driver\/payments(\/|$)/,
  /^\/api\/v1\/passenger\/profile(\/|$)/,
  /^\/api\/v1\/admin\/ride-videos(\/|$)/,
  /^\/api\/v1\/admin\/fleet\/drivers\/[0-9a-f-]{36}\/documents(\/|$)/i,
  /^\/api\/v1\/admin\/bookings\/[0-9a-f-]{36}\/ride-video$/i,
  /^\/api\/v1\/webhooks\/stripe$/,
  /^\/api\/v1\/config\/payments$/,
  /^\/api\/v1\/passenger\/bookings\/[0-9a-f-]{36}\/payment$/i,
];

export function shouldSkipGlobalRateLimit(path: string): boolean {
  const normalized = (path.split('?')[0] || '/').replace(/\/$/, '') || '/';
  return GLOBAL_RATE_LIMIT_SKIP_PATTERNS.some((pattern) => pattern.test(normalized));
}
