import Redis from 'ioredis';
export declare function isRedisRequired(): boolean;
/** Cache/session reads and writes (maps, driver location, sessions). */
export declare function isRedisCacheEnabled(): boolean;
/** Pub/Sub adapter and cross-process broadcasts. */
export declare function isRedisPubSubEnabled(): boolean;
/** Non-blocking publish for optional Redis pub/sub (fail-open). */
export declare function safeRedisPublish(channel: string, message: string): Promise<void>;
export declare const redis: Redis;
export declare const redisPub: Redis;
export declare const redisSub: Redis;
/**
 * Test Redis connection
 * @returns Promise that resolves if connection is successful
 */
export declare function testRedisConnection(): Promise<boolean>;
/**
 * Close all Redis connections
 */
export declare function closeRedisConnections(): Promise<void>;
/**
 * Session cache helper functions
 */
export declare const sessionCache: {
    set(sessionId: string, data: any, ttl?: number): Promise<void>;
    get(sessionId: string): Promise<any>;
    delete(sessionId: string): Promise<void>;
    exists(sessionId: string): Promise<boolean>;
};
/**
 * Real-time data cache helper functions
 */
export declare const realtimeCache: {
    setDriverLocation(driverId: string, location: any, ttl?: number): Promise<void>;
    getDriverLocation(driverId: string): Promise<any>;
    setDriverStatus(driverId: string, status: string, ttl?: number): Promise<void>;
    getDriverStatus(driverId: string): Promise<string | null>;
    setDriverHeartbeat(driverId: string, timestamp?: string, ttl?: number): Promise<void>;
    getDriverHeartbeat(driverId: string): Promise<string | null>;
    getActiveDrivers(): Promise<string[]>;
};
/**
 * Pub/Sub channels for WebSocket broadcasting
 */
export declare const PubSubChannels: {
    LOCATION_UPDATE: string;
    DRIVER_STATUS: string;
    DRIVER_ONLINE: string;
    DRIVER_OFFLINE: string;
    TRIP_UPDATE: string;
    BOOKING_UPDATE: string;
    VIDEO_LIVE: string;
};
/**
 * Google Maps response cache (non-sensitive, normalized keys only)
 */
export declare const mapsCache: {
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: unknown, ttl: number): Promise<void>;
};
/**
 * Health check for Redis
 * @returns Object with health status and latency
 */
export declare function redisHealthCheck(): Promise<{
    healthy: boolean;
    latency?: number;
    error?: string;
    ping?: string;
    pubSub?: {
        publisher: boolean;
        subscriber: boolean;
    };
}>;
/**
 * Verify namespaced driver-cache-style write-read (does not touch real driver keys).
 */
export declare function verifyRedisRealtimeCache(): Promise<{
    pass: boolean;
    error?: string;
}>;
/**
 * Temporary pub/sub round-trip on an isolated health probe channel.
 */
export declare function verifyRedisPubSub(): Promise<{
    pass: boolean;
    error?: string;
}>;
//# sourceMappingURL=redis.d.ts.map