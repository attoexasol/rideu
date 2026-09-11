import {
  pgTable,
  uuid,
  decimal,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { rideMarkets } from './ride_markets';
import { serviceCategories } from './service_categories';

/**
 * Per-market category rates. BD and US prices are separate rows.
 * Global service_categories rates are legacy catalog defaults, not USD.
 */
export const serviceCategoryMarketFares = pgTable(
  'service_category_market_fares',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => rideMarkets.id, { onDelete: 'cascade' }),
    serviceCategoryId: uuid('service_category_id')
      .notNull()
      .references(() => serviceCategories.id, { onDelete: 'cascade' }),
    baseFare: decimal('base_fare', { precision: 10, scale: 2 }).notNull(),
    perKmRate: decimal('per_km_rate', { precision: 10, scale: 2 }).notNull(),
    minFare: decimal('min_fare', { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    marketCategoryUnique: uniqueIndex('uq_market_fares_market_category').on(
      table.marketId,
      table.serviceCategoryId
    ),
    marketIdx: index('idx_market_fares_market_id').on(table.marketId),
  })
);

export type ServiceCategoryMarketFare = typeof serviceCategoryMarketFares.$inferSelect;
export type NewServiceCategoryMarketFare = typeof serviceCategoryMarketFares.$inferInsert;
