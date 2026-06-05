"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.locations = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const drivers_1 = require("./drivers");
/**
 * Locations table schema
 * Stores GPS location data from drivers with high precision
 */
exports.locations = (0, pg_core_1.pgTable)('locations', {
    id: (0, pg_core_1.uuid)('id').defaultRandom().primaryKey(),
    driverId: (0, pg_core_1.uuid)('driver_id')
        .notNull()
        .references(() => drivers_1.drivers.id, { onDelete: 'cascade' }),
    latitude: (0, pg_core_1.decimal)('latitude', { precision: 10, scale: 8 }).notNull(),
    longitude: (0, pg_core_1.decimal)('longitude', { precision: 11, scale: 8 }).notNull(),
    accuracy: (0, pg_core_1.decimal)('accuracy', { precision: 10, scale: 2 }),
    speed: (0, pg_core_1.decimal)('speed', { precision: 10, scale: 2 }),
    heading: (0, pg_core_1.decimal)('heading', { precision: 5, scale: 2 }),
    timestamp: (0, pg_core_1.timestamp)('timestamp').notNull().defaultNow(),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
}, (table) => ({
    driverIdIdx: (0, pg_core_1.index)('idx_locations_driver_id').on(table.driverId),
    timestampIdx: (0, pg_core_1.index)('idx_locations_timestamp').on(table.timestamp.desc()),
    driverTimestampIdx: (0, pg_core_1.index)('idx_locations_driver_timestamp').on(table.driverId, table.timestamp.desc()),
}));
//# sourceMappingURL=locations.js.map