require('dotenv').config();
const postgres = require('postgres');

const sql = postgres(process.env.DATABASE_URL);

(async () => {
  try {
    const adminUsers = await sql`
      SELECT
        id,
        auth0_id,
        email,
        name,
        role,
        created_at
      FROM admin_users
      ORDER BY created_at DESC
    `;

    console.log('Admin Users in Database:');
    console.log('========================\n');

    if (adminUsers.length === 0) {
      console.log('No admin users found in database.');
    } else {
      adminUsers.forEach((admin, idx) => {
        console.log(`${idx + 1}. ${admin.name} (${admin.email})`);
        console.log(`   Role: ${admin.role}`);
        console.log(`   Auth0 ID: ${admin.auth0_id}`);
        console.log(`   Created: ${admin.created_at}`);
        console.log('');
      });
    }

    await sql.end();
  } catch (error) {
    console.error('Error:', error);
    await sql.end();
    process.exit(1);
  }
})();
