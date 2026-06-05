/**
 * DriveWize Backend — Automated API Test Runner
 * Generates structured results for the API testing report.
 */
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import postgres from 'postgres';

const BASE = process.env.API_BASE_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-key';

interface TestResult {
  method: string;
  path: string;
  category: string;
  auth: string;
  status: number;
  pass: boolean;
  latencyMs: number;
  note?: string;
  errorCode?: string;
}

function makeToken(role: 'super_admin' | 'admin' | 'driver', auth0Id: string, email: string, name: string) {
  return jwt.sign(
    {
      sub: auth0Id,
      email,
      name,
      role,
      'https://drivewize.com/role': role,
      sessionId: `test_${Date.now()}`,
    },
    JWT_SECRET,
    { expiresIn: '1h', algorithm: 'HS256' }
  );
}

async function request(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; query?: Record<string, string>; headers?: Record<string, string> } = {}
): Promise<{ status: number; body: any; latencyMs: number }> {
  const url = new URL(path, BASE);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.body) headers['Content-Type'] = 'application/json';
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;

  const start = Date.now();
  const res = await fetch(url.toString(), {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const latencyMs = Date.now() - start;

  let body: any;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    body = await res.json();
  } else {
    body = await res.text();
  }
  return { status: res.status, body, latencyMs };
}

function record(
  results: TestResult[],
  category: string,
  method: string,
  path: string,
  auth: string,
  res: { status: number; body: any; latencyMs: number },
  expectedStatuses: number[],
  note?: string
) {
  const pass = expectedStatuses.includes(res.status);
  results.push({
    method,
    path,
    category,
    auth,
    status: res.status,
    pass,
    latencyMs: res.latencyMs,
    note,
    errorCode: res.body?.error?.code || (res.body?.status === 'error' ? 'ERROR' : undefined),
  });
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const results: TestResult[] = [];

  const [superAdmin] = await sql`
    SELECT id, auth0_id, email, name, role FROM admin_users WHERE role = 'super_admin' LIMIT 1
  `;
  const [admin] = await sql`
    SELECT id, auth0_id, email, name, role FROM admin_users WHERE role = 'admin' LIMIT 1
  `;
  const [driver] = await sql`
    SELECT id, auth0_id, email, name, status FROM drivers LIMIT 1
  `;

  const superToken = makeToken('super_admin', superAdmin.auth0_id, superAdmin.email, superAdmin.name);
  const adminToken = makeToken('admin', admin.auth0_id, admin.email, admin.name);
  const driverToken = makeToken('driver', driver.auth0_id, driver.email, driver.name);
  const driverId = driver.id as string;

  // --- Public ---
  record(results, 'System', 'GET', '/', 'none', await request('GET', '/'), [200]);
  record(results, 'System', 'GET', '/health', 'none', await request('GET', '/health'), [200]);

  // --- Auth (no token) ---
  record(results, 'Auth', 'GET', '/api/auth/me', 'none', await request('GET', '/api/auth/me'), [401], 'Should reject unauthenticated');
  record(results, 'Auth', 'POST', '/api/auth/login', 'none', await request('POST', '/api/auth/login', { body: {} }), [400], 'Missing auth0Token');
  record(results, 'Auth', 'POST', '/api/auth/refresh', 'none', await request('POST', '/api/auth/refresh', { body: {} }), [400], 'Missing refreshToken');
  record(results, 'Auth', 'POST', '/api/auth/refresh', 'none', await request('POST', '/api/auth/refresh', { body: { refreshToken: 'invalid' } }), [401], 'Invalid refresh token');

  // --- Auth (authenticated) ---
  record(results, 'Auth', 'GET', '/api/auth/me', 'super_admin', await request('GET', '/api/auth/me', { token: superToken }), [200]);
  record(results, 'Auth', 'GET', '/api/auth/validate-session', 'super_admin', await request('GET', '/api/auth/validate-session', { token: superToken }), [200]);
  record(results, 'Auth', 'POST', '/api/auth/logout', 'super_admin', await request('POST', '/api/auth/logout', { token: superToken }), [200]);

  // Re-create super token after logout
  const superToken2 = makeToken('super_admin', superAdmin.auth0_id, superAdmin.email, superAdmin.name);

  // --- Drivers ---
  record(results, 'Drivers', 'GET', '/api/drivers', 'none', await request('GET', '/api/drivers'), [401]);
  record(results, 'Drivers', 'GET', '/api/drivers', 'driver', await request('GET', '/api/drivers', { token: driverToken }), [403], 'Driver cannot list all');
  record(results, 'Drivers', 'GET', '/api/drivers', 'super_admin', await request('GET', '/api/drivers', { token: superToken2, query: { page: '1', limit: '5' } }), [200]);
  record(results, 'Drivers', 'GET', `/api/drivers/${driverId}`, 'super_admin', await request('GET', `/api/drivers/${driverId}`, { token: superToken2 }), [200]);
  record(results, 'Drivers', 'GET', '/api/drivers/me', 'driver', await request('GET', '/api/drivers/me', { token: driverToken }), [200]);
  record(results, 'Drivers', 'PATCH', `/api/drivers/${driverId}/status`, 'driver', await request('PATCH', `/api/drivers/${driverId}/status`, { token: driverToken, body: { status: 'online' } }), [200]);
  record(results, 'Drivers', 'POST', '/api/drivers', 'driver', await request('POST', '/api/drivers', { token: driverToken, body: { email: 'x@test.com', password: 'pass1234', name: 'X' } }), [403]);
  record(results, 'Drivers', 'POST', '/api/drivers', 'super_admin', await request('POST', '/api/drivers', { token: superToken2, body: { email: 'invalid' } }), [400], 'Validation error');

  // --- Locations ---
  record(results, 'Locations', 'GET', '/api/locations/active', 'super_admin', await request('GET', '/api/locations/active', { token: superToken2 }), [200]);
  record(results, 'Locations', 'GET', `/api/locations/${driverId}`, 'super_admin', await request('GET', `/api/locations/${driverId}`, { token: superToken2, query: { limit: '10' } }), [200]);
  record(results, 'Locations', 'GET', `/api/locations/${driverId}/today`, 'super_admin', await request('GET', `/api/locations/${driverId}/today`, { token: superToken2, query: { snapToRoads: 'false' } }), [200]);
  record(results, 'Locations', 'POST', '/api/locations', 'super_admin', await request('POST', '/api/locations', { token: superToken2, body: { latitude: 32.75, longitude: -117.14, timestamp: new Date().toISOString() } }), [403], 'Admin cannot submit location');
  record(results, 'Locations', 'POST', '/api/locations', 'driver', await request('POST', '/api/locations', { token: driverToken, body: { latitude: 32.754, longitude: -117.145, timestamp: new Date().toISOString() } }), [201, 200]);
  record(results, 'Locations', 'DELETE', '/api/locations/cleanup', 'driver', await request('DELETE', '/api/locations/cleanup', { token: driverToken }), [403]);

  // --- Trips ---
  record(results, 'Trips', 'GET', '/api/trips/me', 'driver', await request('GET', '/api/trips/me', { token: driverToken }), [200]);
  record(results, 'Trips', 'GET', `/api/trips/${driverId}`, 'super_admin', await request('GET', `/api/trips/${driverId}`, { token: superToken2 }), [200]);
  record(results, 'Trips', 'POST', '/api/trips', 'driver', await request('POST', '/api/trips', { token: driverToken, body: { startTime: new Date().toISOString() } }), [200, 201]);

  // --- Reports ---
  record(results, 'Reports', 'GET', '/api/reports/fleet', 'super_admin', await request('GET', '/api/reports/fleet', { token: superToken2 }), [200]);
  record(results, 'Reports', 'GET', `/api/reports/driver/${driverId}`, 'super_admin', await request('GET', `/api/reports/driver/${driverId}`, { token: superToken2 }), [200]);
  record(results, 'Reports', 'GET', '/api/reports/export', 'super_admin', await request('GET', '/api/reports/export', { token: superToken2, query: { type: 'csv', reportType: 'drivers' } }), [200]);
  record(results, 'Reports', 'GET', '/api/reports/export', 'driver', await request('GET', '/api/reports/export', { token: driverToken, query: { type: 'csv', reportType: 'drivers' } }), [403]);
  record(results, 'Reports', 'GET', '/api/reports/export', 'super_admin', await request('GET', '/api/reports/export', { token: superToken2, query: { type: 'pdf', reportType: 'drivers' } }), [501], 'PDF not implemented');

  // --- Admin users ---
  record(results, 'Admin', 'GET', '/api/admin/users', 'super_admin', await request('GET', '/api/admin/users', { token: superToken2, query: { limit: '10' } }), [200]);
  record(results, 'Admin', 'GET', '/api/admin/users', 'driver', await request('GET', '/api/admin/users', { token: driverToken }), [403]);
  record(results, 'Admin', 'POST', '/api/admin/users', 'admin', await request('POST', '/api/admin/users', { token: adminToken, body: { email: 'bad', password: 'short', role: 'driver', name: 'T' } }), [400], 'Validation');
  record(results, 'Admin', 'PATCH', `/api/admin/users/${admin.id}/role`, 'admin', await request('PATCH', `/api/admin/users/${admin.id}/role`, { token: adminToken, body: { role: 'super_admin' } }), [403], 'Only super_admin');
  record(results, 'Admin', 'PATCH', `/api/admin/users/${admin.id}/role`, 'super_admin', await request('PATCH', `/api/admin/users/${admin.id}/role`, { token: superToken2, body: { role: 'admin' } }), [200, 400], 'Role change rules');

  // --- 404 ---
  record(results, 'System', 'GET', '/api/nonexistent', 'none', await request('GET', '/api/nonexistent'), [404]);

  await sql.end();

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  const avgLatency = Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / results.length);

  const summary = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE,
    total: results.length,
    passed,
    failed,
    passRate: `${Math.round((passed / results.length) * 100)}%`,
    avgLatencyMs: avgLatency,
    testData: {
      superAdmin: superAdmin.email,
      admin: admin.email,
      driver: { id: driverId, name: driver.name },
    },
    results,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
