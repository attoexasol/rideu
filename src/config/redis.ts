import Redis, { RedisOptions } from 'ioredis';
import { withRedisTimeout } from '../utils/redisTimeout';

export function isRedisRequired(): boolean {
  return (
    process.env.USE_REDIS === 'true' ||
    process.env.NODE_ENV === 'production' ||
    process.env.NODE_ENV === 'staging'
  );
}

/** Cache/session reads and writes (maps, driver location, sessions). */
export function isRedisCacheEnabled(): boolean {
  if (process.env.USE_REDIS === 'false') return false;
  if (redisCircuitOpen) {
    if (Date.now() - redisCircuitOpenedAt < CIRCUIT_RESET_MS) return false;
    redisCircuitOpen = false;
  }
  return true;
}

/** Pub/Sub adapter and cross-process broadcasts. */
export function isRedisPubSubEnabled(): boolean {
  return process.env.USE_REDIS === 'true' || isRedisRequired();
}

let redisCircuitOpen = false;
let redisCircuitOpenedAt = 0;
const CIRCUIT_RESET_MS = 30_000;

function markRedisUnavailable(): void {
  redisCircuitOpen = true;
  redisCircuitOpenedAt = Date.now();
}

function getCommandTimeoutMs(): number {
  return isRedisRequired()
    ? REDIS_COMMAND_TIMEOUT_MS
    : Math.min(REDIS_COMMAND_TIMEOUT_MS, 500);
}

async function safeRedisRead<T>(operation: Promise<T | null>): Promise<T | null> {
  if (!isRedisCacheEnabled()) return null;
  try {
    return await withRedisTimeout(operation, getCommandTimeoutMs());
  } catch {
    markRedisUnavailable();
    return null;
  }
}

async function safeRedisWrite(operation: Promise<unknown>): Promise<void> {
  if (!isRedisCacheEnabled()) return;
  try {
    await withRedisTimeout(operation, getCommandTimeoutMs());
  } catch {
    markRedisUnavailable();
  }
}

/** Non-blocking publish for optional Redis pub/sub (fail-open). */
export async function safeRedisPublish(channel: string, message: string): Promise<void> {
  if (!isRedisPubSubEnabled()) return;
  try {
    await withRedisTimeout(redisPub.publish(channel, message), getCommandTimeoutMs());
  } catch {
    markRedisUnavailable();
  }
}

/**
 * Redis client configuration for session caching and real-time data
 * Supports Pub/Sub for WebSocket scalability
 */

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_URL = process.env.REDIS_URL;
const REDIS_COMMAND_TIMEOUT_MS = parseInt(process.env.REDIS_COMMAND_TIMEOUT_MS || '2000', 10);
const redisExplicitlyDisabled = process.env.USE_REDIS === 'false';

const baseRedisOptions: RedisOptions = {
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 5000);
    return delay;
  },
  enableReadyCheck: true,
  lazyConnect: redisExplicitlyDisabled,
  connectTimeout: 5000,
};

/** General-purpose client: bounded retries/timeouts so HTTP handlers cannot hang forever. */
const commandRedisOptions: RedisOptions = {
  ...baseRedisOptions,
  maxRetriesPerRequest: redisExplicitlyDisabled ? 0 : 2,
  commandTimeout: redisExplicitlyDisabled ? 500 : REDIS_COMMAND_TIMEOUT_MS,
};

/** Pub/Sub clients must not limit retries on blocking commands. */
const pubSubRedisOptions: RedisOptions = {
  ...baseRedisOptions,
  maxRetriesPerRequest: null,
};

// Main Redis client for general operations
export const redis = REDIS_URL
  ? new Redis(REDIS_URL, commandRedisOptions)
  : new Redis({ ...commandRedisOptions, host: REDIS_HOST, port: REDIS_PORT });

// Publisher client for Pub/Sub (WebSocket broadcasting)
export const redisPub = REDIS_URL
  ? new Redis(REDIS_URL, pubSubRedisOptions)
  : new Redis({ ...pubSubRedisOptions, host: REDIS_HOST, port: REDIS_PORT });

// Subscriber client for Pub/Sub (WebSocket broadcasting)
export const redisSub = REDIS_URL
  ? new Redis(REDIS_URL, pubSubRedisOptions)
  : new Redis({ ...pubSubRedisOptions, host: REDIS_HOST, port: REDIS_PORT });

// Connection event handlers
redis.on('connect', () => {
  console.log('✓ Redis client connected');
});

redis.on('error', (err) => {
  console.error('✗ Redis client error:', err);
});

redis.on('ready', () => {
  console.log('✓ Redis client ready');
});

redisPub.on('connect', () => {
  console.log('✓ Redis publisher connected');
});

redisPub.on('error', (err) => {
  console.error('✗ Redis publisher error:', err);
});

redisSub.on('connect', () => {
  console.log('✓ Redis subscriber connected');
});

redisSub.on('error', (err) => {
  console.error('✗ Redis subscriber error:', err);
});

async function pingClient(client: Redis): Promise<string> {
  const result = await client.ping();
  const normalized = String(result).trim().toUpperCase();
  if (normalized.startsWith('PONG')) return 'PONG';
  return String(result).trim();
}

async function pingWithRetry(
  client: Redis,
  attempts = 5,
  delayMs = 200
): Promise<string> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await pingClient(client);
      if (result === 'PONG') return result;
      lastError = new Error(`Unexpected PING response: ${result}`);
    } catch (err) {
      lastError = err;
    }
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('PING failed');
}

/**
 * Test Redis connection
 * @returns Promise that resolves if connection is successful
 */
export async function testRedisConnection(): Promise<boolean> {
  try {
    const result = await pingWithRetry(redis);
    console.log('✓ Redis connection successful');
    return result === 'PONG';
  } catch (error) {
    console.error('✗ Redis connection failed:', error);
    return false;
  }
}

/**
 * Close all Redis connections
 */
export async function closeRedisConnections(): Promise<void> {
  try {
    await Promise.all([redis.quit(), redisPub.quit(), redisSub.quit()]);
    console.log('✓ All Redis connections closed');
  } catch (error) {
    console.error('✗ Error closing Redis connections:', error);
  }
}

/**
 * Session cache helper functions
 */
export const sessionCache = {
  async set(sessionId: string, data: any, ttl: number = 86400): Promise<void> {
    const key = `session:${sessionId}`;
    await safeRedisWrite(redis.setex(key, ttl, JSON.stringify(data)));
  },

  async get(sessionId: string): Promise<any> {
    const key = `session:${sessionId}`;
    const data = await safeRedisRead(redis.get(key));
    return data ? JSON.parse(data) : null;
  },

  async delete(sessionId: string): Promise<void> {
    const key = `session:${sessionId}`;
    await safeRedisWrite(redis.del(key));
  },

  async exists(sessionId: string): Promise<boolean> {
    const key = `session:${sessionId}`;
    const result = await safeRedisRead(redis.exists(key));
    return result === 1;
  },
};

/**
 * Real-time data cache helper functions
 */
export const realtimeCache = {
  async setDriverLocation(driverId: string, location: any, ttl: number = 300): Promise<void> {
    const key = `location:driver:${driverId}`;
    await safeRedisWrite(redis.setex(key, ttl, JSON.stringify(location)));
  },

  async getDriverLocation(driverId: string): Promise<any> {
    const key = `location:driver:${driverId}`;
    const data = await safeRedisRead(redis.get(key));
    return data ? JSON.parse(data) : null;
  },

  async setDriverStatus(driverId: string, status: string, ttl: number = 600): Promise<void> {
    const key = `status:driver:${driverId}`;
    await safeRedisWrite(redis.setex(key, ttl, status));
  },

  async getDriverStatus(driverId: string): Promise<string | null> {
    const key = `status:driver:${driverId}`;
    return safeRedisRead(redis.get(key));
  },

  async setDriverHeartbeat(driverId: string, timestamp?: string, ttl: number = 600): Promise<void> {
    const key = `heartbeat:driver:${driverId}`;
    await safeRedisWrite(redis.setex(key, ttl, timestamp ?? new Date().toISOString()));
  },

  async getDriverHeartbeat(driverId: string): Promise<string | null> {
    const key = `heartbeat:driver:${driverId}`;
    return safeRedisRead(redis.get(key));
  },

  async getActiveDrivers(): Promise<string[]> {
    if (!isRedisCacheEnabled()) return [];
    try {
      const drivers: string[] = [];
      let cursor = '0';

      do {
        const [newCursor, keys] = await withRedisTimeout(
          redis.scan(cursor, 'MATCH', 'location:driver:*', 'COUNT', 100),
          getCommandTimeoutMs()
        );
        cursor = newCursor;

        for (const key of keys) {
          drivers.push(key.replace('location:driver:', ''));
        }
      } while (cursor !== '0');

      return drivers;
    } catch {
      markRedisUnavailable();
      return [];
    }
  },
};

/**
 * Pub/Sub channels for WebSocket broadcasting
 */
export const PubSubChannels = {
  LOCATION_UPDATE: 'location:update',
  DRIVER_STATUS: 'driver:status',
  DRIVER_ONLINE: 'driver:online',
  DRIVER_OFFLINE: 'driver:offline',
  TRIP_UPDATE: 'trip:update',
  BOOKING_UPDATE: 'booking:update',
  VIDEO_LIVE: 'video:live',
};

/**
 * Google Maps response cache (non-sensitive, normalized keys only)
 */
export const mapsCache = {
  async get<T>(key: string): Promise<T | null> {
    const data = await safeRedisRead(redis.get(`maps:${key}`));
    return data ? (JSON.parse(data) as T) : null;
  },

  async set(key: string, value: unknown, ttl: number): Promise<void> {
    await safeRedisWrite(redis.setex(`maps:${key}`, ttl, JSON.stringify(value)));
  },
};

/**
 * Health check for Redis
 * @returns Object with health status and latency
 */
export async function redisHealthCheck(): Promise<{
  healthy: boolean;
  latency?: number;
  error?: string;
  ping?: string;
  pubSub?: { publisher: boolean; subscriber: boolean };
}> {
  const start = Date.now();
  try {
    const mainPing = await pingWithRetry(redis);
    const [pubPing, subPing] = await Promise.all([
      pingWithRetry(redisPub),
      pingWithRetry(redisSub),
    ]);

    const latency = Date.now() - start;
    const publisher = pubPing === 'PONG';
    const subscriber = subPing === 'PONG';

    if (!publisher || !subscriber) {
      return {
        healthy: false,
        latency,
        ping: mainPing,
        pubSub: { publisher, subscriber },
        error: 'Redis pub/sub clients failed PING',
      };
    }

    return {
      healthy: true,
      latency,
      ping: 'PONG',
      pubSub: { publisher, subscriber },
    };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Verify namespaced driver-cache-style write-read (does not touch real driver keys).
 */
export async function verifyRedisRealtimeCache(): Promise<{
  pass: boolean;
  error?: string;
}> {
  const probeId = `${Date.now()}`;
  const locationKey = `health:probe:location:${probeId}`;
  const statusKey = `health:probe:status:${probeId}`;
  const ttlSeconds = 30;
  const probeLocation = JSON.stringify({
    latitude: 23.8103,
    longitude: 90.4125,
    timestamp: new Date().toISOString(),
  });

  try {
    await redis.setex(locationKey, ttlSeconds, probeLocation);
    await redis.setex(statusKey, ttlSeconds, 'online');

    const readLocation = await redis.get(locationKey);
    const readStatus = await redis.get(statusKey);

    await redis.del(locationKey, statusKey);

    const locationOk = readLocation === probeLocation;
    const statusOk = readStatus === 'online';

    if (!locationOk || !statusOk) {
      return { pass: false, error: 'Probe read-back mismatch' };
    }

    return { pass: true };
  } catch (error) {
    await redis.del(locationKey, statusKey).catch(() => {});
    return {
      pass: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Temporary pub/sub round-trip on an isolated health probe channel.
 */
export async function verifyRedisPubSub(): Promise<{
  pass: boolean;
  error?: string;
}> {
  const channel = `health:probe:pubsub:${Date.now()}`;
  const testMessage = `probe-${Date.now()}`;
  const probeSub = redisSub.duplicate();
  const probePub = redisPub.duplicate();

  try {
    const received = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Pub/sub probe timed out')), 5000);

      const onMessage = (ch: string, msg: string) => {
        if (ch !== channel) return;
        clearTimeout(timeout);
        probeSub.off('message', onMessage);
        resolve(msg);
      };

      probeSub.on('message', onMessage);
      probeSub.subscribe(channel).then(() => probePub.publish(channel, testMessage)).catch(reject);
    });

    if (received !== testMessage) {
      return { pass: false, error: 'Pub/sub message mismatch' };
    }

    return { pass: true };
  } catch (error) {
    return {
      pass: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    await probeSub.unsubscribe(channel).catch(() => {});
    await Promise.allSettled([probeSub.quit(), probePub.quit()]);
  }
}
