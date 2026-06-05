/**
 * Location Cleanup Script
 * Deletes location data older than 6 months
 * Run this script via cron job daily: 0 2 * * * (2 AM daily)
 */

require('dotenv').config();
const postgres = require('postgres');

const sql = postgres(process.env.DATABASE_URL);

(async () => {
  try {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    console.log(`🗑️  Starting location cleanup...`);
    console.log(`📅 Deleting locations older than: ${sixMonthsAgo.toISOString()}\n`);

    // Delete old locations
    const result = await sql`
      DELETE FROM locations
      WHERE timestamp <= ${sixMonthsAgo}
    `;

    console.log(`✅ Deleted ${result.count} locations`);
    console.log(`🎉 Cleanup complete!\n`);

    await sql.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Cleanup error:', error.message);
    await sql.end();
    process.exit(1);
  }
})();
