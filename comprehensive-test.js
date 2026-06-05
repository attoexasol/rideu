/**
 * Comprehensive Backend API Testing
 * Tests all critical endpoints quickly
 */

const jwt = require('jsonwebtoken');
const http = require('http');

const JWT_SECRET = 'your-jwt-secret-key';
const BASE_URL = 'http://localhost:3000';

const testUsers = {
  driver1: { sub: 'auth0|test-driver-1', email: 'driver1@drivewize.com', name: 'John Smith', 'https://drivewize.com/role': 'driver', role: 'driver' },
  admin1: { sub: 'auth0|test-admin-1', email: 'admin@drivewize.com', name: 'Admin User', 'https://drivewize.com/role': 'admin', role: 'admin' },
};

function generateAuth0Token(userKey) {
  return jwt.sign(testUsers[userKey], JWT_SECRET, { expiresIn: '24h' });
}

function makeRequest(method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = { method, headers: { 'Content-Type': 'application/json', ...headers } };
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : null });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function login(userKey) {
  const auth0Token = generateAuth0Token(userKey);
  const response = await makeRequest('POST', '/api/auth/login', {}, { auth0Token });
  return response.status === 200 && response.body.success ? response.body.data.token : null;
}

async function runTests() {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║   Comprehensive Backend Validation Test Suite        ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');

  let passed = 0, failed = 0;
  const failures = [];

  const test = async (name, fn) => {
    try {
      await fn();
      console.log(`✓ ${name}`);
      passed++;
    } catch (e) {
      console.log(`✗ ${name}: ${e.message}`);
      failures.push({ test: name, error: e.message });
      failed++;
    }
  };

  // Login
  const driverToken = await login('driver1');
  const adminToken = await login('admin1');
  if (!driverToken || !adminToken) {
    console.error('❌ Failed to obtain tokens');
    return;
  }

  // Auth endpoints
  await test('GET /api/auth/me (driver)', async () => {
    const r = await makeRequest('GET', '/api/auth/me', { Authorization: `Bearer ${driverToken}` });
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
  });

  await test('POST /api/auth/logout', async () => {
    const r = await makeRequest('POST', '/api/auth/logout', { Authorization: `Bearer ${driverToken}` });
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
  });

  // Driver endpoints
  await test('GET /api/drivers (admin)', async () => {
    const r = await makeRequest('GET', '/api/drivers', { Authorization: `Bearer ${adminToken}` });
    if (r.status !== 200 || !Array.isArray(r.body.data)) throw new Error(`Expected 200 with array, got ${r.status}`);
  });

  await test('GET /api/drivers?status=online', async () => {
    const r = await makeRequest('GET', '/api/drivers?status=online', { Authorization: `Bearer ${adminToken}` });
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
  });

  await test('GET /api/drivers/:id', async () => {
    const drivers = await makeRequest('GET', '/api/drivers', { Authorization: `Bearer ${adminToken}` });
    const driverId = drivers.body.data[0].id;
    const r = await makeRequest('GET', `/api/drivers/${driverId}`, { Authorization: `Bearer ${adminToken}` });
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
  });

  await test('PATCH /api/drivers/:id/status', async () => {
    const drivers = await makeRequest('GET', '/api/drivers', { Authorization: `Bearer ${adminToken}` });
    const driverId = drivers.body.data[0].id;
    const r = await makeRequest('PATCH', `/api/drivers/${driverId}/status`, { Authorization: `Bearer ${adminToken}` }, { status: 'idle' });
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
  });

  // Location endpoints
  await test('POST /api/locations (driver)', async () => {
    const r = await makeRequest('POST', '/api/locations', { Authorization: `Bearer ${driverToken}` }, {
      latitude: 37.7749,
      longitude: -122.4194,
      timestamp: new Date().toISOString()
    });
    if (r.status !== 200 && r.status !== 201) throw new Error(`Expected 200/201, got ${r.status}`);
  });

  await test('GET /api/locations/:driverId', async () => {
    const drivers = await makeRequest('GET', '/api/drivers', { Authorization: `Bearer ${adminToken}` });
    const driverId = drivers.body.data[0].id;
    const r = await makeRequest('GET', `/api/locations/${driverId}`, { Authorization: `Bearer ${adminToken}` });
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
  });

  await test('GET /api/locations/active', async () => {
    const r = await makeRequest('GET', '/api/locations/active', { Authorization: `Bearer ${adminToken}` });
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
  });

  // Trip endpoints
  await test('POST /api/trips (driver)', async () => {
    const r = await makeRequest('POST', '/api/trips', { Authorization: `Bearer ${driverToken}` }, {
      startTime: new Date().toISOString()
    });
    if (r.status !== 200 && r.status !== 201) throw new Error(`Expected 200/201, got ${r.status}`);
  });

  await test('GET /api/trips/:driverId', async () => {
    const drivers = await makeRequest('GET', '/api/drivers', { Authorization: `Bearer ${adminToken}` });
    const driverId = drivers.body.data[0].id;
    const r = await makeRequest('GET', `/api/trips/${driverId}`, { Authorization: `Bearer ${adminToken}` });
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
  });

  // Reports endpoints
  await test('GET /api/reports/fleet', async () => {
    const r = await makeRequest('GET', '/api/reports/fleet', { Authorization: `Bearer ${adminToken}` });
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
  });

  // Error handling tests
  await test('401 on missing token', async () => {
    const r = await makeRequest('GET', '/api/drivers');
    if (r.status !== 401) throw new Error(`Expected 401, got ${r.status}`);
  });

  await test('404 on invalid endpoint', async () => {
    const r = await makeRequest('GET', '/api/nonexistent', { Authorization: `Bearer ${adminToken}` });
    if (r.status !== 404) throw new Error(`Expected 404, got ${r.status}`);
  });

  // Summary
  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log(`║   Test Results: ${passed} passed, ${failed} failed${' '.repeat(Math.max(0, 21 - passed.toString().length - failed.toString().length))}║`);
  console.log('╚═══════════════════════════════════════════════════════╝\n');

  if (failures.length > 0) {
    console.log('Failures:');
    failures.forEach(f => console.log(`  - ${f.test}: ${f.error}`));
  }
}

runTests();
