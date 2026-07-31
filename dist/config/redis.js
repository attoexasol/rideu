"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapsCache = exports.PubSubChannels = exports.realtimeCache = exports.sessionCache = exports.redisSub = exports.redisPub = exports.redis = void 0;
exports.testRedisConnection = testRedisConnection;
exports.closeRedisConnections = closeRedisConnections;
exports.redisHealthCheck = redisHealthCheck;
exports.verifyRedisRealtimeCache = verifyRedisRealtimeCache;
exports.verifyRedisPubSub = verifyRedisPubSub;
const ioredis_1 = __importDefault(require("ioredis"));
/**
 * Redis client configuration for session caching and real-time data
 * Supports Pub/Sub for WebSocket scalability
 */
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_URL = process.env.REDIS_URL;
const redisOptions = {
    host: REDIS_HOST,
    port: REDIS_PORT,
    retryStrategy: (times) => {
        const delay = Math.min(times * 50, 5000);
        return delay;
    },
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
};
// Main Redis client for general operations
exports.redis = REDIS_URL ? new ioredis_1.default(REDIS_URL, redisOptions) : new ioredis_1.default(redisOptions);
// Publisher client for Pub/Sub (WebSocket broadcasting)
exports.redisPub = REDIS_URL ? new ioredis_1.default(REDIS_URL, redisOptions) : new ioredis_1.default(redisOptions);
// Subscriber client for Pub/Sub (WebSocket broadcasting)
exports.redisSub = REDIS_URL ? new ioredis_1.default(REDIS_URL, redisOptions) : new ioredis_1.default(redisOptions);
// Connection event handlers
exports.redis.on('connect', () => {
    console.log('✓ Redis client connected');
});
exports.redis.on('error', (err) => {
    console.error('✗ Redis client error:', err);
});
exports.redis.on('ready', () => {
    console.log('✓ Redis client ready');
});
exports.redisPub.on('connect', () => {
    console.log('✓ Redis publisher connected');
});
exports.redisPub.on('error', (err) => {
    console.error('✗ Redis publisher error:', err);
});
exports.redisSub.on('connect', () => {
    console.log('✓ Redis subscriber connected');
});
exports.redisSub.on('error', (err) => {
    console.error('✗ Redis subscriber error:', err);
});
async function pingClient(client) {
    const result = await client.ping();
    const normalized = String(result).trim().toUpperCase();
    if (normalized.startsWith('PONG'))
        return 'PONG';
    return String(result).trim();
}
async function pingWithRetry(client, attempts = 5, delayMs = 200) {
    let lastError;
    for (let i = 0; i < attempts; i++) {
        try {
            const result = await pingClient(client);
            if (result === 'PONG')
                return result;
            lastError = new Error(`Unexpected PING response: ${result}`);
        }
        catch (err) {
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
async function testRedisConnection() {
    try {
        const result = await pingWithRetry(exports.redis);
        console.log('✓ Redis connection successful');
        return result === 'PONG';
    }
    catch (error) {
        console.error('✗ Redis connection failed:', error);
        return false;
    }
}
/**
 * Close all Redis connections
 */
async function closeRedisConnections() {
    try {
        await Promise.all([exports.redis.quit(), exports.redisPub.quit(), exports.redisSub.quit()]);
        console.log('✓ All Redis connections closed');
    }
    catch (error) {
        console.error('✗ Error closing Redis connections:', error);
    }
}
/**
 * Session cache helper functions
 */
exports.sessionCache = {
    /**
     * Store session data in Redis
     * @param sessionId - Unique session identifier
     * @param data - Session data to store
     * @param ttl - Time to live in seconds (default: 24 hours)
     */
    async set(sessionId, data, ttl = 86400) {
        const key = `session:${sessionId}`;
        await exports.redis.setex(key, ttl, JSON.stringify(data));
    },
    /**
     * Retrieve session data from Redis
     * @param sessionId - Unique session identifier
     * @returns Session data or null if not found
     */
    async get(sessionId) {
        const key = `session:${sessionId}`;
        const data = await exports.redis.get(key);
        return data ? JSON.parse(data) : null;
    },
    /**
     * Delete session from Redis
     * @param sessionId - Unique session identifier
     */
    async delete(sessionId) {
        const key = `session:${sessionId}`;
        await exports.redis.del(key);
    },
    /**
     * Check if session exists
     * @param sessionId - Unique session identifier
     * @returns Boolean indicating if session exists
     */
    async exists(sessionId) {
        const key = `session:${sessionId}`;
        const result = await exports.redis.exists(key);
        return result === 1;
    },
};
/**
 * Real-time data cache helper functions
 */
exports.realtimeCache = {
    /**
     * Store driver's latest location in Redis
     * @param driverId - Driver unique identifier
     * @param location - Location data
     * @param ttl - Time to live in seconds (default: 5 minutes)
     */
    async setDriverLocation(driverId, location, ttl = 300) {
        const key = `location:driver:${driverId}`;
        await exports.redis.setex(key, ttl, JSON.stringify(location));
    },
    /**
     * Get driver's latest location from Redis
     * @param driverId - Driver unique identifier
     * @returns Location data or null
     */
    async getDriverLocation(driverId) {
        const key = `location:driver:${driverId}`;
        const data = await exports.redis.get(key);
        return data ? JSON.parse(data) : null;
    },
    /**
     * Store driver status in Redis
     * @param driverId - Driver unique identifier
     * @param status - Driver status (online, offline)
     * @param ttl - Time to live in seconds (default: 10 minutes)
     */
    async setDriverStatus(driverId, status, ttl = 600) {
        const key = `status:driver:${driverId}`;
        await exports.redis.setex(key, ttl, status);
    },
    /**
     * Get driver status from Redis
     * @param driverId - Driver unique identifier
     * @returns Driver status or null
     */
    async getDriverStatus(driverId) {
        const key = `status:driver:${driverId}`;
        return await exports.redis.get(key);
    },
    /**
     * Store driver heartbeat (refreshed on every valid location post).
     */
    async setDriverHeartbeat(driverId, timestamp, ttl = 600) {
        const key = `heartbeat:driver:${driverId}`;
        await exports.redis.setex(key, ttl, timestamp ?? new Date().toISOString());
    },
    /**
     * Get driver heartbeat ISO timestamp.
     */
    async getDriverHeartbeat(driverId) {
        const key = `heartbeat:driver:${driverId}`;
        return await exports.redis.get(key);
    },
    /**
     * Get all active drivers (with recent location updates)
     * Uses SCAN instead of KEYS to avoid blocking
     * @returns Array of driver IDs
     */
    async getActiveDrivers() {
        const drivers = [];
        let cursor = '0';
        do {
            const [newCursor, keys] = await exports.redis.scan(cursor, 'MATCH', 'location:driver:*', 'COUNT', 100);
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
exports.PubSubChannels = {
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
exports.mapsCache = {
    async get(key) {
        try {
            const data = await exports.redis.get(`maps:${key}`);
            return data ? JSON.parse(data) : null;
        }
        catch {
            return null;
        }
    },
    async set(key, value, ttl) {
        try {
            await exports.redis.setex(`maps:${key}`, ttl, JSON.stringify(value));
        }
        catch {
            // Cache failures must not break requests
        }
    },
};
/**
 * Health check for Redis
 * @returns Object with health status and latency
 */
async function redisHealthCheck() {
    const start = Date.now();
    try {
        const mainPing = await pingWithRetry(exports.redis);
        const [pubPing, subPing] = await Promise.all([
            pingWithRetry(exports.redisPub),
            pingWithRetry(exports.redisSub),
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
    }
    catch (error) {
        return {
            healthy: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}
/**
 * Verify namespaced driver-cache-style write-read (does not touch real driver keys).
 */
async function verifyRedisRealtimeCache() {
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
        await exports.redis.setex(locationKey, ttlSeconds, probeLocation);
        await exports.redis.setex(statusKey, ttlSeconds, 'online');
        const readLocation = await exports.redis.get(locationKey);
        const readStatus = await exports.redis.get(statusKey);
        await exports.redis.del(locationKey, statusKey);
        const locationOk = readLocation === probeLocation;
        const statusOk = readStatus === 'online';
        if (!locationOk || !statusOk) {
            return { pass: false, error: 'Probe read-back mismatch' };
        }
        return { pass: true };
    }
    catch (error) {
        await exports.redis.del(locationKey, statusKey).catch(() => { });
        return {
            pass: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}
/**
 * Temporary pub/sub round-trip on an isolated health probe channel.
 */
async function verifyRedisPubSub() {
    const channel = `health:probe:pubsub:${Date.now()}`;
    const testMessage = `probe-${Date.now()}`;
    const probeSub = exports.redisSub.duplicate();
    const probePub = exports.redisPub.duplicate();
    try {
        const received = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Pub/sub probe timed out')), 5000);
            const onMessage = (ch, msg) => {
                if (ch !== channel)
                    return;
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
    }
    catch (error) {
        return {
            pass: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
    finally {
        await probeSub.unsubscribe(channel).catch(() => { });
        await Promise.allSettled([probeSub.quit(), probePub.quit()]);
    }
}
//# sourceMappingURL=redis.js.map