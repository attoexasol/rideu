import { sql } from 'drizzle-orm';
import {
  pgTable,
  smallint,
  boolean,
  integer,
  uuid,
  varchar,
  timestamp,
  check,
} from 'drizzle-orm/pg-core';
import { adminUsers } from './admin_users';

export const PLATFORM_SETTINGS_ROW_ID = 1;

/**
 * Global platform flags. Exactly one row (id = 1).
 * video_recording_enabled is OFF unless an Admin explicitly enables it.
 */
export const platformSettings = pgTable(
  'platform_settings',
  {
    id: smallint('id').primaryKey().default(PLATFORM_SETTINGS_ROW_ID),
    videoRecordingEnabled: boolean('video_recording_enabled').default(false).notNull(),
    version: integer('version').default(1).notNull(),
    updatedByAdminUserId: uuid('updated_by_admin_user_id').references(() => adminUsers.id, {
      onDelete: 'set null',
    }),
    updatedByAuth0Id: varchar('updated_by_auth0_id', { length: 255 }),
    updatedByEmail: varchar('updated_by_email', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    singleton: check('platform_settings_singleton_check', sql`${table.id} = 1`),
  })
);

export type PlatformSettings = typeof platformSettings.$inferSelect;
