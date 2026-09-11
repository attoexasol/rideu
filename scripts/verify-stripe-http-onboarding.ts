/**
 * HTTP probe for driver onboarding-link using real backend auth path.
 */
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { db } from '../src/db/connection';
import { drivers } from '../src/db/schema/drivers';
import { eq } from 'drizzle-orm';
import {
  describeStripeRuntimeEnv,
  logStripeConnectCreateProbe,
  logStripePlatformSnapshot,
  logStripeRuntimeEnv,
  probeStripeConnectAccountCreate,
  retrieveStripePlatformSnapshot,
} from '../src/services/stripeRuntimeVerify';
import { getStripeClient, resetStripeClientForTests } from '../src/services/stripe.service';
import { buildDriverStripeAccountCreateIdempotencyKey } from '../src/constants/stripeConnect';

const BASE = process.env.LIVE_TEST_BASE_URL || 'http://127.0.0.1:3000';
const AUTH0_ID = process.argv[2] || 'auth0|6a350be063741e31d649fd65';

async function main(): Promise<void> {
  if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET missing');
    process.exit(1);
  }

  const [driver] = await db
    .select()
    .from(drivers)
    .where(eq(drivers.auth0Id, AUTH0_ID))
    .limit(1);

  if (!driver) {
    console.error('Driver not found for auth0Id=' + AUTH0_ID);
    process.exit(1);
  }

  resetStripeClientForTests();
  const shellStripeSecretPresent = Boolean(process.env.STRIPE_SECRET_KEY);
  const env = describeStripeRuntimeEnv(shellStripeSecretPresent);
  logStripeRuntimeEnv('http-endpoint', env);

  const stripe = getStripeClient();
  const platform = await retrieveStripePlatformSnapshot(stripe);
  logStripePlatformSnapshot('http-endpoint', platform);

  const token = jwt.sign(
    {
      userId: driver.id,
      auth0Id: driver.auth0Id,
      name: driver.name,
      email: driver.email,
      role: 'driver',
      userType: 'driver',
      sessionId: driver.activeSessionId || `verify_${Date.now()}`,
      permissions: [],
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h', algorithm: 'HS256' }
  );

  const res = await fetch(`${BASE}/api/v1/driver/payouts/onboarding-link`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Device-Id': driver.activeDeviceId || 'verify-device',
    },
    body: JSON.stringify({}),
  });

  const body = await res.json().catch(() => ({}));
  console.info('[STRIPE_RUNTIME_VERIFY] source=http-endpoint');
  console.info('[STRIPE_RUNTIME_VERIFY] httpStatus=' + res.status);
  console.info('[STRIPE_RUNTIME_VERIFY] errorCode=' + (body?.error?.code ?? 'null'));
  console.info(
    '[STRIPE_RUNTIME_VERIFY] errorMessage=' + (body?.error?.message ?? 'null')
  );

  const probe = await probeStripeConnectAccountCreate(
    stripe,
    driver.id,
    env.configuredCountry ?? 'US',
    buildDriverStripeAccountCreateIdempotencyKey(driver.id)
  );
  logStripeConnectCreateProbe('http-endpoint-direct-probe', probe);

  process.exit(res.ok ? 0 : 2);
}

main().catch((error) => {
  console.error(
    '[STRIPE_RUNTIME_VERIFY] fatal=' + (error instanceof Error ? error.message : String(error))
  );
  process.exit(1);
});
