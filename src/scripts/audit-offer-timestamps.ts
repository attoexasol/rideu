import 'dotenv/config';
import postgres from 'postgres';
import * as fs from 'fs';

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);

  const cols = await sql`
    SELECT column_name, data_type, datetime_precision, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'booking_offers'
    ORDER BY ordinal_position
  `;

  const tz = await sql`SELECT current_setting('TimeZone') AS tz, now()::text AS now_text`;

  const allPending = await sql`
    SELECT count(*)::int AS n FROM booking_offers WHERE status = 'pending'
  `;

  const malformedPending = await sql`
    SELECT count(*)::int AS n
    FROM booking_offers
    WHERE status = 'pending' AND expires_at <= offered_at
  `;

  const pendingSample = await sql`
    SELECT
      id,
      booking_id,
      driver_id,
      status,
      offered_at::text AS offered_text,
      expires_at::text AS expires_text,
      responded_at::text AS responded_text,
      (expires_at <= offered_at) AS expires_before_or_eq_offered,
      (expires_at > now()) AS alive
    FROM booking_offers
    WHERE status = 'pending'
       OR (expires_at <= offered_at AND offered_at > now() - interval '2 days')
    ORDER BY offered_at DESC
    LIMIT 50
  `;

  const searchingBookings = await sql`
    SELECT id, status, dispatch_batch, assigned_driver_id
    FROM bookings
    WHERE status IN ('searching', 'offered')
    ORDER BY created_at DESC
    LIMIT 20
  `;

  const out = {
    tz,
    cols,
    allPending,
    malformedPending,
    pendingSample,
    searchingBookings,
  };
  fs.writeFileSync('offer-ts-audit.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
