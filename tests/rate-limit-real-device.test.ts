/**
 * Real-device rate-limit scenarios:
 * - Driver GPS must not exhaust passenger API budget
 * - Same-NAT passenger/driver must not share authenticated budgets
 * - Unauthenticated traffic stays strictly limited
 * - Booking reads / checkout / webhooks / GPS abuse behaviors
 */

import type { Request, Response, NextFunction } from 'express';
import {
  loadRateLimitConfig,
  type RateLimitTier,
} from '../src/config/rate-limit';
import { shouldSkipGlobalRateLimit } from '../src/middleware/rate-limit-paths';
import {
  keyByAuthenticatedOrIp,
  keyByCustomer,
  keyByDriver,
  keyByIp,
  isAuthenticatedRateLimitRequest,
} from '../src/middleware/create-rate-limiter';

function loadConfigForTier(tier: RateLimitTier, overrides: Record<string, string> = {}) {
  const saved = { ...process.env };
  process.env.NODE_ENV = tier === 'test' ? 'test' : tier;
  delete process.env.RATE_LIMIT_ENABLED;
  for (const key of Object.keys(overrides)) {
    delete process.env[key];
  }
  Object.assign(process.env, overrides);
  const config = loadRateLimitConfig();
  process.env = saved;
  return config;
}

function mockReq(
  partial: Partial<Request> & {
    user?: any;
    ip?: string;
    rateLimitIdentity?: { userId: string; role: string };
  } = {}
): Request {
  return {
    method: partial.method ?? 'GET',
    path: partial.path ?? '/',
    originalUrl: partial.originalUrl ?? partial.path ?? '/',
    ip: partial.ip ?? '127.0.0.1',
    headers: partial.headers ?? {},
    params: partial.params ?? {},
    rateLimitIdentity: partial.rateLimitIdentity,
    ...partial,
    user: partial.user,
  } as Request;
}

describe('real-device rate limit isolation', () => {
  it('driver GPS every 6s for 15 minutes fits production driver_location budget', () => {
    const prod = loadConfigForTier('production');
    const updatesPerMinute = 60 / 6;
    const windowMinutes = prod.driverLocation.windowMs / 60_000;
    const needed = Math.ceil(updatesPerMinute * windowMinutes);
    expect(prod.driverLocation.max).toBeGreaterThanOrEqual(needed);
    // 15 minutes of GPS must not be gated by the passenger booking-read budget.
    const fifteenMinGps = Math.ceil((15 * 60) / 6);
    expect(fifteenMinGps).toBeGreaterThan(prod.passengerBookingRead.max);
    expect(shouldSkipGlobalRateLimit('/api/locations')).toBe(true);
  });

  it('passenger and driver behind the same NAT do not share authenticated keys', () => {
    const ip = '103.208.183.242';
    const passenger = mockReq({
      ip,
      rateLimitIdentity: { userId: 'passenger-1', role: 'passenger' },
    });
    const driver = mockReq({
      ip,
      rateLimitIdentity: { userId: 'driver-1', role: 'driver' },
    });

    expect(keyByAuthenticatedOrIp(passenger)).toBe('auth:passenger:passenger-1');
    expect(keyByAuthenticatedOrIp(driver)).toBe('auth:driver:driver-1');
    expect(keyByAuthenticatedOrIp(passenger)).not.toBe(keyByAuthenticatedOrIp(driver));
    expect(keyByCustomer(passenger)).not.toBe(keyByDriver(driver));
  });

  it('unauthenticated traffic remains IP-keyed and uses stricter unauth budget', () => {
    const prod = loadConfigForTier('production');
    const unauth = mockReq({ ip: '10.0.0.9' });
    expect(isAuthenticatedRateLimitRequest(unauth)).toBe(false);
    expect(keyByAuthenticatedOrIp(unauth)).toBe('ip:10.0.0.9');
    expect(prod.globalUnauthenticated.max).toBeLessThan(prod.global.max);
    expect(prod.globalUnauthenticated.max).toBeLessThanOrEqual(100);
  });

  it('repeated booking-detail reads under normal usage are within passenger_booking_read', () => {
    const prod = loadConfigForTier('production');
    // Poll every 5s for a minute during ride tracking.
    const readsPerMinute = 60 / 5;
    expect(prod.passengerBookingRead.max).toBeGreaterThanOrEqual(readsPerMinute);
    expect(
      shouldSkipGlobalRateLimit('/api/v1/passenger/bookings/88683ab3-01d8-47af-a52f-c45363a43fa0')
    ).toBe(true);
  });

  it('abusive booking creation remains restricted relative to booking reads', () => {
    const prod = loadConfigForTier('production');
    expect(prod.passengerBooking.max).toBeLessThanOrEqual(20);
    expect(prod.passengerBooking.max).toBeLessThan(prod.passengerBookingRead.max);
  });

  it('checkout creation retains strict protection', () => {
    const prod = loadConfigForTier('production');
    expect(prod.passengerCheckout.max).toBeLessThanOrEqual(10);
    expect(prod.passengerCheckout.max).toBeLessThan(prod.passengerBookingRead.max);
    expect(prod.passengerCheckout.max).toBeLessThanOrEqual(prod.passengerBooking.max);
  });

  it('driver GPS abuse still gets throttled above normal telemetry', () => {
    const prod = loadConfigForTier('production');
    // Flooding every 0.5s would exceed production GPS max within a minute.
    const floodPerMinute = 60 / 0.5;
    expect(floodPerMinute).toBeGreaterThan(prod.driverLocation.max);
    // Normal 5–10s interval still fits.
    expect(prod.driverLocation.max).toBeGreaterThanOrEqual(12);
  });

  it('Stripe webhook path skips global and dedicated API limiters', () => {
    expect(shouldSkipGlobalRateLimit('/api/v1/webhooks/stripe')).toBe(true);
  });

  it('soft meter and driver operational paths skip the global IP bucket', () => {
    expect(shouldSkipGlobalRateLimit('/api/v1/driver/meter/active')).toBe(true);
    expect(
      shouldSkipGlobalRateLimit(
        '/api/v1/driver/meter/11111111-1111-1111-1111-111111111111/points'
      )
    ).toBe(true);
    expect(shouldSkipGlobalRateLimit('/api/v1/driver/walk-up')).toBe(true);
    expect(shouldSkipGlobalRateLimit('/api/v1/driver/duty/current')).toBe(true);
    expect(shouldSkipGlobalRateLimit('/api/v1/driver/vehicle-exchanges/current')).toBe(true);
    expect(
      shouldSkipGlobalRateLimit(
        '/api/v1/driver/video/sessions/6e948d11-e7c6-4a1a-90ae-f40bed100d75/segments'
      )
    ).toBe(true);
  });

  it('soft meter production budget covers GPS batching without matching GPS abuse allowance', () => {
    const prod = loadConfigForTier('production');
    expect(prod.softMeter.max).toBeGreaterThanOrEqual(60);
    expect(prod.softMeter.max).toBeGreaterThan(prod.passengerCheckout.max);
  });
});

describe('global limiter identity-aware behavior (HTTP)', () => {
  jest.setTimeout(20_000);

  it('returns Retry-After and does not let driver identity consume passenger budget', async () => {
    const previous = {
      RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED,
      RATE_LIMIT_USE_REDIS: process.env.RATE_LIMIT_USE_REDIS,
      NODE_ENV: process.env.NODE_ENV,
      RATE_LIMIT_MAX_REQUESTS: process.env.RATE_LIMIT_MAX_REQUESTS,
      RATE_LIMIT_UNAUTH_MAX_REQUESTS: process.env.RATE_LIMIT_UNAUTH_MAX_REQUESTS,
      RATE_LIMIT_WINDOW_MS: process.env.RATE_LIMIT_WINDOW_MS,
    };

    process.env.RATE_LIMIT_ENABLED = 'true';
    process.env.RATE_LIMIT_USE_REDIS = 'false';
    process.env.NODE_ENV = 'test';
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    process.env.RATE_LIMIT_MAX_REQUESTS = '5';
    process.env.RATE_LIMIT_UNAUTH_MAX_REQUESTS = '2';

    jest.resetModules();
    const express = require('express');
    const request = require('supertest');
    const { createRateLimiter, keyByAuthenticatedOrIp } = require('../src/middleware/create-rate-limiter');
    const { loadRateLimitConfig: reload } = require('../src/config/rate-limit');
    const cfg = reload();

    const app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const role = req.headers['x-test-role'];
      const userId = req.headers['x-test-user'];
      if (typeof role === 'string' && typeof userId === 'string') {
        req.rateLimitIdentity = { userId, role };
      }
      next();
    });
    app.use(
      createRateLimiter({
        name: 'global',
        bucket: cfg.global,
        unauthenticatedBucket: cfg.globalUnauthenticated,
        keyGenerator: keyByAuthenticatedOrIp,
      })
    );
    app.get('/ping', (_req: Request, res: Response) => res.json({ ok: true }));

    const sharedIpAgent = request.agent(app);

    // Unauthenticated: limited to 2
    await sharedIpAgent.get('/ping').expect(200);
    await sharedIpAgent.get('/ping').expect(200);
    const unauthLimited = await sharedIpAgent.get('/ping').expect(429);
    expect(unauthLimited.headers['retry-after']).toBeDefined();
    expect(Number(unauthLimited.headers['retry-after'])).toBeGreaterThan(0);
    expect(unauthLimited.body.error.code).toBe('RATE_LIMITED');
    expect(unauthLimited.body.error.details.retryAfterSeconds).toBeGreaterThan(0);

    // Driver identity: separate budget of 5
    for (let i = 0; i < 5; i++) {
      await sharedIpAgent
        .get('/ping')
        .set('x-test-role', 'driver')
        .set('x-test-user', 'drv-nat-1')
        .expect(200);
    }
    await sharedIpAgent
      .get('/ping')
      .set('x-test-role', 'driver')
      .set('x-test-user', 'drv-nat-1')
      .expect(429);

    // Passenger identity on same IP still has its own budget
    for (let i = 0; i < 5; i++) {
      await sharedIpAgent
        .get('/ping')
        .set('x-test-role', 'passenger')
        .set('x-test-user', 'pax-nat-1')
        .expect(200);
    }
    await sharedIpAgent
      .get('/ping')
      .set('x-test-role', 'passenger')
      .set('x-test-user', 'pax-nat-1')
      .expect(429);

    Object.assign(process.env, previous);
    jest.resetModules();
  });

  it('driver location abuse is throttled by dedicated limiter', async () => {
    const previous = {
      RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED,
      RATE_LIMIT_USE_REDIS: process.env.RATE_LIMIT_USE_REDIS,
      NODE_ENV: process.env.NODE_ENV,
      DRIVER_LOCATION_RATE_LIMIT_MAX: process.env.DRIVER_LOCATION_RATE_LIMIT_MAX,
      DRIVER_LOCATION_RATE_LIMIT_WINDOW_MS: process.env.DRIVER_LOCATION_RATE_LIMIT_WINDOW_MS,
    };

    process.env.RATE_LIMIT_ENABLED = 'true';
    process.env.RATE_LIMIT_USE_REDIS = 'false';
    process.env.NODE_ENV = 'test';
    process.env.DRIVER_LOCATION_RATE_LIMIT_WINDOW_MS = '60000';
    process.env.DRIVER_LOCATION_RATE_LIMIT_MAX = '3';

    jest.resetModules();
    const express = require('express');
    const request = require('supertest');
    const { createRateLimiter, keyByDriver } = require('../src/middleware/create-rate-limiter');
    const { loadRateLimitConfig: reload } = require('../src/config/rate-limit');
    const cfg = reload();

    const app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as any).user = { userId: 'drv-gps-1', role: 'driver' };
      next();
    });
    app.post(
      '/api/locations',
      createRateLimiter({
        name: 'driver_location',
        bucket: cfg.driverLocation,
        keyGenerator: keyByDriver,
      }),
      (_req: Request, res: Response) => res.status(201).json({ ok: true })
    );

    await request(app).post('/api/locations').expect(201);
    await request(app).post('/api/locations').expect(201);
    await request(app).post('/api/locations').expect(201);
    const limited = await request(app).post('/api/locations').expect(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.headers['ratelimit-limit']).toBeDefined();

    Object.assign(process.env, previous);
    jest.resetModules();
  });

  it('checkout limiter stays stricter than booking-read limiter', async () => {
    const previous = {
      RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED,
      RATE_LIMIT_USE_REDIS: process.env.RATE_LIMIT_USE_REDIS,
      NODE_ENV: process.env.NODE_ENV,
      PASSENGER_CHECKOUT_RATE_LIMIT_MAX: process.env.PASSENGER_CHECKOUT_RATE_LIMIT_MAX,
      PASSENGER_BOOKING_READ_RATE_LIMIT_MAX: process.env.PASSENGER_BOOKING_READ_RATE_LIMIT_MAX,
      RATE_LIMIT_WINDOW_MS: process.env.RATE_LIMIT_WINDOW_MS,
    };

    process.env.RATE_LIMIT_ENABLED = 'true';
    process.env.RATE_LIMIT_USE_REDIS = 'false';
    process.env.NODE_ENV = 'test';
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    process.env.PASSENGER_CHECKOUT_RATE_LIMIT_MAX = '2';
    process.env.PASSENGER_BOOKING_READ_RATE_LIMIT_MAX = '20';

    jest.resetModules();
    const express = require('express');
    const request = require('supertest');
    const {
      createRateLimiter,
      keyByCustomer,
    } = require('../src/middleware/create-rate-limiter');
    const { loadRateLimitConfig: reload } = require('../src/config/rate-limit');
    const cfg = reload();

    const app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as any).user = { userId: 'cust-checkout-1', role: 'customer' };
      next();
    });
    app.post(
      '/checkout',
      createRateLimiter({
        name: 'passenger_checkout',
        bucket: cfg.passengerCheckout,
        keyGenerator: keyByCustomer,
      }),
      (_req: Request, res: Response) => res.json({ ok: true })
    );
    app.get(
      '/booking',
      createRateLimiter({
        name: 'passenger_booking_read',
        bucket: cfg.passengerBookingRead,
        keyGenerator: keyByCustomer,
      }),
      (_req: Request, res: Response) => res.json({ ok: true })
    );

    await request(app).post('/checkout').expect(200);
    await request(app).post('/checkout').expect(200);
    await request(app).post('/checkout').expect(429);

    // Booking reads still succeed after checkout is exhausted (separate policy).
    for (let i = 0; i < 10; i++) {
      await request(app).get('/booking').expect(200);
    }

    Object.assign(process.env, previous);
    jest.resetModules();
  });
});

describe('Redis store window boundaries and multi-instance consistency', () => {
  it('RedisRateLimitStore increments atomically and resets after TTL semantics', async () => {
    jest.resetModules();

    const counters = new Map<string, { value: number; ttl: number }>();
    jest.doMock('../src/config/redis', () => ({
      redis: {
        incr: jest.fn(async (key: string) => {
          const entry = counters.get(key) ?? { value: 0, ttl: -1 };
          entry.value += 1;
          counters.set(key, entry);
          return entry.value;
        }),
        pexpire: jest.fn(async (key: string, ms: number) => {
          const entry = counters.get(key) ?? { value: 0, ttl: -1 };
          entry.ttl = ms;
          counters.set(key, entry);
          return 1;
        }),
        pttl: jest.fn(async (key: string) => counters.get(key)?.ttl ?? -1),
        decr: jest.fn(async (key: string) => {
          const entry = counters.get(key) ?? { value: 0, ttl: -1 };
          entry.value -= 1;
          counters.set(key, entry);
          return entry.value;
        }),
        del: jest.fn(async (key: string) => {
          counters.delete(key);
          return 1;
        }),
        get: jest.fn(async (key: string) => {
          const entry = counters.get(key);
          return entry ? String(entry.value) : null;
        }),
      },
      isRedisCacheEnabled: () => true,
    }));
    jest.doMock('../src/utils/redisTimeout', () => ({
      withRedisTimeout: async <T>(p: Promise<T>) => p,
    }));

    const { RedisRateLimitStore } = require('../src/middleware/redis-rate-limit-store');
    const store = new RedisRateLimitStore('test_window');
    store.init({ windowMs: 1000 } as any);

    const a = await store.increment('user-a');
    expect(a.totalHits).toBe(1);
    expect(counters.get('rl:test_window:user-a')?.ttl).toBe(1000);

    const b = await store.increment('user-a');
    expect(b.totalHits).toBe(2);

    // Separate key: shared Redis namespace, independent counters (multi-instance safe).
    const other = await store.increment('user-b');
    expect(other.totalHits).toBe(1);

    await store.resetKey('user-a');
    const afterReset = await store.increment('user-a');
    expect(afterReset.totalHits).toBe(1);

    jest.dontMock('../src/config/redis');
    jest.dontMock('../src/utils/redisTimeout');
    jest.resetModules();
  });

  it('fails open when Redis is unavailable (operational policy)', async () => {
    jest.resetModules();
    jest.doMock('../src/config/redis', () => ({
      redis: {
        incr: jest.fn(async () => {
          throw new Error('redis down');
        }),
      },
      isRedisCacheEnabled: () => true,
    }));
    jest.doMock('../src/utils/redisTimeout', () => ({
      withRedisTimeout: async <T>(p: Promise<T>) => p,
    }));

    const { RedisRateLimitStore } = require('../src/middleware/redis-rate-limit-store');
    const store = new RedisRateLimitStore('fail_open');
    store.init({ windowMs: 60_000 } as any);
    const result = await store.increment('any');
    expect(result.totalHits).toBe(1);

    jest.dontMock('../src/config/redis');
    jest.dontMock('../src/utils/redisTimeout');
    jest.resetModules();
  });
});

describe('keyByIp fallback', () => {
  it('uses IP when identity is absent', () => {
    expect(keyByIp(mockReq({ ip: '1.2.3.4' }))).toBe('ip:1.2.3.4');
  });
});
