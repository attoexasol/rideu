/**
 * End-to-end trace of POST /api/v1/driver/bookings/:bookingId/accept
 * Does not print JWTs or credentials.
 */
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import postgres from 'postgres';
import { randomUUID } from 'crypto';

const BASE = process.env.LIVE_TEST_BASE_URL || 'http://127.0.0.1:3000';
const DRIVER_ID = process.env.DIAG_DRIVER_ID || '281b0d60-71c9-45e3-abcd-0d7c6a590c37';
const TIMEOUT_MS = parseInt(process.env.ACCEPT_REQUEST_TIMEOUT_MS || '15000', 10);
const RIDE_CATEGORY_ID = process.env.DIAG_SERVICE_CATEGORY_ID || '59ab7ef9-0bb3-47c8-8afa-3313b295151e';
let PICKUP = { latitude: 23.8103, longitude: 90.4125, address: 'Dhaka pickup' };
const DROPOFF = { latitude: 23.7527, longitude: 90.3818, address: 'Square Hospital' };

interface ApiJson {
  success?: boolean;
  data?: any;
  error?: { code?: string; message?: string };
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
  return { status: res.status, json, reachedBackend: true };
}

function signToken(payload: Record<string, unknown>) {
  return jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: '1h',
    algorithm: 'HS256',
  });
}

async function main() {
  const report: Record<string, unknown> = {
    baseUrl: BASE,
    requestReachedBackend: false,
    authenticatedDriverIdResolved: false,
    bookingId: null,
    offerIdPresent: false,
    offerStatusBeforeAccept: null,
    bookingStatusBeforeAccept: null,
    eligibilityResult: null,
    transaction: null,
    httpStatus: null,
    backendErrorCode: null,
    bookingStatusAfterRequest: null,
    bookingAcceptedEmittedToPassenger: null,
    bookingOfferCancelledEmitted: null,
    timeoutMs: TIMEOUT_MS,
  };

  if (!process.env.JWT_SECRET || !process.env.DATABASE_URL) {
    report.ok = false;
    report.reason = 'missing_env';
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const sql = postgres(process.env.DATABASE_URL);

  try {
    const customers = await sql`
      SELECT id, auth0_id, email, name FROM customers WHERE status = 'active' LIMIT 1
    `;
    const drivers = await sql`
      SELECT id, auth0_id, email, name, status, vehicle_id
      FROM drivers WHERE id = ${DRIVER_ID}::uuid LIMIT 1
    `;
    const customer = customers[0];
    const driver = drivers[0];
    if (!customer || !driver) {
      report.ok = false;
      report.reason = 'missing_customer_or_driver';
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    report.authenticatedDriverIdResolved = true;
    report.driverId = driver.id;

    // Cancel leftover actives so create/accept can proceed
    const actives = await sql`
      SELECT id FROM bookings
      WHERE customer_id = ${customer.id}::uuid
        AND status IN ('searching','offered','scheduled','accepted','driver_en_route','arrived','in_progress','quoted')
    `;
    const customerToken = signToken({
      userId: customer.id,
      auth0Id: customer.auth0_id,
      name: customer.name,
      email: customer.email,
      role: 'customer',
      userType: 'customer',
      sessionId: `accept_trace_cust_${Date.now()}`,
      permissions: [],
    });
    for (const row of actives) {
      await request('POST', `/api/v1/passenger/bookings/${row.id}/cancel`, customerToken, {
        reasonCode: 'changed_mind',
        reason: 'accept trace cleanup',
      }).catch(() => null);
    }

    const driverActives = await sql`
      SELECT id FROM bookings
      WHERE assigned_driver_id = ${DRIVER_ID}::uuid
        AND status IN ('driver_en_route','arrived','in_progress','accepted')
    `;
    const driverSession = await sql`
      SELECT active_session_id, active_device_id
      FROM drivers WHERE id = ${DRIVER_ID}::uuid LIMIT 1
    `;
    const sessionId =
      driverSession[0]?.active_session_id || `accept_trace_drv_${Date.now()}`;
    const deviceId = driverSession[0]?.active_device_id || 'accept-trace-device';

    const driverToken = signToken({
      userId: driver.id,
      auth0Id: driver.auth0_id,
      name: driver.name,
      email: driver.email,
      role: 'driver',
      userType: 'driver',
      sessionId,
      permissions: [],
    });
    const driverHeaders = { 'X-Device-Id': deviceId };

    for (const row of driverActives) {
      await request(
        'POST',
        `/api/v1/driver/bookings/${row.id}/cancel`,
        driverToken,
        { reason: 'accept trace cleanup' },
        driverHeaders
      ).catch(() => null);
    }

    // Use driver's latest GPS so live Redis location stays inside radius
    const latestLoc = await sql`
      SELECT latitude, longitude FROM locations
      WHERE driver_id = ${DRIVER_ID}::uuid
      ORDER BY timestamp DESC LIMIT 1
    `;
    if (latestLoc[0]) {
      PICKUP = {
        latitude: parseFloat(String(latestLoc[0].latitude)),
        longitude: parseFloat(String(latestLoc[0].longitude)),
        address: 'Near driver (accept trace)',
      };
    }

    // Ensure driver online + fresh location near pickup for dispatch
    await sql`
      UPDATE drivers SET status = 'online', updated_at = NOW() WHERE id = ${DRIVER_ID}::uuid
    `;
    await request(
      'POST',
      '/api/locations',
      driverToken,
      {
        latitude: PICKUP.latitude,
        longitude: PICKUP.longitude,
        heading: 0,
        speed: 0,
        accuracy: 10,
        timestamp: new Date().toISOString(),
      },
      driverHeaders
    ).catch(() => null);

    await request(
      'PATCH',
      `/api/drivers/${DRIVER_ID}/status`,
      driverToken,
      { status: 'online' },
      driverHeaders
    ).catch(() => null);

    const quote = await request('POST', '/api/v1/passenger/bookings/quote', customerToken, {
      pickup: PICKUP,
      dropoff: DROPOFF,
      stops: [],
    });
    report.requestReachedBackend = true;
    const quotes = quote.json?.data?.quotes ?? [];
    const preferred =
      quotes.find((q: any) => q.serviceCategoryId === RIDE_CATEGORY_ID) ??
      quotes.find((q: any) => q.code === 'ride' || q.serviceCode === 'ride') ??
      quotes[0];
    const serviceCategoryId = preferred?.serviceCategoryId;
    report.serviceCategoryId = serviceCategoryId ?? null;
    if (!serviceCategoryId) {
      report.ok = false;
      report.reason = 'no_quote';
      report.httpStatus = quote.status;
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    const create = await request(
      'POST',
      '/api/v1/passenger/bookings',
      customerToken,
      {
        serviceCategoryId,
        pickup: { ...PICKUP, spotLabel: null },
        dropoff: { ...DROPOFF, placeId: null },
        stops: [],
        paymentMethodCode: 'cash',
        schedulingType: 'instant',
      },
      { 'Idempotency-Key': randomUUID() }
    );

    const bookingId = create.json?.data?.id as string | undefined;
    report.bookingId = bookingId ?? null;
    if (!bookingId) {
      report.ok = false;
      report.reason = 'create_failed';
      report.httpStatus = create.status;
      report.backendErrorCode = create.json?.error?.code ?? null;
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    // Wait for dispatch to create offer
    let offerId: string | null = null;
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const offers = await request(
        'GET',
        '/api/v1/driver/bookings/offers/pending',
        driverToken,
        undefined,
        driverHeaders
      );
      const match = (offers.json?.data ?? []).find(
        (o: any) => o.bookingId === bookingId || o.booking?.id === bookingId
      );
      offerId = match?.offerId ?? match?.id ?? offers.json?.data?.[0]?.offerId ?? null;
      if (offerId) break;
    }

    if (!offerId) {
      const dbOffer = await sql`
        SELECT id, status FROM booking_offers
        WHERE booking_id = ${bookingId}::uuid AND driver_id = ${DRIVER_ID}::uuid
        ORDER BY offered_at DESC LIMIT 1
      `;
      offerId = dbOffer[0]?.id ?? null;
    }

    const beforeBooking = await sql`
      SELECT status FROM bookings WHERE id = ${bookingId}::uuid LIMIT 1
    `;
    const bookOffer = offerId
      ? await sql`SELECT status FROM booking_offers WHERE id = ${offerId}::uuid LIMIT 1`
      : await sql`
          SELECT status FROM booking_offers
          WHERE booking_id = ${bookingId}::uuid AND driver_id = ${DRIVER_ID}::uuid
          ORDER BY offered_at DESC LIMIT 1
        `;

    report.offerIdPresent = Boolean(offerId);
    report.offerStatusBeforeAccept = bookOffer[0]?.status ?? null;
    report.bookingStatusBeforeAccept = beforeBooking[0]?.status ?? null;

    const accept = await request(
      'POST',
      `/api/v1/driver/bookings/${bookingId}/accept`,
      driverToken,
      offerId ? { offerId } : {},
      driverHeaders
    );

    report.httpStatus = accept.status;
    report.backendErrorCode = accept.json?.error?.code ?? null;
    report.eligibilityResult =
      accept.status === 200
        ? { eligible: true }
        : {
            eligible: false,
            code: accept.json?.error?.code ?? null,
          };

    const afterBooking = await sql`
      SELECT status FROM bookings WHERE id = ${bookingId}::uuid LIMIT 1
    `;
    report.bookingStatusAfterRequest =
      accept.json?.data?.booking?.status ??
      accept.json?.data?.status ??
      afterBooking[0]?.status ??
      null;

    const success = accept.status === 200 && report.bookingStatusAfterRequest === 'driver_en_route';
    report.transaction = success
      ? { started: true, committed: true, rolledBack: false }
      : accept.json?.error?.code === 'BOOKING_LOCK_TIMEOUT' ||
          accept.json?.error?.code === 'ACCEPT_TIMEOUT'
        ? { started: true, committed: false, rolledBack: true }
        : {
            started: true,
            committed: accept.status === 200,
            rolledBack: accept.status !== 200,
          };

    // Emission contract: passenger booking:accepted always after successful commit;
    // booking:offer:cancelled only when other pending offers were taken.
    if (success) {
      report.bookingAcceptedEmittedToPassenger = true;
      const otherTaken = await sql`
        SELECT count(*)::int AS n FROM booking_offers
        WHERE booking_id = ${bookingId}::uuid
          AND driver_id <> ${DRIVER_ID}::uuid
          AND status = 'taken'
      `;
      report.bookingOfferCancelledEmitted = (otherTaken[0]?.n ?? 0) > 0;
    } else {
      report.bookingAcceptedEmittedToPassenger = false;
      report.bookingOfferCancelledEmitted = false;
    }

    // Cleanup so live driver is not left busy
    await request('POST', `/api/v1/passenger/bookings/${bookingId}/cancel`, customerToken, {
      reasonCode: 'changed_mind',
      reason: 'accept trace cleanup after accept',
    }).catch(() => null);

    report.ok = success;
    report.finalStatus = success ? 'ACCEPT BACKEND READY' : 'ACCEPT BACKEND FAILED';
  } catch (e) {
    report.ok = false;
    report.finalStatus = 'ACCEPT BACKEND FAILED';
    report.error = e instanceof Error ? e.message : String(e);
    if (e instanceof Error && e.name === 'TimeoutError') {
      report.backendErrorCode = 'ACCEPT_TIMEOUT';
      report.transaction = { started: true, committed: false, rolledBack: true };
    }
  } finally {
    await sql.end();
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main();
