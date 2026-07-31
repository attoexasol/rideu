import { pgTable, uuid, varchar, timestamp, index, pgEnum } from 'drizzle-orm/pg-core';
import { vehicles } from './vehicles';

/**
 * Vehicle Type Enum
 * Defines the types of vehicles available in the fleet
 */
export const vehicleTypeEnum = pgEnum('vehicle_type', [
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
export const drivers = pgTable(
  'drivers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    auth0Id: varchar('auth0_id', { length: 255 }).notNull().unique(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    name: varchar('name', { length: 255 }).notNull(),
    phone: varchar('phone', { length: 50 }),
    status: varchar('status', { length: 50 }).default('offline').notNull(),
    vehicleType: vehicleTypeEnum('vehicle_type'),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id),
    // Cab/Vehicle information
    cabName: varchar('cab_name', { length: 255 }),
    cabNumber: varchar('cab_number', { length: 100 }),
    cabLicence: varchar('cab_licence', { length: 100 }),
    vehicleMake: varchar('vehicle_make', { length: 100 }),
    vehicleModel: varchar('vehicle_model', { length: 100 }),
    vehicleYear: varchar('vehicle_year', { length: 4 }),
    vehicleColor: varchar('vehicle_color', { length: 50 }),
    qrCode: varchar('qr_code', { length: 255 }).unique(),
    vehicleQrCode: varchar('vehicle_qr_code', { length: 255 }).unique(),
    lastSeen: timestamp('last_seen'),
    // Single-session enforcement for mobile apps
    activeSessionId: varchar('active_session_id', { length: 255 }), // Current active session ID
    activeDeviceId: varchar('active_device_id', { length: 255 }), // Device UUID
    activeDeviceInfo: varchar('active_device_info', { length: 500 }), // Device name/model (e.g., "iPhone 15 Pro")
    lastLoginAt: timestamp('last_login_at'), // Last successful login timestamp (for Auth0 token iat comparison)
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    statusIdx: index('idx_drivers_status').on(table.status),
    auth0IdIdx: index('idx_drivers_auth0_id').on(table.auth0Id),
    vehicleTypeIdx: index('idx_drivers_vehicle_type').on(table.vehicleType),
    activeSessionIdx: index('idx_drivers_active_session').on(table.activeSessionId),
    qrCodeIdx: index('idx_drivers_qr_code').on(table.qrCode),
    vehicleQrCodeIdx: index('idx_drivers_vehicle_qr_code').on(table.vehicleQrCode),
  })
);

// Export type for TypeScript inference
export type Driver = typeof drivers.$inferSelect;
export type NewDriver = typeof drivers.$inferInsert;
