"use strict";
/**
 * Database Schema Index
 * Exports all table schemas and types for the DriveWize GPS Tracking System
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.schema = void 0;
// Import all schemas
__exportStar(require("./drivers"), exports);
__exportStar(require("./locations"), exports);
__exportStar(require("./trips"), exports);
__exportStar(require("./admin_users"), exports);
__exportStar(require("./sessions"), exports);
__exportStar(require("./vehicles"), exports);
__exportStar(require("./logs"), exports);
// Import schemas for combined export
const drivers_1 = require("./drivers");
const locations_1 = require("./locations");
const trips_1 = require("./trips");
const admin_users_1 = require("./admin_users");
const sessions_1 = require("./sessions");
const vehicles_1 = require("./vehicles");
const logs_1 = require("./logs");
// Export all schemas as a single object for Drizzle ORM
exports.schema = {
    drivers: drivers_1.drivers,
    locations: locations_1.locations,
    trips: trips_1.trips,
    adminUsers: admin_users_1.adminUsers,
    sessions: sessions_1.sessions,
    vehicles: vehicles_1.vehicles,
    logs: logs_1.logs,
};
//# sourceMappingURL=index.js.map