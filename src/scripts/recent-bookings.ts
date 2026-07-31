import 'dotenv/config';
import postgres from 'postgres';

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT b.id, b.status, b.service_category_id, b.created_at,
      (SELECT count(*)::int FROM booking_offers o WHERE o.booking_id = b.id) AS offer_count
    FROM bookings b
    ORDER BY b.created_at DESC
    LIMIT 5
  `;
  console.log(JSON.stringify(rows, null, 2));
  await sql.end();
}

main();
