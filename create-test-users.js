/**
 * Create Test Users in Auth0 and Database
 * Run with: node create-test-users.js
 */

const { ManagementClient } = require('auth0');
const postgres = require('postgres');
require('dotenv').config();

const auth0 = new ManagementClient({
  domain: process.env.AUTH0_DOMAIN,
  clientId: process.env.AUTH0_MANAGEMENT_CLIENT_ID,
  clientSecret: process.env.AUTH0_MANAGEMENT_CLIENT_SECRET,
});

const sql = postgres(process.env.DATABASE_URL);

async function createTestUsers() {
  console.log('\n🔧 Creating test users in Auth0 and database...\n');

  try {
    // 1. Create Super Admin User
    console.log('1️⃣  Creating Super Admin...');
    let superAdminAuth0User;
    try {
      const createResult = await auth0.users.create({
        email: 'admin@drivewize.test',
        password: 'DriveWize2024!Admin',
        name: 'Test Super Admin',
        connection: 'Username-Password-Authentication',
        email_verified: true,
        app_metadata: {
          role: 'super_admin',
        },
      });
      superAdminAuth0User = createResult.data;
      console.log('   ✅ Super Admin created in Auth0:', superAdminAuth0User.user_id);
    } catch (err) {
      if (err.statusCode === 409) {
        console.log('   ⚠️  Super Admin already exists in Auth0, fetching...');
        const usersResult = await auth0.usersByEmail.getByEmail({ email: 'admin@drivewize.test' });
        superAdminAuth0User = usersResult.data[0];
      } else {
        throw err;
      }
    }

    // Assign super_admin role in Auth0 metadata
    await auth0.users.update(
      { id: superAdminAuth0User.user_id },
      {
        app_metadata: {
          role: 'super_admin',
        },
      }
    );

    // Create in admin_users database table
    const [dbSuperAdmin] = await sql`
      INSERT INTO admin_users (auth0_id, email, name, role)
      VALUES (${superAdminAuth0User.user_id}, ${'admin@drivewize.test'}, ${'Test Super Admin'}, ${'super_admin'})
      ON CONFLICT (email) DO UPDATE SET
        auth0_id = EXCLUDED.auth0_id,
        name = EXCLUDED.name,
        role = EXCLUDED.role
      RETURNING *
    `;
    console.log('   ✅ Super Admin created in database:', dbSuperAdmin.id);
    console.log('   ✅ Super Admin added to admin_users table\n');

    // 2. Create Driver User
    console.log('2️⃣  Creating Driver...');
    let driverAuth0User;
    try {
      const createResult = await auth0.users.create({
        email: 'driver@drivewize.test',
        password: 'DriveWize2024!Driver',
        name: 'Test Driver',
        connection: 'Username-Password-Authentication',
        email_verified: true,
        app_metadata: {
          role: 'driver',
        },
      });
      driverAuth0User = createResult.data;
      console.log('   ✅ Driver created in Auth0:', driverAuth0User.user_id);
    } catch (err) {
      if (err.statusCode === 409) {
        console.log('   ⚠️  Driver already exists in Auth0, fetching...');
        const usersResult = await auth0.usersByEmail.getByEmail({ email: 'driver@drivewize.test' });
        driverAuth0User = usersResult.data[0];
      } else {
        throw err;
      }
    }

    // Assign driver role in Auth0 metadata
    await auth0.users.update(
      { id: driverAuth0User.user_id },
      {
        app_metadata: {
          role: 'driver',
        },
      }
    );

    // Create in drivers database table
    const [dbDriver] = await sql`
      INSERT INTO drivers (auth0_id, email, name, phone, status)
      VALUES (${driverAuth0User.user_id}, ${'driver@drivewize.test'}, ${'Test Driver'}, ${'+1-555-0100'}, ${'offline'})
      ON CONFLICT (email) DO UPDATE SET
        auth0_id = EXCLUDED.auth0_id,
        name = EXCLUDED.name,
        phone = EXCLUDED.phone
      RETURNING *
    `;
    console.log('   ✅ Driver created in database:', dbDriver.id);
    console.log('   ✅ Driver added to drivers table\n');

    console.log('═══════════════════════════════════════════════════════');
    console.log('✅ Test users created successfully!\n');
    console.log('📧 SUPER ADMIN CREDENTIALS:');
    console.log('   Email:    admin@drivewize.test');
    console.log('   Password: DriveWize2024!Admin');
    console.log('   Portal:   https://drivewize.daedastream.dev\n');
    console.log('📱 DRIVER CREDENTIALS:');
    console.log('   Email:    driver@drivewize.test');
    console.log('   Password: DriveWize2024!Driver');
    console.log('   App:      Mobile App (iOS Simulator)\n');
    console.log('═══════════════════════════════════════════════════════\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error creating test users:', error);
    if (error.response?.data) {
      console.error('Auth0 Error Details:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

createTestUsers();
