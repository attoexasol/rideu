"use strict";
/**
 * Driver Inactivity Checker
 *
 * Automatically sets drivers to offline if they haven't sent a location update
 * in over 10 minutes. This handles cases where:
 * - Driver force-quits the app without logging out
 * - App crashes
 * - Phone dies/loses connection
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkInactiveDrivers = checkInactiveDrivers;
exports.startInactivityChecker = startInactivityChecker;
const connection_1 = require("../db/connection");
const drivers_1 = require("../db/schema/drivers");
const locations_1 = require("../db/schema/locations");
const drizzle_orm_1 = require("drizzle-orm");
const utils_1 = require("../db/utils");
const INACTIVITY_THRESHOLD_MINUTES = 10;
const CHECK_INTERVAL_MS = 2 * 60 * 1000; // Check every 2 minutes
/**
 * Check for inactive drivers and set them to offline
 */
async function checkInactiveDrivers() {
    try {
        // Skip this cycle if the database is unreachable
        const dbHealth = await (0, connection_1.healthCheck)();
        if (!dbHealth.healthy) {
            console.warn('[InactivityChecker] Database is unhealthy, skipping this cycle:', dbHealth.error);
            return;
        }
        console.log('[InactivityChecker] Checking for inactive drivers...');
        // Get all online drivers
        const onlineDrivers = await connection_1.db
            .select()
            .from(drivers_1.drivers)
            .where((0, drizzle_orm_1.eq)(drivers_1.drivers.status, 'online'));
        console.log(`[InactivityChecker] Found ${onlineDrivers.length} online drivers to check`);
        let inactiveCount = 0;
        const cutoffTime = new Date(Date.now() - INACTIVITY_THRESHOLD_MINUTES * 60 * 1000);
        for (const driver of onlineDrivers) {
            // Get driver's latest location
            const [latestLocation] = await connection_1.db
                .select()
                .from(locations_1.locations)
                .where((0, drizzle_orm_1.eq)(locations_1.locations.driverId, driver.id))
                .orderBy((0, drizzle_orm_1.desc)(locations_1.locations.timestamp))
                .limit(1);
            if (!latestLocation) {
                // No location data at all - this shouldn't happen for online drivers
                console.log(`[InactivityChecker] Driver ${driver.name} has no location data, setting to offline`);
                await utils_1.driverUtils.updateStatus(driver.id, 'offline');
                inactiveCount++;
                continue;
            }
            // Check if last location is older than threshold
            const lastLocationTime = new Date(latestLocation.timestamp);
            if (lastLocationTime < cutoffTime) {
                const minutesSinceLastUpdate = Math.floor((Date.now() - lastLocationTime.getTime()) / 60000);
                console.log(`[InactivityChecker] Driver ${driver.name} inactive for ${minutesSinceLastUpdate} minutes (last location: ${lastLocationTime.toISOString()}), setting to offline`);
                await utils_1.driverUtils.updateStatus(driver.id, 'offline');
                inactiveCount++;
            }
        }
        if (inactiveCount > 0) {
            console.log(`[InactivityChecker] Set ${inactiveCount} driver(s) to offline due to inactivity`);
        }
        else {
            console.log('[InactivityChecker] All online drivers are sending location updates');
        }
    }
    catch (error) {
        console.error('[InactivityChecker] Error checking inactive drivers:', error);
    }
}
/**
 * Start the inactivity checker background job
 */
function startInactivityChecker() {
    console.log(`[InactivityChecker] Starting background inactivity checker (interval: ${CHECK_INTERVAL_MS / 60000}min, threshold: ${INACTIVITY_THRESHOLD_MINUTES}min)`);
    // Run immediately on start
    checkInactiveDrivers();
    // Then run every 2 minutes
    return setInterval(() => {
        checkInactiveDrivers();
    }, CHECK_INTERVAL_MS);
}
//# sourceMappingURL=driver-inactivity-checker.js.map