require('dotenv').config();
const postgres = require('postgres');
const { randomUUID } = require('crypto');

const sql = postgres(process.env.DATABASE_URL);

const ADMIN_EMAIL = 'admin@drivewize.com';
const ADMIN_NAME = 'Super Admin';
const ADMIN_ROLE = 'super_admin';

// You'll need to create this user in Auth0 first
// Use your Auth0 dashboard to create a user with this email
const ADMIN_AUTH0_ID = 'auth0|REPLACE_WITH_ACTUAL_AUTH0_ID';

(async () => {
  try {
    console.log('Creating Super Admin User...\n');

    // Check if admin already exists
    const existing = await sql`
      SELECT * FROM admin_users
      WHERE email = ${ADMIN_EMAIL}
    `;

    if (existing.length > 0) {
      console.log('❌ Admin user already exists:');
      console.log(`   Email: ${existing[0].email}`);
      console.log(`   Name: ${existing[0].name}`);
      console.log(`   Role: ${existing[0].role}`);
      await sql.end();
      return;
    }

    // Create admin user
    const result = await sql`
      INSERT INTO admin_users (id, auth0_id, email, name, role)
      VALUES (
        ${randomUUID()},
        ${ADMIN_AUTH0_ID},
        ${ADMIN_EMAIL},
        ${ADMIN_NAME},
        ${ADMIN_ROLE}
      )
      RETURNING *
    `;

    console.log('✅ Super Admin user created successfully!');
    console.log(`   Email: ${result[0].email}`);
    console.log(`   Name: ${result[0].name}`);
    console.log(`   Role: ${result[0].role}`);
    console.log(`   Auth0 ID: ${result[0].auth0_id}`);
    console.log('\n📝 Next steps:');
    console.log('   1. Create this user in Auth0 if not already done');
    console.log('   2. Set the user\'s app_metadata in Auth0:');
    console.log('      { "role": "super_admin" }');
    console.log('   3. Login to admin dashboard at: http://localhost:5173');

    await sql.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    await sql.end();
    process.exit(1);
  }
})();
