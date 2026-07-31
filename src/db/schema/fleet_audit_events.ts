import { pgTable, uuid, varchar, timestamp, jsonb, index } from 'drizzle-orm/pg-core';

/** Append-only audit trail for duty, assignment, QR, and admin override events. */
export const fleetAuditEvents = pgTable(
  'fleet_audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    actorType: varchar('actor_type', { length: 50 }).notNull(),
    actorId: uuid('actor_id'),
    entityType: varchar('entity_type', { length: 50 }),
    entityId: uuid('entity_id'),
    driverId: uuid('driver_id'),
    vehicleId: uuid('vehicle_id'),
    fleetId: uuid('fleet_id'),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    eventTypeIdx: index('idx_fleet_audit_events_event_type').on(table.eventType),
    driverIdx: index('idx_fleet_audit_events_driver_id').on(table.driverId),
    fleetIdx: index('idx_fleet_audit_events_fleet_id').on(table.fleetId),
    createdAtIdx: index('idx_fleet_audit_events_created_at').on(table.createdAt),
  })
);

export type FleetAuditEvent = typeof fleetAuditEvents.$inferSelect;
export type NewFleetAuditEvent = typeof fleetAuditEvents.$inferInsert;
