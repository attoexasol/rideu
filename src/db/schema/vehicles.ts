import { pgTable, uuid, varchar, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { fleets } from './fleets';

/**
 * Vehicles table schema
 * Stores information about vehicles in the fleet
 */
export const vehicles = pgTable(
  'vehicles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    make: varchar('make', { length: 100 }),
    model: varchar('model', { length: 100 }),
    year: integer('year'),
    color: varchar('color', { length: 50 }),
    plateNumber: varchar('plate_number', { length: 50 }).unique(),
    vin: varchar('vin', { length: 17 }).unique(),
    bodyNumber: varchar('body_number', { length: 255 }),
    status: varchar('status', { length: 50 }).default('active').notNull(),
    fleetId: uuid('fleet_id').references(() => fleets.id, { onDelete: 'restrict' }),
    qrCode: varchar('qr_code', { length: 255 }).unique(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    plateNumberIdx: index('idx_vehicles_plate_number').on(table.plateNumber),
    fleetIdx: index('idx_vehicles_fleet_id').on(table.fleetId),
    qrCodeIdx: index('idx_vehicles_qr_code').on(table.qrCode),
  })
);

// Export type for TypeScript inference
export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;
