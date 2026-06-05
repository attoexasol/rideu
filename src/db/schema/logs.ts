import { pgTable, uuid, varchar, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * Logs table schema
 * Stores system and user activity logs with metadata
 */
export const logs = pgTable(
  'logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    userId: uuid('user_id'),
    userType: varchar('user_type', { length: 50 }),
    message: text('message'),
    metadata: jsonb('metadata'),
    timestamp: timestamp('timestamp').defaultNow().notNull(),
  },
  (table) => ({
    eventTypeIdx: index('idx_logs_event_type').on(table.eventType),
    timestampIdx: index('idx_logs_timestamp').on(table.timestamp.desc()),
  })
);

// Export type for TypeScript inference
export type Log = typeof logs.$inferSelect;
export type NewLog = typeof logs.$inferInsert;
