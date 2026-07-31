/**
 * Dev/staging: expire malformed pending offers (expires_at <= offered_at)
 * and clear stale offered bookings. Safe to run after migration as well.
 */
import 'dotenv/config';
import postgres from 'postgres';
import * as fs from 'fs';

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);
  const env = process.env.NODE_ENV || 'development';
  if (env === 'production' && process.env.ALLOW_OFFER_REPAIR !== 'true') {
    console.error('Refusing to repair in production without ALLOW_OFFER_REPAIR=true');
    process.exit(1);
  }

  const before = await sql`
    SELECT
      id,
      booking_id,
      driver_id,
      status,
      offered_at::text AS offered_text,
      expires_at::text AS expires_text,
      (expires_at <= offered_at) AS malformed
    FROM booking_offers
    WHERE status = 'pending'
    ORDER BY offered_at DESC
    LIMIT 100
  `;

  const malformed = before.filter((r) => r.malformed);
  fs.writeFileSync(
    'offer-repair-before.json',
    JSON.stringify({ env, pending: before, malformedCount: malformed.length }, null, 2)
  );

  const expired = await sql`
    UPDATE booking_offers
    SET
      status = 'expired',
      responded_at = COALESCE(responded_at, CURRENT_TIMESTAMP)
    WHERE status = 'pending'
      AND expires_at <= offered_at
    RETURNING id, booking_id, driver_id
  `;

  const cleared = await sql`
    UPDATE bookings b
    SET
      status = 'searching',
      updated_at = CURRENT_TIMESTAMP
    WHERE b.status = 'offered'
      AND b.assigned_driver_id IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM booking_offers o
        WHERE o.booking_id = b.id
          AND o.status = 'pending'
          AND o.expires_at > CURRENT_TIMESTAMP
      )
    RETURNING id
  `;

  const report = {
    expiredOfferCount: expired.length,
    expiredOfferIds: expired.map((r) => r.id),
    clearedBookingIds: cleared.map((r) => r.id),
  };
  fs.writeFileSync('offer-repair-after.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
