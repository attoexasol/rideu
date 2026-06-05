import dotenv from 'dotenv';
import { db } from './src/db/connection';
import { drivers } from './src/db/schema';
import { eq } from 'drizzle-orm';

dotenv.config();

async function updateDriverAuth0Id() {
  try {
    // Find the driver by email
    const driver = await db.select().from(drivers).where(eq(drivers.email, 'driver@drivewize.test')).limit(1);

    if (driver.length > 0) {
      console.log('Current driver auth0_id:', driver[0].auth0Id);

      // Update with the correct Auth0 user ID
      await db.update(drivers)
        .set({ auth0Id: 'auth0|68ee78346aa97718f2ec7885' })
        .where(eq(drivers.email, 'driver@drivewize.test'));

      console.log('✅ Updated driver auth0_id to: auth0|68ee78346aa97718f2ec7885');

      // Verify the update
      const updated = await db.select().from(drivers).where(eq(drivers.email, 'driver@drivewize.test')).limit(1);
      console.log('Verified new auth0_id:', updated[0].auth0Id);
    } else {
      console.log('❌ Driver not found');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

updateDriverAuth0Id();
