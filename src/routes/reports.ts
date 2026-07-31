/**
 * Report Routes
 *
 * GET /api/reports/export - Export data (CSV/PDF)
 * GET /api/reports/driver/:id - Driver report
 * GET /api/reports/fleet - Fleet-wide report
 */

import express from 'express';
import { requireAuth, extractUserInfo } from '../middleware/auth';
import { requireAdmin } from '../middleware/rbac';
import { validate, exportReportQuerySchema, getReportQuerySchema } from '../validators';
import { sendSuccess, sendNotFound } from '../utils/response';
import { asyncHandler } from '../middleware/error-handler';
import { db } from '../db/connection';
import { drivers, trips, locations } from '../db/schema';
import { tripUtils } from '../db/utils';
import { eq, and, gte, lte, sql, count } from 'drizzle-orm';

const router = express.Router();

/**
 * GET /api/reports/export
 * Export data (CSV/PDF)
 */
router.get(
  '/export',
  requireAuth,
  extractUserInfo,
  requireAdmin,
  validate(exportReportQuerySchema, 'query'),
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const { type, reportType, startDate, endDate, driverId } = req.query as any;

    // Get data based on report type
    let data: any[] = [];

    if (reportType === 'drivers') {
      data = await db.select().from(drivers);
    } else if (reportType === 'trips') {
      const conditions = [];
      if (driverId) conditions.push(eq(trips.driverId, driverId));
      if (startDate) conditions.push(gte(trips.startTime, new Date(startDate)));
      if (endDate) conditions.push(lte(trips.startTime, new Date(endDate)));

      data = await db
        .select()
        .from(trips)
        .where(conditions.length > 0 ? and(...conditions) : undefined);
    } else if (reportType === 'locations') {
      const conditions = [];
      if (driverId) conditions.push(eq(locations.driverId, driverId));
      if (startDate) conditions.push(gte(locations.timestamp, new Date(startDate)));
      if (endDate) conditions.push(lte(locations.timestamp, new Date(endDate)));

      data = await db
        .select()
        .from(locations)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .limit(1000); // Limit for performance
    }

    if (type === 'csv') {
      // Generate CSV
      if (data.length === 0) {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${reportType}_report.csv"`);
        return res.send('No data available');
      }

      const headers = Object.keys(data[0]).join(',');
      const rows = data.map((row) =>
        Object.values(row)
          .map((val) => `"${val}"`)
          .join(',')
      );
      const csv = [headers, ...rows].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${reportType}_report.csv"`);
      return res.send(csv);
    } else {
      // For PDF, we would use a library like pdfkit or puppeteer
      // For now, return a placeholder
      res.setHeader('Content-Type', 'application/json');
      return sendSuccess(res, {
        message: 'PDF export not yet implemented',
        data,
      });
    }
  })
);

/**
 * GET /api/reports/driver/:id
 * Driver report
 */
router.get(
  '/driver/:id',
  requireAuth,
  extractUserInfo,
  requireAdmin,
  validate(getReportQuerySchema, 'query'),
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const { id } = req.params;
    const { startDate, endDate } = req.query as any;

    // Check if driver exists
    const driver = await db.query.drivers.findFirst({
      where: eq(drivers.id, id),
    });

    if (!driver) {
      return sendNotFound(res, 'Driver');
    }

    // Get trip statistics
    const tripStats = await tripUtils.getStatsForDriver(
      id,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined
    );

    // Get all trips for the period
    const allTrips = await tripUtils.getForDriver(
      id,
      'completed',
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
      100
    );

    // Calculate total hours from trips
    let totalHours = 0;
    allTrips.forEach((trip) => {
      if (trip.endTime && trip.startTime) {
        const duration = new Date(trip.endTime).getTime() - new Date(trip.startTime).getTime();
        totalHours += duration / (1000 * 60 * 60); // Convert ms to hours
      }
    });

    // Calculate average speed
    const avgSpeed =
      tripStats.totalDistance && totalHours > 0 ? Number(tripStats.totalDistance) / totalHours : 0;

    return sendSuccess(res, {
      driverId: driver.id,
      driverName: driver.name,
      totalTrips: Number(tripStats.totalTrips) || 0,
      totalDistance: Number(tripStats.totalDistance) || 0,
      totalHours: Math.round(totalHours * 100) / 100,
      averageSpeed: Math.round(avgSpeed * 100) / 100,
      trips: allTrips.map((trip) => ({
        id: trip.id,
        startTime: trip.startTime,
        endTime: trip.endTime,
        distance: trip.distance ? parseFloat(trip.distance) : 0,
        status: trip.status,
      })),
    });
  })
);

/**
 * GET /api/reports/fleet
 * Fleet-wide report
 */
router.get(
  '/fleet',
  requireAuth,
  extractUserInfo,
  requireAdmin,
  validate(getReportQuerySchema, 'query'),
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const { startDate, endDate } = req.query as any;

    // Get all drivers
    const allDrivers = await db.select().from(drivers);

    // Get active drivers count
    const [activeDriversResult] = await db
      .select({ count: count() })
      .from(drivers)
      .where(eq(drivers.status, 'online'));

    // Get total trips
    const tripConditions = [eq(trips.status, 'completed')];
    if (startDate) tripConditions.push(gte(trips.startTime, new Date(startDate)));
    if (endDate) tripConditions.push(lte(trips.startTime, new Date(endDate)));

    const [tripStatsResult] = await db
      .select({
        totalTrips: count(),
        totalDistance: sql<number>`SUM(CAST(${trips.distance} AS DECIMAL))`,
      })
      .from(trips)
      .where(and(...tripConditions));

    // Get stats for each driver
    const driverStats = await Promise.all(
      allDrivers.map(async (driver) => {
        const stats = await tripUtils.getStatsForDriver(
          driver.id,
          startDate ? new Date(startDate) : undefined,
          endDate ? new Date(endDate) : undefined
        );

        // Calculate hours for this driver
        const driverTrips = await tripUtils.getForDriver(
          driver.id,
          'completed',
          startDate ? new Date(startDate) : undefined,
          endDate ? new Date(endDate) : undefined,
          1000
        );

        let totalHours = 0;
        driverTrips.forEach((trip) => {
          if (trip.endTime && trip.startTime) {
            const duration = new Date(trip.endTime).getTime() - new Date(trip.startTime).getTime();
            totalHours += duration / (1000 * 60 * 60);
          }
        });

        return {
          driverId: driver.id,
          name: driver.name,
          trips: Number(stats.totalTrips) || 0,
          distance: Number(stats.totalDistance) || 0,
          hours: Math.round(totalHours * 100) / 100,
        };
      })
    );

    return sendSuccess(res, {
      totalDrivers: allDrivers.length,
      activeDrivers: Number(activeDriversResult?.count) || 0,
      totalTrips: Number(tripStatsResult?.totalTrips) || 0,
      totalDistance: Number(tripStatsResult?.totalDistance) || 0,
      driverStats: driverStats.filter((s) => s.trips > 0), // Only include drivers with trips
    });
  })
);

export default router;
