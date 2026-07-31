/**
 * Driver Inactivity Checker
 *
 * Marks drivers offline only when no fresh heartbeat, Redis location, or lastSeen
 * is available within the configured threshold.
 */

import { db, healthCheck } from '../db/connection';
import { drivers } from '../db/schema/drivers';
import { locations } from '../db/schema/locations';
import { eq, desc } from 'drizzle-orm';
import { driverUtils } from '../db/utils';
import { realtimeCache } from '../config/redis';

const INACTIVITY_THRESHOLD_MINUTES = parseInt(
  process.env.DRIVER_INACTIVITY_THRESHOLD_MINUTES || '10',
  10
);
const CHECK_INTERVAL_MS = 2 * 60 * 1000;

export interface DriverActivityTimestamps {
  redisHeartbeat?: string | null;
  redisLocation?: string | null;
  dbLastSeen?: Date | null;
  dbLocation?: Date | null;
}

/**
 * Returns true if any authoritative activity timestamp is within the threshold.
 */
export function isDriverActivityFresh(
  timestamps: DriverActivityTimestamps,
  thresholdMinutes = INACTIVITY_THRESHOLD_MINUTES
): boolean {
  const cutoff = Date.now() - thresholdMinutes * 60 * 1000;
  const candidates: string[] = [];

  if (timestamps.redisHeartbeat) candidates.push(timestamps.redisHeartbeat);
  if (timestamps.redisLocation) candidates.push(timestamps.redisLocation);
  if (timestamps.dbLastSeen) candidates.push(timestamps.dbLastSeen.toISOString());
  if (timestamps.dbLocation) candidates.push(timestamps.dbLocation.toISOString());

  return candidates.some((ts) => {
    const parsed = new Date(ts);
    return !Number.isNaN(parsed.getTime()) && parsed.getTime() >= cutoff;
  });
}

async function collectDriverActivity(driverId: string): Promise<DriverActivityTimestamps> {
  const [heartbeat, location, driverRow, latestLocation] = await Promise.all([
    realtimeCache.getDriverHeartbeat(driverId),
    realtimeCache.getDriverLocation(driverId),
    db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1),
    db
      .select()
      .from(locations)
      .where(eq(locations.driverId, driverId))
      .orderBy(desc(locations.timestamp))
      .limit(1),
  ]);

  return {
    redisHeartbeat: heartbeat,
    redisLocation: location?.timestamp ?? null,
    dbLastSeen: driverRow[0]?.lastSeen ?? null,
    dbLocation: latestLocation[0]?.timestamp ?? null,
  };
}

export async function checkInactiveDrivers() {
  try {
    const dbHealth = await healthCheck();
    if (!dbHealth.healthy) {
      console.warn(
        '[InactivityChecker] Database is unhealthy, skipping this cycle:',
        dbHealth.error
      );
      return;
    }

    console.log('[InactivityChecker] Checking for inactive drivers...');

    const onlineDrivers = await db
      .select()
      .from(drivers)
      .where(eq(drivers.status, 'online'));

    console.log(`[InactivityChecker] Found ${onlineDrivers.length} online drivers to check`);

    let inactiveCount = 0;

    for (const driver of onlineDrivers) {
      if (driver.status === 'busy') continue;

      const activity = await collectDriverActivity(driver.id);
      if (isDriverActivityFresh(activity)) continue;

      const staleSource = activity.redisHeartbeat
        ? 'heartbeat'
        : activity.redisLocation
          ? 'redis-location'
          : activity.dbLastSeen
            ? 'lastSeen'
            : 'db-location';

      console.log(
        `[InactivityChecker] Driver ${driver.name} has no fresh activity (checked: heartbeat, redis-location, lastSeen, db-location; stale via ${staleSource}), setting to offline`
      );

      await driverUtils.updateStatus(driver.id, 'offline');
      await realtimeCache.setDriverStatus(driver.id, 'offline');
      inactiveCount++;
    }

    if (inactiveCount > 0) {
      console.log(
        `[InactivityChecker] Set ${inactiveCount} driver(s) to offline due to inactivity`
      );
    } else {
      console.log('[InactivityChecker] All online drivers have fresh activity signals');
    }
  } catch (error) {
    console.error('[InactivityChecker] Error checking inactive drivers:', error);
  }
}

export function startInactivityChecker(): NodeJS.Timeout {
  console.log(
    `[InactivityChecker] Starting background inactivity checker (interval: ${CHECK_INTERVAL_MS / 60000}min, threshold: ${INACTIVITY_THRESHOLD_MINUTES}min)`
  );

  checkInactiveDrivers();

  return setInterval(() => {
    checkInactiveDrivers();
  }, CHECK_INTERVAL_MS);
}
