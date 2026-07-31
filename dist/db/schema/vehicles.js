"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.vehicles = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const fleets_1 = require("./fleets");
/**
 * Vehicles table schema
 * Stores information about vehicles in the fleet
 */
exports.vehicles = (0, pg_core_1.pgTable)('vehicles', {
    id: (0, pg_core_1.uuid)('id').defaultRandom().primaryKey(),
    make: (0, pg_core_1.varchar)('make', { length: 100 }),
    model: (0, pg_core_1.varchar)('model', { length: 100 }),
    year: (0, pg_core_1.integer)('year'),
    color: (0, pg_core_1.varchar)('color', { length: 50 }),
    plateNumber: (0, pg_core_1.varchar)('plate_number', { length: 50 }).unique(),
    vin: (0, pg_core_1.varchar)('vin', { length: 17 }).unique(),
    bodyNumber: (0, pg_core_1.varchar)('body_number', { length: 255 }),
    status: (0, pg_core_1.varchar)('status', { length: 50 }).default('active').notNull(),
    fleetId: (0, pg_core_1.uuid)('fleet_id').references(() => fleets_1.fleets.id, { onDelete: 'restrict' }),
    qrCode: (0, pg_core_1.varchar)('qr_code', { length: 255 }).unique(),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at').defaultNow().notNull(),
}, (table) => ({
    plateNumberIdx: (0, pg_core_1.index)('idx_vehicles_plate_number').on(table.plateNumber),
    fleetIdx: (0, pg_core_1.index)('idx_vehicles_fleet_id').on(table.fleetId),
    qrCodeIdx: (0, pg_core_1.index)('idx_vehicles_qr_code').on(table.qrCode),
}));
//# sourceMappingURL=vehicles.js.map