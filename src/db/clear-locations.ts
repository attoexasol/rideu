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

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { locations } from './schema';
import { sql } from 'drizzle-orm';

async function clearLocations() {
  // Get database URL from environment
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is required');
    process.exit(1);
  }

  console.log('🔌 Connecting to database...');
  console.log(`   Using: ${databaseUrl.replace(/:[^:@]+@/, ':****@')}`); // Hide password in logs

  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  try {
    // Get count before deletion
    const countBefore = await db.select({ count: sql<number>`count(*)::int` }).from(locations);
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

    await new Promise((resolve) => setTimeout(resolve, 5000));

    console.log('🗑️  Deleting all locations...');
    await db.delete(locations);

    // Verify deletion
    const countAfter = await db.select({ count: sql<number>`count(*)::int` }).from(locations);
    const totalAfter = countAfter[0]?.count || 0;

    console.log(`✅ Deleted ${totalBefore - totalAfter} location records`);
    console.log(`📊 Remaining records: ${totalAfter}`);

    await client.end();
    console.log('✅ Done!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to clear locations:', error);
    await client.end();
    process.exit(1);
  }
}

clearLocations();
