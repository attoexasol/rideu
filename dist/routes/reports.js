"use strict";
/**
 * Report Routes
 *
 * GET /api/reports/export - Export data (CSV/PDF)
 * GET /api/reports/driver/:id - Driver report
 * GET /api/reports/fleet - Fleet-wide report
 */
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
const connection_1 = require("../db/connection");
const schema_1 = require("../db/schema");
const utils_1 = require("../db/utils");
const drizzle_orm_1 = require("drizzle-orm");
const router = express_1.default.Router();
/**
 * GET /api/reports/export
 * Export data (CSV/PDF)
 */
router.get('/export', auth_1.requireAuth, auth_1.extractUserInfo, rbac_1.requireAdmin, (0, validators_1.validate)(validators_1.exportReportQuerySchema, 'query'), (0, error_handler_1.asyncHandler)(async (req, res) => {
    const { type, reportType, startDate, endDate, driverId } = req.query;
    // Get data based on report type
    let data = [];
    if (reportType === 'drivers') {
        data = await connection_1.db.select().from(schema_1.drivers);
    }
    else if (reportType === 'trips') {
        const conditions = [];
        if (driverId)
            conditions.push((0, drizzle_orm_1.eq)(schema_1.trips.driverId, driverId));
        if (startDate)
            conditions.push((0, drizzle_orm_1.gte)(schema_1.trips.startTime, new Date(startDate)));
        if (endDate)
            conditions.push((0, drizzle_orm_1.lte)(schema_1.trips.startTime, new Date(endDate)));
        data = await connection_1.db
            .select()
            .from(schema_1.trips)
            .where(conditions.length > 0 ? (0, drizzle_orm_1.and)(...conditions) : undefined);
    }
    else if (reportType === 'locations') {
        const conditions = [];
        if (driverId)
            conditions.push((0, drizzle_orm_1.eq)(schema_1.locations.driverId, driverId));
        if (startDate)
            conditions.push((0, drizzle_orm_1.gte)(schema_1.locations.timestamp, new Date(startDate)));
        if (endDate)
            conditions.push((0, drizzle_orm_1.lte)(schema_1.locations.timestamp, new Date(endDate)));
        data = await connection_1.db
            .select()
            .from(schema_1.locations)
            .where(conditions.length > 0 ? (0, drizzle_orm_1.and)(...conditions) : undefined)
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
        const rows = data.map((row) => Object.values(row)
            .map((val) => `"${val}"`)
            .join(','));
        const csv = [headers, ...rows].join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${reportType}_report.csv"`);
        return res.send(csv);
    }
    else {
        // For PDF, we would use a library like pdfkit or puppeteer
        // For now, return a placeholder
        res.setHeader('Content-Type', 'application/json');
        return (0, response_1.sendSuccess)(res, {
            message: 'PDF export not yet implemented',
            data,
        });
    }
}));
/**
 * GET /api/reports/driver/:id
 * Driver report
 */
router.get('/driver/:id', auth_1.requireAuth, auth_1.extractUserInfo, rbac_1.requireAdmin, (0, validators_1.validate)(validators_1.getReportQuerySchema, 'query'), (0, error_handler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { startDate, endDate } = req.query;
    // Check if driver exists
    const driver = await connection_1.db.query.drivers.findFirst({
        where: (0, drizzle_orm_1.eq)(schema_1.drivers.id, id),
    });
    if (!driver) {
        return (0, response_1.sendNotFound)(res, 'Driver');
    }
    // Get trip statistics
    const tripStats = await utils_1.tripUtils.getStatsForDriver(id, startDate ? new Date(startDate) : undefined, endDate ? new Date(endDate) : undefined);
    // Get all trips for the period
    const allTrips = await utils_1.tripUtils.getForDriver(id, 'completed', startDate ? new Date(startDate) : undefined, endDate ? new Date(endDate) : undefined, 100);
    // Calculate total hours from trips
    let totalHours = 0;
    allTrips.forEach((trip) => {
        if (trip.endTime && trip.startTime) {
            const duration = new Date(trip.endTime).getTime() - new Date(trip.startTime).getTime();
            totalHours += duration / (1000 * 60 * 60); // Convert ms to hours
        }
    });
    // Calculate average speed
    const avgSpeed = tripStats.totalDistance && totalHours > 0 ? Number(tripStats.totalDistance) / totalHours : 0;
    return (0, response_1.sendSuccess)(res, {
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
}));
/**
 * GET /api/reports/fleet
 * Fleet-wide report
 */
router.get('/fleet', auth_1.requireAuth, auth_1.extractUserInfo, rbac_1.requireAdmin, (0, validators_1.validate)(validators_1.getReportQuerySchema, 'query'), (0, error_handler_1.asyncHandler)(async (req, res) => {
    const { startDate, endDate } = req.query;
    // Get all drivers
    const allDrivers = await connection_1.db.select().from(schema_1.drivers);
    // Get active drivers count
    const [activeDriversResult] = await connection_1.db
        .select({ count: (0, drizzle_orm_1.count)() })
        .from(schema_1.drivers)
        .where((0, drizzle_orm_1.eq)(schema_1.drivers.status, 'online'));
    // Get total trips
    const tripConditions = [(0, drizzle_orm_1.eq)(schema_1.trips.status, 'completed')];
    if (startDate)
        tripConditions.push((0, drizzle_orm_1.gte)(schema_1.trips.startTime, new Date(startDate)));
    if (endDate)
        tripConditions.push((0, drizzle_orm_1.lte)(schema_1.trips.startTime, new Date(endDate)));
    const [tripStatsResult] = await connection_1.db
        .select({
        totalTrips: (0, drizzle_orm_1.count)(),
        totalDistance: (0, drizzle_orm_1.sql) `SUM(CAST(${schema_1.trips.distance} AS DECIMAL))`,
    })
        .from(schema_1.trips)
        .where((0, drizzle_orm_1.and)(...tripConditions));
    // Get stats for each driver
    const driverStats = await Promise.all(allDrivers.map(async (driver) => {
        const stats = await utils_1.tripUtils.getStatsForDriver(driver.id, startDate ? new Date(startDate) : undefined, endDate ? new Date(endDate) : undefined);
        // Calculate hours for this driver
        const driverTrips = await utils_1.tripUtils.getForDriver(driver.id, 'completed', startDate ? new Date(startDate) : undefined, endDate ? new Date(endDate) : undefined, 1000);
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
    }));
    return (0, response_1.sendSuccess)(res, {
        totalDrivers: allDrivers.length,
        activeDrivers: Number(activeDriversResult?.count) || 0,
        totalTrips: Number(tripStatsResult?.totalTrips) || 0,
        totalDistance: Number(tripStatsResult?.totalDistance) || 0,
        driverStats: driverStats.filter((s) => s.trips > 0), // Only include drivers with trips
    });
}));
exports.default = router;
//# sourceMappingURL=reports.js.map