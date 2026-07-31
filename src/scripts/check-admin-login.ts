import 'dotenv/config';
import postgres from 'postgres';

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);

  const byEmail = await sql`
    SELECT 'admin_users' AS table_name, id, auth0_id, email, name, role
    FROM admin_users
    WHERE email ILIKE ${'%admin@test.com%'}
    UNION ALL
    SELECT 'drivers' AS table_name, id, auth0_id, email, name, status AS role
    FROM drivers
    WHERE email ILIKE ${'%admin@test.com%'}
  `;

  const allAdmins = await sql`
    SELECT id, auth0_id, email, name, role FROM admin_users ORDER BY created_at DESC LIMIT 10
  `;

  console.log('=== Records matching admin@test.com ===');
  console.log(byEmail);

  console.log('\n=== Recent admin_users ===');
  console.log(allAdmins);

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
