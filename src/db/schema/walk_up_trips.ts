import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  decimal,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { drivers } from './drivers';
import { vehicles } from './vehicles';
import { dutySessions } from './duty_sessions';

export const walkUpTrips = pgTable(
  'walk_up_trips',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'restrict' }),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'restrict' }),
    dutySessionId: uuid('duty_session_id').references(() => dutySessions.id, {
      onDelete: 'set null',
    }),
    status: varchar('status', { length: 32 }).default('created').notNull(),
    marketCode: varchar('market_code', { length: 8 }),
    currency: varchar('currency', { length: 3 }).notNull(),
    pickupLatitude: decimal('pickup_latitude', { precision: 10, scale: 8 }).notNull(),
    pickupLongitude: decimal('pickup_longitude', { precision: 11, scale: 8 }).notNull(),
    passengerLabel: varchar('passenger_label', { length: 80 }),
    idempotencyKey: varchar('idempotency_key', { length: 80 }),
    paymentStatus: varchar('payment_status', { length: 32 }).default('none').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    driverStatusIdx: index('idx_walk_up_trips_driver_status').on(table.driverId, table.status),
    idempotencyUnique: uniqueIndex('uq_walk_up_trips_idempotency_key').on(table.idempotencyKey),
    oneOpenDriver: uniqueIndex('uq_walk_up_trips_one_open_driver')
      .on(table.driverId)
      .where(sql`status in ('created', 'in_progress', 'ended')`),
    statusCheck: check(
      'walk_up_trips_status_check',
      sql`${table.status} in ('created', 'in_progress', 'ended', 'finalized', 'cancelled')`
    ),
    paymentStatusCheck: check(
      'walk_up_trips_payment_status_check',
      sql`${table.paymentStatus} in ('none', 'not_billable', 'pending', 'checkout_open', 'paid', 'failed', 'cancelled', 'refunded')`
    ),
  })
);

export type WalkUpTrip = typeof walkUpTrips.$inferSelect;
export type NewWalkUpTrip = typeof walkUpTrips.$inferInsert;
