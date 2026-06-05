/**
 * Update driver password to something simpler
 */

const { ManagementClient } = require('auth0');
require('dotenv').config();

const auth0 = new ManagementClient({
  domain: process.env.AUTH0_DOMAIN,
  clientId: process.env.AUTH0_MANAGEMENT_CLIENT_ID,
  clientSecret: process.env.AUTH0_MANAGEMENT_CLIENT_SECRET,
});

async function updateDriverPassword() {
  try {
    console.log('Updating driver password...\n');

    // Get the driver user
    const usersResult = await auth0.usersByEmail.getByEmail({
      email: 'driver@drivewize.test'
    });

    if (!usersResult.data || usersResult.data.length === 0) {
      console.error('Driver user not found in Auth0');
      process.exit(1);
    }

    const driver = usersResult.data[0];
    console.log('Found driver:', driver.email);
    console.log('Auth0 ID:', driver.user_id);

    // Update password (Auth0 requires: 8+ chars, uppercase, lowercase, number)
    await auth0.users.update(
      { id: driver.user_id },
      { password: 'Test1234' }
    );

    console.log('\n✅ Password updated successfully!');
    console.log('\nNew credentials:');
    console.log('  Email:    driver@drivewize.test');
    console.log('  Password: Test1234');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

updateDriverPassword();
