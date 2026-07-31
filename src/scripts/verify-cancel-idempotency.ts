import 'dotenv/config';
import jwt from 'jsonwebtoken';
import postgres from 'postgres';
import { randomUUID } from 'crypto';

const BASE = process.env.LIVE_TEST_BASE_URL || 'http://103.208.181.253:3000';

async function getToken() {
  const sql = postgres(process.env.DATABASE_URL!);
  const rows = await sql`SELECT id, auth0_id, email, name FROM customers WHERE status = 'active' LIMIT 1`;
  await sql.end();
  const c = rows[0];
  const token = jwt.sign(
    {
      userId: c.id,
      auth0Id: c.auth0_id,
      name: c.name,
      email: c.email,
      role: 'customer',
      userType: 'customer',
      sessionId: `cancel_verify_${Date.now()}`,
      permissions: [],
    },
    process.env.JWT_SECRET!,
    { expiresIn: '1h', algorithm: 'HS256' }
  );
  return token;
}

async function main() {
  const token = await getToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const activeRes = await fetch(`${BASE}/api/v1/passenger/bookings/active`, { headers });
  const activeJson = (await activeRes.json()) as { data?: { id?: string } };
  const bookingId = activeJson.data?.id;
  if (!bookingId) {
    console.log(JSON.stringify({ ok: false, reason: 'no_active_booking' }, null, 2));
    return;
  }

  const idem = randomUUID();
  const cancelHeaders = { ...headers, 'Idempotency-Key': idem };

  const r1 = await fetch(`${BASE}/api/v1/passenger/bookings/${bookingId}/cancel`, {
    method: 'POST',
    headers: cancelHeaders,
    body: JSON.stringify({ reason: 'verify' }),
  });
  const j1 = (await r1.json()) as { error?: { code?: string }; data?: { id?: string; status?: string } };

  const r2 = await fetch(`${BASE}/api/v1/passenger/bookings/${bookingId}/cancel`, {
    method: 'POST',
    headers: cancelHeaders,
    body: JSON.stringify({ reason: 'verify' }),
  });
  const j2 = (await r2.json()) as { error?: { code?: string }; data?: { id?: string; status?: string } };

  const r3 = await fetch(`${BASE}/api/v1/passenger/bookings/${bookingId}/cancel`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ reason: 'verify' }),
  });
  const j3 = (await r3.json()) as { error?: { code?: string }; data?: { id?: string; status?: string } };

  console.log(
    JSON.stringify(
      {
        bookingId,
        firstCancel: { status: r1.status, code: j1.error?.code, dataStatus: j1.data?.status },
        idempotentRetry: { status: r2.status, code: j2.error?.code, dataStatus: j2.data?.status },
        alreadyCancelled: { status: r3.status, code: j3.error?.code, dataStatus: j3.data?.status },
        sameIdempotentResult: j1.data?.id === j2.data?.id && j1.data?.status === j2.data?.status,
      },
      null,
      2
    )
  );
}

main().catch(console.error);
