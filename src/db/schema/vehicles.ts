import { pgTable, uuid, varchar, integer, timestamp, index } from 'drizzle-orm/pg-core';

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
    plateNumber: varchar('plate_number', { length: 50 }).unique(),
    vin: varchar('vin', { length: 17 }).unique(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    plateNumberIdx: index('idx_vehicles_plate_number').on(table.plateNumber),
  })
);

// Export type for TypeScript inference
export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;
