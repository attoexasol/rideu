/**
 * Safe driver eligibility diagnostic (no secrets in output).
 */
import 'dotenv/config';
import postgres from 'postgres';
import { diagnoseDriverEligibility } from '../services/driverAvailability.service';
import { realtimeCache } from '../config/redis';

const DRIVER_ID = process.env.DIAG_DRIVER_ID || '281b0d60-71c9-45e3-abcd-0d7c6a590c37';
const PICKUP_LAT = parseFloat(process.env.DIAG_PICKUP_LAT || '23.7638929');
const PICKUP_LNG = parseFloat(process.env.DIAG_PICKUP_LNG || '90.4287913');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL required');
    process.exit(1);
  }

  const sql = postgres(process.env.DATABASE_URL);
  try {
    const driverRows = await sql`
      SELECT d.id, d.name, d.status, d.vehicle_id, d.last_seen
      FROM drivers d
      WHERE d.id = ${DRIVER_ID}::uuid
      LIMIT 1
    `;
    const driver = driverRows[0];
    if (!driver) {
      console.log(JSON.stringify({ driverId: DRIVER_ID, eligible: false, reasons: ['DRIVER_NOT_FOUND'] }, null, 2));
      return;
    }

    const categories = await sql`
      SELECT service_category_id
      FROM driver_service_categories
      WHERE driver_id = ${DRIVER_ID}::uuid
    `;

    const serviceCategoryId =
      process.env.DIAG_SERVICE_CATEGORY_ID ||
      categories[0]?.service_category_id ||
      '';

    const [redisStatus, heartbeat, location] = await Promise.all([
      realtimeCache.getDriverStatus(DRIVER_ID),
      realtimeCache.getDriverHeartbeat(DRIVER_ID),
      realtimeCache.getDriverLocation(DRIVER_ID),
    ]);

    const diagnosis = serviceCategoryId
      ? await diagnoseDriverEligibility(DRIVER_ID, serviceCategoryId, PICKUP_LAT, PICKUP_LNG)
      : { driverId: DRIVER_ID, eligible: false, reasons: ['NO_SERVICE_CATEGORY_FOR_TEST'] };

    console.log(
      JSON.stringify(
        {
          driver: {
            id: driver.id,
            status: driver.status,
            hasVehicle: Boolean(driver.vehicle_id),
            lastSeen: driver.last_seen,
          },
          redis: {
            status: redisStatus,
            heartbeat,
            locationTimestamp: location?.timestamp ?? null,
          },
          serviceCategories: categories.map((c) => c.service_category_id),
          testServiceCategoryId: serviceCategoryId || null,
          diagnosis,
        },
        null,
        2
      )
    );
  } finally {
    await sql.end();
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
