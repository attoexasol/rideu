import {
  pgTable,
  uuid,
  varchar,
  integer,
  decimal,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const serviceCategories = pgTable(
  'service_categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: varchar('code', { length: 50 }).notNull().unique(),
    name: varchar('name', { length: 100 }).notNull(),
    description: varchar('description', { length: 500 }),
    iconKey: varchar('icon_key', { length: 100 }),
    capacity: integer('capacity').default(1).notNull(),
    baseFare: decimal('base_fare', { precision: 10, scale: 2 }).notNull(),
    perKmRate: decimal('per_km_rate', { precision: 10, scale: 2 }).notNull(),
    minFare: decimal('min_fare', { precision: 10, scale: 2 }).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    codeIdx: index('idx_service_categories_code').on(table.code),
    activeIdx: index('idx_service_categories_active').on(table.isActive),
  })
);

export type ServiceCategory = typeof serviceCategories.$inferSelect;
export type NewServiceCategory = typeof serviceCategories.$inferInsert;
