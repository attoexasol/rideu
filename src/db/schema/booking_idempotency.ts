import { pgTable, uuid, varchar, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { customers } from './customers';
import { bookings } from './bookings';

export const bookingIdempotencyKeys = pgTable(
  'booking_idempotency_keys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
  },
  (table) => ({
    customerKeyIdx: uniqueIndex('idx_booking_idempotency_customer_key').on(
      table.customerId,
      table.idempotencyKey
    ),
    expiresIdx: index('idx_booking_idempotency_expires').on(table.expiresAt),
  })
);

export type BookingIdempotencyKey = typeof bookingIdempotencyKeys.$inferSelect;
