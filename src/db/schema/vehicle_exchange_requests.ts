import { pgTable, uuid, varchar, timestamp, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { fleets } from './fleets';
import { organizations } from './organizations';
import { drivers } from './drivers';
import { vehicles } from './vehicles';
import { driverVehicleAssignments } from './driver_vehicle_assignments';
import { dutySessions } from './duty_sessions';
import { vehicleQrTokens } from './vehicle_qr_tokens';

export const vehicleExchangeRequests = pgTable(
  'vehicle_exchange_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    fleetId: uuid('fleet_id')
      .notNull()
      .references(() => fleets.id, { onDelete: 'restrict' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    initiatorDriverId: uuid('initiator_driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    partnerDriverId: uuid('partner_driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    initiatorVehicleId: uuid('initiator_vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'restrict' }),
    partnerVehicleId: uuid('partner_vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'restrict' }),
    initiatorAssignmentId: uuid('initiator_assignment_id')
      .notNull()
      .references(() => driverVehicleAssignments.id, { onDelete: 'restrict' }),
    partnerAssignmentId: uuid('partner_assignment_id')
      .notNull()
      .references(() => driverVehicleAssignments.id, { onDelete: 'restrict' }),
    initiatorDutySessionId: uuid('initiator_duty_session_id')
      .notNull()
      .references(() => dutySessions.id, { onDelete: 'restrict' }),
    partnerDutySessionId: uuid('partner_duty_session_id')
      .notNull()
      .references(() => dutySessions.id, { onDelete: 'restrict' }),
    initiatorScannedTokenId: uuid('initiator_scanned_token_id').references(
      () => vehicleQrTokens.id,
      { onDelete: 'set null' }
    ),
    partnerScannedTokenId: uuid('partner_scanned_token_id').references(
      () => vehicleQrTokens.id,
      { onDelete: 'set null' }
    ),
    status: varchar('status', { length: 50 }).notNull().default('pending'),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    initiatedAt: timestamp('initiated_at').defaultNow().notNull(),
    confirmedAt: timestamp('confirmed_at'),
    cancelledAt: timestamp('cancelled_at'),
    cancelledByDriverId: uuid('cancelled_by_driver_id').references(() => drivers.id, {
      onDelete: 'set null',
    }),
    cancelReason: varchar('cancel_reason', { length: 255 }),
    completedBy: varchar('completed_by', { length: 50 }),
    version: integer('version').default(1).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    statusIdx: index('idx_ver_status').on(table.status),
    expiresIdx: index('idx_ver_expires_at').on(table.expiresAt),
    initiatorIdx: index('idx_ver_initiator_driver').on(table.initiatorDriverId),
    partnerIdx: index('idx_ver_partner_driver').on(table.partnerDriverId),
    idempotencyIdx: uniqueIndex('idx_ver_initiator_idempotency').on(
      table.initiatorDriverId,
      table.idempotencyKey
    ),
  })
);

export type VehicleExchangeRequest = typeof vehicleExchangeRequests.$inferSelect;
export type NewVehicleExchangeRequest = typeof vehicleExchangeRequests.$inferInsert;
