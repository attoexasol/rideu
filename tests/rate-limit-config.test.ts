/**
 * Rate limit configuration and middleware tests.
 */

import type { Request } from 'express';
import {
  loadRateLimitConfig,
  resolveRateLimitTier,
  type RateLimitTier,
} from '../src/config/rate-limit';
import { shouldSkipGlobalRateLimit } from '../src/middleware/rate-limit-paths';
import {
  keyByAuthenticatedOrIp,
  keyByCustomer,
  keyByDriver,
  keyByIp,
  RATE_LIMIT_RESPONSE,
} from '../src/middleware/create-rate-limiter';

function loadConfigForTier(tier: RateLimitTier, overrides: Record<string, string> = {}) {
  const saved = { ...process.env };
  process.env.NODE_ENV = tier === 'test' ? 'test' : tier;
  delete process.env.RATE_LIMIT_ENABLED;
  for (const key of Object.keys(overrides)) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }
  const config = loadRateLimitConfig();
  process.env = saved;
  return config;
}

function mockReq(partial: Partial<Request> & { user?: any; ip?: string } = {}): Request {
  return {
    method: partial.method ?? 'GET',
    path: partial.path ?? '/',
    originalUrl: partial.originalUrl ?? partial.path ?? '/',
    ip: partial.ip ?? '127.0.0.1',
    headers: partial.headers ?? {},
    params: partial.params ?? {},
    ...partial,
    user: partial.user,
  } as Request;
}

describe('resolveRateLimitTier', () => {
  it('maps NODE_ENV to tier', () => {
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = 'staging';
    expect(resolveRateLimitTier()).toBe('staging');
    process.env.NODE_ENV = saved;
  });
});

describe('tier defaults', () => {
  it('production limits are stricter than development', () => {
    const dev = loadConfigForTier('development');
    const prod = loadConfigForTier('production');
    expect(prod.global.max).toBeLessThan(dev.global.max);
    expect(prod.passengerMaps.max).toBeLessThan(dev.passengerMaps.max);
    expect(prod.driverLocation.max).toBeLessThan(dev.driverLocation.max);
    expect(prod.passengerBooking.max).toBeLessThan(dev.passengerBooking.max);
    expect(prod.auth.max).toBeLessThanOrEqual(dev.auth.max);
  });

  it('staging limits are higher than production for QA', () => {
    const staging = loadConfigForTier('staging');
    const prod = loadConfigForTier('production');
    expect(staging.global.max).toBeGreaterThan(prod.global.max);
    expect(staging.driverLocation.max).toBeGreaterThan(prod.driverLocation.max);
    expect(staging.passengerMaps.max).toBeGreaterThan(prod.passengerMaps.max);
  });

  it('disables limiters in test by default', () => {
    const testConfig = loadConfigForTier('test');
    expect(testConfig.enabled).toBe(false);
  });

  it('allows env overrides per bucket', () => {
    const config = loadConfigForTier('production', {
      DRIVER_LOCATION_RATE_LIMIT_MAX: '999',
      RATE_LIMIT_ENABLED: 'true',
    });
    expect(config.driverLocation.max).toBe(999);
    expect(config.enabled).toBe(true);
  });
});

describe('driver GPS allowance', () => {
  it('supports continuous 5-second updates in development', () => {
    const dev = loadConfigForTier('development');
    const perMinuteAt5s = 60 / 5;
    expect(dev.driverLocation.max).toBeGreaterThanOrEqual(perMinuteAt5s);
  });

  it('production driver location allows at least 12 requests per minute', () => {
    const prod = loadConfigForTier('production');
    expect(prod.driverLocation.max).toBeGreaterThanOrEqual(12);
    expect(prod.driverLocation.windowMs).toBe(60_000);
  });

  it('production authenticated global budget exceeds unauthenticated IP budget', () => {
    const prod = loadConfigForTier('production');
    expect(prod.global.max).toBeGreaterThan(prod.globalUnauthenticated.max);
    expect(prod.globalUnauthenticated.max).toBeLessThanOrEqual(100);
  });
});

describe('global rate limit skip paths', () => {
  it('skips driver GPS endpoint', () => {
    expect(shouldSkipGlobalRateLimit('/api/locations')).toBe(true);
  });

  it('skips passenger booking create, active restore, and booking detail', () => {
    expect(shouldSkipGlobalRateLimit('/api/v1/passenger/bookings')).toBe(true);
    expect(shouldSkipGlobalRateLimit('/api/v1/passenger/bookings/active')).toBe(true);
    expect(
      shouldSkipGlobalRateLimit('/api/v1/passenger/bookings/88683ab3-01d8-47af-a52f-c45363a43fa0')
    ).toBe(true);
  });

  it('skips passenger cancel endpoint', () => {
    expect(
      shouldSkipGlobalRateLimit(
        '/api/v1/passenger/bookings/88683ab3-01d8-47af-a52f-c45363a43fa0/cancel'
      )
    ).toBe(true);
  });

  it('skips maps proxy endpoints', () => {
    expect(shouldSkipGlobalRateLimit('/api/v1/passenger/places/autocomplete')).toBe(true);
    expect(shouldSkipGlobalRateLimit('/api/v1/passenger/routes/preview')).toBe(true);
    expect(shouldSkipGlobalRateLimit('/api/v1/passenger/bookings/quote')).toBe(true);
  });

  it('skips all driver booking endpoints', () => {
    expect(shouldSkipGlobalRateLimit('/api/v1/driver/bookings/active')).toBe(true);
    expect(shouldSkipGlobalRateLimit('/api/v1/driver/bookings/offers/pending')).toBe(true);
    expect(
      shouldSkipGlobalRateLimit(
        '/api/v1/driver/bookings/88683ab3-01d8-47af-a52f-c45363a43fa0/accept'
      )
    ).toBe(true);
  });

  it('skips Stripe webhook endpoint', () => {
    expect(shouldSkipGlobalRateLimit('/api/v1/webhooks/stripe')).toBe(true);
  });

  it('skips soft meter, video, duty, and vehicle-exchange operational paths', () => {
    expect(shouldSkipGlobalRateLimit('/api/v1/driver/meter/active')).toBe(true);
    expect(shouldSkipGlobalRateLimit('/api/v1/driver/walk-up')).toBe(true);
    expect(shouldSkipGlobalRateLimit('/api/v1/driver/duty/current')).toBe(true);
    expect(shouldSkipGlobalRateLimit('/api/v1/driver/vehicle-exchanges/current')).toBe(true);
    expect(
      shouldSkipGlobalRateLimit(
        '/api/v1/driver/video/sessions/6e948d11-e7c6-4a1a-90ae-f40bed100d75/segments'
      )
    ).toBe(true);
  });

  it('skips passenger payment config and booking payment status', () => {
    expect(shouldSkipGlobalRateLimit('/api/v1/config/payments')).toBe(true);
    expect(
      shouldSkipGlobalRateLimit(
        '/api/v1/passenger/bookings/11111111-1111-1111-1111-111111111111/payment'
      )
    ).toBe(true);
  });

  it('skips driver payout endpoints', () => {
    expect(shouldSkipGlobalRateLimit('/api/v1/driver/payouts/onboarding-link')).toBe(true);
    expect(shouldSkipGlobalRateLimit('/api/v1/driver/payouts/status')).toBe(true);
  });

  it('skips driver document endpoints', () => {
    expect(shouldSkipGlobalRateLimit('/api/v1/driver/documents')).toBe(true);
    expect(shouldSkipGlobalRateLimit('/api/v1/driver/documents/driving_license')).toBe(true);
    expect(
      shouldSkipGlobalRateLimit(
        '/api/v1/admin/fleet/drivers/11111111-1111-1111-1111-111111111111/documents'
      )
    ).toBe(true);
  });

  it('skips driver payment history endpoints', () => {
    expect(shouldSkipGlobalRateLimit('/api/v1/driver/payments')).toBe(true);
    expect(shouldSkipGlobalRateLimit('/api/v1/driver/payments/summary')).toBe(true);
    expect(
      shouldSkipGlobalRateLimit('/api/v1/driver/payments/11111111-1111-1111-1111-111111111111')
    ).toBe(true);
  });

  it('skips auth endpoints', () => {
    expect(shouldSkipGlobalRateLimit('/api/auth/login')).toBe(true);
    expect(shouldSkipGlobalRateLimit('/api/auth/refresh')).toBe(true);
  });

  it('skips admin ride-video endpoints with dedicated limiters', () => {
    expect(shouldSkipGlobalRateLimit('/api/v1/admin/ride-videos')).toBe(true);
    expect(
      shouldSkipGlobalRateLimit('/api/v1/admin/ride-videos/11111111-1111-1111-1111-111111111111')
    ).toBe(true);
    expect(
      shouldSkipGlobalRateLimit(
        '/api/v1/admin/bookings/11111111-1111-1111-1111-111111111111/ride-video'
      )
    ).toBe(true);
  });

  it('does not skip unrelated admin endpoints', () => {
    expect(shouldSkipGlobalRateLimit('/api/admin/users')).toBe(false);
  });
});

describe('rate limit key strategy', () => {
  it('keys passengers by customer id', () => {
    const req = mockReq({ user: { userId: 'cust-1' } });
    expect(keyByCustomer(req)).toBe('customer:cust-1');
  });

  it('keys drivers by driver id', () => {
    const req = mockReq({ user: { userId: 'drv-1' } });
    expect(keyByDriver(req)).toBe('driver:drv-1');
  });

  it('uses separate keys for two users on the same IP', () => {
    const ip = '192.168.1.10';
    const passengerA = mockReq({ ip, user: { userId: 'p1' } });
    const passengerB = mockReq({ ip, user: { userId: 'p2' } });
    expect(keyByCustomer(passengerA)).not.toBe(keyByCustomer(passengerB));
  });

  it('falls back to IP for unauthenticated requests', () => {
    const req = mockReq({ ip: '10.0.0.5' });
    expect(keyByIp(req)).toBe('ip:10.0.0.5');
  });

  it('global authenticated key separates passenger and driver on same IP', () => {
    const ip = '103.208.183.242';
    const passenger = mockReq({
      ip,
      rateLimitIdentity: { userId: 'p1', role: 'passenger' },
    } as any);
    const driver = mockReq({
      ip,
      rateLimitIdentity: { userId: 'd1', role: 'driver' },
    } as any);
    expect(keyByAuthenticatedOrIp(passenger)).toBe('auth:passenger:p1');
    expect(keyByAuthenticatedOrIp(driver)).toBe('auth:driver:d1');
  });
});

describe('limiter isolation', () => {
  it('uses separate limiter instances for maps, cancel, location, and offers', () => {
    const limiters = require('../src/middleware/rate-limiters');
    expect(limiters.passengerMapsRateLimit).toBeDefined();
    expect(limiters.passengerBookingCancelRateLimit).toBeDefined();
    expect(limiters.driverLocationRateLimit).toBeDefined();
    expect(limiters.driverOfferRateLimit).toBeDefined();
    expect(limiters.passengerMapsRateLimit).not.toBe(limiters.driverLocationRateLimit);
    expect(limiters.driverOfferRateLimit).not.toBe(limiters.driverLocationRateLimit);
    expect(limiters.passengerBookingCancelRateLimit).not.toBe(limiters.passengerMapsRateLimit);
  });
});

describe('429 response contract', () => {
  it('uses unified RATE_LIMITED error code', () => {
    expect(RATE_LIMIT_RESPONSE).toEqual({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please try again shortly.',
        retryable: true,
        details: null,
      },
    });
  });
});

describe('booking protection', () => {
  it('keeps production booking create limits lower than development', () => {
    const dev = loadConfigForTier('development');
    const prod = loadConfigForTier('production');
    expect(prod.passengerBooking.max).toBeLessThan(dev.passengerBooking.max);
    expect(prod.passengerBooking.max).toBeLessThanOrEqual(20);
  });

  it('keeps cancel limit separate from maps with idempotent skip on success', () => {
    const cancel = require('../src/middleware/passenger-booking-cancel-rate-limit');
    expect(cancel.passengerBookingCancelRateLimit).toBeDefined();
    const maps = require('../src/middleware/passenger-maps-rate-limit');
    expect(maps.passengerMapsRateLimit).not.toBe(cancel.passengerBookingCancelRateLimit);
  });
});

describe('recovery endpoints', () => {
  it('allows generous recovery limits in staging', () => {
    const staging = loadConfigForTier('staging');
    expect(staging.passengerRecovery.max).toBeGreaterThanOrEqual(100);
    expect(staging.driverRecovery.max).toBeGreaterThanOrEqual(100);
  });
});

describe('auth rate limits', () => {
  it('restricts auth more tightly per minute than driver GPS in production', () => {
    const prod = loadConfigForTier('production');
    const authPerMinute = prod.auth.max / (prod.auth.windowMs / 60_000);
    const gpsPerMinute = prod.driverLocation.max / (prod.driverLocation.windowMs / 60_000);
    expect(authPerMinute).toBeLessThan(gpsPerMinute);
  });
});

describe('429 Retry-After header', () => {
  jest.setTimeout(15_000);

  it('returns Retry-After and unified body on limit exceeded', async () => {
    const previousEnabled = process.env.RATE_LIMIT_ENABLED;
    const previousNodeEnv = process.env.NODE_ENV;
    const previousRedisStore = process.env.RATE_LIMIT_USE_REDIS;
    process.env.RATE_LIMIT_ENABLED = 'true';
    process.env.RATE_LIMIT_USE_REDIS = 'false';
    process.env.NODE_ENV = 'test';

    jest.resetModules();
    const express = require('express');
    const request = require('supertest');
    const { createRateLimiter } = require('../src/middleware/create-rate-limiter');

    const app = express();
    app.use(
      createRateLimiter({
        name: 'test_retry_after',
        bucket: { windowMs: 60_000, max: 1 },
      })
    );
    app.get('/ping', (_req: any, res: any) => res.json({ ok: true }));

    await request(app).get('/ping').expect(200);
    const limited = await request(app).get('/ping').expect(429);

    expect(limited.body.success).toBe(false);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(limited.body.error.retryable).toBe(true);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.headers['ratelimit-limit']).toBeDefined();
    if (limited.body.error.details?.retryAfterSeconds != null) {
      expect(limited.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
    }

    process.env.RATE_LIMIT_ENABLED = previousEnabled;
    process.env.NODE_ENV = previousNodeEnv;
    process.env.RATE_LIMIT_USE_REDIS = previousRedisStore;
    jest.resetModules();
  });
});
