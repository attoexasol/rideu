require('dotenv').config();
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL);

(async () => {
  const locs = await sql`
    SELECT latitude, longitude, accuracy, speed, timestamp
    FROM locations
    WHERE driver_id = '8d646501-6c53-49c9-b725-22ceee32fbd0'
    ORDER BY timestamp DESC
    LIMIT 10
  `;

  console.log('Recent locations with accuracy:\n');
  locs.forEach((loc, i) => {
    const lat = parseFloat(loc.latitude);
    const lng = parseFloat(loc.longitude);
    const acc = loc.accuracy ? parseFloat(loc.accuracy) : null;
    const speed = loc.speed ? parseFloat(loc.speed) : null;

    console.log(`${i+1}. Coords: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    console.log(`   Accuracy: ±${acc ? acc.toFixed(1) : 'N/A'}m | Speed: ${speed !== null ? speed.toFixed(1) : 'N/A'} mph`);
    console.log(`   Time: ${loc.timestamp.toLocaleTimeString()}\n`);
  });

  await sql.end();
})();
