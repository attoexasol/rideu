"use strict";
/**
 * Clear all locations (breadcrumbs) from the database
 *
 * Usage:
 *   # Clear from local database
 *   npx tsx src/db/clear-locations.ts
 *
 *   # Clear from Railway staging/production database
 *   # Set DATABASE_URL env var first, then run:
 *   DATABASE_URL="postgresql://..." npx tsx src/db/clear-locations.ts
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const postgres_js_1 = require("drizzle-orm/postgres-js");
const postgres_1 = __importDefault(require("postgres"));
const schema_1 = require("./schema");
const drizzle_orm_1 = require("drizzle-orm");
async function clearLocations() {
    // Get database URL from environment
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        console.error('❌ DATABASE_URL environment variable is required');
        process.exit(1);
    }
    console.log('🔌 Connecting to database...');
    console.log(`   Using: ${databaseUrl.replace(/:[^:@]+@/, ':****@')}`); // Hide password in logs
    const client = (0, postgres_1.default)(databaseUrl, { max: 1 });
    const db = (0, postgres_js_1.drizzle)(client);
    try {
        // Get count before deletion
        const countBefore = await db.select({ count: (0, drizzle_orm_1.sql) `count(*)::int` }).from(schema_1.locations);
        const totalBefore = countBefore[0]?.count || 0;
        console.log(`📊 Found ${totalBefore} location records (breadcrumbs)`);
        if (totalBefore === 0) {
            console.log('✅ No locations to delete');
            await client.end();
            process.exit(0);
        }
        // Confirm deletion
        console.log('\n⚠️  WARNING: This will DELETE ALL location records from the database!');
        console.log('   Press Ctrl+C to cancel, or wait 5 seconds to proceed...\n');
        await new Promise(resolve => setTimeout(resolve, 5000));
        console.log('🗑️  Deleting all locations...');
        await db.delete(schema_1.locations);
        // Verify deletion
        const countAfter = await db.select({ count: (0, drizzle_orm_1.sql) `count(*)::int` }).from(schema_1.locations);
        const totalAfter = countAfter[0]?.count || 0;
        console.log(`✅ Deleted ${totalBefore - totalAfter} location records`);
        console.log(`📊 Remaining records: ${totalAfter}`);
        await client.end();
        console.log('✅ Done!');
        process.exit(0);
    }
    catch (error) {
        console.error('❌ Failed to clear locations:', error);
        await client.end();
        process.exit(1);
    }
}
clearLocations();
//# sourceMappingURL=clear-locations.js.map