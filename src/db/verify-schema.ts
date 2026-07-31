import { db, queryClient, closeConnection } from './connection';
import { drivers, locations, trips, adminUsers, sessions, vehicles, logs } from './schema';
import * as dotenv from 'dotenv';

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

    const driverCount = await db.select().from(drivers);
    console.log(`   ✓ drivers table: ${driverCount.length} records`);

    const locationCount = await db.select().from(locations);
    console.log(`   ✓ locations table: ${locationCount.length} records`);

    const tripCount = await db.select().from(trips);
    console.log(`   ✓ trips table: ${tripCount.length} records`);

    const adminCount = await db.select().from(adminUsers);
    console.log(`   ✓ admin_users table: ${adminCount.length} records`);

    const sessionCount = await db.select().from(sessions);
    console.log(`   ✓ sessions table: ${sessionCount.length} records`);

    const vehicleCount = await db.select().from(vehicles);
    console.log(`   ✓ vehicles table: ${vehicleCount.length} records`);

    const logCount = await db.select().from(logs);
    console.log(`   ✓ logs table: ${logCount.length} records`);

    console.log('\n🔍 Checking indexes...');

    // Check if indexes exist
    const indexes = await queryClient`
      SELECT
        tablename,
        indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname
    `;

    const indexesByTable: Record<string, string[]> = {};
    indexes.forEach((idx: any) => {
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
      console.log(
        `   ✓ Sample location: lat=${sampleLocation.latitude}, lng=${sampleLocation.longitude}`
      );
    }

    // Show sample trip
    const sampleTrip = tripCount[0];
    if (sampleTrip) {
      console.log(
        `   ✓ Sample trip: ${sampleTrip.status} (distance: ${sampleTrip.distance || 'N/A'})`
      );
    }

    console.log('\n✅ Schema verification complete! All tables and indexes are in place.');
  } catch (error) {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  } finally {
    await closeConnection();
  }

  process.exit(0);
}

verifySchema();
