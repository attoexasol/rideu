import { pgTable, uuid, varchar, decimal, timestamp, index } from 'drizzle-orm/pg-core';
import { customers } from './customers';

export const customerPlaces = pgTable(
  'customer_places',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    label: varchar('label', { length: 255 }).notNull(),
    address: varchar('address', { length: 500 }).notNull(),
    latitude: decimal('latitude', { precision: 10, scale: 8 }).notNull(),
    longitude: decimal('longitude', { precision: 11, scale: 8 }).notNull(),
    placeId: varchar('place_id', { length: 255 }),
    city: varchar('city', { length: 255 }),
    countryCode: varchar('country_code', { length: 10 }),
    placeType: varchar('place_type', { length: 50 }).default('recent').notNull(),
    lastUsedAt: timestamp('last_used_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    customerIdIdx: index('idx_customer_places_customer_id').on(table.customerId),
    customerPlaceTypeIdx: index('idx_customer_places_customer_type').on(
      table.customerId,
      table.placeType
    ),
    lastUsedIdx: index('idx_customer_places_last_used').on(table.lastUsedAt.desc()),
  })
);

export type CustomerPlace = typeof customerPlaces.$inferSelect;
export type NewCustomerPlace = typeof customerPlaces.$inferInsert;
