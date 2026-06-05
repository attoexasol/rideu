/**
 * Driver Inactivity Checker
 *
 * Automatically sets drivers to offline if they haven't sent a location update
 * in over 10 minutes. This handles cases where:
 * - Driver force-quits the app without logging out
 * - App crashes
 * - Phone dies/loses connection
 */

import { db, healthCheck } from '../db/connection';
import { drivers } from '../db/schema/drivers';
import { locations } from '../db/schema/locations';
import { eq, desc } from 'drizzle-orm';
import { driverUtils } from '../db/utils';

const INACTIVITY_THRESHOLD_MINUTES = 10;
const CHECK_INTERVAL_MS = 2 * 60 * 1000; // Check every 2 minutes

/**
 * Check for inactive drivers and set them to offline
 */
export async function checkInactiveDrivers() {
  try {
    // Skip this cycle if the database is unreachable
    const dbHealth = await healthCheck();
    if (!dbHealth.healthy) {
      console.warn('[InactivityChecker] Database is unhealthy, skipping this cycle:', dbHealth.error);
      return;
    }

    console.log('[InactivityChecker] Checking for inactive drivers...');

    // Get all online drivers
    const onlineDrivers = await db
      .select()
      .from(drivers)
      .where(eq(drivers.status, 'online'));

    console.log(`[InactivityChecker] Found ${onlineDrivers.length} online drivers to check`);

    let inactiveCount = 0;
    const cutoffTime = new Date(Date.now() - INACTIVITY_THRESHOLD_MINUTES * 60 * 1000);

    for (const driver of onlineDrivers) {
      // Get driver's latest location
      const [latestLocation] = await db
        .select()
        .from(locations)
        .where(eq(locations.driverId, driver.id))
        .orderBy(desc(locations.timestamp))
        .limit(1);

      if (!latestLocation) {
        // No location data at all - this shouldn't happen for online drivers
        console.log(`[InactivityChecker] Driver ${driver.name} has no location data, setting to offline`);
        await driverUtils.updateStatus(driver.id, 'offline');
        inactiveCount++;
        continue;
      }

      // Check if last location is older than threshold
      const lastLocationTime = new Date(latestLocation.timestamp);
      if (lastLocationTime < cutoffTime) {
        const minutesSinceLastUpdate = Math.floor((Date.now() - lastLocationTime.getTime()) / 60000);
        console.log(
          `[InactivityChecker] Driver ${driver.name} inactive for ${minutesSinceLastUpdate} minutes (last location: ${lastLocationTime.toISOString()}), setting to offline`
        );
        await driverUtils.updateStatus(driver.id, 'offline');
        inactiveCount++;
      }
    }

    if (inactiveCount > 0) {
      console.log(`[InactivityChecker] Set ${inactiveCount} driver(s) to offline due to inactivity`);
    } else {
      console.log('[InactivityChecker] All online drivers are sending location updates');
    }
  } catch (error) {
    console.error('[InactivityChecker] Error checking inactive drivers:', error);
  }
}

/**
 * Start the inactivity checker background job
 */
export function startInactivityChecker(): NodeJS.Timeout {
  console.log(`[InactivityChecker] Starting background inactivity checker (interval: ${CHECK_INTERVAL_MS / 60000}min, threshold: ${INACTIVITY_THRESHOLD_MINUTES}min)`);

  // Run immediately on start
  checkInactiveDrivers();

  // Then run every 2 minutes
  return setInterval(() => {
    checkInactiveDrivers();
  }, CHECK_INTERVAL_MS);
}
