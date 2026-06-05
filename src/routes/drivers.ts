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

import express from 'express';
import { requireAuth, extractUserInfo } from '../middleware/auth';
import { requireAdmin } from '../middleware/rbac';
import { trackDriverDevice } from '../middleware/device-tracking';
import {
  validate,
  createDriverSchema,
  updateDriverSchema,
  updateDriverStatusSchema,
  getDriversQuerySchema,
} from '../validators';
import { sendSuccess, sendError, sendNotFound, calculatePagination } from '../utils/response';
import { asyncHandler } from '../middleware/error-handler';
import { db } from '../db/connection';
import { drivers } from '../db/schema/drivers';
import { vehicles } from '../db/schema/vehicles';
import { driverUtils, locationUtils } from '../db/utils';
import { eq, or, ilike, sql, count } from 'drizzle-orm';
import { redisPub, PubSubChannels, realtimeCache } from '../config/redis';
import { auth0Management } from '../services/auth0Management';

const router = express.Router();

/**
 * GET /api/drivers/me
 * Get current authenticated user's driver profile
 */
router.get(
  '/me',
  requireAuth,
  extractUserInfo,
  trackDriverDevice, // Track device for session enforcement
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const user = (req as any).user;

    // Get driver by Auth0 ID
    const driver = await db.query.drivers.findFirst({
      where: eq(drivers.auth0Id, user.auth0Id),
    });

    if (!driver) {
      return sendNotFound(res, 'Driver');
    }

    // Get vehicle if driver has one
    let vehicle = null;
    if (driver.vehicleId) {
      vehicle = await db.query.vehicles.findFirst({
        where: eq(vehicles.id, driver.vehicleId),
      });
    }

    // Get current location
    const currentLocation = await locationUtils.getLatestForDriver(driver.id);

    return sendSuccess(res, {
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
  })
);

/**
 * GET /api/drivers
 * List all drivers with pagination, search, and filters
 */
router.get(
  '/',
  requireAuth,
  extractUserInfo,
  requireAdmin,
  validate(getDriversQuerySchema, 'query'),
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const { status, vehicleType, search, page, limit } = req.query as any;

    // Build query conditions
    const conditions = [];

    if (status) {
      conditions.push(eq(drivers.status, status));
    }

    if (vehicleType) {
      conditions.push(eq(drivers.vehicleType, vehicleType));
    }

    if (search) {
      conditions.push(
        or(
          ilike(drivers.name, `%${search}%`),
          ilike(drivers.email, `%${search}%`)
        )
      );
    }

    // Get total count
    const [totalResult] = await db
      .select({ count: count() })
      .from(drivers)
      .where(conditions.length > 0 ? sql`${sql.join(conditions, sql` AND `)}` : undefined);

    const total = totalResult?.count || 0;

    // Get paginated results with vehicle info
    const offset = (page - 1) * limit;

    const results = await db
      .select({
        id: drivers.id,
        auth0Id: drivers.auth0Id,
        email: drivers.email,
        name: drivers.name,
        phone: drivers.phone,
        status: drivers.status,
        vehicleType: drivers.vehicleType,
        vehicleId: drivers.vehicleId,
        cabName: drivers.cabName,
        cabNumber: drivers.cabNumber,
        vehicleMake: drivers.vehicleMake,
        vehicleModel: drivers.vehicleModel,
        vehicleYear: drivers.vehicleYear,
        vehicleColor: drivers.vehicleColor,
        lastSeen: drivers.lastSeen,
        createdAt: drivers.createdAt,
        updatedAt: drivers.updatedAt,
        vehicle: {
          id: vehicles.id,
          make: vehicles.make,
          model: vehicles.model,
          plateNumber: vehicles.plateNumber,
        },
      })
      .from(drivers)
      .leftJoin(vehicles, eq(drivers.vehicleId, vehicles.id))
      .where(conditions.length > 0 ? sql`${sql.join(conditions, sql` AND `)}` : undefined)
      .limit(limit)
      .offset(offset)
      .orderBy(drivers.createdAt);

    const pagination = calculatePagination(total, page, limit);

    return sendSuccess(res, results, 200, { pagination });
  })
);

/**
 * GET /api/drivers/:id
 * Get single driver with current location
 * Drivers can access their own profile, admins can access any driver's profile
 */
router.get(
  '/:id',
  requireAuth,
  extractUserInfo,
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const { id } = req.params;
    const user = (req as any).user;

    // Get driver
    const driver = await db.query.drivers.findFirst({
      where: eq(drivers.id, id),
    });

    if (!driver) {
      return sendNotFound(res, 'Driver');
    }

    // Check authorization: user must be the driver themselves OR an admin
    const isOwnProfile = driver.auth0Id === user.auth0Id;
    const isAdmin = user.role?.toLowerCase() === 'admin' || user.role?.toLowerCase() === 'super_admin';

    if (!isOwnProfile && !isAdmin) {
      return sendNotFound(res, 'Driver'); // Return 404 to avoid leaking info about other drivers
    }

    // Get vehicle if driver has one
    let vehicle = null;
    if (driver.vehicleId) {
      vehicle = await db.query.vehicles.findFirst({
        where: eq(vehicles.id, driver.vehicleId),
      });
    }

    // Get current location
    const currentLocation = await locationUtils.getLatestForDriver(id);

    return sendSuccess(res, {
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
  })
);

/**
 * POST /api/drivers
 * Create new driver with Auth0 account
 */
router.post(
  '/',
  requireAuth,
  extractUserInfo,
  requireAdmin,
  validate(createDriverSchema),
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const { email, password, name, phone, vehicleType, vehicleId, cabName, cabNumber, vehicleMake, vehicleModel, vehicleYear, vehicleColor } = req.body;

    console.log('🚗 Creating driver with data:', { email, name, phone, vehicleType, vehicleId, cabName, cabNumber, vehicleMake, vehicleModel, vehicleYear, vehicleColor });

    // Check if driver already exists
    const existingDriver = await driverUtils.findByEmail(email);
    if (existingDriver) {
      return sendError(res, 'DUPLICATE_ERROR', 'Driver with this email already exists', 409);
    }

    try {
      // Create user in Auth0 with driver role
      const auth0User = await auth0Management.createUser({
        email,
        password,
        name,
        role: 'driver',
      });

      console.log('✅ Auth0 user created:', auth0User.user_id);

      // Create driver in database with Auth0 ID
      const [newDriver] = await db
        .insert(drivers)
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

      return sendSuccess(res, newDriver, 201);
    } catch (error: any) {
      console.error('❌ Failed to create driver - Full error:', error);
      console.error('   Error message:', error.message);
      console.error('   Error response:', error.response?.data);
      console.error('   Error stack:', error.stack);

      // Check if it's an Auth0 error
      if (error.message?.includes('Auth0')) {
        return sendError(res, 'AUTH0_ERROR', `Failed to create Auth0 account: ${error.message}`, 500);
      }

      // Return the actual error message for debugging
      return sendError(res, 'CREATE_ERROR', error.message || 'Failed to create driver', 500);
    }
  })
);

/**
 * PUT /api/drivers/:id
 * Update driver
 */
router.put(
  '/:id',
  requireAuth,
  extractUserInfo,
  requireAdmin,
  validate(updateDriverSchema),
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const { id } = req.params;
    const { name, phone, vehicleType, vehicleId, status, cabName, cabNumber, vehicleMake, vehicleModel, vehicleYear, vehicleColor } = req.body;

    // Check if driver exists
    const existingDriver = await db.query.drivers.findFirst({
      where: eq(drivers.id, id),
    });

    if (!existingDriver) {
      return sendNotFound(res, 'Driver');
    }

    // Build update data
    const updateData: any = {
      updatedAt: new Date(),
    };

    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (vehicleType !== undefined) updateData.vehicleType = vehicleType;
    if (vehicleId !== undefined) updateData.vehicleId = vehicleId;
    if (cabName !== undefined) updateData.cabName = cabName;
    if (cabNumber !== undefined) updateData.cabNumber = cabNumber;
    if (vehicleMake !== undefined) updateData.vehicleMake = vehicleMake;
    if (vehicleModel !== undefined) updateData.vehicleModel = vehicleModel;
    if (vehicleYear !== undefined) updateData.vehicleYear = vehicleYear;
    if (vehicleColor !== undefined) updateData.vehicleColor = vehicleColor;
    if (status !== undefined) updateData.status = status;

    // Update driver
    const [updatedDriver] = await db
      .update(drivers)
      .set(updateData)
      .where(eq(drivers.id, id))
      .returning();

    return sendSuccess(res, updatedDriver);
  })
);

/**
 * DELETE /api/drivers/:id
 * Delete driver
 */
router.delete(
  '/:id',
  requireAuth,
  extractUserInfo,
  requireAdmin,
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const { id } = req.params;

    // Check if driver exists
    const existingDriver = await db.query.drivers.findFirst({
      where: eq(drivers.id, id),
    });

    if (!existingDriver) {
      return sendNotFound(res, 'Driver');
    }

    // Delete driver (CASCADE will delete related locations, trips)
    await db.delete(drivers).where(eq(drivers.id, id));

    return sendSuccess(res, { message: 'Driver deleted' });
  })
);

/**
 * PATCH /api/drivers/:id/status
 * Update driver status
 * Drivers can update their own status, admins can update any driver's status
 */
router.patch(
  '/:id/status',
  requireAuth,
  extractUserInfo,
  trackDriverDevice, // Track device for session enforcement
  validate(updateDriverStatusSchema),
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const { id } = req.params;
    const { status } = req.body;
    const user = (req as any).user;

    // Get the driver record to check auth0Id
    const driver = await db.query.drivers.findFirst({
      where: eq(drivers.id, id),
    });

    if (!driver) {
      return sendNotFound(res, 'Driver');
    }

    // Check authorization: user must be the driver themselves OR an admin
    const isOwnProfile = driver.auth0Id === user.auth0Id;
    const isAdmin = user.role?.toLowerCase() === 'admin' || user.role?.toLowerCase() === 'super_admin';

    if (!isOwnProfile && !isAdmin) {
      return sendError(res, 'UNAUTHORIZED', 'You can only update your own status', 403);
    }

    // Update driver status
    const updatedDriver = await driverUtils.updateStatus(id, status);

    if (!updatedDriver) {
      return sendNotFound(res, 'Driver');
    }

    // Update status in Redis cache
    await realtimeCache.setDriverStatus(id, status);

    // Broadcast status change to all admins via WebSocket
    try {
      // Get io instance (import dynamically to avoid circular dependency)
      const { io } = await import('../index');

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
      await redisPub.publish(
        PubSubChannels.DRIVER_STATUS,
        JSON.stringify(broadcastPayload)
      );

      console.log(`  🔄 Driver status changed (via API): ${updatedDriver.name} → ${status}`, broadcastPayload);
    } catch (error) {
      console.error('Failed to broadcast status change:', error);
      // Don't fail the request if broadcast fails
    }

    return sendSuccess(res, updatedDriver);
  })
);

export default router;
