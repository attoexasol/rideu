"use strict";
/**
 * Driver Routes
 *
 * GET /api/drivers - List all drivers (with pagination, filters, search)
 * GET /api/drivers/:id - Get single driver with current location
 * POST /api/drivers - Create new driver
 * PUT /api/drivers/:id - Update driver
 * DELETE /api/drivers/:id - Delete driver
 * PATCH /api/drivers/:id/status - Update driver status
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
const device_tracking_1 = require("../middleware/device-tracking");
const validators_1 = require("../validators");
const response_1 = require("../utils/response");
const error_handler_1 = require("../middleware/error-handler");
const connection_1 = require("../db/connection");
const drivers_1 = require("../db/schema/drivers");
const vehicles_1 = require("../db/schema/vehicles");
const utils_1 = require("../db/utils");
const drizzle_orm_1 = require("drizzle-orm");
const redis_1 = require("../config/redis");
const auth0Management_1 = require("../services/auth0Management");
const router = express_1.default.Router();
/**
 * GET /api/drivers/me
 * Get current authenticated user's driver profile
 */
router.get('/me', auth_1.requireAuth, auth_1.extractUserInfo, device_tracking_1.trackDriverDevice, // Track device for session enforcement
(0, error_handler_1.asyncHandler)(async (req, res) => {
    const user = req.user;
    // Get driver by Auth0 ID
    const driver = await connection_1.db.query.drivers.findFirst({
        where: (0, drizzle_orm_1.eq)(drivers_1.drivers.auth0Id, user.auth0Id),
    });
    if (!driver) {
        return (0, response_1.sendNotFound)(res, 'Driver');
    }
    // Get vehicle if driver has one
    let vehicle = null;
    if (driver.vehicleId) {
        vehicle = await connection_1.db.query.vehicles.findFirst({
            where: (0, drizzle_orm_1.eq)(vehicles_1.vehicles.id, driver.vehicleId),
        });
    }
    // Get current location
    const currentLocation = await utils_1.locationUtils.getLatestForDriver(driver.id);
    return (0, response_1.sendSuccess)(res, {
        ...driver,
        vehicle,
        currentLocation: currentLocation
            ? {
                latitude: currentLocation.latitude,
                longitude: currentLocation.longitude,
                timestamp: currentLocation.timestamp,
            }
            : null,
    });
}));
/**
 * GET /api/drivers
 * List all drivers with pagination, search, and filters
 */
router.get('/', auth_1.requireAuth, auth_1.extractUserInfo, rbac_1.requireAdmin, (0, validators_1.validate)(validators_1.getDriversQuerySchema, 'query'), (0, error_handler_1.asyncHandler)(async (req, res) => {
    const { status, vehicleType, search, page, limit } = req.query;
    // Build query conditions
    const conditions = [];
    if (status) {
        conditions.push((0, drizzle_orm_1.eq)(drivers_1.drivers.status, status));
    }
    if (vehicleType) {
        conditions.push((0, drizzle_orm_1.eq)(drivers_1.drivers.vehicleType, vehicleType));
    }
    if (search) {
        conditions.push((0, drizzle_orm_1.or)((0, drizzle_orm_1.ilike)(drivers_1.drivers.name, `%${search}%`), (0, drizzle_orm_1.ilike)(drivers_1.drivers.email, `%${search}%`)));
    }
    // Get total count
    const [totalResult] = await connection_1.db
        .select({ count: (0, drizzle_orm_1.count)() })
        .from(drivers_1.drivers)
        .where(conditions.length > 0 ? (0, drizzle_orm_1.sql) `${drizzle_orm_1.sql.join(conditions, (0, drizzle_orm_1.sql) ` AND `)}` : undefined);
    const total = totalResult?.count || 0;
    // Get paginated results with vehicle info
    const offset = (page - 1) * limit;
    const results = await connection_1.db
        .select({
        id: drivers_1.drivers.id,
        auth0Id: drivers_1.drivers.auth0Id,
        email: drivers_1.drivers.email,
        name: drivers_1.drivers.name,
        phone: drivers_1.drivers.phone,
        status: drivers_1.drivers.status,
        vehicleType: drivers_1.drivers.vehicleType,
        vehicleId: drivers_1.drivers.vehicleId,
        cabName: drivers_1.drivers.cabName,
        cabNumber: drivers_1.drivers.cabNumber,
        vehicleMake: drivers_1.drivers.vehicleMake,
        vehicleModel: drivers_1.drivers.vehicleModel,
        vehicleYear: drivers_1.drivers.vehicleYear,
        vehicleColor: drivers_1.drivers.vehicleColor,
        lastSeen: drivers_1.drivers.lastSeen,
        createdAt: drivers_1.drivers.createdAt,
        updatedAt: drivers_1.drivers.updatedAt,
        vehicle: {
            id: vehicles_1.vehicles.id,
            make: vehicles_1.vehicles.make,
            model: vehicles_1.vehicles.model,
            plateNumber: vehicles_1.vehicles.plateNumber,
        },
    })
        .from(drivers_1.drivers)
        .leftJoin(vehicles_1.vehicles, (0, drizzle_orm_1.eq)(drivers_1.drivers.vehicleId, vehicles_1.vehicles.id))
        .where(conditions.length > 0 ? (0, drizzle_orm_1.sql) `${drizzle_orm_1.sql.join(conditions, (0, drizzle_orm_1.sql) ` AND `)}` : undefined)
        .limit(limit)
        .offset(offset)
        .orderBy(drivers_1.drivers.createdAt);
    const pagination = (0, response_1.calculatePagination)(total, page, limit);
    return (0, response_1.sendSuccess)(res, results, 200, { pagination });
}));
/**
 * GET /api/drivers/:id
 * Get single driver with current location
 * Drivers can access their own profile, admins can access any driver's profile
 */
router.get('/:id', auth_1.requireAuth, auth_1.extractUserInfo, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const user = req.user;
    // Get driver
    const driver = await connection_1.db.query.drivers.findFirst({
        where: (0, drizzle_orm_1.eq)(drivers_1.drivers.id, id),
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
    // Get vehicle if driver has one
    let vehicle = null;
    if (driver.vehicleId) {
        vehicle = await connection_1.db.query.vehicles.findFirst({
            where: (0, drizzle_orm_1.eq)(vehicles_1.vehicles.id, driver.vehicleId),
        });
    }
    // Get current location
    const currentLocation = await utils_1.locationUtils.getLatestForDriver(id);
    return (0, response_1.sendSuccess)(res, {
        ...driver,
        vehicle,
        currentLocation: currentLocation
            ? {
                latitude: currentLocation.latitude,
                longitude: currentLocation.longitude,
                timestamp: currentLocation.timestamp,
            }
            : null,
    });
}));
/**
 * POST /api/drivers
 * Create new driver with Auth0 account
 */
router.post('/', auth_1.requireAuth, auth_1.extractUserInfo, rbac_1.requireAdmin, (0, validators_1.validate)(validators_1.createDriverSchema), (0, error_handler_1.asyncHandler)(async (req, res) => {
    const { email, password, name, phone, vehicleType, vehicleId, cabName, cabNumber, vehicleMake, vehicleModel, vehicleYear, vehicleColor } = req.body;
    console.log('🚗 Creating driver with data:', { email, name, phone, vehicleType, vehicleId, cabName, cabNumber, vehicleMake, vehicleModel, vehicleYear, vehicleColor });
    // Check if driver already exists
    const existingDriver = await utils_1.driverUtils.findByEmail(email);
    if (existingDriver) {
        return (0, response_1.sendError)(res, 'DUPLICATE_ERROR', 'Driver with this email already exists', 409);
    }
    try {
        // Create user in Auth0 with driver role
        const auth0User = await auth0Management_1.auth0Management.createUser({
            email,
            password,
            name,
            role: 'driver',
        });
        console.log('✅ Auth0 user created:', auth0User.user_id);
        // Create driver in database with Auth0 ID
        const [newDriver] = await connection_1.db
            .insert(drivers_1.drivers)
            .values({
            auth0Id: auth0User.user_id,
            email,
            name,
            phone: phone || null,
            vehicleType: vehicleType || null,
            vehicleId: vehicleId || null,
            cabName: cabName || null,
            cabNumber: cabNumber || null,
            vehicleMake: vehicleMake || null,
            vehicleModel: vehicleModel || null,
            vehicleYear: vehicleYear || null,
            vehicleColor: vehicleColor || null,
            status: 'offline',
        })
            .returning();
        console.log('✅ Driver created in database:', newDriver.id);
        return (0, response_1.sendSuccess)(res, newDriver, 201);
    }
    catch (error) {
        console.error('❌ Failed to create driver - Full error:', error);
        console.error('   Error message:', error.message);
        console.error('   Error response:', error.response?.data);
        console.error('   Error stack:', error.stack);
        // Check if it's an Auth0 error
        if (error.message?.includes('Auth0')) {
            return (0, response_1.sendError)(res, 'AUTH0_ERROR', `Failed to create Auth0 account: ${error.message}`, 500);
        }
        // Return the actual error message for debugging
        return (0, response_1.sendError)(res, 'CREATE_ERROR', error.message || 'Failed to create driver', 500);
    }
}));
/**
 * PUT /api/drivers/:id
 * Update driver
 */
router.put('/:id', auth_1.requireAuth, auth_1.extractUserInfo, rbac_1.requireAdmin, (0, validators_1.validate)(validators_1.updateDriverSchema), (0, error_handler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { name, phone, vehicleType, vehicleId, status, cabName, cabNumber, vehicleMake, vehicleModel, vehicleYear, vehicleColor } = req.body;
    // Check if driver exists
    const existingDriver = await connection_1.db.query.drivers.findFirst({
        where: (0, drizzle_orm_1.eq)(drivers_1.drivers.id, id),
    });
    if (!existingDriver) {
        return (0, response_1.sendNotFound)(res, 'Driver');
    }
    // Build update data
    const updateData = {
        updatedAt: new Date(),
    };
    if (name !== undefined)
        updateData.name = name;
    if (phone !== undefined)
        updateData.phone = phone;
    if (vehicleType !== undefined)
        updateData.vehicleType = vehicleType;
    if (vehicleId !== undefined)
        updateData.vehicleId = vehicleId;
    if (cabName !== undefined)
        updateData.cabName = cabName;
    if (cabNumber !== undefined)
        updateData.cabNumber = cabNumber;
    if (vehicleMake !== undefined)
        updateData.vehicleMake = vehicleMake;
    if (vehicleModel !== undefined)
        updateData.vehicleModel = vehicleModel;
    if (vehicleYear !== undefined)
        updateData.vehicleYear = vehicleYear;
    if (vehicleColor !== undefined)
        updateData.vehicleColor = vehicleColor;
    if (status !== undefined)
        updateData.status = status;
    // Update driver
    const [updatedDriver] = await connection_1.db
        .update(drivers_1.drivers)
        .set(updateData)
        .where((0, drizzle_orm_1.eq)(drivers_1.drivers.id, id))
        .returning();
    return (0, response_1.sendSuccess)(res, updatedDriver);
}));
/**
 * DELETE /api/drivers/:id
 * Delete driver
 */
router.delete('/:id', auth_1.requireAuth, auth_1.extractUserInfo, rbac_1.requireAdmin, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    // Check if driver exists
    const existingDriver = await connection_1.db.query.drivers.findFirst({
        where: (0, drizzle_orm_1.eq)(drivers_1.drivers.id, id),
    });
    if (!existingDriver) {
        return (0, response_1.sendNotFound)(res, 'Driver');
    }
    // Delete driver (CASCADE will delete related locations, trips)
    await connection_1.db.delete(drivers_1.drivers).where((0, drizzle_orm_1.eq)(drivers_1.drivers.id, id));
    return (0, response_1.sendSuccess)(res, { message: 'Driver deleted' });
}));
/**
 * PATCH /api/drivers/:id/status
 * Update driver status
 * Drivers can update their own status, admins can update any driver's status
 */
router.patch('/:id/status', auth_1.requireAuth, auth_1.extractUserInfo, device_tracking_1.trackDriverDevice, // Track device for session enforcement
(0, validators_1.validate)(validators_1.updateDriverStatusSchema), (0, error_handler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const user = req.user;
    // Get the driver record to check auth0Id
    const driver = await connection_1.db.query.drivers.findFirst({
        where: (0, drizzle_orm_1.eq)(drivers_1.drivers.id, id),
    });
    if (!driver) {
        return (0, response_1.sendNotFound)(res, 'Driver');
    }
    // Check authorization: user must be the driver themselves OR an admin
    const isOwnProfile = driver.auth0Id === user.auth0Id;
    const isAdmin = user.role?.toLowerCase() === 'admin' || user.role?.toLowerCase() === 'super_admin';
    if (!isOwnProfile && !isAdmin) {
        return (0, response_1.sendError)(res, 'UNAUTHORIZED', 'You can only update your own status', 403);
    }
    // Update driver status
    const updatedDriver = await utils_1.driverUtils.updateStatus(id, status);
    if (!updatedDriver) {
        return (0, response_1.sendNotFound)(res, 'Driver');
    }
    // Update status in Redis cache
    await redis_1.realtimeCache.setDriverStatus(id, status);
    // Broadcast status change to all admins via WebSocket
    try {
        // Get io instance (import dynamically to avoid circular dependency)
        const { io } = await Promise.resolve().then(() => __importStar(require('../index')));
        const broadcastPayload = {
            driverId: updatedDriver.id,
            driverName: updatedDriver.name,
            status: updatedDriver.status,
            timestamp: new Date().toISOString(),
        };
        // Broadcast to admin room
        console.log(`  📡 Broadcasting status change to ${io.sockets.adapter.rooms.get('admin')?.size || 0} admins in 'admin' room`);
        io.to('admin').emit('driver:status_change', broadcastPayload);
        // Publish to Redis Pub/Sub for multi-server scalability
        await redis_1.redisPub.publish(redis_1.PubSubChannels.DRIVER_STATUS, JSON.stringify(broadcastPayload));
        console.log(`  🔄 Driver status changed (via API): ${updatedDriver.name} → ${status}`, broadcastPayload);
    }
    catch (error) {
        console.error('Failed to broadcast status change:', error);
        // Don't fail the request if broadcast fails
    }
    return (0, response_1.sendSuccess)(res, updatedDriver);
}));
exports.default = router;
//# sourceMappingURL=drivers.js.map