import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { videoSessions } from './video_sessions';
import { bookings } from './bookings';
import { drivers } from './drivers';

export const videoSegments = pgTable(
  'video_segments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => videoSessions.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'restrict' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'restrict' }),
    sequenceNumber: integer('segment_index').notNull(),
    clientSegmentId: text('client_segment_id').notNull(),
    storageKey: text('storage_key'),
    uploadStatus: text('upload_status').default('pending').notNull(),
    durationMs: integer('duration_ms'),
    fileSizeBytes: bigint('file_size', { mode: 'number' }),
    mimeType: text('mime_type').notNull(),
    checksum: text('checksum'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
    retentionDeletedAt: timestamp('retention_deleted_at', { withTimezone: true }),
    retryCount: integer('retry_count').default(0).notNull(),
    failureReason: text('failure_reason'),
    // Kept nullable for compatibility with legacy trip video readers. New recordings are private.
    videoUrl: text('video_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sessionIdx: index('idx_video_segments_session').on(table.sessionId, table.sequenceNumber),
    bookingIdx: index('idx_video_segments_booking').on(table.bookingId),
    statusIdx: index('idx_video_segments_upload_status').on(table.uploadStatus),
    retentionDeletedIdx: index('idx_video_segments_retention_deleted').on(table.retentionDeletedAt),
    sequenceUnique: uniqueIndex('uq_video_segments_session_sequence').on(
      table.sessionId,
      table.sequenceNumber
    ),
    clientIdUnique: uniqueIndex('uq_video_segments_session_client_id').on(
      table.sessionId,
      table.clientSegmentId
    ),
    statusCheck: check(
      'video_segments_upload_status_check',
      sql`${table.uploadStatus} in ('pending', 'uploading', 'uploaded', 'verified', 'failed')`
    ),
    sequenceCheck: check('video_segments_sequence_check', sql`${table.sequenceNumber} >= 0`),
    durationCheck: check(
      'video_segments_duration_check',
      sql`${table.durationMs} is null or ${table.durationMs} >= 0`
    ),
    sizeCheck: check(
      'video_segments_size_check',
      sql`${table.fileSizeBytes} is null or ${table.fileSizeBytes} >= 0`
    ),
    retryCheck: check('video_segments_retry_check', sql`${table.retryCount} >= 0`),
  })
);

export type VideoSegment = typeof videoSegments.$inferSelect;
export type NewVideoSegment = typeof videoSegments.$inferInsert;
