/**
 * Backend API Testing Script
 * Tests all API endpoints with authentication
 */

const jwt = require('jsonwebtoken');
const http = require('http');

const JWT_SECRET = 'your-jwt-secret-key';
const BASE_URL = 'http://localhost:3000';

// Test users from seed data
const testUsers = {
  driver1: {
    sub: 'auth0|test-driver-1',
    email: 'driver1@drivewize.com',
    name: 'John Smith',
    'https://drivewize.com/role': 'driver',
    role: 'driver',
  },
  admin1: {
    sub: 'auth0|test-admin-1',
    email: 'admin@drivewize.com',
    name: 'Admin User',
    'https://drivewize.com/role': 'admin',
    role: 'admin',
  },
};

// Generate Auth0-like token
function generateAuth0Token(userKey) {
  return jwt.sign(testUsers[userKey], JWT_SECRET, { expiresIn: '24h' });
}

// Make HTTP request
function makeRequest(method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data ? JSON.parse(data) : null,
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data,
          });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Test login and get backend JWT token
async function testLogin(userKey) {
  console.log(`\n=== Testing Login for ${userKey} ===`);
  const auth0Token = generateAuth0Token(userKey);

  const response = await makeRequest('POST', '/api/auth/login', {}, {
    auth0Token,
  });

  console.log(`Status: ${response.status}`);
  console.log(`Body:`, JSON.stringify(response.body, null, 2));

  if (response.status === 200 && response.body.success) {
    return response.body.data.token;
  }
  return null;
}

// Test authenticated endpoint
async function testAuthenticatedEndpoint(method, path, token, body = null) {
  const response = await makeRequest(method, path, {
    Authorization: `Bearer ${token}`,
  }, body);

  return response;
}

// Main test flow
async function runTests() {
  console.log('╔═══════════════════════════════════════╗');
  console.log('║   Backend API Validation Tests        ║');
  console.log('╚═══════════════════════════════════════╝');

  try {
    // Test 1: Login as driver
    const driverToken = await testLogin('driver1');
    if (!driverToken) {
      console.error('❌ Driver login failed');
      return;
    }
    console.log('✓ Driver login successful');

    // Test 2: Login as admin
    const adminToken = await testLogin('admin1');
    if (!adminToken) {
      console.error('❌ Admin login failed');
      return;
    }
    console.log('✓ Admin login successful');

    // Test 3: Test /api/auth/me with driver token
    console.log('\n=== Testing /api/auth/me (Driver) ===');
    let response = await testAuthenticatedEndpoint('GET', '/api/auth/me', driverToken);
    console.log(`Status: ${response.status}`);
    console.log(`Body:`, JSON.stringify(response.body, null, 2));

    // Test 4: Test /api/drivers (Admin)
    console.log('\n=== Testing GET /api/drivers (Admin) ===');
    response = await testAuthenticatedEndpoint('GET', '/api/drivers', adminToken);
    console.log(`Status: ${response.status}`);
    console.log(`Body:`, JSON.stringify(response.body, null, 2));

    // Test 5: Test /api/drivers without auth (expect 401)
    console.log('\n=== Testing GET /api/drivers (No Auth - Expect 401) ===');
    response = await makeRequest('GET', '/api/drivers');
    console.log(`Status: ${response.status}`);
    console.log(`Body:`, JSON.stringify(response.body, null, 2));

    // Save tokens to file for manual testing
    const fs = require('fs');
    fs.writeFileSync('/tmp/test_tokens.json', JSON.stringify({
      driverToken,
      adminToken,
      driverAuth0Token: generateAuth0Token('driver1'),
      adminAuth0Token: generateAuth0Token('admin1'),
    }, null, 2));

    console.log('\n✓ Tokens saved to /tmp/test_tokens.json');
    console.log('\n╔═══════════════════════════════════════╗');
    console.log('║   Tests Complete                       ║');
    console.log('╚═══════════════════════════════════════╝\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

runTests();
