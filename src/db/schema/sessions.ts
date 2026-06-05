import { pgTable, uuid, varchar, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * Sessions table schema
 * Stores user session tokens for authentication
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(),
    userType: varchar('user_type', { length: 50 }).notNull(),
    token: varchar('token', { length: 500 }).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    tokenIdx: index('idx_sessions_token').on(table.token),
    userIdIdx: index('idx_sessions_user_id').on(table.userId),
    expiresAtIdx: index('idx_sessions_expires_at').on(table.expiresAt),
  })
);

// Export type for TypeScript inference
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
