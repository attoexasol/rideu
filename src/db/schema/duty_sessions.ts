import { pgTable, uuid, varchar, timestamp, text, index } from 'drizzle-orm/pg-core';
import { drivers } from './drivers';
import { fleets } from './fleets';
import { organizations } from './organizations';
import { vehicles } from './vehicles';

export const dutySessions = pgTable(
  'duty_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    fleetId: uuid('fleet_id')
      .notNull()
      .references(() => fleets.id, { onDelete: 'restrict' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    status: varchar('status', { length: 50 }).notNull().default('active'),
    startedAt: timestamp('started_at').defaultNow().notNull(),
    endedAt: timestamp('ended_at'),
    startVehicleId: uuid('start_vehicle_id').references(() => vehicles.id, {
      onDelete: 'set null',
    }),
    endedReason: varchar('ended_reason', { length: 100 }),
    startLocation: text('start_location'),
    endLocation: text('end_location'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    driverIdx: index('idx_duty_sessions_driver_id').on(table.driverId),
    fleetIdx: index('idx_duty_sessions_fleet_id').on(table.fleetId),
    statusIdx: index('idx_duty_sessions_status').on(table.status),
  })
);

export type DutySession = typeof dutySessions.$inferSelect;
export type NewDutySession = typeof dutySessions.$inferInsert;
