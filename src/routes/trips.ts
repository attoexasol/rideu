/**
 * Trip Routes
 *
 * POST /api/trips - Start new trip
 * PUT /api/trips/:id - Update/end trip
 * GET /api/trips/:driverId - Get trip history for driver
 */

import express from 'express';
import { requireAuth, extractUserInfo } from '../middleware/auth';
import {
  validate,
  createTripSchema,
  updateTripSchema,
  getTripsQuerySchema,
} from '../validators';
import { sendSuccess, sendNotFound, calculatePagination } from '../utils/response';
import { asyncHandler } from '../middleware/error-handler';
import { db } from '../db/connection';
import { trips } from '../db/schema/trips';
import { drivers } from '../db/schema/drivers';
import { tripUtils } from '../db/utils';
import { eq, count, sql } from 'drizzle-orm';

const router = express.Router();

/**
 * GET /api/trips/me
 * Get trip history for authenticated driver
 */
router.get(
  '/me',
  requireAuth,
  extractUserInfo,
  validate(getTripsQuerySchema, 'query'),
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const { startDate, endDate, status, page, limit } = req.query as any;
    const user = (req as any).user;

    // Get driver by Auth0 ID
    const driver = await db.query.drivers.findFirst({
      where: eq(drivers.auth0Id, user.auth0Id),
    });

    if (!driver) {
      return sendNotFound(res, 'Driver');
    }

    const driverId = driver.id;

    // Get total count
    const conditions = [eq(trips.driverId, driverId)];
    if (status) conditions.push(eq(trips.status, status));
    if (startDate) conditions.push(sql`${trips.startTime} >= ${startDate}`);
    if (endDate) conditions.push(sql`${trips.startTime} <= ${endDate}`);

    const [{ count: total }] = await db
      .select({ count: count() })
      .from(trips)
      .where(sql`${sql.join(conditions, sql` AND `)}`);

    // Get trips with pagination
    const pageNum = page || 1;
    const limitNum = limit || 20;
    const offset = (pageNum - 1) * limitNum;

    const results = await db
      .select()
      .from(trips)
      .where(sql`${sql.join(conditions, sql` AND `)}`)
      .orderBy(sql`${trips.startTime} DESC`)
      .limit(limitNum)
      .offset(offset);

    const pagination = calculatePagination(total, pageNum, limitNum);

    return sendSuccess(res, results, 200, { pagination });
  })
);

/**
 * POST /api/trips
 * Start new trip
 */
router.post(
  '/',
  requireAuth,
  extractUserInfo,
  validate(createTripSchema),
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const { startTime, startLocationId } = req.body;
    const user = (req as any).user;

    // Get driver ID
    let driverId: string;

    if (user.role === 'driver') {
      // Driver starting their own trip
      const driver = await db.query.drivers.findFirst({
        where: eq(drivers.auth0Id, user.auth0Id),
      });

      if (!driver) {
        return sendNotFound(res, 'Driver');
      }

      driverId = driver.id;
    } else {
      // Admin would need to specify driverId (not in current spec)
      return sendNotFound(res, 'Driver');
    }

    // Check if driver already has an active trip
    const activeTrip = await tripUtils.getActiveForDriver(driverId);

    if (activeTrip) {
      return sendSuccess(res, activeTrip, 200); // Return existing active trip
    }

    // Create new trip
    const newTrip = await tripUtils.start({
      driverId,
      startTime: new Date(startTime),
      startLocationId: startLocationId || undefined,
    });

    return sendSuccess(
      res,
      {
        id: newTrip.id,
        driverId: newTrip.driverId,
        startTime: newTrip.startTime,
        status: newTrip.status,
      },
      201
    );
  })
);

/**
 * PUT /api/trips/:id
 * Update/end trip
 */
router.put(
  '/:id',
  requireAuth,
  extractUserInfo,
  validate(updateTripSchema),
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const { id } = req.params;
    const { endTime, endLocationId, distance, status } = req.body;

    // Check if trip exists
    const existingTrip = await db.query.trips.findFirst({
      where: eq(trips.id, id),
    });

    if (!existingTrip) {
      return sendNotFound(res, 'Trip');
    }

    // Build update data
    const updateData: any = {};

    if (endTime) updateData.endTime = new Date(endTime);
    if (endLocationId) updateData.endLocationId = endLocationId;
    if (distance !== undefined) updateData.distance = distance.toString();
    if (status) updateData.status = status;

    // Update trip
    const updatedTrip = await tripUtils.end(id, updateData);

    if (!updatedTrip) {
      return sendNotFound(res, 'Trip');
    }

    return sendSuccess(res, {
      id: updatedTrip.id,
      driverId: updatedTrip.driverId,
      startTime: updatedTrip.startTime,
      endTime: updatedTrip.endTime,
      distance: updatedTrip.distance ? parseFloat(updatedTrip.distance) : undefined,
      status: updatedTrip.status,
    });
  })
);

/**
 * GET /api/trips/:driverId
 * Get trip history for driver
 * Drivers can access their own trips, admins can access any driver's trips
 */
router.get(
  '/:driverId',
  requireAuth,
  extractUserInfo,
  validate(getTripsQuerySchema, 'query'),
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const { driverId } = req.params;
    const { startDate, endDate, status, page, limit } = req.query as any;
    const user = (req as any).user;

    // Check if driver exists
    const driver = await db.query.drivers.findFirst({
      where: eq(drivers.id, driverId),
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

    // Get total count
    const conditions = [eq(trips.driverId, driverId)];
    if (status) conditions.push(eq(trips.status, status));

    const [totalResult] = await db
      .select({ count: count() })
      .from(trips)
      .where(sql`${sql.join(conditions, sql` AND `)}`);

    const total = totalResult?.count || 0;

    // Get trip history
    const tripHistory = await tripUtils.getForDriver(
      driverId,
      status,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
      limit
    );

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

    const pagination = calculatePagination(total, page, limit);

    return sendSuccess(res, formattedTrips, 200, { pagination });
  })
);

export default router;
