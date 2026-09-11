/**
 * Exercise backend Stripe Connect service path (same as HTTP handler internals).
 */
import 'dotenv/config';
import { verifyBackendStripeRuntime } from '../src/services/stripeRuntimeVerify';
import { resetStripeConnectLocksForTests } from '../src/services/stripeConnect.service';

const DRIVER_ID = process.argv[2];

async function main(): Promise<void> {
  if (!DRIVER_ID) {
    console.error('Usage: npx tsx scripts/verify-stripe-backend-service.ts <driver-uuid>');
    process.exit(1);
  }

  resetStripeConnectLocksForTests();
  const shellStripeSecretPresent = Boolean(process.env.STRIPE_SECRET_KEY);
  const { env, platform, probe } = await verifyBackendStripeRuntime(shellStripeSecretPresent, DRIVER_ID);

  const { logStripeRuntimeEnv, logStripePlatformSnapshot, logStripeConnectCreateProbe } =
    await import('../src/services/stripeRuntimeVerify');

  logStripeRuntimeEnv('backend', env);
  logStripePlatformSnapshot('backend', platform);
  logStripeConnectCreateProbe('backend', probe);

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
