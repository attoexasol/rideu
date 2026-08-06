import { pgTable, uuid, varchar, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { videoSessions } from './video_sessions';
import { bookings } from './bookings';
import { adminUsers } from './admin_users';

/** Append-only audit trail for admin ride-video access and playback actions. */
export const rideVideoAuditEvents = pgTable(
  'ride_video_audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id').references(() => videoSessions.id, { onDelete: 'set null' }),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    adminUserId: uuid('admin_user_id').references(() => adminUsers.id, { onDelete: 'set null' }),
    adminAuth0Id: varchar('admin_auth0_id', { length: 255 }),
    adminEmail: varchar('admin_email', { length: 255 }),
    action: varchar('action', { length: 100 }).notNull(),
    result: varchar('result', { length: 50 }).notNull().default('success'),
    reason: text('reason'),
    segmentId: uuid('segment_id'),
    ipAddress: varchar('ip_address', { length: 100 }),
    userAgent: varchar('user_agent', { length: 500 }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sessionIdx: index('idx_ride_video_audit_session').on(table.sessionId, table.createdAt),
    bookingIdx: index('idx_ride_video_audit_booking').on(table.bookingId, table.createdAt),
    actionIdx: index('idx_ride_video_audit_action').on(table.action),
    createdAtIdx: index('idx_ride_video_audit_created_at').on(table.createdAt),
  })
);

export type RideVideoAuditEvent = typeof rideVideoAuditEvents.$inferSelect;
export type NewRideVideoAuditEvent = typeof rideVideoAuditEvents.$inferInsert;
