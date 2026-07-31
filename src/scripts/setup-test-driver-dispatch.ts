/**
 * One-time test setup: assign vehicle + service category to a driver for dispatch E2E.
 * Safe for staging/dev only.
 */
import 'dotenv/config';
import postgres from 'postgres';

const DRIVER_ID = process.env.DIAG_DRIVER_ID || '281b0d60-71c9-45e3-abcd-0d7c6a590c37';
const VEHICLE_ID = process.env.DIAG_VEHICLE_ID || 'ee462fab-4b4f-40b3-bc7d-ed0debd5413c';
const SERVICE_CATEGORY_ID =
  process.env.DIAG_SERVICE_CATEGORY_ID || '59ab7ef9-0bb3-47c8-8afa-3313b295151e';

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);
  try {
    await sql`
      UPDATE drivers
      SET vehicle_id = ${VEHICLE_ID}::uuid, updated_at = NOW()
      WHERE id = ${DRIVER_ID}::uuid
    `;

    await sql`
      INSERT INTO driver_service_categories (driver_id, service_category_id, is_primary, verified_at)
      VALUES (${DRIVER_ID}::uuid, ${SERVICE_CATEGORY_ID}::uuid, true, NOW())
      ON CONFLICT (driver_id, service_category_id) DO NOTHING
    `;

    const driver = await sql`
      SELECT id, name, vehicle_id, status FROM drivers WHERE id = ${DRIVER_ID}::uuid
    `;
    const links = await sql`
      SELECT service_category_id FROM driver_service_categories WHERE driver_id = ${DRIVER_ID}::uuid
    `;

    console.log(
      JSON.stringify(
        {
          ok: true,
          driver: driver[0],
          serviceCategoryIds: links.map((l) => l.service_category_id),
        },
        null,
        2
      )
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
