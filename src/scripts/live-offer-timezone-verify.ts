/**
 * Live local verification: create offer timestamps + pending filter + optional socket room.
 * Does not print JWTs or secrets.
 */
import 'dotenv/config';
import postgres from 'postgres';
import { io as ioClient } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import { createPendingBookingOffer } from '../repositories/booking.repository';
import { listPendingOffersForDriver } from '../repositories/booking.repository';
import { DISPATCH_OFFER_TTL_SECONDS } from '../constants/bookingStatus';
import { closeConnection } from '../db/connection';
import { closeRedisConnections } from '../config/redis';

const BASE = process.env.LIVE_BASE_URL || 'http://127.0.0.1:3000';
const DRIVER_ID = process.env.LIVE_DRIVER_ID || '4d8d26f0-cee9-4575-8331-ae64b072f42c';

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);
  const report: Record<string, unknown> = { base: BASE, driverId: DRIVER_ID };

  try {
    const [driver] = await sql`
      SELECT id, auth0_id, status FROM drivers WHERE id = ${DRIVER_ID}::uuid
    `;
    if (!driver) throw new Error('DRIVER_NOT_FOUND');

    // Use an existing searching/offered booking or skip booking-linked pending status filter by
    // creating a disposable booking row is heavy — instead verify raw timestamptz insert math
    // and listPending against any active dispatchable booking if present.
    const [booking] = await sql`
      SELECT id, status, service_category_id
      FROM bookings
      WHERE status IN ('searching', 'offered')
      ORDER BY created_at DESC
      LIMIT 1
    `;

    let offerId: string | null = null;
    let bookingId: string | null = booking?.id ?? null;

    if (!bookingId) {
      // Create a minimal searching booking for the existing customer of last booking
      const [last] = await sql`
        SELECT customer_id, service_category_id, pickup_latitude, pickup_longitude, pickup_address,
               dropoff_latitude, dropoff_longitude, dropoff_address
        FROM bookings
        ORDER BY created_at DESC
        LIMIT 1
      `;
      if (!last) throw new Error('NO_BOOKING_TEMPLATE');
      const [created] = await sql`
        INSERT INTO bookings (
          booking_number, customer_id, service_category_id, status, scheduling_type,
          pickup_latitude, pickup_longitude, pickup_address,
          dropoff_latitude, dropoff_longitude, dropoff_address,
          search_started_at
        ) VALUES (
          ${'TZ' + String(Date.now()).slice(-10)},
          ${last.customer_id}::uuid,
          ${last.service_category_id}::uuid,
          'offered',
          'instant',
          ${last.pickup_latitude}, ${last.pickup_longitude}, ${last.pickup_address},
          ${last.dropoff_latitude}, ${last.dropoff_longitude}, ${last.dropoff_address},
          CURRENT_TIMESTAMP
        )
        RETURNING id
      `;
      bookingId = created.id as string;
      report.createdTestBooking = true;
    }

    // Clear prior offer for unique (booking, driver) if needed
    await sql`
      DELETE FROM booking_offers
      WHERE booking_id = ${bookingId}::uuid AND driver_id = ${DRIVER_ID}::uuid
    `;

    const offer = await createPendingBookingOffer({
      bookingId: bookingId!,
      driverId: DRIVER_ID,
      distanceToPickupKm: '0.50',
      ttlSeconds: DISPATCH_OFFER_TTL_SECONDS,
    });
    offerId = offer.id;

    const [row] = await sql`
      SELECT
        offered_at > offered_at - interval '1 second' AS offered_sane,
        expires_at > offered_at AS expires_after_offered,
        expires_at > CURRENT_TIMESTAMP AS pending_alive,
        extract(epoch from (expires_at - offered_at)) AS ttl_seconds,
        offered_at::text AS offered_text,
        expires_at::text AS expires_text
      FROM booking_offers WHERE id = ${offerId}::uuid
    `;

    const pending = await listPendingOffersForDriver(DRIVER_ID);
    const pendingContains = pending.some((p) => p.offer.id === offerId);

    report.offer = {
      offerId,
      bookingId,
      expiresAfterOffered: row.expires_after_offered,
      pendingAlive: row.pending_alive,
      ttlSeconds: row.ttl_seconds,
      offeredText: row.offered_text,
      expiresText: row.expires_text,
      pendingContains,
      pendingCount: pending.length,
    };

    // Socket room join check (HS256 session token)
    const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET;
    let socketResult: Record<string, unknown> = { attempted: false };
    if (secret) {
      const token = jwt.sign(
        {
          userId: DRIVER_ID,
          auth0Id: driver.auth0_id,
          role: 'driver',
          userType: 'driver',
          sessionId: `tz_verify_${Date.now()}`,
        },
        secret,
        { expiresIn: '5m' }
      );

      socketResult = await new Promise((resolve) => {
        const socket = ioClient(BASE, {
          auth: { token },
          transports: ['websocket'],
          timeout: 8000,
          forceNew: true,
        });
        const timer = setTimeout(() => {
          socket.close();
          resolve({ attempted: true, ok: false, reason: 'timeout' });
        }, 9000);
        socket.on('authenticated', (payload: any) => {
          clearTimeout(timer);
          const rooms: string[] = payload?.rooms || [];
          const room = `driver-${DRIVER_ID}`;
          const joined = rooms.includes(room) || rooms.some((r) => r === room);
          socket.close();
          resolve({
            attempted: true,
            ok: joined,
            driverId: payload?.userId,
            roomJoined: joined,
            room,
            roomCount: rooms.length,
          });
        });
        socket.on('connect_error', (err) => {
          clearTimeout(timer);
          socket.close();
          resolve({ attempted: true, ok: false, reason: err.message });
        });
      });
    } else {
      socketResult = { attempted: false, reason: 'no JWT_SECRET' };
    }

    report.socket = socketResult;

    // Cleanup test offer (and test booking if created)
    await sql`UPDATE booking_offers SET status='expired', responded_at=CURRENT_TIMESTAMP WHERE id = ${offerId}::uuid`;
    if (report.createdTestBooking) {
      await sql`UPDATE bookings SET status='cancelled', cancelled_at=CURRENT_TIMESTAMP WHERE id = ${bookingId}::uuid`;
    }

    report.ready =
      row.expires_after_offered === true &&
      row.pending_alive === true &&
      pendingContains === true;

    report.finalStatus = report.ready
      ? 'READY FOR DRIVER OFFER RETEST'
      : 'NOT READY';

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
    await closeConnection();
    await closeRedisConnections();
    process.exit(0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
