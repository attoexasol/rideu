require('dotenv').config();
const postgres = require('postgres');

const sql = postgres(process.env.DATABASE_URL);

// Keep only the real driver (from mobile app login)
const KEEP_DRIVER_EMAIL = 'driver@drivewize.test';

(async () => {
  try {
    console.log('🧹 Cleaning up test drivers...\n');

    // Get all drivers
    const allDrivers = await sql`
      SELECT id, email, name, auth0_id
      FROM drivers
      ORDER BY created_at DESC
    `;

    console.log(`Found ${allDrivers.length} drivers in database:\n`);
    allDrivers.forEach((d, idx) => {
      console.log(`${idx + 1}. ${d.name} (${d.email})`);
      console.log(`   Auth0 ID: ${d.auth0_id}`);
    });

    // Find the driver to keep
    const keepDriver = allDrivers.find(d => d.email === KEEP_DRIVER_EMAIL);

    if (!keepDriver) {
      console.log(`\n❌ Driver with email ${KEEP_DRIVER_EMAIL} not found!`);
      await sql.end();
      return;
    }

    console.log(`\n✅ Keeping driver: ${keepDriver.name} (${keepDriver.email})`);

    // Get drivers to delete
    const deleteDrivers = allDrivers.filter(d => d.email !== KEEP_DRIVER_EMAIL);

    if (deleteDrivers.length === 0) {
      console.log('\n✅ No drivers to delete.');
      await sql.end();
      return;
    }

    console.log(`\n🗑️  Will delete ${deleteDrivers.length} drivers:`);
    deleteDrivers.forEach(d => {
      console.log(`   - ${d.name} (${d.email})`);
    });

    // Delete trips for these drivers
    const deleteDriverIds = deleteDrivers.map(d => d.id);

    const deletedTrips = await sql`
      DELETE FROM trips
      WHERE driver_id = ANY(${deleteDriverIds})
    `;
    console.log(`\n✅ Deleted ${deletedTrips.count} trips`);

    // Delete locations for these drivers
    const deletedLocations = await sql`
      DELETE FROM locations
      WHERE driver_id = ANY(${deleteDriverIds})
    `;
    console.log(`✅ Deleted ${deletedLocations.count} locations`);

    // Delete the drivers
    const deletedDrivers = await sql`
      DELETE FROM drivers
      WHERE id = ANY(${deleteDriverIds})
    `;
    console.log(`✅ Deleted ${deletedDrivers.count} drivers`);

    console.log('\n🎉 Cleanup complete!');
    console.log(`\nRemaining driver: ${keepDriver.name} (${keepDriver.email})`);

    await sql.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    await sql.end();
    process.exit(1);
  }
})();
