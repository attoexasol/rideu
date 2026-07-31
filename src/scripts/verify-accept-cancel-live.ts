/**
 * Live verify accept/cancel do not hang and return within timeout.
 */
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import postgres from 'postgres';
import { randomUUID } from 'crypto';

const BASE = process.env.LIVE_TEST_BASE_URL || 'http://103.208.181.253:3000';
const DRIVER_ID = process.env.DIAG_DRIVER_ID || '281b0d60-71c9-45e3-abcd-0d7c6a590c37';
const TIMEOUT_MS = 15000;

interface ApiJson {
  data?: any;
  error?: { code?: string };
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
    ),
  ]);
}

async function getCustomerToken(sql: postgres.Sql) {
  const rows = await sql`SELECT id, auth0_id, email, name FROM customers WHERE status = 'active' LIMIT 1`;
  const c = rows[0];
  const token = jwt.sign(
    {
      userId: c.id,
      auth0Id: c.auth0_id,
      name: c.name,
      email: c.email,
      role: 'customer',
      userType: 'customer',
      sessionId: `accept_cancel_${Date.now()}`,
      permissions: [],
    },
    process.env.JWT_SECRET!,
    { expiresIn: '1h', algorithm: 'HS256' }
  );
  return { token, customerId: c.id };
}

async function getDriverToken(sql: postgres.Sql) {
  const rows = await sql`SELECT id, auth0_id, email, name FROM drivers WHERE id = ${DRIVER_ID}::uuid LIMIT 1`;
  const d = rows[0];
  const token = jwt.sign(
    {
      userId: d.id,
      auth0Id: d.auth0_id,
      name: d.name,
      email: d.email,
      role: 'driver',
      userType: 'driver',
      sessionId: `accept_cancel_drv_${Date.now()}`,
      permissions: [],
    },
    process.env.JWT_SECRET!,
    { expiresIn: '1h', algorithm: 'HS256' }
  );
  return { token, driverId: d.id };
}

async function request(
  method: string,
  path: string,
  token: string,
  body?: unknown,
  extraHeaders?: Record<string, string>
) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({}))) as ApiJson;
  return { status: res.status, json };
}

async function main() {
  if (!process.env.JWT_SECRET || !process.env.DATABASE_URL) {
    console.log(JSON.stringify({ ok: false, reason: 'missing env' }, null, 2));
    process.exit(1);
  }

  const sql = postgres(process.env.DATABASE_URL);
  const results: Record<string, unknown> = { baseUrl: BASE };

  try {
    const { token: customerToken } = await getCustomerToken(sql);
    const { token: driverToken } = await getDriverToken(sql);

    const quote = await withTimeout(
      request('POST', '/api/v1/passenger/bookings/quote', customerToken, {
        pickup: { latitude: 23.8103, longitude: 90.4125, address: 'Dhaka pickup' },
        dropoff: { latitude: 23.7527, longitude: 90.3818, address: 'Square Hospital' },
        stops: [],
      }),
      'quote'
    );
    const serviceCategoryId = quote.json?.data?.quotes?.[0]?.serviceCategoryId;
    if (!serviceCategoryId) {
      results.ok = false;
      results.reason = 'no_quote';
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    const create = await withTimeout(
      request(
        'POST',
        '/api/v1/passenger/bookings',
        customerToken,
        {
          serviceCategoryId,
          pickup: { latitude: 23.8103, longitude: 90.4125, address: 'Dhaka pickup', spotLabel: null },
          dropoff: { latitude: 23.7527, longitude: 90.3818, address: 'Square Hospital', placeId: null },
          stops: [],
          paymentMethodCode: 'cash',
          schedulingType: 'instant',
        },
        { 'Idempotency-Key': randomUUID() }
      ),
      'create_booking'
    );

    const bookingId = create.json?.data?.id;
    results.create = { status: create.status, bookingId, bookingStatus: create.json?.data?.status };
    if (!bookingId) {
      results.ok = false;
      results.reason = 'create_failed';
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    await new Promise((r) => setTimeout(r, 2000));

    const offers = await withTimeout(
      request('GET', '/api/v1/driver/bookings/offers/pending', driverToken),
      'pending_offers'
    );
    const offerId = offers.json?.data?.[0]?.offerId;
    results.pendingOffers = { status: offers.status, count: offers.json?.data?.length ?? 0, offerId };

    const accept = await withTimeout(
      request('POST', `/api/v1/driver/bookings/${bookingId}/accept`, driverToken, { offerId }),
      'driver_accept'
    );
    results.accept = {
      status: accept.status,
      code: accept.json?.error?.code,
      bookingStatus: accept.json?.data?.booking?.status ?? accept.json?.data?.status,
    };

    const cancelAfterAccept = await withTimeout(
      request('POST', `/api/v1/passenger/bookings/${bookingId}/cancel`, customerToken, {
        reasonCode: 'changed_mind',
        reason: 'live test cancel after accept',
      }),
      'passenger_cancel_after_accept'
    );
    results.cancelAfterAccept = {
      status: cancelAfterAccept.status,
      code: cancelAfterAccept.json?.error?.code,
      bookingStatus: cancelAfterAccept.json?.data?.status,
    };

    const active = await withTimeout(
      request('GET', '/api/v1/passenger/bookings/active', customerToken),
      'active_after_cancel'
    );
    results.activeAfterCancel = {
      status: active.status,
      dataIsNull: active.json?.data === null,
    };

    results.ok =
      create.status === 201 &&
      accept.status === 200 &&
      (results.accept as any).bookingStatus === 'driver_en_route' &&
      cancelAfterAccept.status === 200 &&
      (results.cancelAfterAccept as any).bookingStatus === 'cancelled';
  } catch (e) {
    results.ok = false;
    results.error = e instanceof Error ? e.message : String(e);
  } finally {
    await sql.end();
  }

  console.log(JSON.stringify(results, null, 2));
}

main();
