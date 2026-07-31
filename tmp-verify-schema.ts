import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `;
  console.log('Tables:', tables.map((t) => t.table_name).join(', '));
  for (const table of ['vehicles', 'driver_vehicle_assignments', 'driver_attendance']) {
    const cols = await sql`
      SELECT column_name, data_type, character_maximum_length
      FROM information_schema.columns
      WHERE table_name = ${table}
      ORDER BY ordinal_position
    `;
    console.log(`\n${table}:`, cols);
  }
  await sql.end();
}

main();
