import { pgTable, uuid, varchar, timestamp, index } from 'drizzle-orm/pg-core';
import { vehicleExchangeRequests } from './vehicle_exchange_requests';

/**
 * Active resource locks for pending exchanges.
 * Partial unique on (resource_type, resource_id) WHERE released_at IS NULL
 * guarantees at most one pending exchange per driver or vehicle regardless of role.
 */
export const vehicleExchangeResourceLocks = pgTable(
  'vehicle_exchange_resource_locks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    exchangeRequestId: uuid('exchange_request_id')
      .notNull()
      .references(() => vehicleExchangeRequests.id, { onDelete: 'cascade' }),
    resourceType: varchar('resource_type', { length: 20 }).notNull(),
    resourceId: uuid('resource_id').notNull(),
    releasedAt: timestamp('released_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    exchangeIdx: index('idx_verl_exchange_request_id').on(table.exchangeRequestId),
    resourceIdx: index('idx_verl_resource').on(table.resourceType, table.resourceId),
  })
);

export type VehicleExchangeResourceLock = typeof vehicleExchangeResourceLocks.$inferSelect;
export type NewVehicleExchangeResourceLock = typeof vehicleExchangeResourceLocks.$inferInsert;
