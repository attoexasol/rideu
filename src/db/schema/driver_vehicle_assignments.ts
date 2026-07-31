import { pgTable, uuid, timestamp, boolean, varchar, index } from 'drizzle-orm/pg-core';
import { drivers } from './drivers';
import { vehicles } from './vehicles';
import { fleets } from './fleets';
import { dutySessions } from './duty_sessions';

export const driverVehicleAssignments = pgTable(
  'driver_vehicle_assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    fleetId: uuid('fleet_id').references(() => fleets.id, { onDelete: 'restrict' }),
    dutySessionId: uuid('duty_session_id').references(() => dutySessions.id, {
      onDelete: 'set null',
    }),
    assignedAt: timestamp('assigned_at').defaultNow().notNull(),
    unassignedAt: timestamp('unassigned_at'),
    isActive: boolean('is_active').default(true).notNull(),
    assignedBy: varchar('assigned_by', { length: 50 }),
    assignmentReason: varchar('assignment_reason', { length: 100 }),
    unassignedReason: varchar('unassigned_reason', { length: 100 }),
    predecessorAssignmentId: uuid('predecessor_assignment_id'),
    exchangeRequestId: uuid('exchange_request_id'),
  },
  (table) => ({
    driverIdx: index('idx_dva_driver_id').on(table.driverId),
    vehicleIdx: index('idx_dva_vehicle_id').on(table.vehicleId),
    isActiveIdx: index('idx_dva_is_active').on(table.isActive),
    fleetIdx: index('idx_dva_fleet_id').on(table.fleetId),
    dutySessionIdx: index('idx_dva_duty_session_id').on(table.dutySessionId),
  })
);

export type DriverVehicleAssignment = typeof driverVehicleAssignments.$inferSelect;
export type NewDriverVehicleAssignment = typeof driverVehicleAssignments.$inferInsert;
