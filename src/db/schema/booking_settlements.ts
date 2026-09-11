import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  bigint,
  decimal,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { bookings } from './bookings';
import { bookingPayments } from './booking_payments';

/**
 * Future settlement row for capture + platform/driver allocation.
 * Split amounts and percentage snapshots are written when a captured payment is settled.
 */
export const bookingSettlements = pgTable(
  'booking_settlements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'restrict' }),
    paymentId: uuid('payment_id').references(() => bookingPayments.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 50 }).notNull(),
    grossAmount: bigint('gross_amount', { mode: 'number' }).notNull(),
    driverAmount: bigint('driver_amount', { mode: 'number' }),
    platformAmount: bigint('platform_amount', { mode: 'number' }),
    airportFee: bigint('airport_fee', { mode: 'number' }),
    currency: varchar('currency', { length: 10 }).notNull(),
    providerTransferId: varchar('provider_transfer_id', { length: 255 }),
    calculationVersion: varchar('calculation_version', { length: 50 }),
    airportFeePercentage: decimal('airport_fee_percentage', { precision: 6, scale: 2 }),
    driverPercentage: decimal('driver_percentage', { precision: 6, scale: 2 }),
    companyPercentage: decimal('company_percentage', { precision: 6, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    bookingUnique: uniqueIndex('uq_booking_settlements_booking_id').on(table.bookingId),
    paymentIdx: index('idx_booking_settlements_payment_id').on(table.paymentId),
    statusIdx: index('idx_booking_settlements_status').on(table.status),
    statusCheck: check(
      'booking_settlements_status_check',
      sql`${table.status} in ('unresolved', 'pending', 'processing', 'settled', 'failed', 'skipped_cash')`
    ),
    grossAmountCheck: check(
      'booking_settlements_gross_amount_check',
      sql`${table.grossAmount} >= 0`
    ),
  })
);

export type BookingSettlement = typeof bookingSettlements.$inferSelect;
export type NewBookingSettlement = typeof bookingSettlements.$inferInsert;
