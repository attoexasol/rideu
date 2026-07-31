/**
 * Cancel active test booking from live verification (one-off cleanup).
 */
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import postgres from 'postgres';

const BASE = process.env.LIVE_TEST_BASE_URL || 'http://103.208.181.253:3000';

interface ApiResponse<T = unknown> {
  success?: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

async function main() {
  if (!process.env.JWT_SECRET || !process.env.DATABASE_URL) {
    console.error('Missing JWT_SECRET or DATABASE_URL');
    process.exit(1);
  }

  const sql = postgres(process.env.DATABASE_URL);
  try {
    const rows = await sql`SELECT id, auth0_id, email, name FROM customers WHERE status = 'active' LIMIT 1`;
    if (!rows.length) {
      console.error('No active customer found');
      process.exit(1);
    }

    const customer = rows[0];
    const token = jwt.sign(
      {
        userId: customer.id,
        auth0Id: customer.auth0_id,
        name: customer.name,
        email: customer.email,
        role: 'customer',
        userType: 'customer',
        sessionId: `cleanup_${Date.now()}`,
        permissions: [],
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h', algorithm: 'HS256' }
    );

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    const activeRes = await fetch(`${BASE}/api/v1/passenger/bookings/active`, { headers });
    const activeJson = (await activeRes.json()) as ApiResponse<{
      booking?: { id?: string; status?: string };
      id?: string;
      status?: string;
    }>;
    const detail = activeJson.data;
    const booking = detail?.booking ?? detail;
    const bookingId = booking?.id as string | undefined;

    const ongoing = await sql`
      SELECT id, status, pickup_address, dropoff_address, created_at
      FROM bookings
      WHERE customer_id = ${customer.id}
        AND status IN ('searching','offered','scheduled','accepted','driver_en_route','arrived','in_progress','quoted')
      ORDER BY created_at DESC
      LIMIT 10
    `;

    const recent = await sql`
      SELECT id, status, pickup_address, dropoff_address, created_at, cancelled_at
      FROM bookings
      WHERE customer_id = ${customer.id}
      ORDER BY created_at DESC
      LIMIT 5
    `;

    const targetId =
      bookingId ??
      ongoing.find((b) =>
        String(b.pickup_address ?? '').includes('Dhaka test pickup') ||
        String(b.dropoff_address ?? '').includes('Square Hospital')
      )?.id ??
      recent.find((b) =>
        String(b.pickup_address ?? '').includes('Dhaka test pickup') ||
        String(b.dropoff_address ?? '').includes('Square Hospital')
      )?.id ??
      ongoing[0]?.id;

    if (!targetId) {
      console.log(
        JSON.stringify(
          {
            action: 'no_booking_to_cancel',
            customerId: customer.id,
            dbOngoingCount: ongoing.length,
            recentBookings: recent.map((b) => ({
              id: b.id,
              status: b.status,
              pickup: b.pickup_address,
              dropoff: b.dropoff_address,
              createdAt: b.created_at,
              cancelledAt: b.cancelled_at,
            })),
          },
          null,
          2
        )
      );
      return;
    }

    const cancelRes = await fetch(`${BASE}/api/v1/passenger/bookings/${targetId}/cancel`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ reason: 'Cleanup after live idempotency verification test' }),
    });
    const cancelJson = (await cancelRes.json()) as ApiResponse;

    let cleanupMethod: 'api' | 'database' | 'already_cancelled' = cancelJson.success ? 'api' : 'database';
    if (!cancelJson.success) {
      const targetStatus =
        booking?.status ?? ongoing.find((b) => b.id === targetId)?.status ?? recent.find((b) => b.id === targetId)?.status;
      if (targetStatus === 'cancelled') {
        cleanupMethod = 'already_cancelled';
      } else {
        await sql`
          UPDATE bookings
          SET
            status = 'cancelled',
            cancelled_at = NOW(),
            cancelled_by = 'system',
            cancellation_reason = 'Cleanup after live idempotency verification test',
            updated_at = NOW()
          WHERE id = ${targetId}
            AND customer_id = ${customer.id}
            AND status <> 'cancelled'
        `;
        await sql`
          INSERT INTO booking_events (booking_id, actor_type, actor_id, event_type, payload)
          VALUES (
            ${targetId},
            'system',
            ${customer.id},
            'cancelled',
            ${JSON.stringify({ reason: 'Cleanup after live idempotency verification test' })}::jsonb
          )
        `;
      }
    }

    await sql`
      DELETE FROM booking_idempotency_keys
      WHERE customer_id = ${customer.id}
        AND booking_id = ${targetId}
    `;

    const verifyRes = await fetch(`${BASE}/api/v1/passenger/bookings/active`, { headers });
    const verifyJson = (await verifyRes.json()) as ApiResponse<unknown>;

    const finalRow = await sql`
      SELECT id, status, cancelled_at, cancellation_reason
      FROM bookings
      WHERE id = ${targetId}
      LIMIT 1
    `;

    console.log(
      JSON.stringify(
        {
          action: cleanupMethod === 'already_cancelled' ? 'already_cancelled' : 'cancelled',
          customerId: customer.id,
          bookingId: targetId,
          previousStatus: booking?.status ?? ongoing.find((b) => b.id === targetId)?.status,
          cleanupMethod,
          cancelHttpStatus: cancelRes.status,
          cancelApiSuccess: cancelJson.success === true,
          cancelApiError: cancelJson.error?.code ?? null,
          finalStatus: finalRow[0]?.status ?? null,
          activeAfterCancel: verifyJson.data ?? null,
        },
        null,
        2
      )
    );

    if (finalRow[0]?.status !== 'cancelled' && cleanupMethod !== 'already_cancelled') {
      process.exit(1);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
