import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { drivers } from './drivers';

/**
 * FCM registration tokens for Driver Android devices.
 * device_id is the app device UUID (drivers.active_device_id), never the FCM token.
 */
export const driverPushTokens = pgTable(
  'driver_push_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    deviceId: varchar('device_id', { length: 255 }).notNull(),
    sessionId: varchar('session_id', { length: 255 }),
    fcmToken: text('fcm_token').notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    lastRegisteredAt: timestamp('last_registered_at').defaultNow().notNull(),
  },
  (table) => ({
    driverDeviceUnique: uniqueIndex('idx_driver_push_tokens_driver_device').on(
      table.driverId,
      table.deviceId
    ),
    fcmTokenUnique: uniqueIndex('idx_driver_push_tokens_fcm_token').on(table.fcmToken),
    driverIdx: index('idx_driver_push_tokens_driver_id').on(table.driverId),
    deviceIdx: index('idx_driver_push_tokens_device_id').on(table.deviceId),
  })
);

export type DriverPushToken = typeof driverPushTokens.$inferSelect;
export type NewDriverPushToken = typeof driverPushTokens.$inferInsert;
