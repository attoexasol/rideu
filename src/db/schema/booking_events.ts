import { pgTable, uuid, varchar, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { bookings } from './bookings';

export const bookingEvents = pgTable(
  'booking_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    actorType: varchar('actor_type', { length: 50 }).notNull(),
    actorId: uuid('actor_id'),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    bookingIdx: index('idx_booking_events_booking').on(table.bookingId, table.createdAt),
  })
);

export type BookingEvent = typeof bookingEvents.$inferSelect;
export type NewBookingEvent = typeof bookingEvents.$inferInsert;
