import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';

/**
 * Operating markets. Pickup country resolves to one market and one
 * transaction currency. No FX. Not airport-code specific.
 */
export const rideMarkets = pgTable(
  'ride_markets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: varchar('code', { length: 8 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    countryCode: varchar('country_code', { length: 2 }).notNull(),
    currency: varchar('currency', { length: 10 }).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    codeUnique: uniqueIndex('uq_ride_markets_code').on(table.code),
    countryUnique: uniqueIndex('uq_ride_markets_country_code').on(table.countryCode),
    currencyCheck: check(
      'ride_markets_currency_check',
      sql`${table.currency} in ('BDT', 'USD')`
    ),
  })
);

export type RideMarket = typeof rideMarkets.$inferSelect;
export type NewRideMarket = typeof rideMarkets.$inferInsert;
