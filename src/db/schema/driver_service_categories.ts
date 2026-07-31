import { pgTable, uuid, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { drivers } from './drivers';
import { serviceCategories } from './service_categories';

/** Admin-assigned service types per driver (multi-type). */
export const driverServiceCategories = pgTable(
  'driver_service_categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    serviceCategoryId: uuid('service_category_id')
      .notNull()
      .references(() => serviceCategories.id, { onDelete: 'cascade' }),
    isPrimary: boolean('is_primary').default(false).notNull(),
    verifiedAt: timestamp('verified_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    driverCategoryUnique: uniqueIndex('idx_driver_service_categories_unique').on(
      table.driverId,
      table.serviceCategoryId
    ),
    categoryIdx: index('idx_driver_service_categories_category').on(table.serviceCategoryId),
  })
);

export type DriverServiceCategory = typeof driverServiceCategories.$inferSelect;
export type NewDriverServiceCategory = typeof driverServiceCategories.$inferInsert;
