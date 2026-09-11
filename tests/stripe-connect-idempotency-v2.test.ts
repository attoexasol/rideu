/**
 * Stripe Connect idempotency v2 tests.
 */

import {
  buildDriverStripeAccountCreateIdempotencyKey,
  STRIPE_CONNECT_ACCOUNT_CREATE_IDEMPOTENCY_VERSION,
  stripeConnectAccountIdempotencyKey,
} from '../src/constants/stripeConnect';
import { FinancialIdempotencyKey } from '../src/constants/payment';

const mockIsStripeReady = jest.fn(() => true);
const mockGetStripeClient = jest.fn();
const mockFindDriverById = jest.fn();
const mockClaimDriverStripeAccountId = jest.fn();
const mockPersistDriverStripeAccountSync = jest.fn();

jest.mock('../src/services/stripe.service', () => {
  const actual = jest.requireActual('../src/services/stripe.service');
  return {
    ...actual,
    isStripeReady: () => mockIsStripeReady(),
    getStripeClient: () => mockGetStripeClient(),
  };
});

jest.mock('../src/repositories/driverStripe.repository', () => ({
  findDriverById: (driverId: string) => mockFindDriverById(driverId),
  findDriverByStripeAccountId: jest.fn(),
  claimDriverStripeAccountId: (driverId: string, accountId: string, country: string) =>
    mockClaimDriverStripeAccountId(driverId, accountId, country),
  persistDriverStripeAccountSync: (driverId: string, fields: unknown) =>
    mockPersistDriverStripeAccountSync(driverId, fields),
}));

import {
  createDriverOnboardingLink,
  getDriverPayoutStatus,
  getOrCreateDriverStripeAccountId,
  resetStripeConnectLocksForTests,
} from '../src/services/stripeConnect.service';

const DRIVER_ID = '281b0d60-71c9-45e3-abcd-0d7c6a590c37';
const RETURN_URL = 'https://app.example/driver/payouts/return';
const REFRESH_URL = 'https://app.example/driver/payouts/refresh';

function baseDriver(overrides: Record<string, unknown> = {}) {
  return {
    id: DRIVER_ID,
    auth0Id: 'auth0|driver',
    stripeAccountId: null,
    stripeAccountCountry: null,
    stripeAccountStatus: null,
    stripeDetailsSubmitted: false,
    stripeChargesEnabled: false,
    stripePayoutsEnabled: false,
    stripeRequirementsCurrentlyDue: [],
    stripeRequirementsEventuallyDue: [],
    stripeOnboardingCompletedAt: null,
    stripeLastSyncedAt: null,
    ...overrides,
  };
}

function stripeAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acct_v2_test',
    object: 'account',
    country: 'US',
    details_submitted: false,
    charges_enabled: false,
    payouts_enabled: false,
    requirements: {
      currently_due: ['individual.verification.document'],
      eventually_due: [],
      disabled_reason: null,
    },
    capabilities: { transfers: 'inactive' },
    ...overrides,
  };
}

describe('Stripe Connect idempotency v2', () => {
  const mockAccountsCreate = jest.fn();
  const mockAccountsRetrieve = jest.fn();
  const mockAccountLinksCreate = jest.fn();
  let storedAccountId: string | null = null;

  beforeEach(() => {
    resetStripeConnectLocksForTests();
    storedAccountId = null;
    process.env.STRIPE_CONNECT_DEFAULT_COUNTRY = 'US';
    process.env.STRIPE_CONNECT_RETURN_URL = RETURN_URL;
    process.env.STRIPE_CONNECT_REFRESH_URL = REFRESH_URL;

    mockAccountsCreate.mockReset();
    mockAccountsRetrieve.mockReset();
    mockAccountLinksCreate.mockReset();
    mockFindDriverById.mockReset();
    mockClaimDriverStripeAccountId.mockReset();
    mockPersistDriverStripeAccountSync.mockReset();

    mockGetStripeClient.mockReturnValue({
      accounts: { create: mockAccountsCreate, retrieve: mockAccountsRetrieve },
      accountLinks: { create: mockAccountLinksCreate },
    });

    mockFindDriverById.mockImplementation(async () =>
      baseDriver({ stripeAccountId: storedAccountId })
    );
    mockClaimDriverStripeAccountId.mockImplementation(async (_id: string, accountId: string) => {
      storedAccountId = accountId;
      return { claimed: true, accountId };
    });
    mockPersistDriverStripeAccountSync.mockResolvedValue(undefined);
    mockAccountsCreate.mockResolvedValue(stripeAccount());
    mockAccountsRetrieve.mockResolvedValue(stripeAccount());
    mockAccountLinksCreate.mockResolvedValue({
      object: 'account_link',
      url: 'https://connect.stripe.com/setup/s/test_onboarding',
      expires_at: 1_700_000_000,
    });
  });

  afterEach(() => {
    resetStripeConnectLocksForTests();
    delete process.env.STRIPE_CONNECT_DEFAULT_COUNTRY;
    delete process.env.STRIPE_CONNECT_RETURN_URL;
    delete process.env.STRIPE_CONNECT_REFRESH_URL;
  });

  it('A. driver without Stripe account uses :v2 creation key', async () => {
    await getOrCreateDriverStripeAccountId(DRIVER_ID);
    expect(mockAccountsCreate).toHaveBeenCalledTimes(1);
    expect(mockAccountsCreate.mock.calls[0][1]).toEqual({
      idempotencyKey: `driver:${DRIVER_ID}:stripe-connect-account:v2`,
    });
    expect(buildDriverStripeAccountCreateIdempotencyKey(DRIVER_ID)).toBe(
      FinancialIdempotencyKey.connectAccount(DRIVER_ID)
    );
    expect(STRIPE_CONNECT_ACCOUNT_CREATE_IDEMPOTENCY_VERSION).toBe('v2');
  });

  it('B. repeated onboarding reuses the same connected account', async () => {
    await createDriverOnboardingLink(DRIVER_ID);
    const second = await createDriverOnboardingLink(DRIVER_ID);
    expect(mockAccountsCreate).toHaveBeenCalledTimes(1);
    expect(second.accountId).toBe('acct_v2_test');
    expect(mockAccountLinksCreate).toHaveBeenCalledTimes(2);
  });

  it('C. existing stripeAccountId skips accounts.create', async () => {
    storedAccountId = 'acct_existing';
    const accountId = await getOrCreateDriverStripeAccountId(DRIVER_ID);
    expect(accountId).toBe('acct_existing');
    expect(mockAccountsCreate).not.toHaveBeenCalled();
  });

  it('D. concurrent onboarding resolves to one connected account', async () => {
    mockAccountsCreate.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return stripeAccount();
    });
    const [first, second] = await Promise.all([
      createDriverOnboardingLink(DRIVER_ID),
      createDriverOnboardingLink(DRIVER_ID),
    ]);
    expect(mockAccountsCreate).toHaveBeenCalledTimes(1);
    expect(first.accountId).toBe('acct_v2_test');
    expect(second.accountId).toBe('acct_v2_test');
  });

  it('E. race claim keeps persisted account as source of truth', async () => {
    mockClaimDriverStripeAccountId.mockResolvedValueOnce({
      claimed: false,
      accountId: 'acct_already_claimed',
    });
    mockFindDriverById.mockImplementation(async () =>
      baseDriver({ stripeAccountId: 'acct_already_claimed' })
    );
    const accountId = await getOrCreateDriverStripeAccountId(DRIVER_ID);
    expect(accountId).toBe('acct_already_claimed');
  });

  it('F. status reflects connected account after creation', async () => {
    storedAccountId = 'acct_v2_test';
    mockAccountsRetrieve.mockResolvedValue(
      stripeAccount({ details_submitted: false, payouts_enabled: false })
    );
    const status = await getDriverPayoutStatus(DRIVER_ID);
    expect(status.connected).toBe(true);
    expect(status.status).toBe('onboarding_required');
    expect(status.accountId).toBe('acct_v2_test');
  });

  it('G. stripeConnectAccountIdempotencyKey aliases v2 builder', () => {
    expect(stripeConnectAccountIdempotencyKey('driver-1')).toBe(
      buildDriverStripeAccountCreateIdempotencyKey('driver-1')
    );
    expect(stripeConnectAccountIdempotencyKey('driver-1')).not.toBe(
      'driver:driver-1:stripe-connect-account'
    );
  });
});
