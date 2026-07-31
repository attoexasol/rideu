import { pgTable, uuid, varchar, timestamp, index } from 'drizzle-orm/pg-core';
import { vehicles } from './vehicles';
import { fleets } from './fleets';
import { adminUsers } from './admin_users';

export const vehicleQrTokens = pgTable(
  'vehicle_qr_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    fleetId: uuid('fleet_id')
      .notNull()
      .references(() => fleets.id, { onDelete: 'restrict' }),
    token: varchar('token', { length: 255 }).notNull().unique(),
    status: varchar('status', { length: 50 }).notNull().default('active'),
    legacySource: varchar('legacy_source', { length: 100 }),
    issuedAt: timestamp('issued_at').defaultNow().notNull(),
    revokedAt: timestamp('revoked_at'),
    issuedByAdminId: uuid('issued_by_admin_id').references(() => adminUsers.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    vehicleIdx: index('idx_vehicle_qr_tokens_vehicle_id').on(table.vehicleId),
    fleetIdx: index('idx_vehicle_qr_tokens_fleet_id').on(table.fleetId),
    statusIdx: index('idx_vehicle_qr_tokens_status').on(table.status),
    tokenIdx: index('idx_vehicle_qr_tokens_token').on(table.token),
  })
);

export type VehicleQrToken = typeof vehicleQrTokens.$inferSelect;
export type NewVehicleQrToken = typeof vehicleQrTokens.$inferInsert;
