require('dotenv').config();
const { ManagementClient } = require('auth0');

async function checkClientName() {
  const management = new ManagementClient({
    domain: process.env.AUTH0_DOMAIN,
    clientId: process.env.AUTH0_MANAGEMENT_CLIENT_ID,
    clientSecret: process.env.AUTH0_MANAGEMENT_CLIENT_SECRET,
  });

  const adminClientId = 'q1LwosJ5gccATugBY6wYSRiNtrIOYUAc';

  try {
    const { data: client } = await management.clients.get({ client_id: adminClientId });
    
    console.log('\n📋 Auth0 Client Info:');
    console.log('- Client ID:', client.client_id);
    console.log('- Client Name:', client.name);
    console.log('- Description:', client.description);
    console.log('- Type:', client.app_type);
    
    console.log('\n🔧 Update Your Auth0 Action:');
    console.log('Change this line:');
    console.log('  ADMIN_PORTAL: \'DriveWize Admin Portal\',');
    console.log('To this:');
    console.log(`  ADMIN_PORTAL: '${client.name}',`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkClientName();
