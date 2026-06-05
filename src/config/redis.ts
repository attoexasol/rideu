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
export const redis = REDIS_URL
  ? new Redis(REDIS_URL, redisOptions)
  : new Redis(redisOptions);

// Publisher client for Pub/Sub (WebSocket broadcasting)
export const redisPub = REDIS_URL
  ? new Redis(REDIS_URL, redisOptions)
  : new Redis(redisOptions);

// Subscriber client for Pub/Sub (WebSocket broadcasting)
export const redisSub = REDIS_URL
  ? new Redis(REDIS_URL, redisOptions)
  : new Redis(redisOptions);

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

/**
 * Test Redis connection
 * @returns Promise that resolves if connection is successful
 */
export async function testRedisConnection(): Promise<boolean> {
  try {
    await redis.ping();
    console.log('✓ Redis connection successful');
    return true;
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
    await Promise.all([
      redis.quit(),
      redisPub.quit(),
      redisSub.quit(),
    ]);
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
};

/**
 * Health check for Redis
 * @returns Object with health status and latency
 */
export async function redisHealthCheck(): Promise<{ healthy: boolean; latency?: number; error?: string }> {
  const start = Date.now();
  try {
    await redis.ping();
    const latency = Date.now() - start;
    return { healthy: true, latency };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
