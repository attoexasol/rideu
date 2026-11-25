/**
 * Driver Routes
 *
 * GET /api/drivers - List all drivers (with pagination, filters, search)
 * GET /api/drivers/:id - Get single driver with current location
 * POST /api/drivers - Create new driver
 * PUT /api/drivers/:id - Update driver
 * DELETE /api/drivers/:id - Delete driver
 * PATCH /api/drivers/:id/cab-identifier - Update cab number or licence only
 * PATCH /api/drivers/:id/status - Update driver status
 * GET /api/drivers/qr/:qrCode - Lookup driver by QR code value
 * GET /api/drivers/:id/qrcode - Generate QR code image (PNG or base64)
 * POST /api/drivers/scan-vehicle - Assign vehicle via QR scan
 * POST /api/drivers/check-in - Company check-in
 * POST /api/drivers/check-out - Company check-out
 * GET /api/drivers/:driverId/assignment - Active vehicle assignment
 * GET /api/drivers/:driverId/attendance - Attendance status
 */

import express from 'express';
import { requireAuth, extractUserInfo } from '../middleware/auth';
import { requireAdmin } from '../middleware/rbac';
import { trackDriverDevice } from '../middleware/device-tracking';
import { logAndNormalizeCabIdentifier } from '../middleware/normalizeCabIdentifier';
import {
  getDriverByQrCodeHandler,
  getDriverQrCodeImageHandler,
} from '../controllers/driverQrCode.controller';
import {
  scanVehicleHandler,
  getActiveAssignmentHandler,
} from '../controllers/driverVehicleAssignment.controller';
import {
  checkInHandler,
  checkOutHandler,
  getAttendanceStatusHandler,
} from '../controllers/driverAttendance.controller';
import {
  validate,
  createDriverSchema,
  updateDriverSchema,
  updateDriverStatusSchema,
  updateCabIdentifierSchema,
  getDriversQuerySchema,
  driverQrCodeParamSchema,
  driverQrImageQuerySchema,
  driverIdParamSchema,
  scanVehicleSchema,
  checkInSchema,
  checkOutSchema,
  driverIdPathSchema,
} from '../validators';
import { sendSuccess, sendError, sendNotFound, calculatePagination } from '../utils/response';
import { asyncHandler } from '../middleware/error-handler';
import { db } from '../db/connection';
import { drivers } from '../db/schema/drivers';
import { vehicles } from '../db/schema/vehicles';
import { driverUtils, locationUtils } from '../db/utils';
import { eq, or, ilike, sql, count } from 'drizzle-orm';
import { redisPub, PubSubChannels, realtimeCache } from '../config/redis';
import { qrDutyRequired } from '../config/duty';
import { assertDriverCanGoOnline, DutyError } from '../services/duty.service';
import { auth0Management } from '../services/auth0Management';
import { updateDriverCabIdentifier } from '../services/driverCabIdentifier';
import { resolveCabFieldsForInsert, resolveCabFieldsForUpdate } from '../utils/cabIdentifier';
import { generateUniqueDriverQrCode } from '../services/driverQrCode.service';
import { ensureDriverVehicleQrCode } from '../services/vehicleQrCode.service';
import { isDeactivatedAccount } from '../services/accountStatus.service';
import { listDocumentsForDriver } from '../services/driverDocument.service';
import {
  insertDriverWithFleetMembership,
  isFleetSelectionError,
  resolveFleetForNewRecord,
} from '../services/defaultFleet.service';
import { resolveAdminFleetScope, type AdminFleetUser } from '../services/adminFleetAccess.service';

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
 * GET /api/drivers/qr/:qrCode
 * Lookup driver by unique qr_code value
 */
router.get(
  '/qr/:qrCode',
  requireAuth,
  extractUserInfo,
  validate(driverQrCodeParamSchema, 'params'),
  asyncHandler(getDriverByQrCodeHandler)
);

/**
 * GET /api/drivers/:id/qrcode
 * Generate QR code image from driver's qr_code (PNG or base64)
 */
router.get(
  '/:id/qrcode',
  requireAuth,
  extractUserInfo,
  validate(driverIdParamSchema, 'params'),
  validate(driverQrImageQuerySchema, 'query'),
  asyncHandler(getDriverQrCodeImageHandler)
);

/**
 * POST /api/drivers/scan-vehicle
 * Driver scans vehicle QR to start shift assignment
 */
router.post(
  '/scan-vehicle',
  requireAuth,
  extractUserInfo,
  validate(scanVehicleSchema),
  asyncHandler(scanVehicleHandler)
);

/**
 * POST /api/drivers/check-in
 * Driver checks in at company (COMPANY_CHECKIN QR)
 */
router.post(
  '/check-in',
  requireAuth,
  extractUserInfo,
  validate(checkInSchema),
  asyncHandler(checkInHandler)
);

/**
 * POST /api/drivers/check-out
 * Driver checks out at company (COMPANY_CHECKIN QR)
 */
router.post(
  '/check-out',
  requireAuth,
  extractUserInfo,
  validate(checkOutSchema),
  asyncHandler(checkOutHandler)
);

/**
 * GET /api/drivers/:driverId/assignment
 * Get active vehicle assignment for driver
 */
router.get(
  '/:driverId/assignment',
  requireAuth,
  extractUserInfo,
  validate(driverIdPathSchema, 'params'),
  asyncHandler(getActiveAssignmentHandler)
);

/**
 * GET /api/drivers/:driverId/attendance
 * Get attendance status for driver
 */
router.get(
  '/:driverId/attendance',
  requireAuth,
  extractUserInfo,
  validate(driverIdPathSchema, 'params'),
  asyncHandler(getAttendanceStatusHandler)
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
      conditions.push(or(ilike(drivers.name, `%${search}%`), ilike(drivers.email, `%${search}%`)));
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
        cabLicence: drivers.cabLicence,
        qrCode: drivers.qrCode,
        vehicleMake: drivers.vehicleMake,
        vehicleModel: drivers.vehicleModel,
        vehicleYear: drivers.vehicleYear,
        vehicleColor: drivers.vehicleColor,
        profileImageUrl: drivers.profileImageUrl,
        accountStatus: drivers.accountStatus,
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
    const isAdmin =
      user.role?.toLowerCase() === 'admin' || user.role?.toLowerCase() === 'super_admin';

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
    const documents = await listDocumentsForDriver(id, isAdmin ? 'admin' : 'driver');

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
      documents,
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
  logAndNormalizeCabIdentifier,
  validate(createDriverSchema),
  asyncHandler(async (req: express.Request, res: express.Response) => {
    console.log('REQUEST BODY (after validation):', req.body);

    const {
      email,
      password,
      name,
      phone,
      vehicleType,
      vehicleId,
      cabName,
      cabFieldType,
      cabValue,
      vehicleMake,
      vehicleModel,
      vehicleYear,
      vehicleColor,
      fleetId: requestedFleetId,
    } = req.body;

    const { cabNumber: resolvedCabNumber, cabLicence } = resolveCabFieldsForInsert(req.body);

    const insertValues = {
      auth0Id: '', // set after Auth0
      email,
      name,
      phone: phone || null,
      vehicleType: vehicleType || null,
      vehicleId: vehicleId || null,
      cabName: cabName || null,
      cabNumber: resolvedCabNumber,
      cabLicence,
      vehicleMake: vehicleMake || null,
      vehicleModel: vehicleModel || null,
      vehicleYear: vehicleYear || null,
      vehicleColor: vehicleColor || null,
      status: 'offline' as const,
    };

    console.log('INSERT cab fields:', {
      cabFieldType,
      cabValue,
      cabNumber: insertValues.cabNumber,
      cabLicence: insertValues.cabLicence,
    });

    // Check if driver already exists
    const existingDriver = await driverUtils.findByEmail(email);
    if (existingDriver) {
      return sendError(res, 'DUPLICATE_ERROR', 'Driver with this email already exists', 409);
    }

    let fleetId: string;
    try {
      const user = (req as express.Request & { user?: AdminFleetUser }).user;
      fleetId = await resolveFleetForNewRecord(requestedFleetId, resolveAdminFleetScope(user ?? {}));
    } catch (error) {
      if (isFleetSelectionError(error)) {
        return sendError(res, error.code, error.message, error.statusCode);
      }
      throw error;
    }

    try {
      const qrCode = await generateUniqueDriverQrCode();

      // Create user in Auth0 with driver role
      const auth0User = await auth0Management.createUser({
        email,
        password,
        name,
        role: 'driver',
      });

      console.log('✅ Auth0 user created:', auth0User.user_id);

      // Create driver in database with Auth0 ID
      const newDriver = await insertDriverWithFleetMembership(
        {
          ...insertValues,
          auth0Id: auth0User.user_id,
          qrCode,
        },
        fleetId
      );

      await ensureDriverVehicleQrCode(newDriver.id);

      console.log('✅ Driver created in database:', newDriver.id, {
        cabNumber: newDriver.cabNumber,
        cabLicence: newDriver.cabLicence,
        qrCode: newDriver.qrCode,
      });

      return sendSuccess(res, newDriver, 201);
    } catch (error: any) {
      console.error('❌ Failed to create driver - Full error:', error);
      console.error('   Error message:', error.message);
      console.error('   Error response:', error.response?.data);
      console.error('   Error stack:', error.stack);

      // Check if it's an Auth0 error
      if (error.message?.includes('Auth0')) {
        return sendError(
          res,
          'AUTH0_ERROR',
          `Failed to create Auth0 account: ${error.message}`,
          500
        );
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
  logAndNormalizeCabIdentifier,
  validate(updateDriverSchema),
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const { id } = req.params;
    console.log('REQUEST BODY (after validation):', req.body);

    const {
      name,
      phone,
      vehicleType,
      vehicleId,
      status,
      cabName,
      vehicleMake,
      vehicleModel,
      vehicleYear,
      vehicleColor,
    } = req.body;

    const cabUpdate = resolveCabFieldsForUpdate(req.body);

    // Check if driver exists
    const existingDriver = await db.query.drivers.findFirst({
      where: eq(drivers.id, id),
    });

    if (!existingDriver) {
      return sendNotFound(res, 'Driver');
    }

    // Update cab_number or cab_licence only (parameterized SQL — other column unchanged)
    if (cabUpdate.cabFieldType && cabUpdate.cabValue) {
      console.log('UPDATE cab fields:', cabUpdate);
      try {
        const cabResult = await updateDriverCabIdentifier(
          id,
          cabUpdate.cabFieldType,
          cabUpdate.cabValue
        );
        if (!cabResult) {
          return sendNotFound(res, 'Driver');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to update cab identifier';
        return sendError(res, 'VALIDATION_ERROR', message, 400);
      }
    }

    // Build update data for remaining fields
    const updateData: any = {
      updatedAt: new Date(),
    };

    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (vehicleType !== undefined) updateData.vehicleType = vehicleType;
    if (vehicleId !== undefined) updateData.vehicleId = vehicleId;
    if (cabName !== undefined) updateData.cabName = cabName;
    if (vehicleMake !== undefined) updateData.vehicleMake = vehicleMake;
    if (vehicleModel !== undefined) updateData.vehicleModel = vehicleModel;
    if (vehicleYear !== undefined) updateData.vehicleYear = vehicleYear;
    if (vehicleColor !== undefined) updateData.vehicleColor = vehicleColor;
    if (status !== undefined) updateData.status = status;

    const hasOtherUpdates = Object.keys(updateData).length > 1;

    if (!hasOtherUpdates && cabUpdate.cabFieldType && cabUpdate.cabValue) {
      const refreshedDriver = await db.query.drivers.findFirst({
        where: eq(drivers.id, id),
      });
      return sendSuccess(res, refreshedDriver);
    }

    if (!hasOtherUpdates) {
      return sendSuccess(res, existingDriver);
    }

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
 * PATCH /api/drivers/:id/cab-identifier
 * Update only cab_number OR cab_licence (parameterized SQL)
 */
router.patch(
  '/:id/cab-identifier',
  requireAuth,
  extractUserInfo,
  requireAdmin,
  logAndNormalizeCabIdentifier,
  validate(updateCabIdentifierSchema),
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const { id } = req.params;
    const fieldType = req.body.fieldType ?? req.body.cabFieldType;
    const value = req.body.value ?? req.body.cabValue;

    const existingDriver = await db.query.drivers.findFirst({
      where: eq(drivers.id, id),
    });

    if (!existingDriver) {
      return sendNotFound(res, 'Driver');
    }

    try {
      const updated = await updateDriverCabIdentifier(id, fieldType, value);
      if (!updated) {
        return sendNotFound(res, 'Driver');
      }

      return sendSuccess(res, {
        id: updated.id,
        cabNumber: updated.cab_number,
        cabLicence: updated.cab_licence,
        updatedAt: updated.updated_at,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update cab identifier';
      return sendError(res, 'VALIDATION_ERROR', message, 400);
    }
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
    const isAdmin =
      user.role?.toLowerCase() === 'admin' || user.role?.toLowerCase() === 'super_admin';

    if (!isOwnProfile && !isAdmin) {
      return sendError(res, 'UNAUTHORIZED', 'You can only update your own status', 403);
    }

    if (status === 'online' && isDeactivatedAccount(driver.accountStatus)) {
      return sendError(res, 'ACCOUNT_DEACTIVATED', 'This account has been deactivated', 403);
    }

    if (qrDutyRequired && status === 'online' && isOwnProfile) {
      try {
        await assertDriverCanGoOnline(id);
      } catch (err) {
        if (err instanceof DutyError) {
          return sendError(res, err.code, err.message, err.statusCode);
        }
        throw err;
      }
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
      console.log(
        `  📡 Broadcasting status change to ${io.sockets.adapter.rooms.get('admin')?.size || 0} admins in 'admin' room`
      );
      io.to('admin').emit('driver:status_change', broadcastPayload);

      // Publish to Redis Pub/Sub for multi-server scalability
      await redisPub.publish(PubSubChannels.DRIVER_STATUS, JSON.stringify(broadcastPayload));

      console.log(
        `  🔄 Driver status changed (via API): ${updatedDriver.name} → ${status}`,
        broadcastPayload
      );
    } catch (error) {
      console.error('Failed to broadcast status change:', error);
      // Don't fail the request if broadcast fails
    }

    return sendSuccess(res, updatedDriver);
  })
);

export default router;
