/**
 * Database utility functions and common queries
 * Provides reusable database operations for the application
 */
/**
 * Driver Utilities
 */
export declare const driverUtils: {
    /**
     * Find driver by Auth0 ID
     */
    findByAuth0Id(auth0Id: string): Promise<{
        id: string;
        auth0Id: string;
        email: string;
        name: string;
        phone: string | null;
        status: string;
        vehicleType: "sedan" | "suv" | "van" | "mini_bus" | "coach_bus" | null;
        vehicleId: string | null;
        cabName: string | null;
        cabNumber: string | null;
        cabLicence: string | null;
        vehicleMake: string | null;
        vehicleModel: string | null;
        vehicleYear: string | null;
        vehicleColor: string | null;
        qrCode: string | null;
        vehicleQrCode: string | null;
        lastSeen: Date | null;
        activeSessionId: string | null;
        activeDeviceId: string | null;
        activeDeviceInfo: string | null;
        lastLoginAt: Date | null;
        profileImageUrl: string | null;
        accountStatus: string;
        stripeAccountId: string | null;
        stripeAccountCountry: string | null;
        stripeAccountStatus: string | null;
        stripeDetailsSubmitted: boolean;
        stripeChargesEnabled: boolean;
        stripePayoutsEnabled: boolean;
        stripeRequirementsCurrentlyDue: string[] | null;
        stripeRequirementsEventuallyDue: string[] | null;
        stripeOnboardingCompletedAt: Date | null;
        stripeLastSyncedAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
    }>;
    /**
     * Find driver by email
     */
    findByEmail(email: string): Promise<{
        id: string;
        auth0Id: string;
        email: string;
        name: string;
        phone: string | null;
        status: string;
        vehicleType: "sedan" | "suv" | "van" | "mini_bus" | "coach_bus" | null;
        vehicleId: string | null;
        cabName: string | null;
        cabNumber: string | null;
        cabLicence: string | null;
        vehicleMake: string | null;
        vehicleModel: string | null;
        vehicleYear: string | null;
        vehicleColor: string | null;
        qrCode: string | null;
        vehicleQrCode: string | null;
        lastSeen: Date | null;
        activeSessionId: string | null;
        activeDeviceId: string | null;
        activeDeviceInfo: string | null;
        lastLoginAt: Date | null;
        profileImageUrl: string | null;
        accountStatus: string;
        stripeAccountId: string | null;
        stripeAccountCountry: string | null;
        stripeAccountStatus: string | null;
        stripeDetailsSubmitted: boolean;
        stripeChargesEnabled: boolean;
        stripePayoutsEnabled: boolean;
        stripeRequirementsCurrentlyDue: string[] | null;
        stripeRequirementsEventuallyDue: string[] | null;
        stripeOnboardingCompletedAt: Date | null;
        stripeLastSyncedAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
    }>;
    /**
     * Update driver status
     */
    updateStatus(driverId: string, status: string): Promise<{
        id: string;
        auth0Id: string;
        email: string;
        name: string;
        phone: string | null;
        status: string;
        vehicleType: "sedan" | "suv" | "van" | "mini_bus" | "coach_bus" | null;
        vehicleId: string | null;
        cabName: string | null;
        cabNumber: string | null;
        cabLicence: string | null;
        vehicleMake: string | null;
        vehicleModel: string | null;
        vehicleYear: string | null;
        vehicleColor: string | null;
        qrCode: string | null;
        vehicleQrCode: string | null;
        lastSeen: Date | null;
        activeSessionId: string | null;
        activeDeviceId: string | null;
        activeDeviceInfo: string | null;
        lastLoginAt: Date | null;
        profileImageUrl: string | null;
        accountStatus: string;
        stripeAccountId: string | null;
        stripeAccountCountry: string | null;
        stripeAccountStatus: string | null;
        stripeDetailsSubmitted: boolean;
        stripeChargesEnabled: boolean;
        stripePayoutsEnabled: boolean;
        stripeRequirementsCurrentlyDue: string[] | null;
        stripeRequirementsEventuallyDue: string[] | null;
        stripeOnboardingCompletedAt: Date | null;
        stripeLastSyncedAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
    }>;
    /**
     * Get all drivers with a specific status
     */
    findByStatus(status: string): Promise<{
        id: string;
        auth0Id: string;
        email: string;
        name: string;
        phone: string | null;
        status: string;
        vehicleType: "sedan" | "suv" | "van" | "mini_bus" | "coach_bus" | null;
        vehicleId: string | null;
        cabName: string | null;
        cabNumber: string | null;
        cabLicence: string | null;
        vehicleMake: string | null;
        vehicleModel: string | null;
        vehicleYear: string | null;
        vehicleColor: string | null;
        qrCode: string | null;
        vehicleQrCode: string | null;
        lastSeen: Date | null;
        activeSessionId: string | null;
        activeDeviceId: string | null;
        activeDeviceInfo: string | null;
        lastLoginAt: Date | null;
        profileImageUrl: string | null;
        accountStatus: string;
        stripeAccountId: string | null;
        stripeAccountCountry: string | null;
        stripeAccountStatus: string | null;
        stripeDetailsSubmitted: boolean;
        stripeChargesEnabled: boolean;
        stripePayoutsEnabled: boolean;
        stripeRequirementsCurrentlyDue: string[] | null;
        stripeRequirementsEventuallyDue: string[] | null;
        stripeOnboardingCompletedAt: Date | null;
        stripeLastSyncedAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
    }[]>;
    /**
     * Get driver with vehicle information
     */
    findWithVehicle(driverId: string): Promise<{
        name: string;
        auth0Id: string;
        id: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        qrCode: string | null;
        email: string;
        phone: string | null;
        vehicleType: "sedan" | "suv" | "van" | "mini_bus" | "coach_bus" | null;
        vehicleId: string | null;
        cabName: string | null;
        cabNumber: string | null;
        cabLicence: string | null;
        vehicleMake: string | null;
        vehicleModel: string | null;
        vehicleYear: string | null;
        vehicleColor: string | null;
        vehicleQrCode: string | null;
        lastSeen: Date | null;
        activeSessionId: string | null;
        activeDeviceId: string | null;
        activeDeviceInfo: string | null;
        lastLoginAt: Date | null;
        profileImageUrl: string | null;
        accountStatus: string;
        stripeAccountId: string | null;
        stripeAccountCountry: string | null;
        stripeAccountStatus: string | null;
        stripeDetailsSubmitted: boolean;
        stripeChargesEnabled: boolean;
        stripePayoutsEnabled: boolean;
        stripeRequirementsCurrentlyDue: string[] | null;
        stripeRequirementsEventuallyDue: string[] | null;
        stripeOnboardingCompletedAt: Date | null;
        stripeLastSyncedAt: Date | null;
        vehicle: never;
    } | null>;
    /**
     * Update driver session info (for single-session enforcement)
     * Sets lastLoginAt to current timestamp for Auth0 token comparison
     */
    updateSessionInfo(driverId: string, sessionData: {
        activeSessionId: string;
        activeDeviceId: string;
        activeDeviceInfo: string;
    }): Promise<{
        id: string;
        auth0Id: string;
        email: string;
        name: string;
        phone: string | null;
        status: string;
        vehicleType: "sedan" | "suv" | "van" | "mini_bus" | "coach_bus" | null;
        vehicleId: string | null;
        cabName: string | null;
        cabNumber: string | null;
        cabLicence: string | null;
        vehicleMake: string | null;
        vehicleModel: string | null;
        vehicleYear: string | null;
        vehicleColor: string | null;
        qrCode: string | null;
        vehicleQrCode: string | null;
        lastSeen: Date | null;
        activeSessionId: string | null;
        activeDeviceId: string | null;
        activeDeviceInfo: string | null;
        lastLoginAt: Date | null;
        profileImageUrl: string | null;
        accountStatus: string;
        stripeAccountId: string | null;
        stripeAccountCountry: string | null;
        stripeAccountStatus: string | null;
        stripeDetailsSubmitted: boolean;
        stripeChargesEnabled: boolean;
        stripePayoutsEnabled: boolean;
        stripeRequirementsCurrentlyDue: string[] | null;
        stripeRequirementsEventuallyDue: string[] | null;
        stripeOnboardingCompletedAt: Date | null;
        stripeLastSyncedAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
    }>;
    /**
     * Clear driver session info (on logout)
     */
    clearSessionInfo(driverId: string): Promise<{
        id: string;
        auth0Id: string;
        email: string;
        name: string;
        phone: string | null;
        status: string;
        vehicleType: "sedan" | "suv" | "van" | "mini_bus" | "coach_bus" | null;
        vehicleId: string | null;
        cabName: string | null;
        cabNumber: string | null;
        cabLicence: string | null;
        vehicleMake: string | null;
        vehicleModel: string | null;
        vehicleYear: string | null;
        vehicleColor: string | null;
        qrCode: string | null;
        vehicleQrCode: string | null;
        lastSeen: Date | null;
        activeSessionId: string | null;
        activeDeviceId: string | null;
        activeDeviceInfo: string | null;
        lastLoginAt: Date | null;
        profileImageUrl: string | null;
        accountStatus: string;
        stripeAccountId: string | null;
        stripeAccountCountry: string | null;
        stripeAccountStatus: string | null;
        stripeDetailsSubmitted: boolean;
        stripeChargesEnabled: boolean;
        stripePayoutsEnabled: boolean;
        stripeRequirementsCurrentlyDue: string[] | null;
        stripeRequirementsEventuallyDue: string[] | null;
        stripeOnboardingCompletedAt: Date | null;
        stripeLastSyncedAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
    }>;
};
/**
 * Location Utilities
 */
export declare const locationUtils: {
    /**
     * Get latest location for a driver
     */
    getLatestForDriver(driverId: string): Promise<{
        id: string;
        driverId: string;
        latitude: string;
        longitude: string;
        accuracy: string | null;
        speed: string | null;
        heading: string | null;
        timestamp: Date;
        createdAt: Date;
    }>;
    /**
     * Get location history for a driver within date range
     */
    getHistoryForDriver(driverId: string, startDate?: Date, endDate?: Date, limit?: number): Promise<{
        id: string;
        driverId: string;
        latitude: string;
        longitude: string;
        accuracy: string | null;
        speed: string | null;
        heading: string | null;
        timestamp: Date;
        createdAt: Date;
    }[]>;
    /**
     * Get all active driver locations (most recent for each driver)
     */
    getActiveDriverLocations(): Promise<{
        locations: {
            id: string;
            driverId: string;
            latitude: string;
            longitude: string;
            accuracy: string | null;
            speed: string | null;
            heading: string | null;
            timestamp: Date;
            createdAt: Date;
        };
        latest: {
            driverId: string;
            maxTimestamp: Date;
        };
    }[]>;
    /**
     * Create new location record
     */
    create(locationData: {
        driverId: string;
        latitude: string;
        longitude: string;
        accuracy?: string;
        speed?: string;
        heading?: string;
        timestamp?: Date;
    }): Promise<{
        id: string;
        createdAt: Date;
        driverId: string;
        latitude: string;
        longitude: string;
        accuracy: string | null;
        speed: string | null;
        heading: string | null;
        timestamp: Date;
    }>;
};
/**
 * Trip Utilities
 */
export declare const tripUtils: {
    /**
     * Get trips for a driver
     */
    getForDriver(driverId: string, status?: string, startDate?: Date, endDate?: Date, limit?: number): Promise<{
        id: string;
        driverId: string;
        bookingId: string | null;
        customerId: string | null;
        startTime: Date;
        endTime: Date | null;
        distance: string | null;
        status: string;
        startLocationId: string | null;
        endLocationId: string | null;
        passengerQrCode: string | null;
        qrVerified: boolean;
        qrVerifiedAt: Date | null;
        tripType: string | null;
        createdAt: Date;
        updatedAt: Date;
    }[]>;
    /**
     * Get active trip for a driver
     */
    getActiveForDriver(driverId: string): Promise<{
        id: string;
        driverId: string;
        bookingId: string | null;
        customerId: string | null;
        startTime: Date;
        endTime: Date | null;
        distance: string | null;
        status: string;
        startLocationId: string | null;
        endLocationId: string | null;
        passengerQrCode: string | null;
        qrVerified: boolean;
        qrVerifiedAt: Date | null;
        tripType: string | null;
        createdAt: Date;
        updatedAt: Date;
    }>;
    /**
     * Start a new trip
     */
    start(tripData: {
        driverId: string;
        startTime: Date;
        startLocationId?: string;
    }): Promise<{
        bookingId: string | null;
        id: string;
        status: string;
        createdAt: Date;
        updatedAt: Date;
        driverId: string;
        customerId: string | null;
        startTime: Date;
        endTime: Date | null;
        distance: string | null;
        startLocationId: string | null;
        endLocationId: string | null;
        passengerQrCode: string | null;
        qrVerified: boolean;
        qrVerifiedAt: Date | null;
        tripType: string | null;
    }>;
    /**
     * End a trip
     */
    end(tripId: string, endData: {
        endTime: Date;
        endLocationId?: string;
        distance?: string;
        status?: "completed" | "cancelled";
    }): Promise<{
        id: string;
        driverId: string;
        bookingId: string | null;
        customerId: string | null;
        startTime: Date;
        endTime: Date | null;
        distance: string | null;
        status: string;
        startLocationId: string | null;
        endLocationId: string | null;
        passengerQrCode: string | null;
        qrVerified: boolean;
        qrVerifiedAt: Date | null;
        tripType: string | null;
        createdAt: Date;
        updatedAt: Date;
    }>;
    /**
     * Get trip statistics for a driver
     */
    getStatsForDriver(driverId: string, startDate?: Date, endDate?: Date): Promise<{
        totalTrips: number;
        totalDistance: number;
        avgDistance: number;
    }>;
};
/**
 * Admin User Utilities
 */
export declare const adminUtils: {
    /**
     * Find admin user by Auth0 ID
     */
    findByAuth0Id(auth0Id: string): Promise<{
        id: string;
        auth0Id: string;
        email: string;
        name: string;
        role: string;
        createdAt: Date;
        updatedAt: Date;
    }>;
    /**
     * Find admin user by email
     */
    findByEmail(email: string): Promise<{
        id: string;
        auth0Id: string;
        email: string;
        name: string;
        role: string;
        createdAt: Date;
        updatedAt: Date;
    }>;
    /**
     * Get all admin users by role
     */
    findByRole(role: string): Promise<{
        id: string;
        auth0Id: string;
        email: string;
        name: string;
        role: string;
        createdAt: Date;
        updatedAt: Date;
    }[]>;
};
/**
 * Session Utilities
 */
export declare const sessionUtils: {
    /**
     * Create a new session
     */
    create(sessionData: {
        userId: string;
        userType: string;
        token: string;
        expiresAt: Date;
    }): Promise<{
        userId: string;
        userType: string;
        id: string;
        createdAt: Date;
        token: string;
        expiresAt: Date;
    }>;
    /**
     * Find session by token
     */
    findByToken(token: string): Promise<{
        id: string;
        userId: string;
        userType: string;
        token: string;
        expiresAt: Date;
        createdAt: Date;
    }>;
    /**
     * Find all active sessions for a user
     */
    findAllForUser(userId: string): Promise<{
        id: string;
        userId: string;
        userType: string;
        token: string;
        expiresAt: Date;
        createdAt: Date;
    }[]>;
    /**
     * Delete session by token
     */
    deleteByToken(token: string): Promise<void>;
    /**
     * Delete expired sessions
     */
    deleteExpired(): Promise<import("postgres").RowList<never[]>>;
    /**
     * Delete all sessions for a user
     */
    deleteAllForUser(userId: string): Promise<void>;
};
/**
 * General Database Utilities
 */
export declare const dbUtils: {
    /**
     * Clean up old location data (older than specified days)
     */
    cleanupOldLocations(daysToKeep?: number): Promise<import("postgres").RowList<never[]>>;
    /**
     * Clean up old completed trips (older than specified days)
     */
    cleanupOldTrips(daysToKeep?: number): Promise<import("postgres").RowList<never[]>>;
    /**
     * Get database statistics
     */
    getStats(): Promise<{
        drivers: number;
        locations: number;
        trips: number;
        admins: number;
    }>;
};
//# sourceMappingURL=utils.d.ts.map