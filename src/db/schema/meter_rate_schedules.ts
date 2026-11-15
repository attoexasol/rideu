import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import type { MeterRules } from '../../constants/softMeter';

export const meterRateSchedules = pgTable(
  'meter_rate_schedules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: varchar('code', { length: 64 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    version: integer('version').notNull(),
    status: varchar('status', { length: 32 }).default('draft').notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    flagDropCents: integer('flag_drop_cents').notNull(),
    distanceRateCentsPerMile: integer('distance_rate_cents_per_mile').notNull(),
    distanceIncrementMicroMiles: integer('distance_increment_micro_miles').notNull(),
    distanceIncrementCents: integer('distance_increment_cents').notNull(),
    waitingCentsPerHour: integer('waiting_cents_per_hour').notNull(),
    waitingCentsPerMinute: integer('waiting_cents_per_minute').notNull(),
    chargingEnabled: boolean('charging_enabled').default(false).notNull(),
    rules: jsonb('rules').$type<MeterRules>().notNull(),
    createdBy: varchar('created_by', { length: 255 }),
    submittedBy: varchar('submitted_by', { length: 255 }),
    approvedBy: varchar('approved_by', { length: 255 }),
    activatedBy: varchar('activated_by', { length: 255 }),
    retiredBy: varchar('retired_by', { length: 255 }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    codeVersionUnique: uniqueIndex('uq_meter_rate_schedules_code_version').on(
      table.code,
      table.version
    ),
    oneActive: uniqueIndex('uq_meter_rate_schedules_one_active')
      .on(table.code)
      .where(sql`status = 'active'`),
    statusIdx: index('idx_meter_rate_schedules_status').on(table.status),
    statusCheck: check(
      'meter_rate_schedules_status_check',
      sql`${table.status} in ('draft', 'pending_approval', 'approved', 'active', 'retired')`
    ),
    chargingCheck: check(
      'meter_rate_schedules_charging_disabled_check',
      sql`${table.chargingEnabled} = false`
    ),
    versionCheck: check('meter_rate_schedules_version_check', sql`${table.version} > 0`),
    moneyCheck: check(
      'meter_rate_schedules_money_check',
      sql`${table.flagDropCents} >= 0 and ${table.distanceRateCentsPerMile} >= 0 and ${table.distanceIncrementCents} >= 0 and ${table.waitingCentsPerHour} >= 0 and ${table.waitingCentsPerMinute} >= 0 and ${table.distanceIncrementMicroMiles} > 0`
    ),
  })
);

export const meterRateScheduleEvents = pgTable(
  'meter_rate_schedule_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    scheduleId: uuid('schedule_id')
      .notNull()
      .references(() => meterRateSchedules.id, { onDelete: 'restrict' }),
    action: varchar('action', { length: 64 }).notNull(),
    actorId: varchar('actor_id', { length: 255 }),
    actorRole: varchar('actor_role', { length: 64 }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    scheduleIdx: index('idx_meter_rate_schedule_events_schedule').on(
      table.scheduleId,
      table.createdAt
    ),
  })
);

export type MeterRateSchedule = typeof meterRateSchedules.$inferSelect;
export type NewMeterRateSchedule = typeof meterRateSchedules.$inferInsert;
export type MeterRateScheduleEvent = typeof meterRateScheduleEvents.$inferSelect;
