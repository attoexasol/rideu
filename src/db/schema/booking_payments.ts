import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  bigint,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { bookings } from './bookings';

/**
 * One current payment record per booking (cash or future Stripe).
 * Amounts are integer minor units (e.g. BDT poisha). Provider ids are null for cash.
 */
export const bookingPayments = pgTable(
  'booking_payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'restrict' }),
    paymentMethod: varchar('payment_method', { length: 20 }).notNull(),
    currency: varchar('currency', { length: 10 }).notNull(),
    grossAmount: bigint('gross_amount', { mode: 'number' }).notNull(),
    provider: varchar('provider', { length: 30 }).notNull(),
    providerPaymentIntentId: varchar('provider_payment_intent_id', { length: 255 }),
    providerChargeId: varchar('provider_charge_id', { length: 255 }),
    status: varchar('status', { length: 50 }).notNull(),
    authorizedAt: timestamp('authorized_at', { withTimezone: true }),
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    failureCode: varchar('failure_code', { length: 100 }),
    failureMessage: varchar('failure_message', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    bookingUnique: uniqueIndex('uq_booking_payments_booking_id').on(table.bookingId),
    providerIntentUnique: uniqueIndex('uq_booking_payments_provider_payment_intent_id').on(
      table.providerPaymentIntentId
    ),
    statusIdx: index('idx_booking_payments_status').on(table.status),
    methodIdx: index('idx_booking_payments_payment_method').on(table.paymentMethod),
    paymentMethodCheck: check(
      'booking_payments_payment_method_check',
      sql`${table.paymentMethod} in ('cash', 'card')`
    ),
    providerCheck: check(
      'booking_payments_provider_check',
      sql`${table.provider} in ('none', 'cash', 'stripe')`
    ),
    statusCheck: check(
      'booking_payments_status_check',
      sql`${table.status} in ('pending', 'requires_payment_method', 'requires_action', 'authorized', 'capture_pending', 'captured', 'failed', 'cancelled', 'refund_pending', 'refunded')`
    ),
    grossAmountCheck: check(
      'booking_payments_gross_amount_check',
      sql`${table.grossAmount} >= 0`
    ),
  })
);

export type BookingPayment = typeof bookingPayments.$inferSelect;
export type NewBookingPayment = typeof bookingPayments.$inferInsert;
