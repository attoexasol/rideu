/**
 * Passenger location timeout regression tests.
 */
import { shouldSkipGlobalRateLimit } from '../src/middleware/rate-limit-paths';
import { RedisRateLimitStore } from '../src/middleware/redis-rate-limit-store';
import { withRedisTimeout, RedisCommandTimeoutError } from '../src/utils/redisTimeout';
import { mapsCache, realtimeCache, isRedisCacheEnabled } from '../src/config/redis';
import { handleGoogleMapsError } from '../src/utils/googleMapsHandler';
import { GoogleMapsServiceError } from '../src/services/googleMaps/errors';

jest.mock('../src/config/redis', () => {
  const actual = jest.requireActual('../src/config/redis') as Record<string, unknown>;
  return {
    ...actual,
    redis: {
      get: jest.fn(),
      setex: jest.fn(),
      incr: jest.fn(),
      pexpire: jest.fn(),
      pttl: jest.fn(),
      decr: jest.fn(),
      del: jest.fn(),
    },
  };
});

const mockedRedis = jest.requireMock('../src/config/redis').redis as {
  get: jest.Mock;
  setex: jest.Mock;
  incr: jest.Mock;
  pexpire: jest.Mock;
  pttl: jest.Mock;
};

describe('passenger location global rate-limit scope', () => {
  it('skips global limiter for autocomplete, details, reverse geocode, route preview, quote', () => {
    expect(shouldSkipGlobalRateLimit('/api/v1/passenger/places/autocomplete')).toBe(true);
    expect(shouldSkipGlobalRateLimit('/api/v1/passenger/places/details')).toBe(true);
    expect(shouldSkipGlobalRateLimit('/api/v1/passenger/places/reverse-geocode')).toBe(true);
    expect(shouldSkipGlobalRateLimit('/api/v1/passenger/routes/preview')).toBe(true);
    expect(shouldSkipGlobalRateLimit('/api/v1/passenger/bookings/quote')).toBe(true);
  });

  it('does not skip unrelated admin endpoints', () => {
    expect(shouldSkipGlobalRateLimit('/api/v1/admin/users')).toBe(false);
  });

  it('skips admin ride-video endpoints independently from passenger routes', () => {
    expect(shouldSkipGlobalRateLimit('/api/v1/admin/ride-videos')).toBe(true);
    expect(shouldSkipGlobalRateLimit('/api/v1/admin/ride-videos/summary')).toBe(true);
    expect(
      shouldSkipGlobalRateLimit('/api/v1/admin/bookings/11111111-1111-1111-1111-111111111111/ride-video')
    ).toBe(true);
  });
});

describe('withRedisTimeout', () => {
  it('rejects hung promises within the configured timeout', async () => {
    await expect(
      withRedisTimeout(new Promise(() => undefined), 50)
    ).rejects.toBeInstanceOf(RedisCommandTimeoutError);
  });
});

describe('realtimeCache fail-open behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not throw when heartbeat write fails', async () => {
    mockedRedis.setex.mockRejectedValue(new Error('MaxRetriesPerRequestError'));
    await expect(
      realtimeCache.setDriverHeartbeat('driver-1', new Date().toISOString())
    ).resolves.toBeUndefined();
  });

  it('returns null when driver location read fails', async () => {
    mockedRedis.get.mockRejectedValue(new Error('MaxRetriesPerRequestError'));
    await expect(realtimeCache.getDriverLocation('driver-1')).resolves.toBeNull();
  });
});

describe('mapsCache fail-open behavior', () => {
  const originalUseRedis = process.env.USE_REDIS;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.USE_REDIS;
  });

  afterEach(() => {
    if (originalUseRedis === undefined) {
      delete process.env.USE_REDIS;
    } else {
      process.env.USE_REDIS = originalUseRedis;
    }
  });

  it('skips redis entirely when USE_REDIS=false', async () => {
    process.env.USE_REDIS = 'false';
    expect(isRedisCacheEnabled()).toBe(false);
    await expect(mapsCache.get('route:test')).resolves.toBeNull();
    await expect(mapsCache.set('route:test', { ok: true }, 60)).resolves.toBeUndefined();
    expect(mockedRedis.get).not.toHaveBeenCalled();
    expect(mockedRedis.setex).not.toHaveBeenCalled();
  });

  it('returns null when redis get hangs instead of blocking the handler', async () => {
    mockedRedis.get.mockImplementation(() => new Promise(() => undefined));
    const result = await mapsCache.get('place-details:test');
    expect(result).toBeNull();
  }, 10_000);

  it('ignores redis set failures/timeouts', async () => {
    mockedRedis.setex.mockImplementation(() => new Promise(() => undefined));
    await expect(mapsCache.set('route:test', { ok: true }, 60)).resolves.toBeUndefined();
  }, 10_000);
});

describe('RedisRateLimitStore fail-open', () => {
  it('allows requests when redis increment fails', async () => {
    mockedRedis.incr.mockRejectedValue(new Error('MaxRetriesPerRequestError'));
    const store = new RedisRateLimitStore('test');
    store.init({ windowMs: 60_000 } as any);
    const result = await store.increment('customer:abc');
    expect(result.totalHits).toBe(1);
    expect(result.resetTime).toBeInstanceOf(Date);
  });
});

describe('Google Maps timeout mapping', () => {
  it('returns 504 for external timeout errors', () => {
    const res = {
      locals: {},
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;

    handleGoogleMapsError(
      res,
      new GoogleMapsServiceError('GOOGLE_MAPS_TIMEOUT', 'Map services timed out. Please try again.', 504)
    );

    expect(res.status).toHaveBeenCalledWith(504);
    expect(res.locals.errorCode).toBe('GOOGLE_MAPS_TIMEOUT');
  });
});

describe('admin video middleware isolation', () => {
  it('admin ride-video routes are mounted under /api/v1/admin only', () => {
    expect(shouldSkipGlobalRateLimit('/api/v1/passenger/places/details')).toBe(true);
    expect(shouldSkipGlobalRateLimit('/api/v1/admin/ride-videos/11111111-1111-1111-1111-111111111111')).toBe(
      true
    );
    expect(shouldSkipGlobalRateLimit('/api/v1/passenger/bookings/11111111-1111-1111-1111-111111111111')).toBe(
      false
    );
  });
});
