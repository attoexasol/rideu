/**
 * Remove GPS Drift Points
 * Removes location points that are too close together (GPS drift/noise)
 * Keeps only points where driver moved 50+ meters
 */

require('dotenv').config();
const postgres = require('postgres');

const sql = postgres(process.env.DATABASE_URL);

// Haversine distance formula
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

(async () => {
  try {
    console.log('🧹 Removing GPS drift points...\n');

    // Get all drivers
    const drivers = await sql`SELECT id, name FROM drivers`;

    let totalRemoved = 0;

    for (const driver of drivers) {
      console.log(`\n📍 Processing ${driver.name}...`);

      // Get all locations for this driver, ordered by time
      const locations = await sql`
        SELECT id, latitude, longitude, timestamp
        FROM locations
        WHERE driver_id = ${driver.id}
        ORDER BY timestamp ASC
      `;

      if (locations.length === 0) {
        console.log('  No locations found');
        continue;
      }

      console.log(`  Found ${locations.length} locations`);

      const toKeep = [];
      const toRemove = [];

      // Always keep the first location
      toKeep.push(locations[0]);
      let lastKept = locations[0];

      // Check each subsequent location
      for (let i = 1; i < locations.length; i++) {
        const current = locations[i];
        const distance = calculateDistance(
          parseFloat(lastKept.latitude),
          parseFloat(lastKept.longitude),
          parseFloat(current.latitude),
          parseFloat(current.longitude)
        );

        if (distance >= 50) {
          // Moved 50+ meters - keep it
          toKeep.push(current);
          lastKept = current;
        } else {
          // GPS drift - remove it
          toRemove.push(current.id);
        }
      }

      if (toRemove.length > 0) {
        // Delete drift points
        await sql`
          DELETE FROM locations
          WHERE id = ANY(${toRemove})
        `;

        console.log(`  ✓ Kept ${toKeep.length} points`);
        console.log(`  🗑️  Removed ${toRemove.length} drift points`);
        totalRemoved += toRemove.length;
      } else {
        console.log(`  ✓ All ${locations.length} points are valid (50+ meters apart)`);
      }
    }

    console.log(`\n🎉 Cleanup complete!`);
    console.log(`📊 Total drift points removed: ${totalRemoved}\n`);

    await sql.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    await sql.end();
    process.exit(1);
  }
})();
