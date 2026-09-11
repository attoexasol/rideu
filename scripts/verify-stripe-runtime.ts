/**
 * Retrieve platform account identity for the active Stripe secret.
 * Safe output only — no secrets or full account objects.
 *
 * NOTE: This script uses a fixed idempotency key pattern and may replay cached
 * Stripe failures. For Accounts v1 verification with fresh keys, run:
 *   npx tsx scripts/verify-stripe-accounts-v1-fresh.ts
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import Stripe from 'stripe';
import { getStripeSecretKey } from '../src/config/stripe';
import {
  logStripeConnectCreateProbe,
  logStripePlatformSnapshot,
  logStripeRuntimeEnv,
  probeStripeConnectAccountCreate,
  retrieveStripePlatformSnapshot,
  describeStripeRuntimeEnv,
} from '../src/services/stripeRuntimeVerify';

const TEST_DRIVER_ID = process.argv[2] ?? 'verify-driver-00000000-0000-0000-0000-000000000001';

async function main(): Promise<void> {
  const shellStripeSecretPresent = Boolean(process.env.STRIPE_SECRET_KEY);
  const secret = getStripeSecretKey();
  if (!secret) {
    console.error('[STRIPE_RUNTIME_VERIFY] abort: STRIPE_SECRET_KEY missing after dotenv load');
    process.exit(1);
  }

  const env = describeStripeRuntimeEnv(shellStripeSecretPresent);
  logStripeRuntimeEnv('verify-script', env);

  const stripe = new Stripe(secret);
  const platform = await retrieveStripePlatformSnapshot(stripe);
  logStripePlatformSnapshot('verify-script', platform);

  const country = env.configuredCountry ?? 'US';
  const probe = await probeStripeConnectAccountCreate(
    stripe,
    TEST_DRIVER_ID,
    country,
    `verify:${TEST_DRIVER_ID}:stripe-connect-account`
  );
  logStripeConnectCreateProbe('verify-script', probe);

  if (probe.result === 'failed') {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(
    '[STRIPE_RUNTIME_VERIFY] fatal=' + (error instanceof Error ? error.message : String(error))
  );
  process.exit(1);
});
