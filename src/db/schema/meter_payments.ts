import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { bookings } from './bookings';
import { meterFareRecords, meterSessions } from './meter_sessions';
import { walkUpTrips } from './walk_up_trips';

export const meterPayments = pgTable(
  'meter_payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    subjectType: varchar('subject_type', { length: 20 }).notNull(),
    walkUpTripId: uuid('walk_up_trip_id').references(() => walkUpTrips.id, {
      onDelete: 'restrict',
    }),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'restrict' }),
    meterSessionId: uuid('meter_session_id')
      .notNull()
      .references(() => meterSessions.id, { onDelete: 'restrict' }),
    fareRecordId: uuid('fare_record_id')
      .notNull()
      .references(() => meterFareRecords.id, { onDelete: 'restrict' }),
    currency: varchar('currency', { length: 3 }).notNull(),
    amountCents: integer('amount_cents').notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    provider: varchar('provider', { length: 20 }).default('stripe').notNull(),
    stripeCheckoutSessionId: varchar('stripe_checkout_session_id', { length: 255 }),
    stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),
    hostedUrl: varchar('hosted_url', { length: 2000 }),
    receiptUrl: varchar('receipt_url', { length: 2000 }),
    idempotencyKey: varchar('idempotency_key', { length: 120 }).notNull(),
    failureCode: varchar('failure_code', { length: 100 }),
    failureMessage: varchar('failure_message', { length: 500 }),
    settlementMode: varchar('settlement_mode', { length: 32 })
      .default('production_disabled')
      .notNull(),
    testOnly: boolean('test_only').default(false).notNull(),
    stripeLivemode: boolean('stripe_livemode').default(false).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    fareClassification: varchar('fare_classification', { length: 64 }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    idempotencyUnique: uniqueIndex('uq_meter_payments_idempotency').on(table.idempotencyKey),
    checkoutUnique: uniqueIndex('uq_meter_payments_checkout').on(table.stripeCheckoutSessionId),
    fareUnique: uniqueIndex('uq_meter_payments_fare').on(table.fareRecordId),
    sessionIdx: index('idx_meter_payments_session').on(table.meterSessionId),
    statusIdx: index('idx_meter_payments_status').on(table.status),
    subjectCheck: check(
      'meter_payments_subject_check',
      sql`(
        (${table.subjectType} = 'walk_up' and ${table.walkUpTripId} is not null)
        or
        (${table.subjectType} = 'on_demand' and ${table.bookingId} is not null)
      )`
    ),
    statusCheck: check(
      'meter_payments_status_check',
      sql`${table.status} in ('not_billable', 'pending', 'checkout_open', 'paid', 'failed', 'cancelled', 'refunded')`
    ),
    settlementCheck: check(
      'meter_payments_settlement_check',
      sql`(
        (${table.settlementMode} = 'production_disabled' and ${table.testOnly} = false and ${table.status} = 'not_billable')
        or
        (${table.settlementMode} = 'stripe_test' and ${table.testOnly} = true and ${table.status} in ('pending', 'checkout_open', 'paid', 'failed', 'cancelled', 'refunded'))
      )`
    ),
    livemodeCheck: check('meter_payments_livemode_check', sql`${table.stripeLivemode} = false`),
    fareClassCheck: check(
      'meter_payments_fare_class_check',
      sql`${table.fareClassification} is null or ${table.fareClassification} = 'test_only_unapproved_tariff'`
    ),
    paymentIntentUnique: uniqueIndex('uq_meter_payments_payment_intent')
      .on(table.stripePaymentIntentId)
      .where(sql`stripe_payment_intent_id is not null`),
    amountCheck: check('meter_payments_amount_check', sql`${table.amountCents} >= 0`),
    providerCheck: check('meter_payments_provider_check', sql`${table.provider} = 'stripe'`),
  })
);

export type MeterPayment = typeof meterPayments.$inferSelect;
export type NewMeterPayment = typeof meterPayments.$inferInsert;
