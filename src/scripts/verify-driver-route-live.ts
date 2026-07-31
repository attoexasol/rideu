/**
 * Live verify driver route contract on a real booking.
 * Does not print JWTs.
 */
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import postgres from 'postgres';
import { randomUUID } from 'crypto';

const BASE = process.env.LIVE_TEST_BASE_URL || 'http://127.0.0.1:3000';
const DRIVER_ID = process.env.DIAG_DRIVER_ID || '281b0d60-71c9-45e3-abcd-0d7c6a590c37';
const TIMEOUT_MS = 20000;
const RIDE_CATEGORY_ID = '59ab7ef9-0bb3-47c8-8afa-3313b295151e';

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
  const json = (await res.json().catch(() => ({}))) as any;
  return { status: res.status, json };
}

function sign(payload: Record<string, unknown>) {
  return jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: '1h',
    algorithm: 'HS256',
  });
}

function assertRoute(route: any, label: string, report: Record<string, unknown>) {
  const ok =
    route &&
    typeof route.encodedPolyline === 'string' &&
    route.encodedPolyline.length > 0 &&
    typeof route.distanceMeters === 'number' &&
    typeof route.durationSeconds === 'number' &&
    route.bounds?.southwest?.latitude != null &&
    route.bounds?.northeast?.latitude != null;
  report[label] = {
    ok,
    hasPolyline: Boolean(route?.encodedPolyline),
    polylineLength: route?.encodedPolyline?.length ?? 0,
    distanceMeters: route?.distanceMeters ?? null,
    durationSeconds: route?.durationSeconds ?? null,
    hasBounds: Boolean(route?.bounds),
    hasLegacyKm: route?.distanceKm != null,
    hasLegacyMin: route?.durationMin != null,
  };
  return ok;
}

async function main() {
  const report: Record<string, unknown> = { baseUrl: BASE };
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, connect_timeout: 15 });

  try {
    const customers = await sql`
      SELECT id, auth0_id, email, name FROM customers WHERE status = 'active' LIMIT 1
    `;
    const drivers = await sql`
      SELECT id, auth0_id, email, name, active_session_id, active_device_id
      FROM drivers WHERE id = ${DRIVER_ID}::uuid LIMIT 1
    `;
    const customer = customers[0];
    const driver = drivers[0];
    if (!customer || !driver) {
      report.ok = false;
      report.reason = 'missing_customer_or_driver';
      console.log(JSON.stringify(report, null, 2));
      process.exit(1);
    }

    const customerToken = sign({
      userId: customer.id,
      auth0Id: customer.auth0_id,
      name: customer.name,
      email: customer.email,
      role: 'customer',
      userType: 'customer',
      sessionId: `route_trace_cust_${Date.now()}`,
      permissions: [],
    });
    const driverToken = sign({
      userId: driver.id,
      auth0Id: driver.auth0_id,
      name: driver.name,
      email: driver.email,
      role: 'driver',
      userType: 'driver',
      sessionId: driver.active_session_id || `route_trace_drv_${Date.now()}`,
      permissions: [],
    });
    const driverHeaders = {
      'X-Device-Id': driver.active_device_id || 'route-trace-device',
    };

    // Cleanup actives
    const actives = await sql`
      SELECT id FROM bookings
      WHERE customer_id = ${customer.id}::uuid
        AND status IN ('searching','offered','scheduled','accepted','driver_en_route','arrived','in_progress','quoted')
    `;
    for (const row of actives) {
      await request('POST', `/api/v1/passenger/bookings/${row.id}/cancel`, customerToken, {
        reasonCode: 'changed_mind',
        reason: 'route verify cleanup',
      }).catch(() => null);
    }

    const loc = await sql`
      SELECT latitude, longitude FROM locations
      WHERE driver_id = ${DRIVER_ID}::uuid
      ORDER BY timestamp DESC LIMIT 1
    `;
    const pickup = {
      latitude: loc[0] ? parseFloat(String(loc[0].latitude)) : 23.8103,
      longitude: loc[0] ? parseFloat(String(loc[0].longitude)) : 90.4125,
      address: 'Route verify pickup',
      spotLabel: null,
    };
    const dropoff = {
      latitude: 23.7527,
      longitude: 90.3818,
      address: 'Square Hospital',
      placeId: null,
    };

    await sql`UPDATE drivers SET status = 'online', updated_at = NOW() WHERE id = ${DRIVER_ID}::uuid`;
    await request(
      'POST',
      '/api/locations',
      driverToken,
      {
        latitude: pickup.latitude,
        longitude: pickup.longitude,
        heading: 0,
        speed: 0,
        accuracy: 10,
        timestamp: new Date().toISOString(),
      },
      driverHeaders
    ).catch(() => null);

    const create = await request(
      'POST',
      '/api/v1/passenger/bookings',
      customerToken,
      {
        serviceCategoryId: RIDE_CATEGORY_ID,
        pickup,
        dropoff,
        stops: [],
        paymentMethodCode: 'cash',
        schedulingType: 'instant',
      },
      { 'Idempotency-Key': randomUUID() }
    );

    const bookingId = create.json?.data?.id as string | undefined;
    report.createStatus = create.status;
    report.bookingId = bookingId ?? null;
    if (!bookingId) {
      report.ok = false;
      report.reason = 'create_failed';
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    const row = await sql`
      SELECT route_encoded_polyline, estimated_distance_km, estimated_duration_min
      FROM bookings WHERE id = ${bookingId}::uuid
    `;
    report.dbHasPolyline = Boolean(row[0]?.route_encoded_polyline);
    report.dbPolylineLength = row[0]?.route_encoded_polyline?.length ?? 0;
    report.dbDistanceKm = row[0]?.estimated_distance_km ?? null;
    report.dbDurationMin = row[0]?.estimated_duration_min ?? null;

    let offerId: string | null = null;
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 800));
      const offers = await request(
        'GET',
        '/api/v1/driver/bookings/offers/pending',
        driverToken,
        undefined,
        driverHeaders
      );
      const match = (offers.json?.data ?? []).find((o: any) => o.bookingId === bookingId);
      if (match) {
        offerId = match.offerId;
        report.pendingOfferRoute = assertRoute(match.route, 'pendingOfferRouteOk', report);
        break;
      }
    }

    if (offerId) {
      const offerDetail = await request(
        'GET',
        `/api/v1/driver/bookings/offers/${offerId}`,
        driverToken,
        undefined,
        driverHeaders
      );
      assertRoute(offerDetail.json?.data?.route, 'offerDetailRoute', report);
    }

    const accept = await request(
      'POST',
      `/api/v1/driver/bookings/${bookingId}/accept`,
      driverToken,
      offerId ? { offerId } : {},
      driverHeaders
    );
    report.acceptStatus = accept.status;
    const acceptRoute =
      accept.json?.data?.booking?.route ?? accept.json?.data?.route;
    assertRoute(acceptRoute, 'acceptRoute', report);

    const active1 = await request(
      'GET',
      '/api/v1/driver/bookings/active',
      driverToken,
      undefined,
      driverHeaders
    );
    const activeRoute = active1.json?.data?.booking?.route;
    assertRoute(activeRoute, 'activeRoute1', report);

    const detail = await request(
      'GET',
      `/api/v1/driver/bookings/${bookingId}`,
      driverToken,
      undefined,
      driverHeaders
    );
    assertRoute(detail.json?.data?.booking?.route, 'detailRoute', report);

    const active2 = await request(
      'GET',
      '/api/v1/driver/bookings/active',
      driverToken,
      undefined,
      driverHeaders
    );
    const activeRoute2 = active2.json?.data?.booking?.route;
    assertRoute(activeRoute2, 'activeRoute2', report);

    report.polylineStableAcrossRefresh =
      activeRoute?.encodedPolyline &&
      activeRoute?.encodedPolyline === activeRoute2?.encodedPolyline &&
      activeRoute?.encodedPolyline === acceptRoute?.encodedPolyline;

    report.sameAsDb =
      row[0]?.route_encoded_polyline &&
      acceptRoute?.encodedPolyline === row[0].route_encoded_polyline;

    // Unauthorized-driver case covered by getDriverBookingDetailForDriver unit tests
    report.unauthorizedNote =
      'authorization enforced in getDriverBookingDetailForDriver (unit-tested)';

    await request('POST', `/api/v1/passenger/bookings/${bookingId}/cancel`, customerToken, {
      reasonCode: 'changed_mind',
      reason: 'route verify cleanup',
    }).catch(() => null);

    const checks = [
      report.dbHasPolyline,
      report.acceptStatus === 200,
      (report.acceptRoute as any)?.ok,
      (report.activeRoute1 as any)?.ok,
      (report.detailRoute as any)?.ok,
      report.polylineStableAcrossRefresh,
      report.sameAsDb,
    ];
    report.ok = checks.every(Boolean);
    report.finalStatus = report.ok
      ? 'READY FOR DRIVER REAL ROUTE QA'
      : 'ROUTE DATA STORAGE GAP';
  } catch (e) {
    report.ok = false;
    report.finalStatus = 'ROUTE DATA STORAGE GAP';
    report.error = e instanceof Error ? e.message : String(e);
  } finally {
    await sql.end({ timeout: 5 });
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main();
