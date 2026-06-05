/**
 * Driver Inactivity Checker
 *
 * Automatically sets drivers to offline if they haven't sent a location update
 * in over 10 minutes. This handles cases where:
 * - Driver force-quits the app without logging out
 * - App crashes
 * - Phone dies/loses connection
 */
/**
 * Check for inactive drivers and set them to offline
 */
export declare function checkInactiveDrivers(): Promise<void>;
/**
 * Start the inactivity checker background job
 */
export declare function startInactivityChecker(): NodeJS.Timeout;
//# sourceMappingURL=driver-inactivity-checker.d.ts.map