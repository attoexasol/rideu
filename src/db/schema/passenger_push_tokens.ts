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
import { customers } from './customers';

/**
 * FCM registration tokens for Passenger devices.
 * device_id is the app device UUID (customers.active_device_id), never the FCM token.
 */
export const passengerPushTokens = pgTable(
  'passenger_push_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    deviceId: varchar('device_id', { length: 255 }).notNull(),
    sessionId: varchar('session_id', { length: 255 }),
    fcmToken: text('fcm_token').notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    lastRegisteredAt: timestamp('last_registered_at').defaultNow().notNull(),
  },
  (table) => ({
    customerDeviceUnique: uniqueIndex('idx_passenger_push_tokens_customer_device').on(
      table.customerId,
      table.deviceId
    ),
    fcmTokenUnique: uniqueIndex('idx_passenger_push_tokens_fcm_token').on(table.fcmToken),
    customerIdx: index('idx_passenger_push_tokens_customer_id').on(table.customerId),
    deviceIdx: index('idx_passenger_push_tokens_device_id').on(table.deviceId),
  })
);

export type PassengerPushToken = typeof passengerPushTokens.$inferSelect;
export type NewPassengerPushToken = typeof passengerPushTokens.$inferInsert;
