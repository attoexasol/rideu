import { pgTable, uuid, varchar, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { vehicleExchangeRequests } from './vehicle_exchange_requests';

export const vehicleExchangeEvents = pgTable(
  'vehicle_exchange_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    exchangeRequestId: uuid('exchange_request_id')
      .notNull()
      .references(() => vehicleExchangeRequests.id, { onDelete: 'cascade' }),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    actorType: varchar('actor_type', { length: 50 }).notNull(),
    actorId: uuid('actor_id'),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    exchangeIdx: index('idx_vee_exchange_request_id').on(table.exchangeRequestId),
    eventTypeIdx: index('idx_vee_event_type').on(table.eventType),
    createdAtIdx: index('idx_vee_created_at').on(table.createdAt),
  })
);

export type VehicleExchangeEvent = typeof vehicleExchangeEvents.$inferSelect;
export type NewVehicleExchangeEvent = typeof vehicleExchangeEvents.$inferInsert;
