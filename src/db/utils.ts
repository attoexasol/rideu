import { db } from './connection';
import { drivers, locations, trips, adminUsers, sessions } from './schema';
import { eq, desc, and, gte, lte, sql } from 'drizzle-orm';

/**
 * Database utility functions and common queries
 * Provides reusable database operations for the application
 */

/**
 * Driver Utilities
 */
export const driverUtils = {
  /**
   * Find driver by Auth0 ID
   */
  async findByAuth0Id(auth0Id: string) {
    const result = await db.select().from(drivers).where(eq(drivers.auth0Id, auth0Id)).limit(1);
    return result[0] || null;
  },

  /**
   * Find driver by email
   */
  async findByEmail(email: string) {
    const result = await db.select().from(drivers).where(eq(drivers.email, email)).limit(1);
    return result[0] || null;
  },

  /**
   * Update driver status
   */
  async updateStatus(driverId: string, status: string) {
    const result = await db
      .update(drivers)
      .set({ status, lastSeen: new Date(), updatedAt: new Date() })
      .where(eq(drivers.id, driverId))
      .returning();
    return result[0] || null;
  },

  /**
   * Get all drivers with a specific status
   */
  async findByStatus(status: string) {
    return await db.select().from(drivers).where(eq(drivers.status, status));
  },

  /**
   * Get driver with vehicle information
   */
  async findWithVehicle(driverId: string) {
    const result = await db.query.drivers.findFirst({
      where: eq(drivers.id, driverId),
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
  async updateSessionInfo(
    driverId: string,
    sessionData: {
      activeSessionId: string;
      activeDeviceId: string;
      activeDeviceInfo: string;
    }
  ) {
    const result = await db
      .update(drivers)
      .set({
        activeSessionId: sessionData.activeSessionId,
        activeDeviceId: sessionData.activeDeviceId,
        activeDeviceInfo: sessionData.activeDeviceInfo,
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(drivers.id, driverId))
      .returning();
    return result[0] || null;
  },

  /**
   * Clear driver session info (on logout)
   */
  async clearSessionInfo(driverId: string) {
    const result = await db
      .update(drivers)
      .set({
        activeSessionId: null,
        activeDeviceId: null,
        activeDeviceInfo: null,
        updatedAt: new Date(),
      })
      .where(eq(drivers.id, driverId))
      .returning();
    return result[0] || null;
  },
};

/**
 * Location Utilities
 */
export const locationUtils = {
  /**
   * Get latest location for a driver
   */
  async getLatestForDriver(driverId: string) {
    const result = await db
      .select()
      .from(locations)
      .where(eq(locations.driverId, driverId))
      .orderBy(desc(locations.timestamp))
      .limit(1);
    return result[0] || null;
  },

  /**
   * Get location history for a driver within date range
   */
  async getHistoryForDriver(
    driverId: string,
    startDate?: Date,
    endDate?: Date,
    limit: number = 100
  ) {
    let query = db
      .select()
      .from(locations)
      .where(eq(locations.driverId, driverId))
      .orderBy(desc(locations.timestamp));

    if (startDate && endDate) {
      query = db
        .select()
        .from(locations)
        .where(
          and(
            eq(locations.driverId, driverId),
            gte(locations.timestamp, startDate),
            lte(locations.timestamp, endDate)
          )
        )
        .orderBy(desc(locations.timestamp));
    }

    return await query.limit(limit);
  },

  /**
   * Get all active driver locations (most recent for each driver)
   */
  async getActiveDriverLocations() {
    // This query gets the most recent location for each driver
    const subquery = db
      .select({
        driverId: locations.driverId,
        maxTimestamp: sql<Date>`MAX(${locations.timestamp})`.as('max_timestamp'),
      })
      .from(locations)
      .groupBy(locations.driverId)
      .as('latest');

    return await db
      .select()
      .from(locations)
      .innerJoin(
        subquery,
        and(
          eq(locations.driverId, subquery.driverId),
          eq(locations.timestamp, subquery.maxTimestamp)
        )
      );
  },

  /**
   * Create new location record
   */
  async create(locationData: {
    driverId: string;
    latitude: string;
    longitude: string;
    accuracy?: string;
    speed?: string;
    heading?: string;
    timestamp?: Date;
  }) {
    const result = await db.insert(locations).values(locationData).returning();
    return result[0];
  },
};

/**
 * Trip Utilities
 */
export const tripUtils = {
  /**
   * Get trips for a driver
   */
  async getForDriver(
    driverId: string,
    status?: string,
    startDate?: Date,
    endDate?: Date,
    limit: number = 50
  ) {
    let conditions = [eq(trips.driverId, driverId)];

    if (status) {
      conditions.push(eq(trips.status, status));
    }

    if (startDate) {
      conditions.push(gte(trips.startTime, startDate));
    }

    if (endDate) {
      conditions.push(lte(trips.startTime, endDate));
    }

    return await db
      .select()
      .from(trips)
      .where(and(...conditions))
      .orderBy(desc(trips.startTime))
      .limit(limit);
  },

  /**
   * Get active trip for a driver
   */
  async getActiveForDriver(driverId: string) {
    const result = await db
      .select()
      .from(trips)
      .where(and(eq(trips.driverId, driverId), eq(trips.status, 'in_progress')))
      .orderBy(desc(trips.startTime))
      .limit(1);
    return result[0] || null;
  },

  /**
   * Start a new trip
   */
  async start(tripData: { driverId: string; startTime: Date; startLocationId?: string }) {
    const result = await db.insert(trips).values(tripData).returning();
    return result[0];
  },

  /**
   * End a trip
   */
  async end(
    tripId: string,
    endData: {
      endTime: Date;
      endLocationId?: string;
      distance?: string;
      status?: 'completed' | 'cancelled';
    }
  ) {
    const result = await db
      .update(trips)
      .set({ ...endData, updatedAt: new Date() })
      .where(eq(trips.id, tripId))
      .returning();
    return result[0] || null;
  },

  /**
   * Get trip statistics for a driver
   */
  async getStatsForDriver(driverId: string, startDate?: Date, endDate?: Date) {
    let conditions = [eq(trips.driverId, driverId), eq(trips.status, 'completed')];

    if (startDate) {
      conditions.push(gte(trips.startTime, startDate));
    }

    if (endDate) {
      conditions.push(lte(trips.startTime, endDate));
    }

    const result = await db
      .select({
        totalTrips: sql<number>`COUNT(*)`,
        totalDistance: sql<number>`SUM(${trips.distance})`,
        avgDistance: sql<number>`AVG(${trips.distance})`,
      })
      .from(trips)
      .where(and(...conditions));

    return result[0];
  },
};

/**
 * Admin User Utilities
 */
export const adminUtils = {
  /**
   * Find admin user by Auth0 ID
   */
  async findByAuth0Id(auth0Id: string) {
    const result = await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.auth0Id, auth0Id))
      .limit(1);
    return result[0] || null;
  },

  /**
   * Find admin user by email
   */
  async findByEmail(email: string) {
    const result = await db.select().from(adminUsers).where(eq(adminUsers.email, email)).limit(1);
    return result[0] || null;
  },

  /**
   * Get all admin users by role
   */
  async findByRole(role: string) {
    return await db.select().from(adminUsers).where(eq(adminUsers.role, role));
  },
};

/**
 * Session Utilities
 */
export const sessionUtils = {
  /**
   * Create a new session
   */
  async create(sessionData: { userId: string; userType: string; token: string; expiresAt: Date }) {
    const result = await db.insert(sessions).values(sessionData).returning();
    return result[0];
  },

  /**
   * Find session by token
   */
  async findByToken(token: string) {
    const result = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.token, token), gte(sessions.expiresAt, new Date())))
      .limit(1);
    return result[0] || null;
  },

  /**
   * Find all active sessions for a user
   */
  async findAllForUser(userId: string) {
    return await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), gte(sessions.expiresAt, new Date())));
  },

  /**
   * Delete session by token
   */
  async deleteByToken(token: string) {
    await db.delete(sessions).where(eq(sessions.token, token));
  },

  /**
   * Delete expired sessions
   */
  async deleteExpired() {
    const result = await db.delete(sessions).where(lte(sessions.expiresAt, new Date()));
    return result;
  },

  /**
   * Delete all sessions for a user
   */
  async deleteAllForUser(userId: string) {
    await db.delete(sessions).where(eq(sessions.userId, userId));
  },
};

/**
 * General Database Utilities
 */
export const dbUtils = {
  /**
   * Clean up old location data (older than specified days)
   */
  async cleanupOldLocations(daysToKeep: number = 30) {
    const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
    const result = await db.delete(locations).where(lte(locations.timestamp, cutoffDate));
    return result;
  },

  /**
   * Clean up old completed trips (older than specified days)
   */
  async cleanupOldTrips(daysToKeep: number = 90) {
    const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
    const result = await db
      .delete(trips)
      .where(and(eq(trips.status, 'completed'), lte(trips.endTime, cutoffDate)));
    return result;
  },

  /**
   * Get database statistics
   */
  async getStats() {
    const [driverCount] = await db.select({ count: sql<number>`COUNT(*)` }).from(drivers);
    const [locationCount] = await db.select({ count: sql<number>`COUNT(*)` }).from(locations);
    const [tripCount] = await db.select({ count: sql<number>`COUNT(*)` }).from(trips);
    const [adminCount] = await db.select({ count: sql<number>`COUNT(*)` }).from(adminUsers);

    return {
      drivers: driverCount.count,
      locations: locationCount.count,
      trips: tripCount.count,
      admins: adminCount.count,
    };
  },
};
