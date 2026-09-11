/**
 * Post-v2 verification: DB persistence, status, repeat onboarding reuse.
 */
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { db } from '../src/db/connection';
import { drivers } from '../src/db/schema/drivers';
import { eq } from 'drizzle-orm';

const AUTH0_ID = process.argv[2] || 'auth0|6a350be063741e31d649fd65';
const BASE = process.env.LIVE_TEST_BASE_URL || 'http://127.0.0.1:3000';

async function main(): Promise<void> {
  const [driver] = await db
    .select()
    .from(drivers)
    .where(eq(drivers.auth0Id, AUTH0_ID))
    .limit(1);

  if (!driver) {
    console.error('[IDEMPOTENCY_V2_VERIFY] driver not found');
    process.exit(1);
  }

  console.info('[IDEMPOTENCY_V2_VERIFY] driverId=' + driver.id);
  console.info('[IDEMPOTENCY_V2_VERIFY] stripeAccountId=' + (driver.stripeAccountId ?? 'null'));

  const token = jwt.sign(
    {
      userId: driver.id,
      auth0Id: driver.auth0Id,
      name: driver.name,
      email: driver.email,
      role: 'driver',
      userType: 'driver',
      sessionId: driver.activeSessionId || 'verify',
      permissions: [],
    },
    process.env.JWT_SECRET!,
    { expiresIn: '1h', algorithm: 'HS256' }
  );

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Device-Id': driver.activeDeviceId || 'verify-device',
  };

  const statusRes = await fetch(`${BASE}/api/v1/driver/payouts/status`, { headers });
  const statusBody = await statusRes.json();
  console.info('[IDEMPOTENCY_V2_VERIFY] statusHttp=' + statusRes.status);
  console.info('[IDEMPOTENCY_V2_VERIFY] status=' + (statusBody?.data?.status ?? 'unknown'));

  const beforeAccountId = driver.stripeAccountId;
  const repeatRes = await fetch(`${BASE}/api/v1/driver/payouts/onboarding-link`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  const repeatBody = await repeatRes.json();
  console.info('[IDEMPOTENCY_V2_VERIFY] repeatOnboardingHttp=' + repeatRes.status);
  console.info('[IDEMPOTENCY_V2_VERIFY] repeatSuccess=' + Boolean(repeatBody?.success));
  console.info('[IDEMPOTENCY_V2_VERIFY] repeatHasUrl=' + Boolean(repeatBody?.data?.url));

  const [driverAfter] = await db
    .select()
    .from(drivers)
    .where(eq(drivers.auth0Id, AUTH0_ID))
    .limit(1);

  console.info(
    '[IDEMPOTENCY_V2_VERIFY] stripeAccountIdAfterRepeat=' +
      (driverAfter?.stripeAccountId ?? 'null')
  );
  console.info(
    '[IDEMPOTENCY_V2_VERIFY] accountUnchanged=' +
      String(beforeAccountId === driverAfter?.stripeAccountId)
  );
}

main().catch((error) => {
  console.error(
    '[IDEMPOTENCY_V2_VERIFY] fatal=' +
      (error instanceof Error ? error.message : String(error))
  );
  process.exit(1);
});
