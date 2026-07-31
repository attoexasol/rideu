/**
 * Driver Inactivity Checker
 *
 * Marks drivers offline only when no fresh heartbeat, Redis location, or lastSeen
 * is available within the configured threshold.
 */
export interface DriverActivityTimestamps {
    redisHeartbeat?: string | null;
    redisLocation?: string | null;
    dbLastSeen?: Date | null;
    dbLocation?: Date | null;
}
/**
 * Returns true if any authoritative activity timestamp is within the threshold.
 */
export declare function isDriverActivityFresh(timestamps: DriverActivityTimestamps, thresholdMinutes?: number): boolean;
export declare function checkInactiveDrivers(): Promise<void>;
export declare function startInactivityChecker(): NodeJS.Timeout;
//# sourceMappingURL=driver-inactivity-checker.d.ts.map