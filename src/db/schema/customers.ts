import { pgTable, uuid, varchar, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * Passenger / customer accounts (RYD U app)
 */
export const customers = pgTable(
  'customers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    auth0Id: varchar('auth0_id', { length: 255 }).notNull().unique(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    name: varchar('name', { length: 255 }).notNull(),
    phoneCountryCode: varchar('phone_country_code', { length: 10 }),
    phoneNumber: varchar('phone_number', { length: 30 }),
    profileImageUrl: varchar('profile_image_url', { length: 500 }),
    status: varchar('status', { length: 50 }).default('active').notNull(),
    emailVerifiedAt: timestamp('email_verified_at'),
    phoneVerifiedAt: timestamp('phone_verified_at'),
    activeSessionId: varchar('active_session_id', { length: 255 }),
    activeDeviceId: varchar('active_device_id', { length: 255 }),
    activeDeviceInfo: varchar('active_device_info', { length: 500 }),
    lastLoginAt: timestamp('last_login_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    auth0IdIdx: index('idx_customers_auth0_id').on(table.auth0Id),
    emailIdx: index('idx_customers_email').on(table.email),
    phoneIdx: index('idx_customers_phone').on(table.phoneCountryCode, table.phoneNumber),
    statusIdx: index('idx_customers_status').on(table.status),
  })
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
