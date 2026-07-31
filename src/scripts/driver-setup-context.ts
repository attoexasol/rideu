import 'dotenv/config';
import postgres from 'postgres';

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);
  const driverId = '281b0d60-71c9-45e3-abcd-0d7c6a590c37';

  const [driver, vehicles, categories] = await Promise.all([
    sql`SELECT id, name, vehicle_id, status FROM drivers WHERE id = ${driverId}::uuid`,
    sql`SELECT id, plate_number, status FROM vehicles WHERE status IN ('active','approved') LIMIT 10`,
    sql`SELECT id, code, name FROM service_categories WHERE is_active = true LIMIT 10`,
  ]);

  console.log(
    JSON.stringify(
      {
        driver: driver[0] ?? null,
        availableVehicles: vehicles,
        serviceCategories: categories,
        driverServiceLinks: await sql`
          SELECT * FROM driver_service_categories WHERE driver_id = ${driverId}::uuid
        `,
      },
      null,
      2
    )
  );
  await sql.end();
}

main();
