import { pgTable, uuid, varchar, decimal, integer, index } from 'drizzle-orm/pg-core';
import { bookings } from './bookings';

export const bookingStops = pgTable(
  'booking_stops',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    stopOrder: integer('stop_order').notNull(),
    latitude: decimal('latitude', { precision: 10, scale: 8 }).notNull(),
    longitude: decimal('longitude', { precision: 11, scale: 8 }).notNull(),
    address: varchar('address', { length: 500 }).notNull(),
    placeId: varchar('place_id', { length: 255 }),
  },
  (table) => ({
    bookingIdx: index('idx_booking_stops_booking').on(table.bookingId),
  })
);

export type BookingStop = typeof bookingStops.$inferSelect;
export type NewBookingStop = typeof bookingStops.$inferInsert;
