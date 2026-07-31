"use strict";
/**
 * Driver Inactivity Checker
 *
 * Marks drivers offline only when no fresh heartbeat, Redis location, or lastSeen
 * is available within the configured threshold.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDriverActivityFresh = isDriverActivityFresh;
exports.checkInactiveDrivers = checkInactiveDrivers;
exports.startInactivityChecker = startInactivityChecker;
const connection_1 = require("../db/connection");
const drivers_1 = require("../db/schema/drivers");
const locations_1 = require("../db/schema/locations");
const drizzle_orm_1 = require("drizzle-orm");
const utils_1 = require("../db/utils");
const redis_1 = require("../config/redis");
const INACTIVITY_THRESHOLD_MINUTES = parseInt(process.env.DRIVER_INACTIVITY_THRESHOLD_MINUTES || '10', 10);
const CHECK_INTERVAL_MS = 2 * 60 * 1000;
/**
 * Returns true if any authoritative activity timestamp is within the threshold.
 */
function isDriverActivityFresh(timestamps, thresholdMinutes = INACTIVITY_THRESHOLD_MINUTES) {
    const cutoff = Date.now() - thresholdMinutes * 60 * 1000;
    const candidates = [];
    if (timestamps.redisHeartbeat)
        candidates.push(timestamps.redisHeartbeat);
    if (timestamps.redisLocation)
        candidates.push(timestamps.redisLocation);
    if (timestamps.dbLastSeen)
        candidates.push(timestamps.dbLastSeen.toISOString());
    if (timestamps.dbLocation)
        candidates.push(timestamps.dbLocation.toISOString());
    return candidates.some((ts) => {
        const parsed = new Date(ts);
        return !Number.isNaN(parsed.getTime()) && parsed.getTime() >= cutoff;
    });
}
async function collectDriverActivity(driverId) {
    const [heartbeat, location, driverRow, latestLocation] = await Promise.all([
        redis_1.realtimeCache.getDriverHeartbeat(driverId),
        redis_1.realtimeCache.getDriverLocation(driverId),
        connection_1.db.select().from(drivers_1.drivers).where((0, drizzle_orm_1.eq)(drivers_1.drivers.id, driverId)).limit(1),
        connection_1.db
            .select()
            .from(locations_1.locations)
            .where((0, drizzle_orm_1.eq)(locations_1.locations.driverId, driverId))
            .orderBy((0, drizzle_orm_1.desc)(locations_1.locations.timestamp))
            .limit(1),
    ]);
    return {
        redisHeartbeat: heartbeat,
        redisLocation: location?.timestamp ?? null,
        dbLastSeen: driverRow[0]?.lastSeen ?? null,
        dbLocation: latestLocation[0]?.timestamp ?? null,
    };
}
async function checkInactiveDrivers() {
    try {
        const dbHealth = await (0, connection_1.healthCheck)();
        if (!dbHealth.healthy) {
            console.warn('[InactivityChecker] Database is unhealthy, skipping this cycle:', dbHealth.error);
            return;
        }
        console.log('[InactivityChecker] Checking for inactive drivers...');
        const onlineDrivers = await connection_1.db
            .select()
            .from(drivers_1.drivers)
            .where((0, drizzle_orm_1.eq)(drivers_1.drivers.status, 'online'));
        console.log(`[InactivityChecker] Found ${onlineDrivers.length} online drivers to check`);
        let inactiveCount = 0;
        for (const driver of onlineDrivers) {
            if (driver.status === 'busy')
                continue;
            const activity = await collectDriverActivity(driver.id);
            if (isDriverActivityFresh(activity))
                continue;
            const staleSource = activity.redisHeartbeat
                ? 'heartbeat'
                : activity.redisLocation
                    ? 'redis-location'
                    : activity.dbLastSeen
                        ? 'lastSeen'
                        : 'db-location';
            console.log(`[InactivityChecker] Driver ${driver.name} has no fresh activity (checked: heartbeat, redis-location, lastSeen, db-location; stale via ${staleSource}), setting to offline`);
            await utils_1.driverUtils.updateStatus(driver.id, 'offline');
            await redis_1.realtimeCache.setDriverStatus(driver.id, 'offline');
            inactiveCount++;
        }
        if (inactiveCount > 0) {
            console.log(`[InactivityChecker] Set ${inactiveCount} driver(s) to offline due to inactivity`);
        }
        else {
            console.log('[InactivityChecker] All online drivers have fresh activity signals');
        }
    }
    catch (error) {
        console.error('[InactivityChecker] Error checking inactive drivers:', error);
    }
}
function startInactivityChecker() {
    console.log(`[InactivityChecker] Starting background inactivity checker (interval: ${CHECK_INTERVAL_MS / 60000}min, threshold: ${INACTIVITY_THRESHOLD_MINUTES}min)`);
    checkInactiveDrivers();
    return setInterval(() => {
        checkInactiveDrivers();
    }, CHECK_INTERVAL_MS);
}
//# sourceMappingURL=driver-inactivity-checker.js.map