import 'dotenv/config';
import jwt from 'jsonwebtoken';
import postgres from 'postgres';

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
      sessionId: `active_verify_${Date.now()}`,
      permissions: [],
    },
    process.env.JWT_SECRET!,
    { expiresIn: '1h', algorithm: 'HS256' }
  );
  return { token, customerId: c.id };
}

async function main() {
  const { token } = await getToken();
  const headers = { Authorization: `Bearer ${token}` };

  const activeRes = await fetch(`${BASE}/api/v1/passenger/bookings/active`, { headers });
  const activeJson = (await activeRes.json()) as {
    success?: boolean;
    data?: { id?: string; status?: string; pickup?: { address?: string }; service?: { serviceCategoryId?: string } } | null;
  };

  console.log(
    JSON.stringify(
      {
        activeStatus: activeRes.status,
        activeSuccess: activeJson.success,
        hasData: activeJson.data !== undefined,
        dataIsNull: activeJson.data === null,
        bookingStatus: activeJson.data?.status ?? null,
        hasPickup: Boolean(activeJson.data?.pickup?.address),
        hasService: Boolean(activeJson.data?.service?.serviceCategoryId),
      },
      null,
      2
    )
  );
}

main().catch(console.error);
