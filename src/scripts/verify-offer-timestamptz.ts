import 'dotenv/config';
import postgres from 'postgres';
import { buildOfferTimeWindow } from '../utils/offerTimestamps';

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);
  const ttl = Number(process.env.DISPATCH_OFFER_TIMEOUT_SECONDS || 45);
  const window = buildOfferTimeWindow(ttl);

  const hist = await sql`
    SELECT
      id,
      offered_at,
      expires_at,
      (expires_at > offered_at) AS ok,
      offered_at::text AS offered_text,
      expires_at::text AS expires_text
    FROM booking_offers
    WHERE id = 'dab09d96-76b1-4fc7-87a8-2a69cc8bcc3d'::uuid
  `;

  const sim = await sql`
    SELECT
      current_setting('TimeZone') AS tz,
      ${window.offeredAt}::timestamptz AS offered,
      ${window.expiresAt}::timestamptz AS expires,
      (${window.expiresAt}::timestamptz > ${window.offeredAt}::timestamptz) AS expires_after_offered,
      (${window.expiresAt}::timestamptz > CURRENT_TIMESTAMP) AS pending_alive,
      extract(epoch from (${window.expiresAt}::timestamptz - ${window.offeredAt}::timestamptz)) AS ttl_seconds
  `;

  console.log(JSON.stringify({ historicalMigrated: hist, newInsertSim: sim }, null, 2));
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
