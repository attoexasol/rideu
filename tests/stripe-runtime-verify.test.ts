/**
 * Stripe runtime verification tests.
 */

import {
  buildStripeConnectAccountCreateParams,
  describeStripeRuntimeEnv,
} from '../src/services/stripeRuntimeVerify';
import { isStripeAccountsV1Disabled } from '../src/services/stripeConnect.debug';

describe('stripeRuntimeVerify', () => {
  const savedSecret = process.env.STRIPE_SECRET_KEY;
  const savedCountry = process.env.STRIPE_CONNECT_DEFAULT_COUNTRY;

  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_runtime_verify';
    process.env.STRIPE_CONNECT_DEFAULT_COUNTRY = 'US';
  });

  afterEach(() => {
    if (savedSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = savedSecret;
    if (savedCountry === undefined) delete process.env.STRIPE_CONNECT_DEFAULT_COUNTRY;
    else process.env.STRIPE_CONNECT_DEFAULT_COUNTRY = savedCountry;
  });

  it('builds the same Connect create payload as Phase B service', () => {
    expect(buildStripeConnectAccountCreateParams('driver-1', 'US')).toEqual({
      country: 'US',
      business_type: 'individual',
      controller: {
        fees: { payer: 'application' },
        losses: { payments: 'application' },
        requirement_collection: 'stripe',
        stripe_dashboard: { type: 'express' },
      },
      capabilities: { transfers: { requested: true } },
      metadata: { driverId: 'driver-1' },
    });
  });

  it('describes env file fingerprint without logging secret', () => {
    const env = describeStripeRuntimeEnv(false);
    expect(env.stripeSecretPresent).toBe(true);
    expect(env.stripeSecretMode).toBe('test');
    expect(env.configuredCountry).toBe('US');
    expect(env.secretFingerprint).toMatch(/^[a-f0-9]{12}$/);
  });

  it('detects Accounts v1 disabled Stripe errors', () => {
    expect(
      isStripeAccountsV1Disabled({
        message:
          'Stripe no longer recommends Accounts v1 for new Connect integrations. enable feat_accounts_v1_support',
      })
    ).toBe(true);
    expect(
      isStripeAccountsV1Disabled({
        message: "You can only create new accounts if you've signed up for Connect",
      })
    ).toBe(false);
  });
});
