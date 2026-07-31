"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.drivers = exports.vehicleTypeEnum = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const vehicles_1 = require("./vehicles");
/**
 * Vehicle Type Enum
 * Defines the types of vehicles available in the fleet
 */
exports.vehicleTypeEnum = (0, pg_core_1.pgEnum)('vehicle_type', [
    'sedan', // Business Class Travel - 3 passengers
    'suv', // Comfort for Small Groups - 5 passengers
    'van', // ADA Accessible Options - 10 passengers
    'mini_bus', // Mid-Sized Groups - 18-24 passengers
    'coach_bus', // Large Groups - 50-55 passengers
]);
/**
 * Drivers table schema
 * Stores driver information and their current status
 */
exports.drivers = (0, pg_core_1.pgTable)('drivers', {
    id: (0, pg_core_1.uuid)('id').defaultRandom().primaryKey(),
    auth0Id: (0, pg_core_1.varchar)('auth0_id', { length: 255 }).notNull().unique(),
    email: (0, pg_core_1.varchar)('email', { length: 255 }).notNull().unique(),
    name: (0, pg_core_1.varchar)('name', { length: 255 }).notNull(),
    phone: (0, pg_core_1.varchar)('phone', { length: 50 }),
    status: (0, pg_core_1.varchar)('status', { length: 50 }).default('offline').notNull(),
    vehicleType: (0, exports.vehicleTypeEnum)('vehicle_type'),
    vehicleId: (0, pg_core_1.uuid)('vehicle_id').references(() => vehicles_1.vehicles.id),
    // Cab/Vehicle information
    cabName: (0, pg_core_1.varchar)('cab_name', { length: 255 }),
    cabNumber: (0, pg_core_1.varchar)('cab_number', { length: 100 }),
    cabLicence: (0, pg_core_1.varchar)('cab_licence', { length: 100 }),
    vehicleMake: (0, pg_core_1.varchar)('vehicle_make', { length: 100 }),
    vehicleModel: (0, pg_core_1.varchar)('vehicle_model', { length: 100 }),
    vehicleYear: (0, pg_core_1.varchar)('vehicle_year', { length: 4 }),
    vehicleColor: (0, pg_core_1.varchar)('vehicle_color', { length: 50 }),
    qrCode: (0, pg_core_1.varchar)('qr_code', { length: 255 }).unique(),
    vehicleQrCode: (0, pg_core_1.varchar)('vehicle_qr_code', { length: 255 }).unique(),
    lastSeen: (0, pg_core_1.timestamp)('last_seen'),
    // Single-session enforcement for mobile apps
    activeSessionId: (0, pg_core_1.varchar)('active_session_id', { length: 255 }), // Current active session ID
    activeDeviceId: (0, pg_core_1.varchar)('active_device_id', { length: 255 }), // Device UUID
    activeDeviceInfo: (0, pg_core_1.varchar)('active_device_info', { length: 500 }), // Device name/model (e.g., "iPhone 15 Pro")
    lastLoginAt: (0, pg_core_1.timestamp)('last_login_at'), // Last successful login timestamp (for Auth0 token iat comparison)
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at').defaultNow().notNull(),
}, (table) => ({
    statusIdx: (0, pg_core_1.index)('idx_drivers_status').on(table.status),
    auth0IdIdx: (0, pg_core_1.index)('idx_drivers_auth0_id').on(table.auth0Id),
    vehicleTypeIdx: (0, pg_core_1.index)('idx_drivers_vehicle_type').on(table.vehicleType),
    activeSessionIdx: (0, pg_core_1.index)('idx_drivers_active_session').on(table.activeSessionId),
    qrCodeIdx: (0, pg_core_1.index)('idx_drivers_qr_code').on(table.qrCode),
    vehicleQrCodeIdx: (0, pg_core_1.index)('idx_drivers_vehicle_qr_code').on(table.vehicleQrCode),
}));
//# sourceMappingURL=drivers.js.map