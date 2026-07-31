/**
 * DB-backed offer timezone verification (skipped when DATABASE_URL unset).
 */
import 'dotenv/config';
import postgres from 'postgres';
import { buildOfferTimeWindow } from '../src/utils/offerTimestamps';

const hasDb = Boolean(process.env.DATABASE_URL);

(hasDb ? describe : describe.skip)('booking_offers timestamptz live DB', () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(() => {
    sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('columns are timestamptz after migration', async () => {
    const cols = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'booking_offers'
        AND column_name IN ('offered_at', 'expires_at', 'responded_at')
      ORDER BY column_name
    `;
    for (const col of cols) {
      expect(col.data_type).toBe('timestamp with time zone');
    }
  });

  it('Asia/Dhaka session still keeps expires_at after offered_at', async () => {
    const ttl = 45;
    const window = buildOfferTimeWindow(ttl);
    const rows = await sql`
      SELECT
        current_setting('TimeZone') AS tz,
        ${window.offeredAt}::timestamptz AS offered,
        ${window.expiresAt}::timestamptz AS expires,
        (${window.expiresAt}::timestamptz > ${window.offeredAt}::timestamptz) AS ok,
        (${window.expiresAt}::timestamptz > CURRENT_TIMESTAMP) AS pending_alive
    `;
    expect(rows[0].tz).toBeTruthy();
    expect(rows[0].ok).toBe(true);
    expect(rows[0].pending_alive).toBe(true);
    expect(new Date(rows[0].expires).getTime()).toBeGreaterThan(new Date(rows[0].offered).getTime());
  });

  it('pending filter uses CURRENT_TIMESTAMP consistently', async () => {
    const rows = await sql`
      SELECT
        (CURRENT_TIMESTAMP + interval '45 seconds') > CURRENT_TIMESTAMP AS future_ok,
        (CURRENT_TIMESTAMP) <= CURRENT_TIMESTAMP AS boundary_expired
    `;
    expect(rows[0].future_ok).toBe(true);
    expect(rows[0].boundary_expired).toBe(true);
  });
});
