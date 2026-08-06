"use strict";
/**
 * Location Routes
 *
 * POST /api/locations - Submit GPS location (from driver app)
 * GET /api/locations/:driverId - Get location history for driver
 * GET /api/locations/active - Get all active driver locations
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../middleware/rbac");
const validators_1 = require("../validators");
const response_1 = require("../utils/response");
const error_handler_1 = require("../middleware/error-handler");
const rate_limiters_1 = require("../middleware/rate-limiters");
const connection_1 = require("../db/connection");
const locations_1 = require("../db/schema/locations");
const drivers_1 = require("../db/schema/drivers");
const utils_1 = require("../db/utils");
const drizzle_orm_1 = require("drizzle-orm");
const redis_1 = require("../config/redis");
const mapboxMatching_1 = require("../services/mapboxMatching");
const booking_repository_1 = require("../repositories/booking.repository");
const bookingNotify_service_1 = require("../services/bookingNotify.service");
const dispatch_1 = require("../config/dispatch");
const driverAvailability_service_1 = require("../services/driverAvailability.service");
const duty_1 = require("../config/duty");
const duty_service_1 = require("../services/duty.service");
const sessions_1 = require("../utils/sessions");
const router = express_1.default.Router();
const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN || '';
/**
 * GET /api/locations/active
 * Get all driver locations (most recent for each driver)
 * Must be before /:driverId route
 */
router.get('/active', auth_1.requireAuth, auth_1.extractUserInfo, rbac_1.requireAdmin, (0, error_handler_1.asyncHandler)(async (_req, res) => {
    // Get ALL drivers (not just online)
    const allDrivers = await connection_1.db
        .select({
        driverId: drivers_1.drivers.id,
        driverName: drivers_1.drivers.name,
        status: drivers_1.drivers.status,
        lastSeen: drivers_1.drivers.lastSeen,
    })
        .from(drivers_1.drivers);
    // Get latest location for each driver
    const driversWithLocations = await Promise.all(allDrivers.map(async (driver) => {
        const location = await utils_1.locationUtils.getLatestForDriver(driver.driverId);
        return {
            driverId: driver.driverId,
            driverName: driver.driverName,
            status: driver.status,
            lastSeen: driver.lastSeen,
            latitude: location?.latitude || null,
            longitude: location?.longitude || null,
            timestamp: location?.timestamp || driver.lastSeen,
        };
    }));
    // Filter out drivers without locations
    const driversWithValidLocations = driversWithLocations.filter((d) => d.latitude !== null && d.longitude !== null);
    return (0, response_1.sendSuccess)(res, driversWithValidLocations);
}));
/**
 * POST /api/locations
 * Submit GPS location (from driver app)
 */
router.post('/', auth_1.requireAuth, auth_1.extractUserInfo, rbac_1.requireDriver, // Includes device tracking automatically
rate_limiters_1.driverLocationRateLimit, (0, validators_1.validate)(validators_1.submitLocationSchema), (0, error_handler_1.asyncHandler)(async (req, res) => {
    const { latitude, longitude, accuracy, speed, heading, timestamp, bookingId } = req.body;
    const user = req.user;
    if (!(0, driverAvailability_service_1.isLocationFresh)(timestamp, dispatch_1.dispatchConfig.driverLocationStaleSeconds + 30)) {
        return (0, response_1.sendError)(res, 'LOCATION_STALE', 'Location timestamp is too old', 400);
    }
    // Get driver from database
    const driver = await utils_1.driverUtils.findByAuth0Id(user.auth0Id);
    if (!driver) {
        return (0, response_1.sendError)(res, 'NOT_FOUND', 'Driver not found', 404);
    }
    // Check if we should save to database (distance filter)
    const lastLocation = await utils_1.locationUtils.getLatestForDriver(driver.id);
    let shouldSaveToDatabase = true;
    let distanceFromLast = 0;
    if (lastLocation) {
        // Calculate distance from last saved location using Haversine formula
        const R = 6371e3; // Earth's radius in meters
        const φ1 = (parseFloat(lastLocation.latitude) * Math.PI) / 180;
        const φ2 = (latitude * Math.PI) / 180;
        const Δφ = ((latitude - parseFloat(lastLocation.latitude)) * Math.PI) / 180;
        const Δλ = ((longitude - parseFloat(lastLocation.longitude)) * Math.PI) / 180;
        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        distanceFromLast = R * c; // Distance in meters
        // Only save if moved more than 10 meters (filters GPS jitter/inaccuracy while capturing actual movement)
        shouldSaveToDatabase = distanceFromLast >= 10;
    }
    let newLocation = null;
    if (shouldSaveToDatabase) {
        // Create location record
        [newLocation] = await connection_1.db
            .insert(locations_1.locations)
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
        console.log(`💾 Location saved to database (distance: ${distanceFromLast.toFixed(1)}m from last)`);
    }
    else {
        console.log(`⏭️  Location not saved (only ${distanceFromLast.toFixed(1)}m from last, need 10m+)`);
    }
    // Always refresh heartbeat and last-seen — independent of location-history persistence.
    const activityTimestamp = timestamp || new Date().toISOString();
    await redis_1.realtimeCache.setDriverHeartbeat(driver.id, activityTimestamp);
    await connection_1.db
        .update(drivers_1.drivers)
        .set({ lastSeen: new Date(activityTimestamp), updatedAt: new Date() })
        .where((0, drizzle_orm_1.eq)(drivers_1.drivers.id, driver.id));
    // Update driver status to online only when allowed (duty-aware when QR_DUTY_REQUIRED)
    const allowOnline = !duty_1.qrDutyRequired || (await (0, duty_service_1.shouldAllowGpsOnlineTransition)(driver.id));
    if (allowOnline && driver.status !== 'busy') {
        await utils_1.driverUtils.updateStatus(driver.id, 'online');
        await redis_1.realtimeCache.setDriverStatus(driver.id, 'online');
    }
    // Try to snap coordinates to nearest road (for smoother map display)
    let snappedLat = latitude;
    let snappedLng = longitude;
    try {
        // Get previous location from cache to enable road snapping
        const previousLocation = await redis_1.realtimeCache.getDriverLocation(driver.id);
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
            const result = await (0, mapboxMatching_1.snapToRoadsBatch)(coordinates);
            // Use the snapped version of the CURRENT position (last point)
            if (result.matched && result.matched.length > 0) {
                const snappedCurrent = result.matched[result.matched.length - 1];
                snappedLat = snappedCurrent.latitude;
                snappedLng = snappedCurrent.longitude;
                console.log(`  ✅ Position snapped to road (${snappedCurrent.distance.toFixed(1)}m from GPS)`);
            }
        }
    }
    catch (error) {
        // If road-snapping fails, just use raw GPS coordinates
        console.log(`  ⏭️  Road snapping skipped/failed, using raw GPS:`, error instanceof Error ? error.message : 'Unknown error');
    }
    // Cache latest dispatch location in Redis on every valid update.
    await redis_1.realtimeCache.setDriverLocation(driver.id, {
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
        const { io } = await Promise.resolve().then(() => __importStar(require('../index')));
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
        console.log(`  📡 Broadcasting location to ${io.sockets.adapter.rooms.get('admin')?.size || 0} admins in 'admin' room`);
        io.to('admin').emit('location:broadcast', broadcastPayload);
        // Also publish to Redis Pub/Sub for multi-server scalability
        await (0, redis_1.safeRedisPublish)(redis_1.PubSubChannels.LOCATION_UPDATE, JSON.stringify(broadcastPayload));
        console.log(`  📍 Location from ${driver.name} broadcast to admin clients via WebSocket`);
    }
    catch (error) {
        console.error('Failed to broadcast location update:', error);
        // Don't fail the request if broadcast fails
    }
    const activeBooking = bookingId
        ? await (0, booking_repository_1.findActiveBookingByDriver)(driver.id).then((b) => b && b.id === bookingId ? b : null)
        : await (0, booking_repository_1.findActiveBookingByDriver)(driver.id);
    if (bookingId && !activeBooking) {
        return (0, response_1.sendError)(res, 'BOOKING_NOT_ASSIGNED', 'bookingId does not match an active assigned booking', 400);
    }
    if (activeBooking) {
        const speedKph = speed != null && speed >= 0 ? speed * 3.6 : null;
        await (0, bookingNotify_service_1.emitDriverLocationToCustomer)(activeBooking.customerId, {
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
    return (0, response_1.sendSuccess)(res, {
        id: newLocation?.id || null,
        driverId: driver.id,
        latitude: latitude,
        longitude: longitude,
        timestamp: activityTimestamp,
        saved: shouldSaveToDatabase,
        distanceFromLast: distanceFromLast.toFixed(1),
    }, 201);
}));
/**
 * GET /api/locations/:driverId/today
 * Get today's breadcrumb trail for a driver
 * Query params:
 *   - snapToRoads: boolean (default true) - Snap coordinates to road network for smooth visualization
 */
router.get('/:driverId/today', auth_1.requireAuth, auth_1.extractUserInfo, rbac_1.requireAdmin, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const { driverId } = req.params;
    const snapToRoads = req.query.snapToRoads !== 'false'; // Default true
    // Check if driver exists
    const driver = await connection_1.db.query.drivers.findFirst({
        where: (0, drizzle_orm_1.eq)(drivers_1.drivers.id, driverId),
    });
    if (!driver) {
        return (0, response_1.sendNotFound)(res, 'Driver');
    }
    // Get start of today (midnight local time)
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    // Get end of today (23:59:59)
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    // Get today's locations in chronological order (for breadcrumb trail)
    const locationHistory = await utils_1.locationUtils.getHistoryForDriver(driverId, startOfToday, endOfToday, 10000 // High limit for full day
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
    let roadGeometry;
    let snappedPoints;
    console.log(`🗺️ [Today Breadcrumbs] Request for driver ${driver.name}:`, {
        snapToRoads,
        breadcrumbsCount: breadcrumbs.length,
        hasMapboxToken: !!MAPBOX_ACCESS_TOKEN,
    });
    if (snapToRoads && breadcrumbs.length >= 2) {
        try {
            console.log(`🛣️  Snapping ${breadcrumbs.length} GPS points to roads for driver ${driver.name}`);
            const result = await (0, mapboxMatching_1.snapToRoadsBatch)(breadcrumbs);
            // Convert [lng, lat] to {latitude, longitude} format
            roadGeometry = result.geometry;
            snappedPoints = result.matched.map((coord) => ({
                latitude: coord.latitude,
                longitude: coord.longitude,
                distance: coord.distance, // How far from original point
            }));
            console.log(`✅ Road snapping complete: ${roadGeometry.length} geometry points, distance: ${(result.totalDistance / 1000).toFixed(2)}km`);
        }
        catch (error) {
            console.error('❌ Road snapping failed:', error instanceof Error ? error.message : error);
            console.error('❌ Error details:', error);
            if (error instanceof Error && error.message.includes('MAPBOX_ACCESS_TOKEN')) {
                console.error('⚠️  Set MAPBOX_ACCESS_TOKEN environment variable to enable road snapping');
            }
            // Continue without road snapping if it fails
        }
    }
    else if (!snapToRoads) {
        console.log('⏭️  Road snapping disabled by query parameter');
    }
    else if (breadcrumbs.length < 2) {
        console.log(`⏭️  Not enough breadcrumbs (${breadcrumbs.length} < 2) for road snapping`);
    }
    console.log(`📦 [Today Breadcrumbs] Response for driver ${driver.name}:`, {
        hasRoadGeometry: !!roadGeometry,
        roadGeometryLength: roadGeometry?.length || 0,
        rawBreadcrumbsCount: breadcrumbs.length,
        snappedToRoads: !!roadGeometry,
    });
    return (0, response_1.sendSuccess)(res, {
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
}));
/**
 * GET /api/locations/:driverId
 * Get location history for driver
 * Query params:
 *   - startDate: ISO date string (optional)
 *   - endDate: ISO date string (optional)
 *   - limit: number (optional)
 *   - snapToRoads: boolean (default true) - Snap coordinates to road network for smooth visualization
 */
router.get('/:driverId', auth_1.requireAuth, auth_1.extractUserInfo, rbac_1.requireAdmin, (0, validators_1.validate)(validators_1.getLocationsQuerySchema, 'query'), (0, error_handler_1.asyncHandler)(async (req, res) => {
    const { driverId } = req.params;
    const { startDate, endDate, limit } = req.query;
    const snapToRoads = req.query.snapToRoads !== 'false'; // Default true
    console.log('📍 Location history request:', {
        driverId,
        startDate,
        endDate,
        limit,
        snapToRoads,
    });
    // Check if driver exists
    const driver = await connection_1.db.query.drivers.findFirst({
        where: (0, drizzle_orm_1.eq)(drivers_1.drivers.id, driverId),
    });
    if (!driver) {
        return (0, response_1.sendNotFound)(res, 'Driver');
    }
    // Get location history
    const locationHistory = await utils_1.locationUtils.getHistoryForDriver(driverId, startDate ? new Date(startDate) : undefined, endDate ? new Date(endDate) : undefined, limit);
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
    const sessions = (0, sessions_1.detectSessions)(breadcrumbs, 5);
    console.log(`📊 Detected ${sessions.length} driving session(s) from ${breadcrumbs.length} points`);
    // Process each session
    let processedSessions = [];
    let totalDistance = 0;
    let totalFilteredPoints = 0;
    for (const session of sessions) {
        // Filter points to reduce density while keeping important changes
        const filteredPoints = (0, sessions_1.filterSignificantPoints)(session.points, 20, // Min 20 seconds between points
        3, // Min 3 m/s speed change (about 7 mph)
        20 // Min 20 degree heading change
        );
        console.log(`Session ${session.id}: ${session.points.length} points → ${filteredPoints.length} after filtering`);
        totalFilteredPoints += filteredPoints.length;
        // Calculate session distance
        const distance = (0, sessions_1.calculateSessionDistance)(filteredPoints);
        totalDistance += distance;
        let sessionData = {
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
                const result = await (0, mapboxMatching_1.snapToRoadsBatch)(filteredPoints);
                sessionData.roadGeometry = result.geometry;
                sessionData.snappedPoints = result.matched.map((coord) => ({
                    latitude: coord.latitude,
                    longitude: coord.longitude,
                    distance: coord.distance,
                }));
                sessionData.snappedDistance = result.totalDistance;
                console.log(`✓ Session ${session.id} snapped: ${(result.totalDistance / 1000).toFixed(2)}km`);
            }
            catch (error) {
                console.error(`❌ Road snapping failed for session ${session.id}:`, error instanceof Error ? error.message : error);
                // Continue without road snapping for this session
            }
        }
        processedSessions.push(sessionData);
    }
    console.log(`📊 Processed ${sessions.length} sessions: ${breadcrumbs.length} → ${totalFilteredPoints} points, ${(totalDistance / 1000).toFixed(2)}km total`);
    return (0, response_1.sendSuccess)(res, {
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
}));
/**
 * DELETE /api/locations/cleanup
 * Clean up locations older than 6 months
 * Admin only - typically run as a scheduled job
 */
router.delete('/cleanup', auth_1.requireAuth, auth_1.extractUserInfo, rbac_1.requireAdmin, (0, error_handler_1.asyncHandler)(async (_req, res) => {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    // Delete old locations
    const deletedLocations = await connection_1.db
        .delete(locations_1.locations)
        .where((0, drizzle_orm_1.lte)(locations_1.locations.timestamp, sixMonthsAgo))
        .returning();
    console.log(`🗑️  Cleaned up ${deletedLocations.length} locations older than ${sixMonthsAgo.toISOString()}`);
    return (0, response_1.sendSuccess)(res, {
        deletedCount: deletedLocations.length,
        cutoffDate: sixMonthsAgo.toISOString(),
    });
}));
exports.default = router;
//# sourceMappingURL=locations.js.map