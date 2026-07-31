/**
 * Location Routes
 *
 * POST /api/locations - Submit GPS location (from driver app)
 * GET /api/locations/:driverId - Get location history for driver
 * GET /api/locations/active - Get all active driver locations
 */

import express from 'express';
import { requireAuth, extractUserInfo } from '../middleware/auth';
import { requireAdmin, requireDriver } from '../middleware/rbac';
import { validate, submitLocationSchema, getLocationsQuerySchema } from '../validators';
import { sendSuccess, sendError, sendNotFound } from '../utils/response';
import { asyncHandler } from '../middleware/error-handler';
import { driverLocationRateLimit } from '../middleware/rate-limiters';
import { db } from '../db/connection';
import { locations } from '../db/schema/locations';
import { drivers } from '../db/schema/drivers';
import { driverUtils, locationUtils } from '../db/utils';
import { eq, lte } from 'drizzle-orm';
import { realtimeCache, redisPub, PubSubChannels } from '../config/redis';
import { snapToRoadsBatch } from '../services/mapboxMatching';
import { findActiveBookingByDriver } from '../repositories/booking.repository';
import { emitDriverLocationToCustomer } from '../services/bookingNotify.service';
import { dispatchConfig } from '../config/dispatch';
import { isLocationFresh } from '../services/driverAvailability.service';
import { qrDutyRequired } from '../config/duty';
import { shouldAllowGpsOnlineTransition } from '../services/duty.service';
import {
  detectSessions,
  filterSignificantPoints,
  calculateSessionDistance,
} from '../utils/sessions';

const router = express.Router();
const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN || '';

/**
 * GET /api/locations/active
 * Get all driver locations (most recent for each driver)
 * Must be before /:driverId route
 */
router.get(
  '/active',
  requireAuth,
  extractUserInfo,
  requireAdmin,
  asyncHandler(async (_req: express.Request, res: express.Response) => {
    // Get ALL drivers (not just online)
    const allDrivers = await db
      .select({
        driverId: drivers.id,
        driverName: drivers.name,
        status: drivers.status,
        lastSeen: drivers.lastSeen,
      })
      .from(drivers);

    // Get latest location for each driver
    const driversWithLocations = await Promise.all(
      allDrivers.map(async (driver) => {
        const location = await locationUtils.getLatestForDriver(driver.driverId);
        return {
          driverId: driver.driverId,
          driverName: driver.driverName,
          status: driver.status,
          lastSeen: driver.lastSeen,
          latitude: location?.latitude || null,
          longitude: location?.longitude || null,
          timestamp: location?.timestamp || driver.lastSeen,
        };
      })
    );

    // Filter out drivers without locations
    const driversWithValidLocations = driversWithLocations.filter(
      (d) => d.latitude !== null && d.longitude !== null
    );

    return sendSuccess(res, driversWithValidLocations);
  })
);

/**
 * POST /api/locations
 * Submit GPS location (from driver app)
 */
router.post(
  '/',
  requireAuth,
  extractUserInfo,
  requireDriver, // Includes device tracking automatically
  driverLocationRateLimit,
  validate(submitLocationSchema),
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const { latitude, longitude, accuracy, speed, heading, timestamp, bookingId } = req.body;
    const user = (req as any).user;

    if (!isLocationFresh(timestamp, dispatchConfig.driverLocationStaleSeconds + 30)) {
      return sendError(res, 'LOCATION_STALE', 'Location timestamp is too old', 400);
    }

    // Get driver from database
    const driver = await driverUtils.findByAuth0Id(user.auth0Id);

    if (!driver) {
      return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
    }

    // Check if we should save to database (distance filter)
    const lastLocation = await locationUtils.getLatestForDriver(driver.id);
    let shouldSaveToDatabase = true;
    let distanceFromLast = 0;

    if (lastLocation) {
      // Calculate distance from last saved location using Haversine formula
      const R = 6371e3; // Earth's radius in meters
      const φ1 = (parseFloat(lastLocation.latitude) * Math.PI) / 180;
      const φ2 = (latitude * Math.PI) / 180;
      const Δφ = ((latitude - parseFloat(lastLocation.latitude)) * Math.PI) / 180;
      const Δλ = ((longitude - parseFloat(lastLocation.longitude)) * Math.PI) / 180;

      const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      distanceFromLast = R * c; // Distance in meters

      // Only save if moved more than 10 meters (filters GPS jitter/inaccuracy while capturing actual movement)
      shouldSaveToDatabase = distanceFromLast >= 10;
    }

    let newLocation = null;
    if (shouldSaveToDatabase) {
      // Create location record
      [newLocation] = await db
        .insert(locations)
        .values({
          driverId: driver.id,
          latitude: latitude.toString(),
          longitude: longitude.toString(),
          accuracy: accuracy ? accuracy.toString() : null,
          speed: speed ? speed.toString() : null,
          heading: heading ? heading.toString() : null,
          timestamp: new Date(timestamp),
        })
        .returning();

      console.log(
        `💾 Location saved to database (distance: ${distanceFromLast.toFixed(1)}m from last)`
      );
    } else {
      console.log(
        `⏭️  Location not saved (only ${distanceFromLast.toFixed(1)}m from last, need 10m+)`
      );
    }

    // Always refresh heartbeat and last-seen — independent of location-history persistence.
    const activityTimestamp = timestamp || new Date().toISOString();
    await realtimeCache.setDriverHeartbeat(driver.id, activityTimestamp);
    await db
      .update(drivers)
      .set({ lastSeen: new Date(activityTimestamp), updatedAt: new Date() })
      .where(eq(drivers.id, driver.id));

    // Update driver status to online only when allowed (duty-aware when QR_DUTY_REQUIRED)
    const allowOnline =
      !qrDutyRequired || (await shouldAllowGpsOnlineTransition(driver.id));
    if (allowOnline && driver.status !== 'busy') {
      await driverUtils.updateStatus(driver.id, 'online');
      await realtimeCache.setDriverStatus(driver.id, 'online');
    }

    // Try to snap coordinates to nearest road (for smoother map display)
    let snappedLat = latitude;
    let snappedLng = longitude;

    try {
      // Get previous location from cache to enable road snapping
      const previousLocation = await realtimeCache.getDriverLocation(driver.id);

      if (previousLocation && MAPBOX_ACCESS_TOKEN) {
        // We have previous location - snap [previous, current] to roads
        const coordinates = [
          {
            latitude: previousLocation.latitude,
            longitude: previousLocation.longitude,
            timestamp: previousLocation.timestamp,
          },
          {
            latitude: latitude,
            longitude: longitude,
            timestamp: activityTimestamp,
          },
        ];

        console.log(`  🛣️  Snapping live position to road for ${driver.name}`);
        const result = await snapToRoadsBatch(coordinates);

        // Use the snapped version of the CURRENT position (last point)
        if (result.matched && result.matched.length > 0) {
          const snappedCurrent = result.matched[result.matched.length - 1];
          snappedLat = snappedCurrent.latitude;
          snappedLng = snappedCurrent.longitude;
          console.log(
            `  ✅ Position snapped to road (${snappedCurrent.distance.toFixed(1)}m from GPS)`
          );
        }
      }
    } catch (error) {
      // If road-snapping fails, just use raw GPS coordinates
      console.log(
        `  ⏭️  Road snapping skipped/failed, using raw GPS:`,
        error instanceof Error ? error.message : 'Unknown error'
      );
    }

    // Cache latest dispatch location in Redis on every valid update.
    await realtimeCache.setDriverLocation(driver.id, {
      latitude: latitude,
      longitude: longitude,
      snappedLatitude: snappedLat,
      snappedLongitude: snappedLng,
      speed: speed,
      heading: heading,
      timestamp: activityTimestamp,
    });

    // Broadcast location update to all connected admin clients via WebSocket
    try {
      // Get io instance (import dynamically to avoid circular dependency)
      const { io } = await import('../index');

      const broadcastPayload = {
        driverId: driver.id,
        driverName: driver.name,
        latitude: latitude,
        longitude: longitude,
        snappedLatitude: snappedLat,
        snappedLongitude: snappedLng,
        speed: speed,
        heading: heading,
        timestamp: activityTimestamp,
      };

      // Emit to admin room
      console.log(
        `  📡 Broadcasting location to ${io.sockets.adapter.rooms.get('admin')?.size || 0} admins in 'admin' room`
      );
      io.to('admin').emit('location:broadcast', broadcastPayload);

      // Also publish to Redis Pub/Sub for multi-server scalability
      await redisPub.publish(PubSubChannels.LOCATION_UPDATE, JSON.stringify(broadcastPayload));

      console.log(`  📍 Location from ${driver.name} broadcast to admin clients via WebSocket`);
    } catch (error) {
      console.error('Failed to broadcast location update:', error);
      // Don't fail the request if broadcast fails
    }

    const activeBooking = bookingId
      ? await findActiveBookingByDriver(driver.id).then((b) =>
          b && b.id === bookingId ? b : null
        )
      : await findActiveBookingByDriver(driver.id);

    if (bookingId && !activeBooking) {
      return sendError(
        res,
        'BOOKING_NOT_ASSIGNED',
        'bookingId does not match an active assigned booking',
        400
      );
    }

    if (activeBooking) {
      const speedKph = speed != null && speed >= 0 ? speed * 3.6 : null;
      await emitDriverLocationToCustomer(activeBooking.customerId, {
        driverId: driver.id,
        bookingId: activeBooking.id,
        latitude,
        longitude,
        heading: heading ?? null,
        speedKph,
        accuracyMeters: accuracy ?? null,
        timestamp: activityTimestamp,
      });
    }

    return sendSuccess(
      res,
      {
        id: newLocation?.id || null,
        driverId: driver.id,
        latitude: latitude,
        longitude: longitude,
        timestamp: activityTimestamp,
        saved: shouldSaveToDatabase,
        distanceFromLast: distanceFromLast.toFixed(1),
      },
      201
    );
  })
);

/**
 * GET /api/locations/:driverId/today
 * Get today's breadcrumb trail for a driver
 * Query params:
 *   - snapToRoads: boolean (default true) - Snap coordinates to road network for smooth visualization
 */
router.get(
  '/:driverId/today',
  requireAuth,
  extractUserInfo,
  requireAdmin,
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const { driverId } = req.params;
    const snapToRoads = req.query.snapToRoads !== 'false'; // Default true

    // Check if driver exists
    const driver = await db.query.drivers.findFirst({
      where: eq(drivers.id, driverId),
    });

    if (!driver) {
      return sendNotFound(res, 'Driver');
    }

    // Get start of today (midnight local time)
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // Get end of today (23:59:59)
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    // Get today's locations in chronological order (for breadcrumb trail)
    const locationHistory = await locationUtils.getHistoryForDriver(
      driverId,
      startOfToday,
      endOfToday,
      10000 // High limit for full day
    );

    // Convert to response format - in chronological order (oldest first)
    const breadcrumbs = locationHistory.reverse().map((loc) => ({
      id: loc.id,
      latitude: parseFloat(loc.latitude),
      longitude: parseFloat(loc.longitude),
      speed: loc.speed ? parseFloat(loc.speed) : undefined,
      heading: loc.heading ? parseFloat(loc.heading) : undefined,
      timestamp: loc.timestamp.toISOString(), // Convert Date to string for Coordinate interface
    }));

    // If road snapping is enabled and we have enough points, snap to roads
    let roadGeometry: number[][] | undefined;
    let snappedPoints: any[] | undefined;

    console.log(`🗺️ [Today Breadcrumbs] Request for driver ${driver.name}:`, {
      snapToRoads,
      breadcrumbsCount: breadcrumbs.length,
      hasMapboxToken: !!MAPBOX_ACCESS_TOKEN,
    });

    if (snapToRoads && breadcrumbs.length >= 2) {
      try {
        console.log(
          `🛣️  Snapping ${breadcrumbs.length} GPS points to roads for driver ${driver.name}`
        );

        const result = await snapToRoadsBatch(breadcrumbs);

        // Convert [lng, lat] to {latitude, longitude} format
        roadGeometry = result.geometry;
        snappedPoints = result.matched.map((coord) => ({
          latitude: coord.latitude,
          longitude: coord.longitude,
          distance: coord.distance, // How far from original point
        }));

        console.log(
          `✅ Road snapping complete: ${roadGeometry.length} geometry points, distance: ${(result.totalDistance / 1000).toFixed(2)}km`
        );
      } catch (error) {
        console.error('❌ Road snapping failed:', error instanceof Error ? error.message : error);
        console.error('❌ Error details:', error);
        if (error instanceof Error && error.message.includes('MAPBOX_ACCESS_TOKEN')) {
          console.error('⚠️  Set MAPBOX_ACCESS_TOKEN environment variable to enable road snapping');
        }
        // Continue without road snapping if it fails
      }
    } else if (!snapToRoads) {
      console.log('⏭️  Road snapping disabled by query parameter');
    } else if (breadcrumbs.length < 2) {
      console.log(`⏭️  Not enough breadcrumbs (${breadcrumbs.length} < 2) for road snapping`);
    }

    console.log(`📦 [Today Breadcrumbs] Response for driver ${driver.name}:`, {
      hasRoadGeometry: !!roadGeometry,
      roadGeometryLength: roadGeometry?.length || 0,
      rawBreadcrumbsCount: breadcrumbs.length,
      snappedToRoads: !!roadGeometry,
    });

    return sendSuccess(res, {
      raw: breadcrumbs, // Original GPS points
      roadGeometry, // Snapped road path (if enabled) - array of [lng, lat]
      snapped: snappedPoints, // Matched points (if enabled)
      meta: {
        driverId,
        driverName: driver.name,
        count: breadcrumbs.length,
        snappedToRoads: !!roadGeometry,
        date: startOfToday.toISOString().split('T')[0],
      },
    });
  })
);

/**
 * GET /api/locations/:driverId
 * Get location history for driver
 * Query params:
 *   - startDate: ISO date string (optional)
 *   - endDate: ISO date string (optional)
 *   - limit: number (optional)
 *   - snapToRoads: boolean (default true) - Snap coordinates to road network for smooth visualization
 */
router.get(
  '/:driverId',
  requireAuth,
  extractUserInfo,
  requireAdmin,
  validate(getLocationsQuerySchema, 'query'),
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const { driverId } = req.params;
    const { startDate, endDate, limit } = req.query as any;
    const snapToRoads = req.query.snapToRoads !== 'false'; // Default true

    console.log('📍 Location history request:', {
      driverId,
      startDate,
      endDate,
      limit,
      snapToRoads,
    });

    // Check if driver exists
    const driver = await db.query.drivers.findFirst({
      where: eq(drivers.id, driverId),
    });

    if (!driver) {
      return sendNotFound(res, 'Driver');
    }

    // Get location history
    const locationHistory = await locationUtils.getHistoryForDriver(
      driverId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
      limit
    );

    console.log(`📊 Found ${locationHistory.length} locations`);

    // Convert to response format - in chronological order (oldest first)
    const breadcrumbs = locationHistory.reverse().map((loc) => ({
      id: loc.id,
      latitude: parseFloat(loc.latitude),
      longitude: parseFloat(loc.longitude),
      accuracy: loc.accuracy ? parseFloat(loc.accuracy) : undefined,
      speed: loc.speed ? parseFloat(loc.speed) : undefined,
      heading: loc.heading ? parseFloat(loc.heading) : undefined,
      timestamp: loc.timestamp.toISOString(),
    }));

    // Detect sessions based on time gaps (5+ minute gap = new session)
    const sessions = detectSessions(breadcrumbs, 5);
    console.log(
      `📊 Detected ${sessions.length} driving session(s) from ${breadcrumbs.length} points`
    );

    // Process each session
    let processedSessions = [];
    let totalDistance = 0;
    let totalFilteredPoints = 0;

    for (const session of sessions) {
      // Filter points to reduce density while keeping important changes
      const filteredPoints = filterSignificantPoints(
        session.points,
        20, // Min 20 seconds between points
        3, // Min 3 m/s speed change (about 7 mph)
        20 // Min 20 degree heading change
      );

      console.log(
        `Session ${session.id}: ${session.points.length} points → ${filteredPoints.length} after filtering`
      );
      totalFilteredPoints += filteredPoints.length;

      // Calculate session distance
      const distance = calculateSessionDistance(filteredPoints);
      totalDistance += distance;

      let sessionData: any = {
        id: session.id,
        startTime: session.startTime,
        endTime: session.endTime,
        duration: session.duration,
        distance: Math.round(distance),
        pointCount: filteredPoints.length,
        originalPointCount: session.points.length,
        points: filteredPoints,
      };

      // If road snapping is enabled and session has enough points
      if (snapToRoads && filteredPoints.length >= 2) {
        try {
          console.log(`🛣️  Snapping session ${session.id}: ${filteredPoints.length} points`);

          const result = await snapToRoadsBatch(filteredPoints);

          sessionData.roadGeometry = result.geometry;
          sessionData.snappedPoints = result.matched.map((coord) => ({
            latitude: coord.latitude,
            longitude: coord.longitude,
            distance: coord.distance,
          }));
          sessionData.snappedDistance = result.totalDistance;

          console.log(
            `✓ Session ${session.id} snapped: ${(result.totalDistance / 1000).toFixed(2)}km`
          );
        } catch (error) {
          console.error(
            `❌ Road snapping failed for session ${session.id}:`,
            error instanceof Error ? error.message : error
          );
          // Continue without road snapping for this session
        }
      }

      processedSessions.push(sessionData);
    }

    console.log(
      `📊 Processed ${sessions.length} sessions: ${breadcrumbs.length} → ${totalFilteredPoints} points, ${(totalDistance / 1000).toFixed(2)}km total`
    );

    return sendSuccess(res, {
      raw: breadcrumbs,
      sessions: processedSessions,
      meta: {
        driverId,
        driverName: driver.name,
        totalPoints: breadcrumbs.length,
        filteredPoints: totalFilteredPoints,
        sessionCount: sessions.length,
        totalDistance: Math.round(totalDistance),
        startDate: startDate || null,
        endDate: endDate || null,
      },
    });
  })
);

/**
 * DELETE /api/locations/cleanup
 * Clean up locations older than 6 months
 * Admin only - typically run as a scheduled job
 */
router.delete(
  '/cleanup',
  requireAuth,
  extractUserInfo,
  requireAdmin,
  asyncHandler(async (_req: express.Request, res: express.Response) => {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    // Delete old locations
    const deletedLocations = await db
      .delete(locations)
      .where(lte(locations.timestamp, sixMonthsAgo))
      .returning();

    console.log(
      `🗑️  Cleaned up ${deletedLocations.length} locations older than ${sixMonthsAgo.toISOString()}`
    );

    return sendSuccess(res, {
      deletedCount: deletedLocations.length,
      cutoffDate: sixMonthsAgo.toISOString(),
    });
  })
);

export default router;
