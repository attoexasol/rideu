"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dbUtils = exports.sessionUtils = exports.adminUtils = exports.tripUtils = exports.locationUtils = exports.driverUtils = void 0;
const connection_1 = require("./connection");
const schema_1 = require("./schema");
const drizzle_orm_1 = require("drizzle-orm");
/**
 * Database utility functions and common queries
 * Provides reusable database operations for the application
 */
/**
 * Driver Utilities
 */
exports.driverUtils = {
    /**
     * Find driver by Auth0 ID
     */
    async findByAuth0Id(auth0Id) {
        const result = await connection_1.db.select().from(schema_1.drivers).where((0, drizzle_orm_1.eq)(schema_1.drivers.auth0Id, auth0Id)).limit(1);
        return result[0] || null;
    },
    /**
     * Find driver by email
     */
    async findByEmail(email) {
        const result = await connection_1.db.select().from(schema_1.drivers).where((0, drizzle_orm_1.eq)(schema_1.drivers.email, email)).limit(1);
        return result[0] || null;
    },
    /**
     * Update driver status
     */
    async updateStatus(driverId, status) {
        const result = await connection_1.db
            .update(schema_1.drivers)
            .set({ status, lastSeen: new Date(), updatedAt: new Date() })
            .where((0, drizzle_orm_1.eq)(schema_1.drivers.id, driverId))
            .returning();
        return result[0] || null;
    },
    /**
     * Get all drivers with a specific status
     */
    async findByStatus(status) {
        return await connection_1.db.select().from(schema_1.drivers).where((0, drizzle_orm_1.eq)(schema_1.drivers.status, status));
    },
    /**
     * Get driver with vehicle information
     */
    async findWithVehicle(driverId) {
        const result = await connection_1.db.query.drivers.findFirst({
            where: (0, drizzle_orm_1.eq)(schema_1.drivers.id, driverId),
            with: {
                vehicle: true,
            },
        });
        return result || null;
    },
    /**
     * Update driver session info (for single-session enforcement)
     * Sets lastLoginAt to current timestamp for Auth0 token comparison
     */
    async updateSessionInfo(driverId, sessionData) {
        const result = await connection_1.db
            .update(schema_1.drivers)
            .set({
            activeSessionId: sessionData.activeSessionId,
            activeDeviceId: sessionData.activeDeviceId,
            activeDeviceInfo: sessionData.activeDeviceInfo,
            lastLoginAt: new Date(),
            updatedAt: new Date(),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.drivers.id, driverId))
            .returning();
        return result[0] || null;
    },
    /**
     * Clear driver session info (on logout)
     */
    async clearSessionInfo(driverId) {
        const result = await connection_1.db
            .update(schema_1.drivers)
            .set({
            activeSessionId: null,
            activeDeviceId: null,
            activeDeviceInfo: null,
            updatedAt: new Date(),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.drivers.id, driverId))
            .returning();
        return result[0] || null;
    },
};
/**
 * Location Utilities
 */
exports.locationUtils = {
    /**
     * Get latest location for a driver
     */
    async getLatestForDriver(driverId) {
        const result = await connection_1.db
            .select()
            .from(schema_1.locations)
            .where((0, drizzle_orm_1.eq)(schema_1.locations.driverId, driverId))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.locations.timestamp))
            .limit(1);
        return result[0] || null;
    },
    /**
     * Get location history for a driver within date range
     */
    async getHistoryForDriver(driverId, startDate, endDate, limit = 100) {
        let query = connection_1.db
            .select()
            .from(schema_1.locations)
            .where((0, drizzle_orm_1.eq)(schema_1.locations.driverId, driverId))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.locations.timestamp));
        if (startDate && endDate) {
            query = connection_1.db
                .select()
                .from(schema_1.locations)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.locations.driverId, driverId), (0, drizzle_orm_1.gte)(schema_1.locations.timestamp, startDate), (0, drizzle_orm_1.lte)(schema_1.locations.timestamp, endDate)))
                .orderBy((0, drizzle_orm_1.desc)(schema_1.locations.timestamp));
        }
        return await query.limit(limit);
    },
    /**
     * Get all active driver locations (most recent for each driver)
     */
    async getActiveDriverLocations() {
        // This query gets the most recent location for each driver
        const subquery = connection_1.db
            .select({
            driverId: schema_1.locations.driverId,
            maxTimestamp: (0, drizzle_orm_1.sql) `MAX(${schema_1.locations.timestamp})`.as('max_timestamp'),
        })
            .from(schema_1.locations)
            .groupBy(schema_1.locations.driverId)
            .as('latest');
        return await connection_1.db
            .select()
            .from(schema_1.locations)
            .innerJoin(subquery, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.locations.driverId, subquery.driverId), (0, drizzle_orm_1.eq)(schema_1.locations.timestamp, subquery.maxTimestamp)));
    },
    /**
     * Create new location record
     */
    async create(locationData) {
        const result = await connection_1.db.insert(schema_1.locations).values(locationData).returning();
        return result[0];
    },
};
/**
 * Trip Utilities
 */
exports.tripUtils = {
    /**
     * Get trips for a driver
     */
    async getForDriver(driverId, status, startDate, endDate, limit = 50) {
        let conditions = [(0, drizzle_orm_1.eq)(schema_1.trips.driverId, driverId)];
        if (status) {
            conditions.push((0, drizzle_orm_1.eq)(schema_1.trips.status, status));
        }
        if (startDate) {
            conditions.push((0, drizzle_orm_1.gte)(schema_1.trips.startTime, startDate));
        }
        if (endDate) {
            conditions.push((0, drizzle_orm_1.lte)(schema_1.trips.startTime, endDate));
        }
        return await connection_1.db
            .select()
            .from(schema_1.trips)
            .where((0, drizzle_orm_1.and)(...conditions))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.trips.startTime))
            .limit(limit);
    },
    /**
     * Get active trip for a driver
     */
    async getActiveForDriver(driverId) {
        const result = await connection_1.db
            .select()
            .from(schema_1.trips)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.trips.driverId, driverId), (0, drizzle_orm_1.eq)(schema_1.trips.status, 'in_progress')))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.trips.startTime))
            .limit(1);
        return result[0] || null;
    },
    /**
     * Start a new trip
     */
    async start(tripData) {
        const result = await connection_1.db.insert(schema_1.trips).values(tripData).returning();
        return result[0];
    },
    /**
     * End a trip
     */
    async end(tripId, endData) {
        const result = await connection_1.db
            .update(schema_1.trips)
            .set({ ...endData, updatedAt: new Date() })
            .where((0, drizzle_orm_1.eq)(schema_1.trips.id, tripId))
            .returning();
        return result[0] || null;
    },
    /**
     * Get trip statistics for a driver
     */
    async getStatsForDriver(driverId, startDate, endDate) {
        let conditions = [(0, drizzle_orm_1.eq)(schema_1.trips.driverId, driverId), (0, drizzle_orm_1.eq)(schema_1.trips.status, 'completed')];
        if (startDate) {
            conditions.push((0, drizzle_orm_1.gte)(schema_1.trips.startTime, startDate));
        }
        if (endDate) {
            conditions.push((0, drizzle_orm_1.lte)(schema_1.trips.startTime, endDate));
        }
        const result = await connection_1.db
            .select({
            totalTrips: (0, drizzle_orm_1.sql) `COUNT(*)`,
            totalDistance: (0, drizzle_orm_1.sql) `SUM(${schema_1.trips.distance})`,
            avgDistance: (0, drizzle_orm_1.sql) `AVG(${schema_1.trips.distance})`,
        })
            .from(schema_1.trips)
            .where((0, drizzle_orm_1.and)(...conditions));
        return result[0];
    },
};
/**
 * Admin User Utilities
 */
exports.adminUtils = {
    /**
     * Find admin user by Auth0 ID
     */
    async findByAuth0Id(auth0Id) {
        const result = await connection_1.db
            .select()
            .from(schema_1.adminUsers)
            .where((0, drizzle_orm_1.eq)(schema_1.adminUsers.auth0Id, auth0Id))
            .limit(1);
        return result[0] || null;
    },
    /**
     * Find admin user by email
     */
    async findByEmail(email) {
        const result = await connection_1.db.select().from(schema_1.adminUsers).where((0, drizzle_orm_1.eq)(schema_1.adminUsers.email, email)).limit(1);
        return result[0] || null;
    },
    /**
     * Get all admin users by role
     */
    async findByRole(role) {
        return await connection_1.db.select().from(schema_1.adminUsers).where((0, drizzle_orm_1.eq)(schema_1.adminUsers.role, role));
    },
};
/**
 * Session Utilities
 */
exports.sessionUtils = {
    /**
     * Create a new session
     */
    async create(sessionData) {
        const result = await connection_1.db.insert(schema_1.sessions).values(sessionData).returning();
        return result[0];
    },
    /**
     * Find session by token
     */
    async findByToken(token) {
        const result = await connection_1.db
            .select()
            .from(schema_1.sessions)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.sessions.token, token), (0, drizzle_orm_1.gte)(schema_1.sessions.expiresAt, new Date())))
            .limit(1);
        return result[0] || null;
    },
    /**
     * Find all active sessions for a user
     */
    async findAllForUser(userId) {
        return await connection_1.db
            .select()
            .from(schema_1.sessions)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.sessions.userId, userId), (0, drizzle_orm_1.gte)(schema_1.sessions.expiresAt, new Date())));
    },
    /**
     * Delete session by token
     */
    async deleteByToken(token) {
        await connection_1.db.delete(schema_1.sessions).where((0, drizzle_orm_1.eq)(schema_1.sessions.token, token));
    },
    /**
     * Delete expired sessions
     */
    async deleteExpired() {
        const result = await connection_1.db.delete(schema_1.sessions).where((0, drizzle_orm_1.lte)(schema_1.sessions.expiresAt, new Date()));
        return result;
    },
    /**
     * Delete all sessions for a user
     */
    async deleteAllForUser(userId) {
        await connection_1.db.delete(schema_1.sessions).where((0, drizzle_orm_1.eq)(schema_1.sessions.userId, userId));
    },
};
/**
 * General Database Utilities
 */
exports.dbUtils = {
    /**
     * Clean up old location data (older than specified days)
     */
    async cleanupOldLocations(daysToKeep = 30) {
        const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
        const result = await connection_1.db.delete(schema_1.locations).where((0, drizzle_orm_1.lte)(schema_1.locations.timestamp, cutoffDate));
        return result;
    },
    /**
     * Clean up old completed trips (older than specified days)
     */
    async cleanupOldTrips(daysToKeep = 90) {
        const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
        const result = await connection_1.db
            .delete(schema_1.trips)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.trips.status, 'completed'), (0, drizzle_orm_1.lte)(schema_1.trips.endTime, cutoffDate)));
        return result;
    },
    /**
     * Get database statistics
     */
    async getStats() {
        const [driverCount] = await connection_1.db.select({ count: (0, drizzle_orm_1.sql) `COUNT(*)` }).from(schema_1.drivers);
        const [locationCount] = await connection_1.db.select({ count: (0, drizzle_orm_1.sql) `COUNT(*)` }).from(schema_1.locations);
        const [tripCount] = await connection_1.db.select({ count: (0, drizzle_orm_1.sql) `COUNT(*)` }).from(schema_1.trips);
        const [adminCount] = await connection_1.db.select({ count: (0, drizzle_orm_1.sql) `COUNT(*)` }).from(schema_1.adminUsers);
        return {
            drivers: driverCount.count,
            locations: locationCount.count,
            trips: tripCount.count,
            admins: adminCount.count,
        };
    },
};
//# sourceMappingURL=utils.js.map