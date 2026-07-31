import { pgTable, uuid, varchar, decimal, timestamp, boolean, index } from 'drizzle-orm/pg-core';
import { drivers } from './drivers';
import { locations } from './locations';
import { customers } from './customers';

/**
 * Trips table schema
 * Stores driver trip information including start/end times and distance
 */
export const trips = pgTable(
  'trips',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id'),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    startTime: timestamp('start_time').notNull(),
    endTime: timestamp('end_time'),
    distance: decimal('distance', { precision: 10, scale: 2 }),
    status: varchar('status', { length: 50 }).default('in_progress').notNull(),
    startLocationId: uuid('start_location_id').references(() => locations.id),
    endLocationId: uuid('end_location_id').references(() => locations.id),
    passengerQrCode: varchar('passenger_qr_code', { length: 255 }).unique(),
    qrVerified: boolean('qr_verified').default(false).notNull(),
    qrVerifiedAt: timestamp('qr_verified_at'),
    tripType: varchar('trip_type', { length: 50 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    driverIdIdx: index('idx_trips_driver_id').on(table.driverId),
    bookingIdIdx: index('idx_trips_booking_id').on(table.bookingId),
    customerIdIdx: index('idx_trips_customer_id').on(table.customerId),
    statusIdx: index('idx_trips_status').on(table.status),
    startTimeIdx: index('idx_trips_start_time').on(table.startTime.desc()),
    passengerQrCodeIdx: index('idx_trips_passenger_qr_code').on(table.passengerQrCode),
  })
);

// Export type for TypeScript inference
export type Trip = typeof trips.$inferSelect;
export type NewTrip = typeof trips.$inferInsert;
