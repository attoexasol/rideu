require('dotenv').config();
const postgres = require('postgres');

const sql = postgres(process.env.DATABASE_URL);

(async () => {
  try {
    const result = await sql`
      SELECT
        t.id,
        t.driver_id,
        t.status,
        t.start_time,
        t.end_time,
        t.distance,
        d.name as driver_name,
        d.email as driver_email
      FROM trips t
      JOIN drivers d ON t.driver_id = d.id
      ORDER BY t.start_time DESC
      LIMIT 10
    `;

    console.log('Total trips in database:', result.length);
    console.log('\nTrip details:');
    result.forEach((trip, idx) => {
      console.log(`\n${idx + 1}. Trip ${trip.id.substring(0, 8)}...`);
      console.log(`   Driver: ${trip.driver_name} (${trip.driver_email})`);
      console.log(`   Status: ${trip.status}`);
      console.log(`   Start: ${trip.start_time}`);
      console.log(`   End: ${trip.end_time || 'N/A'}`);
      console.log(`   Distance: ${trip.distance || 0} km`);
    });

    // Count by status
    const statusCount = await sql`
      SELECT status, COUNT(*) as count
      FROM trips
      GROUP BY status
    `;

    console.log('\n\nTrips by status:');
    statusCount.forEach(row => {
      console.log(`  ${row.status}: ${row.count}`);
    });

    await sql.end();
  } catch (error) {
    console.error('Error:', error);
    await sql.end();
    process.exit(1);
  }
})();
