"use strict";
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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const connection_1 = require("./connection");
const schema_1 = require("./schema");
const dotenv = __importStar(require("dotenv"));
// Load environment variables
dotenv.config();
/**
 * Verify database schema and data
 */
async function verifySchema() {
    console.log('🔍 Verifying database schema and data...\n');
    try {
        // Check tables exist and have data
        console.log('📋 Checking tables...');
        const driverCount = await connection_1.db.select().from(schema_1.drivers);
        console.log(`   ✓ drivers table: ${driverCount.length} records`);
        const locationCount = await connection_1.db.select().from(schema_1.locations);
        console.log(`   ✓ locations table: ${locationCount.length} records`);
        const tripCount = await connection_1.db.select().from(schema_1.trips);
        console.log(`   ✓ trips table: ${tripCount.length} records`);
        const adminCount = await connection_1.db.select().from(schema_1.adminUsers);
        console.log(`   ✓ admin_users table: ${adminCount.length} records`);
        const sessionCount = await connection_1.db.select().from(schema_1.sessions);
        console.log(`   ✓ sessions table: ${sessionCount.length} records`);
        const vehicleCount = await connection_1.db.select().from(schema_1.vehicles);
        console.log(`   ✓ vehicles table: ${vehicleCount.length} records`);
        const logCount = await connection_1.db.select().from(schema_1.logs);
        console.log(`   ✓ logs table: ${logCount.length} records`);
        console.log('\n🔍 Checking indexes...');
        // Check if indexes exist
        const indexes = await (0, connection_1.queryClient) `
      SELECT
        tablename,
        indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname
    `;
        const indexesByTable = {};
        indexes.forEach((idx) => {
            if (!indexesByTable[idx.tablename]) {
                indexesByTable[idx.tablename] = [];
            }
            indexesByTable[idx.tablename].push(idx.indexname);
        });
        Object.entries(indexesByTable).forEach(([table, idxList]) => {
            console.log(`   ✓ ${table}: ${idxList.length} indexes`);
        });
        console.log('\n📊 Sample data verification:');
        // Show sample driver with vehicle
        const sampleDriver = driverCount[0];
        if (sampleDriver) {
            console.log(`   ✓ Sample driver: ${sampleDriver.name} (${sampleDriver.email})`);
            console.log(`     Status: ${sampleDriver.status}`);
        }
        // Show sample location
        const sampleLocation = locationCount[0];
        if (sampleLocation) {
            console.log(`   ✓ Sample location: lat=${sampleLocation.latitude}, lng=${sampleLocation.longitude}`);
        }
        // Show sample trip
        const sampleTrip = tripCount[0];
        if (sampleTrip) {
            console.log(`   ✓ Sample trip: ${sampleTrip.status} (distance: ${sampleTrip.distance || 'N/A'})`);
        }
        console.log('\n✅ Schema verification complete! All tables and indexes are in place.');
    }
    catch (error) {
        console.error('❌ Verification failed:', error);
        process.exit(1);
    }
    finally {
        await (0, connection_1.closeConnection)();
    }
    process.exit(0);
}
verifySchema();
//# sourceMappingURL=verify-schema.js.map