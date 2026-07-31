"use strict";
/**
 * Trip Routes
 *
 * POST /api/trips - Start new trip
 * PUT /api/trips/:id - Update/end trip
 * GET /api/trips/current - Get authenticated driver's active trip
 * GET /api/trips/:driverId - Get trip history for driver
 * POST /api/trips/:tripId/generate-qr - Generate passenger pickup QR (admin)
 * GET /api/trips/:tripId/qrcode - Passenger QR image PNG/base64 (admin)
 * POST /api/trips/scan-passenger - Driver verifies passenger pickup QR
 * GET /api/trips/:tripId/videos - List videos for a trip
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_1 = require("../middleware/auth");
const validators_1 = require("../validators");
const passengerTripQr_controller_1 = require("../controllers/passengerTripQr.controller");
const trip_controller_1 = require("../controllers/trip.controller");
const video_controller_1 = require("../controllers/video.controller");
const response_1 = require("../utils/response");
const error_handler_1 = require("../middleware/error-handler");
const connection_1 = require("../db/connection");
const trips_1 = require("../db/schema/trips");
const drivers_1 = require("../db/schema/drivers");
const utils_1 = require("../db/utils");
const drizzle_orm_1 = require("drizzle-orm");
const router = express_1.default.Router();
/**
 * GET /api/trips/me
 * Get trip history for authenticated driver
 */
router.get('/me', auth_1.requireAuth, auth_1.extractUserInfo, (0, validators_1.validate)(validators_1.getTripsQuerySchema, 'query'), (0, error_handler_1.asyncHandler)(async (req, res) => {
    const { startDate, endDate, status, page, limit } = req.query;
    const user = req.user;
    // Get driver by Auth0 ID
    const driver = await connection_1.db.query.drivers.findFirst({
        where: (0, drizzle_orm_1.eq)(drivers_1.drivers.auth0Id, user.auth0Id),
    });
    if (!driver) {
        return (0, response_1.sendNotFound)(res, 'Driver');
    }
    const driverId = driver.id;
    // Get total count
    const conditions = [(0, drizzle_orm_1.eq)(trips_1.trips.driverId, driverId)];
    if (status)
        conditions.push((0, drizzle_orm_1.eq)(trips_1.trips.status, status));
    if (startDate)
        conditions.push((0, drizzle_orm_1.sql) `${trips_1.trips.startTime} >= ${startDate}`);
    if (endDate)
        conditions.push((0, drizzle_orm_1.sql) `${trips_1.trips.startTime} <= ${endDate}`);
    const [{ count: total }] = await connection_1.db
        .select({ count: (0, drizzle_orm_1.count)() })
        .from(trips_1.trips)
        .where((0, drizzle_orm_1.sql) `${drizzle_orm_1.sql.join(conditions, (0, drizzle_orm_1.sql) ` AND `)}`);
    // Get trips with pagination
    const pageNum = page || 1;
    const limitNum = limit || 20;
    const offset = (pageNum - 1) * limitNum;
    const results = await connection_1.db
        .select()
        .from(trips_1.trips)
        .where((0, drizzle_orm_1.sql) `${drizzle_orm_1.sql.join(conditions, (0, drizzle_orm_1.sql) ` AND `)}`)
        .orderBy((0, drizzle_orm_1.sql) `${trips_1.trips.startTime} DESC`)
        .limit(limitNum)
        .offset(offset);
    const pagination = (0, response_1.calculatePagination)(total, pageNum, limitNum);
    return (0, response_1.sendSuccess)(res, results, 200, { pagination });
}));
/**
 * GET /api/trips/current
 * Get the authenticated driver's active (in_progress) trip
 */
router.get('/current', auth_1.requireAuth, auth_1.extractUserInfo, (0, error_handler_1.asyncHandler)(trip_controller_1.getCurrentTripHandler));
/**
 * POST /api/trips/scan-passenger
 * Driver scans passenger pickup QR to verify boarding
 */
router.post('/scan-passenger', auth_1.requireAuth, auth_1.extractUserInfo, (0, validators_1.validate)(validators_1.scanPassengerSchema), (0, error_handler_1.asyncHandler)(passengerTripQr_controller_1.scanPassengerHandler));
/**
 * GET /api/trips/:tripId/videos
 * List trip videos (driver own trip or admin)
 */
router.get('/:tripId/videos', auth_1.requireAuth, auth_1.extractUserInfo, (0, validators_1.validate)(validators_1.tripIdParamSchema, 'params'), (0, error_handler_1.asyncHandler)(video_controller_1.listTripVideosHandler));
/**
 * POST /api/trips/:tripId/generate-qr
 * Generate and save passenger pickup QR for a trip (admin)
 */
router.post('/:tripId/generate-qr', auth_1.requireAuth, auth_1.extractUserInfo, (0, validators_1.validate)(validators_1.tripIdParamSchema, 'params'), (0, error_handler_1.asyncHandler)(passengerTripQr_controller_1.generatePassengerQrHandler));
/**
 * GET /api/trips/:tripId/qrcode
 * Generate passenger pickup QR image (PNG or base64, admin)
 */
router.get('/:tripId/qrcode', auth_1.requireAuth, auth_1.extractUserInfo, (0, validators_1.validate)(validators_1.tripIdParamSchema, 'params'), (0, validators_1.validate)(validators_1.tripQrImageQuerySchema, 'query'), (0, error_handler_1.asyncHandler)(passengerTripQr_controller_1.getPassengerQrCodeImageHandler));
/**
 * POST /api/trips
 * Start new trip
 */
router.post('/', auth_1.requireAuth, auth_1.extractUserInfo, (0, validators_1.validate)(validators_1.createTripSchema), (0, error_handler_1.asyncHandler)(async (req, res) => {
    const { startTime, startLocationId } = req.body;
    const user = req.user;
    // Get driver ID
    let driverId;
    if (user.role === 'driver') {
        // Driver starting their own trip
        const driver = await connection_1.db.query.drivers.findFirst({
            where: (0, drizzle_orm_1.eq)(drivers_1.drivers.auth0Id, user.auth0Id),
        });
        if (!driver) {
            return (0, response_1.sendNotFound)(res, 'Driver');
        }
        driverId = driver.id;
    }
    else {
        // Admin would need to specify driverId (not in current spec)
        return (0, response_1.sendNotFound)(res, 'Driver');
    }
    // Check if driver already has an active trip
    const activeTrip = await utils_1.tripUtils.getActiveForDriver(driverId);
    if (activeTrip) {
        return (0, response_1.sendSuccess)(res, activeTrip, 200); // Return existing active trip
    }
    // Create new trip
    const newTrip = await utils_1.tripUtils.start({
        driverId,
        startTime: new Date(startTime),
        startLocationId: startLocationId || undefined,
    });
    return (0, response_1.sendSuccess)(res, {
        id: newTrip.id,
        driverId: newTrip.driverId,
        startTime: newTrip.startTime,
        status: newTrip.status,
    }, 201);
}));
/**
 * PUT /api/trips/:id
 * Update/end trip
 */
router.put('/:id', auth_1.requireAuth, auth_1.extractUserInfo, (0, validators_1.validate)(validators_1.updateTripSchema), (0, error_handler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { endTime, endLocationId, distance, status } = req.body;
    // Check if trip exists
    const existingTrip = await connection_1.db.query.trips.findFirst({
        where: (0, drizzle_orm_1.eq)(trips_1.trips.id, id),
    });
    if (!existingTrip) {
        return (0, response_1.sendNotFound)(res, 'Trip');
    }
    // Build update data
    const updateData = {};
    if (endTime)
        updateData.endTime = new Date(endTime);
    if (endLocationId)
        updateData.endLocationId = endLocationId;
    if (distance !== undefined)
        updateData.distance = distance.toString();
    if (status)
        updateData.status = status;
    // Update trip
    const updatedTrip = await utils_1.tripUtils.end(id, updateData);
    if (!updatedTrip) {
        return (0, response_1.sendNotFound)(res, 'Trip');
    }
    return (0, response_1.sendSuccess)(res, {
        id: updatedTrip.id,
        driverId: updatedTrip.driverId,
        startTime: updatedTrip.startTime,
        endTime: updatedTrip.endTime,
        distance: updatedTrip.distance ? parseFloat(updatedTrip.distance) : undefined,
        status: updatedTrip.status,
    });
}));
/**
 * GET /api/trips/:driverId
 * Get trip history for driver
 * Drivers can access their own trips, admins can access any driver's trips
 */
router.get('/:driverId', auth_1.requireAuth, auth_1.extractUserInfo, (0, validators_1.validate)(validators_1.getTripsQuerySchema, 'query'), (0, error_handler_1.asyncHandler)(async (req, res) => {
    const { driverId } = req.params;
    const { startDate, endDate, status, page, limit } = req.query;
    const user = req.user;
    // Check if driver exists
    const driver = await connection_1.db.query.drivers.findFirst({
        where: (0, drizzle_orm_1.eq)(drivers_1.drivers.id, driverId),
    });
    if (!driver) {
        return (0, response_1.sendNotFound)(res, 'Driver');
    }
    // Check authorization: user must be the driver themselves OR an admin
    const isOwnProfile = driver.auth0Id === user.auth0Id;
    const isAdmin = user.role?.toLowerCase() === 'admin' || user.role?.toLowerCase() === 'super_admin';
    if (!isOwnProfile && !isAdmin) {
        return (0, response_1.sendNotFound)(res, 'Driver'); // Return 404 to avoid leaking info about other drivers
    }
    // Get total count
    const conditions = [(0, drizzle_orm_1.eq)(trips_1.trips.driverId, driverId)];
    if (status)
        conditions.push((0, drizzle_orm_1.eq)(trips_1.trips.status, status));
    const [totalResult] = await connection_1.db
        .select({ count: (0, drizzle_orm_1.count)() })
        .from(trips_1.trips)
        .where((0, drizzle_orm_1.sql) `${drizzle_orm_1.sql.join(conditions, (0, drizzle_orm_1.sql) ` AND `)}`);
    const total = totalResult?.count || 0;
    // Get trip history
    const tripHistory = await utils_1.tripUtils.getForDriver(driverId, status, startDate ? new Date(startDate) : undefined, endDate ? new Date(endDate) : undefined, limit);
    // Format response
    const formattedTrips = tripHistory.map((trip) => ({
        id: trip.id,
        startTime: trip.startTime,
        endTime: trip.endTime,
        distance: trip.distance ? parseFloat(trip.distance) : undefined,
        status: trip.status,
        startLocationId: trip.startLocationId,
        endLocationId: trip.endLocationId,
    }));
    const pagination = (0, response_1.calculatePagination)(total, page, limit);
    return (0, response_1.sendSuccess)(res, formattedTrips, 200, { pagination });
}));
exports.default = router;
//# sourceMappingURL=trips.js.map