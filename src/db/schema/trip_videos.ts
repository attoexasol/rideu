import {
  pgTable,
  uuid,
  text,
  bigint,
  integer,
  timestamp,
  varchar,
  index,
} from 'drizzle-orm/pg-core';
import { trips } from './trips';
import { drivers } from './drivers';

export const tripVideos = pgTable(
  'trip_videos',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    fileName: text('file_name'),
    originalName: text('original_name'),
    videoUrl: text('video_url'),
    mimeType: text('mime_type'),
    fileSize: bigint('file_size', { mode: 'number' }),
    durationSeconds: integer('duration_seconds'),
    startedAt: timestamp('started_at'),
    endedAt: timestamp('ended_at'),
    uploadStatus: varchar('upload_status', { length: 20 }).default('uploaded').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    tripIdIdx: index('idx_trip_videos_trip_id').on(table.tripId),
    driverIdIdx: index('idx_trip_videos_driver_id').on(table.driverId),
    createdAtIdx: index('idx_trip_videos_created_at').on(table.createdAt.desc()),
  })
);

export type TripVideo = typeof tripVideos.$inferSelect;
export type NewTripVideo = typeof tripVideos.$inferInsert;
