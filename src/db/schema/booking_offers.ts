import {
  pgTable,
  uuid,
  varchar,
  decimal,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { bookings } from './bookings';
import { drivers } from './drivers';

/** All offer instants are timestamptz; Drizzle mode defaults to Date (UTC-safe with withTimezone). */
export const bookingOffers = pgTable(
  'booking_offers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 50 }).default('pending').notNull(),
    distanceToPickupKm: decimal('distance_to_pickup_km', { precision: 10, scale: 2 }),
    offeredAt: timestamp('offered_at', { withTimezone: true }).defaultNow().notNull(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    bookingDriverUnique: uniqueIndex('idx_booking_offers_unique').on(
      table.bookingId,
      table.driverId
    ),
    bookingIdx: index('idx_booking_offers_booking').on(table.bookingId),
    driverIdx: index('idx_booking_offers_driver').on(table.driverId, table.status),
  })
);

export type BookingOffer = typeof bookingOffers.$inferSelect;
export type NewBookingOffer = typeof bookingOffers.$inferInsert;
