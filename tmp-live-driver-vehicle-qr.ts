import 'dotenv/config';
import jwt from 'jsonwebtoken';
import postgres from 'postgres';

const BASE = process.env.LIVE_TEST_BASE_URL || 'http://127.0.0.1:3000';

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  let driver: {
    id: string;
    auth0_id: string;
    email: string;
    name: string;
    active_session_id: string | null;
    active_device_id: string | null;
  };

  try {
    const rows = await sql`
      SELECT id, auth0_id, email, name, active_session_id, active_device_id
      FROM drivers
      WHERE id = '281b0d60-71c9-45e3-abcd-0d7c6a590c37'
      LIMIT 1
    `;
    if (!rows.length) throw new Error('Rakib driver not found');
    driver = rows[0] as typeof driver;
  } finally {
    await sql.end();
  }

  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign(
    {
      userId: driver.id,
      auth0Id: driver.auth0_id,
      email: driver.email,
      name: driver.name,
      role: 'driver',
      userType: 'driver',
      sessionId: driver.active_session_id,
      iat: now,
    },
    process.env.JWT_SECRET!,
    { expiresIn: '1h', algorithm: 'HS256' }
  );

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (driver.active_device_id) {
    headers['X-Device-ID'] = driver.active_device_id;
  }

  console.log('Driver:', driver.name, 'session:', driver.active_session_id);

  for (const path of ['/api/v1/driver/duty/current', '/api/v1/driver/duty/current/vehicle-qr']) {
    const res = await fetch(`${BASE}${path}`, { headers });
    const body = await res.json();
    console.log('\n===', path, res.status, '===');
    const preview = { ...body };
    if (preview.data?.image?.base64) {
      preview.data.image.base64 = `[${preview.data.image.base64.length} chars]`;
    }
    if (preview.data?.image?.dataUrl) {
      preview.data.image.dataUrl = `[${preview.data.image.dataUrl.length} chars]`;
    }
    console.log(JSON.stringify(preview, null, 2));
    if (JSON.stringify(body).includes('VQR_')) {
      console.error('FAIL: raw VQR_ token exposed in response text');
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
