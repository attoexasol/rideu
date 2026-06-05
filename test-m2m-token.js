const axios = require('axios');
require('dotenv').config();

async function testM2MToken() {
  console.log('\n🔍 Testing M2M Application Token...\n');
  
  const clientId = process.env.AUTH0_MANAGEMENT_CLIENT_ID;
  const clientSecret = process.env.AUTH0_MANAGEMENT_CLIENT_SECRET;
  const domain = process.env.AUTH0_DOMAIN;
  
  console.log('Domain:', domain);
  console.log('Client ID:', clientId);
  console.log('');
  
  try {
    // Get access token
    const tokenResponse = await axios.post(`https://${domain}/oauth/token`, {
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      audience: `https://${domain}/api/v2/`
    });
    
    const accessToken = tokenResponse.data.access_token;
    console.log('✅ Successfully obtained access token');
    console.log('Token type:', tokenResponse.data.token_type);
    console.log('Expires in:', tokenResponse.data.expires_in, 'seconds');
    
    // Decode the token to see scopes (simple decode without verification)
    const tokenParts = accessToken.split('.');
    const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
    
    console.log('\n📋 Token Scopes:');
    if (payload.scope) {
      const scopes = payload.scope.split(' ');
      scopes.forEach(scope => console.log('  -', scope));
      
      // Check for required scopes
      const requiredScopes = ['create:users', 'read:users', 'update:users', 'update:users_app_metadata'];
      const missingScopes = requiredScopes.filter(s => !scopes.includes(s));
      
      if (missingScopes.length > 0) {
        console.log('\n⚠️  MISSING SCOPES:');
        missingScopes.forEach(scope => console.log('  ❌', scope));
        console.log('\nThe M2M application does NOT have the required scopes yet.');
        console.log('Please grant these scopes in Auth0 Dashboard and wait 1-2 minutes.');
      } else {
        console.log('\n✅ All required scopes are present!');
        console.log('You should be able to create users now.');
      }
    } else {
      console.log('  No scopes found in token');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

testM2MToken();
