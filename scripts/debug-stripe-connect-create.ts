/**
 * Probe Stripe Connect account creation using the same client + payload as backend runtime.
 *
 * NOTE: Uses a fixed debug idempotency key; may replay cached Stripe failures.
 * For fresh Accounts v1 probes, run:
 *   npx tsx scripts/verify-stripe-accounts-v1-fresh.ts
 */
import 'dotenv/config';
import { getStripeConnectDefaultCountry } from '../src/config/stripe';
import { getStripeClient, resetStripeClientForTests } from '../src/services/stripe.service';
import {
  logStripeConnectCreateProbe,
  logStripePlatformSnapshot,
  logStripeRuntimeEnv,
  probeStripeConnectAccountCreate,
  retrieveStripePlatformSnapshot,
  describeStripeRuntimeEnv,
} from '../src/services/stripeRuntimeVerify';

const TEST_DRIVER_ID = 'debug-driver-00000000-0000-0000-0000-000000000001';

async function main(): Promise<void> {
  const shellStripeSecretPresent = Boolean(process.env.STRIPE_SECRET_KEY);
  resetStripeClientForTests();
  const env = describeStripeRuntimeEnv(shellStripeSecretPresent);
  logStripeRuntimeEnv('debug-script', env);

  if (!env.stripeSecretPresent) {
    console.error('[STRIPE_CONNECT_DEBUG] abort: no secret configured');
    process.exit(1);
  }

  const stripe = getStripeClient();
  const platform = await retrieveStripePlatformSnapshot(stripe);
  logStripePlatformSnapshot('debug-script', platform);

  const country = getStripeConnectDefaultCountry() ?? 'US';
  console.info('[STRIPE_CONNECT_DEBUG] operation=accounts.create');
  console.info('[STRIPE_CONNECT_DEBUG] driverId=' + TEST_DRIVER_ID);

  const probe = await probeStripeConnectAccountCreate(
    stripe,
    TEST_DRIVER_ID,
    country,
    `debug:${TEST_DRIVER_ID}:stripe-connect-account`
  );
  logStripeConnectCreateProbe('debug-script', probe);

  if (probe.result === 'failed') {
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('[STRIPE_CONNECT_DEBUG] fatal=' + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
