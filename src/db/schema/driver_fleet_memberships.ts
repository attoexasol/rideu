import { pgTable, uuid, varchar, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { drivers } from './drivers';
import { fleets } from './fleets';

export const driverFleetMemberships = pgTable(
  'driver_fleet_memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    fleetId: uuid('fleet_id')
      .notNull()
      .references(() => fleets.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 50 }).notNull().default('active'),
    joinedAt: timestamp('joined_at').defaultNow().notNull(),
    leftAt: timestamp('left_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    driverIdx: index('idx_driver_fleet_memberships_driver_id').on(table.driverId),
    fleetIdx: index('idx_driver_fleet_memberships_fleet_id').on(table.fleetId),
    activeMembershipIdx: uniqueIndex('idx_driver_fleet_memberships_active_unique').on(
      table.driverId,
      table.fleetId
    ),
  })
);

export type DriverFleetMembership = typeof driverFleetMemberships.$inferSelect;
export type NewDriverFleetMembership = typeof driverFleetMemberships.$inferInsert;
