import { pgTable, uuid, boolean, timestamp, varchar, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { vehicles } from './vehicles';
import { serviceCategories } from './service_categories';

export const vehicleServiceCategories = pgTable(
  'vehicle_service_categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    serviceCategoryId: uuid('service_category_id')
      .notNull()
      .references(() => serviceCategories.id, { onDelete: 'cascade' }),
    isPrimary: boolean('is_primary').default(false).notNull(),
    verifiedAt: timestamp('verified_at'),
    source: varchar('source', { length: 50 }).default('migration'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    vehicleCategoryUnique: uniqueIndex('idx_vehicle_service_categories_unique').on(
      table.vehicleId,
      table.serviceCategoryId
    ),
    vehicleIdx: index('idx_vehicle_service_categories_vehicle_id').on(table.vehicleId),
    categoryIdx: index('idx_vehicle_service_categories_category').on(table.serviceCategoryId),
  })
);

export type VehicleServiceCategory = typeof vehicleServiceCategories.$inferSelect;
export type NewVehicleServiceCategory = typeof vehicleServiceCategories.$inferInsert;
