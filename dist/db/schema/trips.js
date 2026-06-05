"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.trips = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const drivers_1 = require("./drivers");
const locations_1 = require("./locations");
/**
 * Trips table schema
 * Stores driver trip information including start/end times and distance
 */
exports.trips = (0, pg_core_1.pgTable)('trips', {
    id: (0, pg_core_1.uuid)('id').defaultRandom().primaryKey(),
    driverId: (0, pg_core_1.uuid)('driver_id')
        .notNull()
        .references(() => drivers_1.drivers.id, { onDelete: 'cascade' }),
    startTime: (0, pg_core_1.timestamp)('start_time').notNull(),
    endTime: (0, pg_core_1.timestamp)('end_time'),
    distance: (0, pg_core_1.decimal)('distance', { precision: 10, scale: 2 }),
    status: (0, pg_core_1.varchar)('status', { length: 50 }).default('in_progress').notNull(),
    startLocationId: (0, pg_core_1.uuid)('start_location_id').references(() => locations_1.locations.id),
    endLocationId: (0, pg_core_1.uuid)('end_location_id').references(() => locations_1.locations.id),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at').defaultNow().notNull(),
}, (table) => ({
    driverIdIdx: (0, pg_core_1.index)('idx_trips_driver_id').on(table.driverId),
    statusIdx: (0, pg_core_1.index)('idx_trips_status').on(table.status),
    startTimeIdx: (0, pg_core_1.index)('idx_trips_start_time').on(table.startTime.desc()),
}));
//# sourceMappingURL=trips.js.map