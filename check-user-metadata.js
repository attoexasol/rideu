/**
 * Check Auth0 User Metadata
 * Run with: node check-user-metadata.js <email>
 */

const { ManagementClient } = require('auth0');
require('dotenv').config();

const auth0 = new ManagementClient({
  domain: process.env.AUTH0_DOMAIN,
  clientId: process.env.AUTH0_MANAGEMENT_CLIENT_ID,
  clientSecret: process.env.AUTH0_MANAGEMENT_CLIENT_SECRET,
});

async function checkUserMetadata() {
  const email = process.argv[2] || 'driver@drivewize.test';

  console.log(`\n🔍 Checking Auth0 metadata for: ${email}\n`);

  try {
    const usersResult = await auth0.usersByEmail.getByEmail({ email });

    if (!usersResult.data || usersResult.data.length === 0) {
      console.log('❌ User not found in Auth0');
      return;
    }

    const user = usersResult.data[0];

    console.log('✅ User found in Auth0:');
    console.log('User ID:', user.user_id);
    console.log('Email:', user.email);
    console.log('Name:', user.name);
    console.log('\n📋 App Metadata:');
    console.log(JSON.stringify(user.app_metadata, null, 2));
    console.log('\n📋 User Metadata:');
    console.log(JSON.stringify(user.user_metadata, null, 2));
    console.log('\n📋 Full User Object:');
    console.log(JSON.stringify(user, null, 2));

  } catch (error) {
    console.error('\n❌ Error checking user metadata:', error.message);
    if (error.response?.data) {
      console.error('Details:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

checkUserMetadata();
