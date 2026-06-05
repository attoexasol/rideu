/**
 * Create a simple test driver with easy credentials
 * Email: driver@test.com
 * Auth0 ID: auth0|test-driver-123
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function createSimpleTestDriver() {
  try {
    console.log('Creating simple test driver...\n');

    const driverData = {
      auth0_id: 'auth0|test-driver-123',
      email: 'driver@test.com',
      name: 'Test Driver',
      phone: '+1234567890',
      license_number: 'TEST123',
      vehicle_make: 'Tesla',
      vehicle_model: 'Model 3',
      vehicle_year: 2023,
      vehicle_plate: 'TEST-123',
      status: 'available',
    };

    // Check if driver already exists
    const existingDriver = await pool.query(
      'SELECT * FROM drivers WHERE email = $1 OR auth0_id = $2',
      [driverData.email, driverData.auth0_id]
    );

    if (existingDriver.rows.length > 0) {
      console.log('✓ Test driver already exists:');
      console.log('  Email:', existingDriver.rows[0].email);
      console.log('  Auth0 ID:', existingDriver.rows[0].auth0_id);
      console.log('  Name:', existingDriver.rows[0].name);
      console.log('  Status:', existingDriver.rows[0].status);
      return existingDriver.rows[0];
    }

    // Create new driver
    const result = await pool.query(
      `INSERT INTO drivers (
        auth0_id, email, name, phone, license_number,
        vehicle_make, vehicle_model, vehicle_year, vehicle_plate,
        status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      RETURNING *`,
      [
        driverData.auth0_id,
        driverData.email,
        driverData.name,
        driverData.phone,
        driverData.license_number,
        driverData.vehicle_make,
        driverData.vehicle_model,
        driverData.vehicle_year,
        driverData.vehicle_plate,
        driverData.status,
      ]
    );

    console.log('✓ Successfully created test driver:');
    console.log('  Email:', result.rows[0].email);
    console.log('  Auth0 ID:', result.rows[0].auth0_id);
    console.log('  Name:', result.rows[0].name);
    console.log('  Status:', result.rows[0].status);
    console.log('  ID:', result.rows[0].id);

    return result.rows[0];
  } catch (error) {
    console.error('Error creating test driver:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run the script
createSimpleTestDriver()
  .then(() => {
    console.log('\n✓ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Failed:', error.message);
    process.exit(1);
  });
