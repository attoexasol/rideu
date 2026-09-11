/**
 * Diagnostic-only: probe Accounts v1 create with guaranteed-fresh idempotency keys.
 * Does not use production driver idempotency keys.
 */
import 'dotenv/config';
import { getStripeConnectDefaultCountry } from '../src/config/stripe';
import { getStripeClient, resetStripeClientForTests } from '../src/services/stripe.service';
import {
  buildFreshAccountsV1IdempotencyKey,
  buildFreshAccountsV1ProbeDriverId,
  logStripeV1VerifyProbe,
  probeStripeConnectAccountCreate,
  retrieveStripePlatformSnapshot,
  V1_VERIFY_PREFIX,
} from '../src/services/stripeRuntimeVerify';

const PROBE_COUNT = 3;

async function main(): Promise<void> {
  resetStripeClientForTests();
  const stripe = getStripeClient();
  const country = getStripeConnectDefaultCountry() ?? 'US';
  const platform = await retrieveStripePlatformSnapshot(stripe);

  console.info(`${V1_VERIFY_PREFIX} probeCount=${PROBE_COUNT}`);
  console.info(`${V1_VERIFY_PREFIX} configuredCountry=${country}`);

  const results: Array<{ probeIndex: number; probe: Awaited<ReturnType<typeof probeStripeConnectAccountCreate>> }> = [];

  for (let i = 1; i <= PROBE_COUNT; i += 1) {
    const idempotencyKey = buildFreshAccountsV1IdempotencyKey();
    const driverId = buildFreshAccountsV1ProbeDriverId();
    console.info(`${V1_VERIFY_PREFIX} probeIndex=${i}`);
    const probe = await probeStripeConnectAccountCreate(stripe, driverId, country, idempotencyKey);
    logStripeV1VerifyProbe(platform.platformAccountId, probe);
    results.push({ probeIndex: i, probe });

    if (probe.result === 'success') {
      console.info(`${V1_VERIFY_PREFIX} stoppingAfterFirstSuccess=true`);
      break;
    }
  }

  const successes = results.filter((r) => r.probe.result === 'success').length;
  const failures = results.filter((r) => r.probe.result === 'failed').length;
  const v1Errors = results.filter((r) =>
    r.probe.stripeErrorMessage?.includes('Accounts v1')
  ).length;

  console.info(`${V1_VERIFY_PREFIX} summary successCount=${successes} failureCount=${failures}`);

  if (successes > 0) {
    process.exit(0);
  }

  if (failures === PROBE_COUNT && v1Errors === PROBE_COUNT) {
    console.info(`${V1_VERIFY_PREFIX} conclusion=STRIPE_ACCOUNTS_V1_DASHBOARD_API_STATE_MISMATCH`);
    process.exit(3);
  }

  process.exit(2);
}

main().catch((error) => {
  console.error(
    `${V1_VERIFY_PREFIX} fatal=` + (error instanceof Error ? error.message : String(error))
  );
  process.exit(1);
});
