/**
 * Verify driver active booking + video session after DVR schema fix.
 */
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import postgres from 'postgres';

const BASE = process.env.LIVE_TEST_BASE_URL || 'http://127.0.0.1:3000';
const DRIVER_ID = process.env.DIAG_DRIVER_ID || '281b0d60-71c9-45e3-abcd-0d7c6a590c37';

function signToken(payload: Record<string, unknown>) {
  return jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: '1h',
    algorithm: 'HS256',
  });
}

async function request(
  method: string,
  path: string,
  token: string,
  body?: unknown,
  headers?: Record<string, string>
) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: {
      booking?: { id?: string };
      video?: unknown;
      sessionId?: string;
    } | null;
  };
  return { status: res.status, json };
}

async function main() {
  if (!process.env.JWT_SECRET || !process.env.DATABASE_URL) {
    console.log(JSON.stringify({ ok: false, reason: 'missing_env' }));
    process.exit(1);
  }

  const sql = postgres(process.env.DATABASE_URL);
  try {
    const drivers = await sql`
      SELECT id, auth0_id, email, name, active_session_id, active_device_id
      FROM drivers WHERE id = ${DRIVER_ID}::uuid LIMIT 1
    `;
    const driver = drivers[0];
    if (!driver) {
      console.log(JSON.stringify({ ok: false, reason: 'driver_not_found' }));
      process.exit(1);
    }

    const token = signToken({
      userId: driver.id,
      auth0Id: driver.auth0_id,
      name: driver.name,
      email: driver.email,
      role: 'driver',
      userType: 'driver',
      sessionId: driver.active_session_id || `dvr_verify_${Date.now()}`,
      permissions: [],
    });
    const driverHeaders = {
      'X-Device-Id': driver.active_device_id || 'dvr-schema-verify-device',
    };

    const active = await request(
      'GET',
      '/api/v1/driver/bookings/active',
      token,
      undefined,
      driverHeaders
    );
    const bookingId =
      (active.json?.data?.booking?.id as string | undefined) ||
      process.env.DIAG_BOOKING_ID;

    let videoPost: { status: number; json: { data?: { sessionId?: string } | null } } = {
      status: 0,
      json: {},
    };
    let videoGet: { status: number; json: { data?: { sessionId?: string } | null } } = {
      status: 0,
      json: {},
    };
    if (bookingId) {
      videoPost = await request(
        'POST',
        `/api/v1/driver/bookings/${bookingId}/video/session`,
        token,
        undefined,
        driverHeaders
      );
      videoGet = await request(
        'GET',
        `/api/v1/driver/bookings/${bookingId}/video/session`,
        token,
        undefined,
        driverHeaders
      );
    }

    const report = {
      activeStatus: active.status,
      activeHasVideoField:
        active.json?.data == null ||
        (active.json?.data != null && 'video' in (active.json.data ?? {})),
      videoField: active.json?.data?.video ?? null,
      bookingId: bookingId ?? null,
      videoPostStatus: videoPost.status,
      videoGetStatus: videoGet.status,
      videoSessionId:
        videoPost.json?.data?.sessionId ?? videoGet.json?.data?.sessionId ?? null,
      ok:
        active.status === 200 &&
        (active.json?.data === null || 'video' in (active.json.data ?? {})) &&
        (!bookingId || (videoPost.status < 500 && videoGet.status < 500)),
    };

    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
