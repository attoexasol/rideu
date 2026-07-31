import 'dotenv/config';
import postgres from 'postgres';

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);

  const drivers = await sql`
    SELECT id, name, email, qr_code
    FROM drivers
    ORDER BY created_at DESC
    LIMIT 5
  `;
  const sessions = await sql`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE expires_at > NOW())::int AS active
    FROM sessions
  `;
  const nullQr = await sql`
    SELECT COUNT(*)::int AS count FROM drivers WHERE qr_code IS NULL
  `;

  console.log('Recent drivers:', drivers);
  console.log('Sessions:', sessions[0]);
  console.log('Drivers without qr_code:', nullQr[0]);

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
