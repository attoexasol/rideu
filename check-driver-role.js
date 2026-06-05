require('dotenv').config();
const { ManagementClient } = require('auth0');

async function fixDriverRole() {
  const management = new ManagementClient({
    domain: process.env.AUTH0_DOMAIN,
    clientId: process.env.AUTH0_MANAGEMENT_CLIENT_ID,
    clientSecret: process.env.AUTH0_MANAGEMENT_CLIENT_SECRET,
  });

  const auth0Id = 'auth0|68ee78346aa97718f2ec7885';

  try {
    console.log('🔍 Fetching user from Auth0...');
    const user = await management.users.get({ id: auth0Id });
    
    console.log('\n📋 User Info:');
    console.log('- Email:', user.data.email);
    console.log('- Name:', user.data.name);
    console.log('- Auth0 ID:', user.data.user_id);
    console.log('- App Metadata:', JSON.stringify(user.data.app_metadata, null, 2));
    
    const currentRole = user.data.app_metadata?.role || 'No role set';
    console.log('\n❌ Current Role:', currentRole);
    
    if (currentRole === 'admin') {
      console.log('\n🔄 Updating role from "admin" to "driver"...');
      await management.users.update(
        { id: auth0Id },
        { app_metadata: { role: 'driver' } }
      );
      console.log('✅ Role updated successfully!');
      console.log('\n📱 The driver needs to log out and log back in to see the change.');
    } else {
      console.log('✅ Role is already set to:', currentRole);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

fixDriverRole();
