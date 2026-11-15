import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  integer,
  bigint,
  boolean,
  jsonb,
  decimal,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import type { MeterRules } from '../../constants/softMeter';
import { bookings } from './bookings';
import { customers } from './customers';
import { drivers } from './drivers';
import { vehicles } from './vehicles';
import { meterRateSchedules } from './meter_rate_schedules';
import { walkUpTrips } from './walk_up_trips';

export interface StoredRateSnapshot {
  scheduleId: string;
  code: string;
  version: number;
  status: string;
  currency: string;
  flagDropCents: number;
  distanceRateCentsPerMile: number;
  distanceIncrementMicroMiles: number;
  distanceIncrementCents: number;
  waitingCentsPerHour: number;
  waitingCentsPerMinute: number;
  chargingEnabled: boolean;
  rules: MeterRules;
  capturedAt: string;
}

export const meterSessions = pgTable(
  'meter_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tripKind: varchar('trip_kind', { length: 20 }).notNull(),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'restrict' }),
    walkUpTripId: uuid('walk_up_trip_id').references(() => walkUpTrips.id, {
      onDelete: 'restrict',
    }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'restrict' }),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'restrict' }),
    rateScheduleId: uuid('rate_schedule_id')
      .notNull()
      .references(() => meterRateSchedules.id, { onDelete: 'restrict' }),
    rateSnapshot: jsonb('rate_snapshot').$type<StoredRateSnapshot>().notNull(),
    status: varchar('status', { length: 20 }).default('pending').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    stoppedAt: timestamp('stopped_at', { withTimezone: true }),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    startIdempotencyKey: varchar('start_idempotency_key', { length: 80 }),
    stopIdempotencyKey: varchar('stop_idempotency_key', { length: 80 }),
    acceptedDistanceMillimeters: bigint('accepted_distance_millimeters', { mode: 'number' })
      .default(0)
      .notNull(),
    waitingSeconds: integer('waiting_seconds').default(0).notNull(),
    excludedStopSeconds: integer('excluded_stop_seconds').default(0).notNull(),
    stopStreak: integer('stop_streak').default(0).notNull(),
    stopRemainderMs: integer('stop_remainder_ms').default(0).notNull(),
    rejectedPointCount: integer('rejected_point_count').default(0).notNull(),
    gapCount: integer('gap_count').default(0).notNull(),
    reviewRequired: boolean('review_required').default(false).notNull(),
    reviewReasons: jsonb('review_reasons').$type<string[]>().default([]).notNull(),
    lastAcceptedRecordedAt: timestamp('last_accepted_recorded_at', { withTimezone: true }),
    lastAcceptedLatitude: decimal('last_accepted_latitude', { precision: 10, scale: 8 }),
    lastAcceptedLongitude: decimal('last_accepted_longitude', { precision: 11, scale: 8 }),
    lastSequence: integer('last_sequence').default(0).notNull(),
    provisionalTotalCents: integer('provisional_total_cents').default(0).notNull(),
    billable: boolean('billable').default(false).notNull(),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    totalPausedSeconds: integer('total_paused_seconds').default(0).notNull(),
    pauseReason: varchar('pause_reason', { length: 40 }),
    needsNewAnchor: boolean('needs_new_anchor').default(false).notNull(),
    stateVersion: integer('state_version').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    driverStatusIdx: index('idx_meter_sessions_driver_status').on(table.driverId, table.status),
    bookingUnique: uniqueIndex('uq_meter_sessions_booking')
      .on(table.bookingId)
      .where(sql`booking_id is not null`),
    walkUpUnique: uniqueIndex('uq_meter_sessions_walk_up')
      .on(table.walkUpTripId)
      .where(sql`walk_up_trip_id is not null`),
    oneOpenDriver: uniqueIndex('uq_meter_sessions_one_open_driver')
      .on(table.driverId)
      .where(sql`status in ('pending', 'running', 'paused', 'stopped')`),
    kindCheck: check(
      'meter_sessions_kind_check',
      sql`(
        (${table.tripKind} = 'on_demand' and ${table.bookingId} is not null and ${table.walkUpTripId} is null)
        or
        (${table.tripKind} = 'walk_up' and ${table.walkUpTripId} is not null and ${table.bookingId} is null)
      )`
    ),
    statusCheck: check(
      'meter_sessions_status_check',
      sql`${table.status} in ('pending', 'running', 'paused', 'stopped', 'finalized', 'voided')`
    ),
    billableCheck: check('meter_sessions_billable_check', sql`${table.billable} = false`),
    distanceCheck: check(
      'meter_sessions_distance_check',
      sql`${table.acceptedDistanceMillimeters} >= 0 and ${table.waitingSeconds} >= 0`
    ),
    pauseCheck: check(
      'meter_sessions_pause_check',
      sql`${table.totalPausedSeconds} >= 0 and ${table.stateVersion} >= 0 and (${table.pauseReason} is null or ${table.pauseReason} = 'driver_personal_stop')`
    ),
    stopCheck: check(
      'meter_sessions_stop_check',
      sql`${table.excludedStopSeconds} >= 0 and ${table.stopStreak} >= 0 and ${table.stopRemainderMs} >= 0 and ${table.stopRemainderMs} < 1000`
    ),
  })
);

export const meterGpsSamples = pgTable(
  'meter_gps_samples',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => meterSessions.id, { onDelete: 'restrict' }),
    clientPointId: varchar('client_point_id', { length: 120 }).notNull(),
    sequence: integer('sequence').notNull(),
    disposition: varchar('disposition', { length: 20 }).notNull(),
    rejectReason: varchar('reject_reason', { length: 64 }),
    recordedAt: timestamp('recorded_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    latitude: decimal('latitude', { precision: 10, scale: 8 }).notNull(),
    longitude: decimal('longitude', { precision: 11, scale: 8 }).notNull(),
    accuracyMeters: decimal('accuracy_meters', { precision: 10, scale: 2 }),
    speedMps: decimal('speed_mps', { precision: 10, scale: 2 }),
    distanceDeltaMillimeters: integer('distance_delta_millimeters').default(0).notNull(),
    gapBefore: boolean('gap_before').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pointUnique: uniqueIndex('uq_meter_gps_samples_point').on(table.sessionId, table.clientPointId),
    sessionSeqIdx: index('idx_meter_gps_samples_session_seq').on(table.sessionId, table.sequence),
    dispositionCheck: check(
      'meter_gps_samples_disposition_check',
      sql`${table.disposition} in ('accepted', 'rejected')`
    ),
  })
);

export const meterCalculationEvents = pgTable(
  'meter_calculation_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => meterSessions.id, { onDelete: 'restrict' }),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sessionIdx: index('idx_meter_calculation_events_session').on(table.sessionId, table.createdAt),
  })
);

export const meterFareRecords = pgTable(
  'meter_fare_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => meterSessions.id, { onDelete: 'restrict' }),
    rateScheduleId: uuid('rate_schedule_id')
      .notNull()
      .references(() => meterRateSchedules.id, { onDelete: 'restrict' }),
    rateSnapshot: jsonb('rate_snapshot').$type<StoredRateSnapshot>().notNull(),
    flagDropCents: integer('flag_drop_cents').notNull(),
    distanceChargeCents: integer('distance_charge_cents').notNull(),
    waitingChargeCents: integer('waiting_charge_cents').notNull(),
    totalCents: integer('total_cents').notNull(),
    acceptedDistanceMillimeters: bigint('accepted_distance_millimeters', { mode: 'number' }).notNull(),
    completedIncrements: integer('completed_increments').notNull(),
    remainderMicroMiles: integer('remainder_micro_miles').notNull(),
    waitingSeconds: integer('waiting_seconds').notNull(),
    billable: boolean('billable').default(false).notNull(),
    chargingEnabled: boolean('charging_enabled').default(false).notNull(),
    blockedReasons: jsonb('blocked_reasons').$type<string[]>().notNull(),
    calculation: jsonb('calculation').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sessionUnique: uniqueIndex('uq_meter_fare_records_session').on(table.sessionId),
    billableCheck: check('meter_fare_records_billable_check', sql`${table.billable} = false`),
    chargingCheck: check(
      'meter_fare_records_charging_check',
      sql`${table.chargingEnabled} = false`
    ),
    moneyCheck: check(
      'meter_fare_records_money_check',
      sql`${table.flagDropCents} >= 0 and ${table.distanceChargeCents} >= 0 and ${table.waitingChargeCents} >= 0 and ${table.totalCents} >= 0`
    ),
  })
);

export const meterPauses = pgTable(
  'meter_pauses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => meterSessions.id, { onDelete: 'restrict' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'restrict' }),
    reason: varchar('reason', { length: 40 }).default('driver_personal_stop').notNull(),
    pausedAt: timestamp('paused_at', { withTimezone: true }).notNull(),
    resumedAt: timestamp('resumed_at', { withTimezone: true }),
    durationSeconds: integer('duration_seconds'),
    provisionalTotalCents: integer('provisional_total_cents').notNull(),
    acceptedDistanceMillimeters: bigint('accepted_distance_millimeters', { mode: 'number' }).notNull(),
    waitingSeconds: integer('waiting_seconds').notNull(),
    stateVersionAtPause: integer('state_version_at_pause').notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 80 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sessionIdx: index('idx_meter_pauses_session').on(table.sessionId, table.pausedAt),
    oneOpen: uniqueIndex('uq_meter_pauses_one_open')
      .on(table.sessionId)
      .where(sql`resumed_at is null`),
    reasonCheck: check(
      'meter_pauses_reason_check',
      sql`${table.reason} = 'driver_personal_stop'`
    ),
    intervalCheck: check(
      'meter_pauses_interval_check',
      sql`${table.resumedAt} is null or ${table.resumedAt} >= ${table.pausedAt}`
    ),
    durationCheck: check(
      'meter_pauses_duration_check',
      sql`${table.durationSeconds} is null or ${table.durationSeconds} >= 0`
    ),
  })
);

export type MeterSession = typeof meterSessions.$inferSelect;
export type NewMeterSession = typeof meterSessions.$inferInsert;
export type MeterGpsSample = typeof meterGpsSamples.$inferSelect;
export type MeterFareRecord = typeof meterFareRecords.$inferSelect;
export type MeterCalculationEvent = typeof meterCalculationEvents.$inferSelect;
export type MeterPause = typeof meterPauses.$inferSelect;
