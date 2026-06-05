import { pgTable, uuid, varchar, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * Admin Users table schema
 * Stores administrative user accounts with role-based access
 */
export const adminUsers = pgTable(
  'admin_users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    auth0Id: varchar('auth0_id', { length: 255 }).notNull().unique(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    name: varchar('name', { length: 255 }).notNull(),
    role: varchar('role', { length: 50 }).default('admin').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    auth0IdIdx: index('idx_admin_users_auth0_id').on(table.auth0Id),
  })
);

// Export type for TypeScript inference
export type AdminUser = typeof adminUsers.$inferSelect;
export type NewAdminUser = typeof adminUsers.$inferInsert;
