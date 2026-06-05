/**
 * WebSocket Integration Test
 * Tests real-time location broadcasting from driver to admin
 */

const io = require('socket.io-client');
const jwt = require('jsonwebtoken');
const http = require('http');

const JWT_SECRET = 'your-jwt-secret-key';
const BACKEND_URL = 'http://localhost:3000';

const testUsers = {
  driver1: {
    sub: 'auth0|test-driver-1',
    email: 'driver1@drivewize.com',
    name: 'John Smith',
    'https://drivewize.com/role': 'driver',
    role: 'driver'
  },
  admin1: {
    sub: 'auth0|test-admin-1',
    email: 'admin@drivewize.com',
    name: 'Admin User',
    'https://drivewize.com/role': 'admin',
    role: 'admin'
  },
};

function generateAuth0Token(userKey) {
  return jwt.sign(testUsers[userKey], JWT_SECRET, { expiresIn: '24h' });
}

function makeRequest(method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BACKEND_URL);
    const options = { method, headers: { 'Content-Type': 'application/json', ...headers } };
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getBackendToken(userKey) {
  const auth0Token = generateAuth0Token(userKey);
  const response = await makeRequest('POST', '/api/auth/login', {}, { auth0Token });
  return response.status === 200 && response.body.success ? response.body.data.token : null;
}

function connectWebSocket(token, userType) {
  return new Promise((resolve, reject) => {
    const socket = io(BACKEND_URL, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });

    socket.on('connect', () => {
      console.log(`✓ ${userType} WebSocket connected`);
      resolve(socket);
    });

    socket.on('connect_error', (err) => {
      console.error(`✗ ${userType} WebSocket connection error:`, err.message);
      reject(err);
    });

    setTimeout(() => reject(new Error(`${userType} connection timeout`)), 5000);
  });
}

async function runWebSocketTests() {
  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('║   WebSocket Integration Test Suite                   ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');

  let passed = 0, failed = 0;
  const results = [];

  try {
    // Get tokens
    console.log('1. Obtaining authentication tokens...');
    const driverToken = await getBackendToken('driver1');
    const adminToken = await getBackendToken('admin1');

    if (!driverToken || !adminToken) {
      console.error('❌ Failed to obtain tokens');
      return;
    }
    console.log('✓ Tokens obtained\n');
    passed++;

    // Connect driver
    console.log('2. Connecting driver WebSocket...');
    const driverSocket = await connectWebSocket(driverToken, 'Driver');
    passed++;

    // Connect admin
    console.log('3. Connecting admin WebSocket...');
    const adminSocket = await connectWebSocket(adminToken, 'Admin');
    passed++;

    // Wait for authentication
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Test location broadcast
    console.log('\n4. Testing location broadcast (driver → admin)...');

    const locationReceived = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Location broadcast timeout'));
      }, 10000);

      adminSocket.on('location:broadcast', (data) => {
        clearTimeout(timeout);
        console.log('✓ Admin received location broadcast:', {
          driverId: data.driverId,
          lat: data.latitude,
          lng: data.longitude,
        });
        passed++;
        resolve(data);
      });
    });

    // Driver sends location
    const testLocation = {
      latitude: 37.7749,
      longitude: -122.4194,
      accuracy: 10,
      speed: 25,
      heading: 180,
      timestamp: new Date().toISOString(),
    };

    driverSocket.emit('location:update', testLocation);
    console.log('✓ Driver sent location update');
    passed++;

    // Wait for broadcast
    await locationReceived;

    // Test driver status change
    console.log('\n5. Testing driver status change broadcast...');

    const statusReceived = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Status change timeout'));
      }, 5000);

      adminSocket.on('driver:status_change', (data) => {
        clearTimeout(timeout);
        console.log('✓ Admin received status change:', {
          driverId: data.driverId,
          status: data.status,
        });
        passed++;
        resolve(data);
      });
    });

    driverSocket.emit('driver:status', { status: 'active' });
    console.log('✓ Driver changed status to active');
    passed++;

    await statusReceived;

    // Test reconnection
    console.log('\n6. Testing WebSocket reconnection...');
    driverSocket.disconnect();
    console.log('✓ Driver disconnected');
    passed++;

    await new Promise(resolve => setTimeout(resolve, 1000));

    const reconnectedSocket = await connectWebSocket(driverToken, 'Driver (reconnected)');
    console.log('✓ Driver reconnected successfully');
    passed++;

    // Cleanup
    reconnectedSocket.disconnect();
    adminSocket.disconnect();
    console.log('\n✓ Cleaned up connections');
    passed++;

    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log(`║   WebSocket Tests: ${passed} passed, ${failed} failed${' '.repeat(Math.max(0, 18 - passed.toString().length - failed.toString().length))}║`);
    console.log('╚═══════════════════════════════════════════════════════╝\n');

  } catch (error) {
    console.error('\n❌ WebSocket test failed:', error.message);
    failed++;

    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log(`║   WebSocket Tests: ${passed} passed, ${failed} failed${' '.repeat(Math.max(0, 18 - passed.toString().length - failed.toString().length))}║`);
    console.log('╚═══════════════════════════════════════════════════════╝\n');
  }

  process.exit(failed > 0 ? 1 : 0);
}

runWebSocketTests();
