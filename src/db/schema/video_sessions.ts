import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { trips } from './trips';
import { bookings } from './bookings';
import { drivers } from './drivers';
import { customers } from './customers';

export const videoSessions = pgTable(
  'video_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tripId: uuid('trip_id').references(() => trips.id, { onDelete: 'set null' }),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'restrict' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'restrict' }),
    passengerId: uuid('passenger_id').references(() => customers.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 50 }).default('pending').notNull(),
    consentStatus: varchar('consent_status', { length: 30 }).default('required').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tripIdx: index('idx_video_sessions_trip').on(table.tripId),
    bookingIdx: index('idx_video_sessions_booking').on(table.bookingId),
    driverIdx: index('idx_video_sessions_driver').on(table.driverId),
    statusIdx: index('idx_video_sessions_status').on(table.status),
    oneRecoverableSession: uniqueIndex('uq_video_sessions_booking_driver_recoverable')
      .on(table.bookingId, table.driverId)
      .where(sql`${table.status} in ('pending', 'active', 'paused', 'finalizing')`),
    statusCheck: check(
      'video_sessions_status_check',
      sql`${table.status} in ('pending', 'active', 'paused', 'finalizing', 'completed', 'cancelled', 'failed')`
    ),
    consentCheck: check(
      'video_sessions_consent_status_check',
      sql`${table.consentStatus} in ('required', 'granted', 'denied', 'not_required')`
    ),
  })
);

export type VideoSession = typeof videoSessions.$inferSelect;
export type NewVideoSession = typeof videoSessions.$inferInsert;
