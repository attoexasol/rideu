import {
  pgTable,
  uuid,
  varchar,
  decimal,
  boolean,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { serviceCategories } from './service_categories';

export const promotions = pgTable(
  'promotions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: varchar('code', { length: 50 }),
    title: varchar('title', { length: 100 }).notNull(),
    discountType: varchar('discount_type', { length: 20 }).notNull(),
    discountValue: decimal('discount_value', { precision: 10, scale: 2 }).notNull(),
    serviceCategoryId: uuid('service_category_id').references(() => serviceCategories.id, {
      onDelete: 'set null',
    }),
    validFrom: timestamp('valid_from').notNull(),
    validUntil: timestamp('valid_until').notNull(),
    maxUsesPerCustomer: integer('max_uses_per_customer'),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    activeIdx: index('idx_promotions_active').on(table.isActive),
    categoryIdx: index('idx_promotions_category').on(table.serviceCategoryId),
  })
);

export type Promotion = typeof promotions.$inferSelect;
export type NewPromotion = typeof promotions.$inferInsert;
