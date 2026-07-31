import Redis from 'ioredis';
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
    /**
     * Store session data in Redis
     * @param sessionId - Unique session identifier
     * @param data - Session data to store
     * @param ttl - Time to live in seconds (default: 24 hours)
     */
    set(sessionId: string, data: any, ttl?: number): Promise<void>;
    /**
     * Retrieve session data from Redis
     * @param sessionId - Unique session identifier
     * @returns Session data or null if not found
     */
    get(sessionId: string): Promise<any>;
    /**
     * Delete session from Redis
     * @param sessionId - Unique session identifier
     */
    delete(sessionId: string): Promise<void>;
    /**
     * Check if session exists
     * @param sessionId - Unique session identifier
     * @returns Boolean indicating if session exists
     */
    exists(sessionId: string): Promise<boolean>;
};
/**
 * Real-time data cache helper functions
 */
export declare const realtimeCache: {
    /**
     * Store driver's latest location in Redis
     * @param driverId - Driver unique identifier
     * @param location - Location data
     * @param ttl - Time to live in seconds (default: 5 minutes)
     */
    setDriverLocation(driverId: string, location: any, ttl?: number): Promise<void>;
    /**
     * Get driver's latest location from Redis
     * @param driverId - Driver unique identifier
     * @returns Location data or null
     */
    getDriverLocation(driverId: string): Promise<any>;
    /**
     * Store driver status in Redis
     * @param driverId - Driver unique identifier
     * @param status - Driver status (online, offline)
     * @param ttl - Time to live in seconds (default: 10 minutes)
     */
    setDriverStatus(driverId: string, status: string, ttl?: number): Promise<void>;
    /**
     * Get driver status from Redis
     * @param driverId - Driver unique identifier
     * @returns Driver status or null
     */
    getDriverStatus(driverId: string): Promise<string | null>;
    /**
     * Store driver heartbeat (refreshed on every valid location post).
     */
    setDriverHeartbeat(driverId: string, timestamp?: string, ttl?: number): Promise<void>;
    /**
     * Get driver heartbeat ISO timestamp.
     */
    getDriverHeartbeat(driverId: string): Promise<string | null>;
    /**
     * Get all active drivers (with recent location updates)
     * Uses SCAN instead of KEYS to avoid blocking
     * @returns Array of driver IDs
     */
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