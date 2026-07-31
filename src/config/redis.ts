import Redis, { RedisOptions } from 'ioredis';

/**
 * Redis client configuration for session caching and real-time data
 * Supports Pub/Sub for WebSocket scalability
 */

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_URL = process.env.REDIS_URL;

const redisOptions: RedisOptions = {
  host: REDIS_HOST,
  port: REDIS_PORT,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 5000);
    return delay;
  },
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
};

// Main Redis client for general operations
export const redis = REDIS_URL ? new Redis(REDIS_URL, redisOptions) : new Redis(redisOptions);

// Publisher client for Pub/Sub (WebSocket broadcasting)
export const redisPub = REDIS_URL ? new Redis(REDIS_URL, redisOptions) : new Redis(redisOptions);

// Subscriber client for Pub/Sub (WebSocket broadcasting)
export const redisSub = REDIS_URL ? new Redis(REDIS_URL, redisOptions) : new Redis(redisOptions);

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
  /**
   * Store session data in Redis
   * @param sessionId - Unique session identifier
   * @param data - Session data to store
   * @param ttl - Time to live in seconds (default: 24 hours)
   */
  async set(sessionId: string, data: any, ttl: number = 86400): Promise<void> {
    const key = `session:${sessionId}`;
    await redis.setex(key, ttl, JSON.stringify(data));
  },

  /**
   * Retrieve session data from Redis
   * @param sessionId - Unique session identifier
   * @returns Session data or null if not found
   */
  async get(sessionId: string): Promise<any> {
    const key = `session:${sessionId}`;
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  },

  /**
   * Delete session from Redis
   * @param sessionId - Unique session identifier
   */
  async delete(sessionId: string): Promise<void> {
    const key = `session:${sessionId}`;
    await redis.del(key);
  },

  /**
   * Check if session exists
   * @param sessionId - Unique session identifier
   * @returns Boolean indicating if session exists
   */
  async exists(sessionId: string): Promise<boolean> {
    const key = `session:${sessionId}`;
    const result = await redis.exists(key);
    return result === 1;
  },
};

/**
 * Real-time data cache helper functions
 */
export const realtimeCache = {
  /**
   * Store driver's latest location in Redis
   * @param driverId - Driver unique identifier
   * @param location - Location data
   * @param ttl - Time to live in seconds (default: 5 minutes)
   */
  async setDriverLocation(driverId: string, location: any, ttl: number = 300): Promise<void> {
    const key = `location:driver:${driverId}`;
    await redis.setex(key, ttl, JSON.stringify(location));
  },

  /**
   * Get driver's latest location from Redis
   * @param driverId - Driver unique identifier
   * @returns Location data or null
   */
  async getDriverLocation(driverId: string): Promise<any> {
    const key = `location:driver:${driverId}`;
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  },

  /**
   * Store driver status in Redis
   * @param driverId - Driver unique identifier
   * @param status - Driver status (online, offline)
   * @param ttl - Time to live in seconds (default: 10 minutes)
   */
  async setDriverStatus(driverId: string, status: string, ttl: number = 600): Promise<void> {
    const key = `status:driver:${driverId}`;
    await redis.setex(key, ttl, status);
  },

  /**
   * Get driver status from Redis
   * @param driverId - Driver unique identifier
   * @returns Driver status or null
   */
  async getDriverStatus(driverId: string): Promise<string | null> {
    const key = `status:driver:${driverId}`;
    return await redis.get(key);
  },

  /**
   * Store driver heartbeat (refreshed on every valid location post).
   */
  async setDriverHeartbeat(driverId: string, timestamp?: string, ttl: number = 600): Promise<void> {
    const key = `heartbeat:driver:${driverId}`;
    await redis.setex(key, ttl, timestamp ?? new Date().toISOString());
  },

  /**
   * Get driver heartbeat ISO timestamp.
   */
  async getDriverHeartbeat(driverId: string): Promise<string | null> {
    const key = `heartbeat:driver:${driverId}`;
    return await redis.get(key);
  },

  /**
   * Get all active drivers (with recent location updates)
   * Uses SCAN instead of KEYS to avoid blocking
   * @returns Array of driver IDs
   */
  async getActiveDrivers(): Promise<string[]> {
    const drivers: string[] = [];
    let cursor = '0';

    do {
      const [newCursor, keys] = await redis.scan(
        cursor,
        'MATCH',
        'location:driver:*',
        'COUNT',
        100
      );
      cursor = newCursor;

      for (const key of keys) {
        drivers.push(key.replace('location:driver:', ''));
      }
    } while (cursor !== '0');

    return drivers;
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
    try {
      const data = await redis.get(`maps:${key}`);
      return data ? (JSON.parse(data) as T) : null;
    } catch {
      return null;
    }
  },

  async set(key: string, value: unknown, ttl: number): Promise<void> {
    try {
      await redis.setex(`maps:${key}`, ttl, JSON.stringify(value));
    } catch {
      // Cache failures must not break requests
    }
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
