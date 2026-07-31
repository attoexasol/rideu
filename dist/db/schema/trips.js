"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.trips = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const drivers_1 = require("./drivers");
const locations_1 = require("./locations");
const customers_1 = require("./customers");
/**
 * Trips table schema
 * Stores driver trip information including start/end times and distance
 */
exports.trips = (0, pg_core_1.pgTable)('trips', {
    id: (0, pg_core_1.uuid)('id').defaultRandom().primaryKey(),
    driverId: (0, pg_core_1.uuid)('driver_id')
        .notNull()
        .references(() => drivers_1.drivers.id, { onDelete: 'cascade' }),
    bookingId: (0, pg_core_1.uuid)('booking_id'),
    customerId: (0, pg_core_1.uuid)('customer_id').references(() => customers_1.customers.id, { onDelete: 'set null' }),
    startTime: (0, pg_core_1.timestamp)('start_time').notNull(),
    endTime: (0, pg_core_1.timestamp)('end_time'),
    distance: (0, pg_core_1.decimal)('distance', { precision: 10, scale: 2 }),
    status: (0, pg_core_1.varchar)('status', { length: 50 }).default('in_progress').notNull(),
    startLocationId: (0, pg_core_1.uuid)('start_location_id').references(() => locations_1.locations.id),
    endLocationId: (0, pg_core_1.uuid)('end_location_id').references(() => locations_1.locations.id),
    passengerQrCode: (0, pg_core_1.varchar)('passenger_qr_code', { length: 255 }).unique(),
    qrVerified: (0, pg_core_1.boolean)('qr_verified').default(false).notNull(),
    qrVerifiedAt: (0, pg_core_1.timestamp)('qr_verified_at'),
    tripType: (0, pg_core_1.varchar)('trip_type', { length: 50 }),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at').defaultNow().notNull(),
}, (table) => ({
    driverIdIdx: (0, pg_core_1.index)('idx_trips_driver_id').on(table.driverId),
    bookingIdIdx: (0, pg_core_1.index)('idx_trips_booking_id').on(table.bookingId),
    customerIdIdx: (0, pg_core_1.index)('idx_trips_customer_id').on(table.customerId),
    statusIdx: (0, pg_core_1.index)('idx_trips_status').on(table.status),
    startTimeIdx: (0, pg_core_1.index)('idx_trips_start_time').on(table.startTime.desc()),
    passengerQrCodeIdx: (0, pg_core_1.index)('idx_trips_passenger_qr_code').on(table.passengerQrCode),
}));
//# sourceMappingURL=trips.js.map