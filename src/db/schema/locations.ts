import { pgTable, uuid, decimal, timestamp, index } from 'drizzle-orm/pg-core';
import { drivers } from './drivers';

/**
 * Locations table schema
 * Stores GPS location data from drivers with high precision
 */
export const locations = pgTable(
  'locations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    latitude: decimal('latitude', { precision: 10, scale: 8 }).notNull(),
    longitude: decimal('longitude', { precision: 11, scale: 8 }).notNull(),
    accuracy: decimal('accuracy', { precision: 10, scale: 2 }),
    speed: decimal('speed', { precision: 10, scale: 2 }),
    heading: decimal('heading', { precision: 5, scale: 2 }),
    timestamp: timestamp('timestamp').notNull().defaultNow(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    driverIdIdx: index('idx_locations_driver_id').on(table.driverId),
    timestampIdx: index('idx_locations_timestamp').on(table.timestamp.desc()),
    driverTimestampIdx: index('idx_locations_driver_timestamp').on(
      table.driverId,
      table.timestamp.desc()
    ),
  })
);

// Export type for TypeScript inference
export type Location = typeof locations.$inferSelect;
export type NewLocation = typeof locations.$inferInsert;
