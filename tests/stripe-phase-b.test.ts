import fs from 'fs';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { drivers } from '../src/db/schema/drivers';
import { FinancialIdempotencyKey } from '../src/constants/payment';
import {
  normalizeStripeConnectStatus,
  buildDriverStripeAccountCreateIdempotencyKey,
  stripeConnectAccountIdempotencyKey,
  StripeConnectAccountStatus,
} from '../src/constants/stripeConnect';
import { PaymentError } from '../src/services/payment.errors';
import {
  assertCardPaymentAllowed,
  authorizePayment,
  capturePayment,
  preparePayment,
  settleCompletedBooking,
} from '../src/services/payment.service';
import { calculateSettlement } from '../src/services/settlement.service';
import { PaymentMethodCode } from '../src/constants/payment';
import { validateEnvironment, printEnvironmentInfo } from '../src/config/env-validator';
import { shouldSkipGlobalRateLimit } from '../src/middleware/rate-limit-paths';
import { logger } from '../src/middleware/logger';
import { errorHandler } from '../src/middleware/error-handler';

const mockIsStripeReady = jest.fn(() => true);
const mockGetStripeClient = jest.fn();
const mockFindDriverById = jest.fn();
const mockFindDriverByStripeAccountId = jest.fn();
const mockClaimDriverStripeAccountId = jest.fn();
const mockPersistDriverStripeAccountSync = jest.fn();
const mockFindByAuth0Id = jest.fn();

const authState = {
  auth0Id: 'auth0|driver-a',
};

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
  findDriverByStripeAccountId: (accountId: string) => mockFindDriverByStripeAccountId(accountId),
  claimDriverStripeAccountId: (driverId: string, accountId: string, country: string) =>
    mockClaimDriverStripeAccountId(driverId, accountId, country),
  persistDriverStripeAccountSync: (driverId: string, fields: unknown) =>
    mockPersistDriverStripeAccountSync(driverId, fields),
}));

jest.mock('../src/db/utils', () => ({
  driverUtils: {
    findByAuth0Id: (auth0Id: string) => mockFindByAuth0Id(auth0Id),
  },
}));

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  extractUserInfo: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { auth0Id: authState.auth0Id, role: 'driver', userId: 'driver-a' };
    next();
  },
}));

jest.mock('../src/middleware/rbac', () => ({
  requireDriver: [(_req: unknown, _res: unknown, next: () => void) => next()],
}));

jest.mock('../src/middleware/rate-limiters', () => ({
  driverGeneralRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import {
  createDriverOnboardingLink,
  extractConnectedAccountIdFromEvent,
  getDriverPayoutStatus,
  getOrCreateDriverStripeAccountId,
  handleStripeConnectWebhookEvent,
  normalizeStripeAccount,
  resetStripeConnectLocksForTests,
} from '../src/services/stripeConnect.service';
import driverPayoutRoutes from '../src/routes/v1/driver/payouts';

const DRIVER_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const DRIVER_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const RETURN_URL = 'https://app.example/driver/payouts/return';
const REFRESH_URL = 'https://app.example/driver/payouts/refresh';
const ACCOUNT_LINK_URL = 'https://connect.stripe.com/setup/s/test_onboarding';

function baseDriver(overrides: Record<string, unknown> = {}) {
  return {
    id: DRIVER_A_ID,
    auth0Id: 'auth0|driver-a',
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
    id: 'acct_test_1',
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

function createPayoutApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/driver/payouts', driverPayoutRoutes);
  app.use(errorHandler);
  return app;
}

describe('Stripe Phase B — status mapping', () => {
  it('maps incomplete onboarding correctly', () => {
    expect(
      normalizeStripeConnectStatus({
        detailsSubmitted: false,
        chargesEnabled: false,
        payoutsEnabled: false,
        currentlyDue: ['individual.verification.document'],
        eventuallyDue: [],
        disabledReason: null,
        transfersCapability: 'inactive',
      })
    ).toBe(StripeConnectAccountStatus.ONBOARDING_REQUIRED);

    expect(
      normalizeStripeAccount(
        stripeAccount({
          details_submitted: false,
          payouts_enabled: false,
          requirements: { currently_due: [], eventually_due: [], disabled_reason: null },
        }) as any
      ).status
    ).toBe(StripeConnectAccountStatus.ONBOARDING_REQUIRED);
  });

  it('maps verification pending correctly', () => {
    expect(
      normalizeStripeConnectStatus({
        detailsSubmitted: true,
        chargesEnabled: false,
        payoutsEnabled: false,
        currentlyDue: [],
        eventuallyDue: ['individual.verification.document'],
        disabledReason: null,
        transfersCapability: 'pending',
      })
    ).toBe(StripeConnectAccountStatus.VERIFICATION_PENDING);
  });

  it('maps ready from payouts_enabled, not charges_enabled', () => {
    expect(
      normalizeStripeConnectStatus({
        detailsSubmitted: true,
        chargesEnabled: false,
        payoutsEnabled: true,
        currentlyDue: [],
        eventuallyDue: [],
        disabledReason: null,
        transfersCapability: 'active',
      })
    ).toBe(StripeConnectAccountStatus.READY);

    expect(
      normalizeStripeConnectStatus({
        detailsSubmitted: true,
        chargesEnabled: true,
        payoutsEnabled: false,
        currentlyDue: [],
        eventuallyDue: [],
        disabledReason: null,
        transfersCapability: 'active',
      })
    ).toBe(StripeConnectAccountStatus.VERIFICATION_PENDING);
  });

  it('maps restricted when Stripe reports a disabled reason', () => {
    expect(
      normalizeStripeConnectStatus({
        detailsSubmitted: true,
        chargesEnabled: false,
        payoutsEnabled: false,
        currentlyDue: [],
        eventuallyDue: [],
        disabledReason: 'requirements.past_due',
        transfersCapability: 'inactive',
      })
    ).toBe(StripeConnectAccountStatus.RESTRICTED);
  });
});

describe('Stripe Phase B — driver Connect onboarding', () => {
  const mockAccountsCreate = jest.fn();
  const mockAccountsRetrieve = jest.fn();
  const mockAccountLinksCreate = jest.fn();
  let storedAccountId: string | null = null;

  beforeEach(() => {
    resetStripeConnectLocksForTests();
    mockIsStripeReady.mockReturnValue(true);
    storedAccountId = null;
    process.env.STRIPE_CONNECT_DEFAULT_COUNTRY = 'US';
    process.env.STRIPE_CONNECT_RETURN_URL = RETURN_URL;
    process.env.STRIPE_CONNECT_REFRESH_URL = REFRESH_URL;
    mockAccountsCreate.mockReset();
    mockAccountsRetrieve.mockReset();
    mockAccountLinksCreate.mockReset();
    mockFindDriverById.mockReset();
    mockFindDriverByStripeAccountId.mockReset();
    mockClaimDriverStripeAccountId.mockReset();
    mockPersistDriverStripeAccountSync.mockReset();
    mockFindByAuth0Id.mockReset();
    mockGetStripeClient.mockReturnValue({
      accounts: { create: mockAccountsCreate, retrieve: mockAccountsRetrieve },
      accountLinks: { create: mockAccountLinksCreate },
      paymentIntents: { create: jest.fn() },
      charges: { create: jest.fn() },
      transfers: { create: jest.fn() },
    });
    mockFindDriverById.mockImplementation(async () => baseDriver({ stripeAccountId: storedAccountId }));
    mockClaimDriverStripeAccountId.mockImplementation(async (_id: string, accountId: string) => {
      storedAccountId = accountId;
      return { claimed: true, accountId };
    });
    mockPersistDriverStripeAccountSync.mockResolvedValue(undefined);
    mockAccountsCreate.mockResolvedValue(stripeAccount());
    mockAccountsRetrieve.mockResolvedValue(stripeAccount());
    mockAccountLinksCreate.mockResolvedValue({
      object: 'account_link',
      url: ACCOUNT_LINK_URL,
      expires_at: 1_700_000_000,
    });
    mockFindByAuth0Id.mockResolvedValue(baseDriver());
    authState.auth0Id = 'auth0|driver-a';
  });

  afterEach(() => {
    resetStripeConnectLocksForTests();
    delete process.env.STRIPE_CONNECT_DEFAULT_COUNTRY;
    delete process.env.CONNECT_DEFAULT_COUNTRY;
    delete process.env.STRIPE_CONNECT_RETURN_URL;
    delete process.env.STRIPE_CONNECT_REFRESH_URL;
  });

  it('A. driver with no Stripe account: status = not_connected', async () => {
    const status = await getDriverPayoutStatus(DRIVER_A_ID);
    expect(status.status).toBe('not_connected');
    expect(status.connected).toBe(false);
    expect(status.accountId).toBeNull();
    expect(mockAccountsCreate).not.toHaveBeenCalled();
    expect(mockGetStripeClient().paymentIntents.create).not.toHaveBeenCalled();
  });

  it('B. onboarding link creates exactly one Stripe connected account', async () => {
    const result = await createDriverOnboardingLink(DRIVER_A_ID);
    expect(mockAccountsCreate).toHaveBeenCalledTimes(1);
    expect(mockAccountsCreate.mock.calls[0][0]).toMatchObject({
      country: 'US',
      business_type: 'individual',
      controller: {
        fees: { payer: 'application' },
        losses: { payments: 'application' },
        requirement_collection: 'stripe',
        stripe_dashboard: { type: 'express' },
      },
      capabilities: { transfers: { requested: true } },
      metadata: { driverId: DRIVER_A_ID },
    });
    expect(mockAccountsCreate.mock.calls[0][0].type).toBeUndefined();
    expect(mockAccountsCreate.mock.calls[0][0].capabilities.card_payments).toBeUndefined();
    expect(mockAccountsCreate.mock.calls[0][1]).toEqual({
      idempotencyKey: buildDriverStripeAccountCreateIdempotencyKey(DRIVER_A_ID),
    });
    expect(result.accountId).toBe('acct_test_1');
    expect(result.url).toBe(ACCOUNT_LINK_URL);
    expect(result.status).toBe('onboarding_required');
    expect(mockClaimDriverStripeAccountId).toHaveBeenCalledWith(DRIVER_A_ID, 'acct_test_1', 'US');
  });

  it('C. duplicate onboarding-link calls reuse the same account ID', async () => {
    await createDriverOnboardingLink(DRIVER_A_ID);
    const second = await createDriverOnboardingLink(DRIVER_A_ID);
    expect(mockAccountsCreate).toHaveBeenCalledTimes(1);
    expect(second.accountId).toBe('acct_test_1');
    expect(mockAccountLinksCreate).toHaveBeenCalledTimes(2);
  });

  it('D. duplicate request race cannot create two accounts for one driver', async () => {
    mockAccountsCreate.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return stripeAccount();
    });
    const [first, second] = await Promise.all([
      createDriverOnboardingLink(DRIVER_A_ID),
      createDriverOnboardingLink(DRIVER_A_ID),
    ]);
    expect(mockAccountsCreate).toHaveBeenCalledTimes(1);
    expect(first.accountId).toBe('acct_test_1');
    expect(second.accountId).toBe('acct_test_1');
  });

  it('E. missing payout country returns STRIPE_CONNECT_COUNTRY_REQUIRED', async () => {
    delete process.env.STRIPE_CONNECT_DEFAULT_COUNTRY;
    delete process.env.CONNECT_DEFAULT_COUNTRY;
    await expect(createDriverOnboardingLink(DRIVER_A_ID)).rejects.toMatchObject({
      code: 'STRIPE_CONNECT_COUNTRY_REQUIRED',
      statusCode: 400,
    });
    expect(mockAccountsCreate).not.toHaveBeenCalled();
  });

  it('does not guess country from BDT or BD', async () => {
    delete process.env.STRIPE_CONNECT_DEFAULT_COUNTRY;
    try {
      await createDriverOnboardingLink(DRIVER_A_ID);
    } catch (error) {
      expect((error as PaymentError).code).toBe('STRIPE_CONNECT_COUNTRY_REQUIRED');
    }
    expect(mockAccountsCreate).not.toHaveBeenCalled();
  });

  it('F. Stripe country rejection returns STRIPE_CONNECT_COUNTRY_UNSUPPORTED', async () => {
    mockAccountsCreate.mockRejectedValue({
      type: 'invalid_request_error',
      param: 'country',
      code: 'country_unsupported',
      message: 'You cannot create connected accounts in BD',
    });
    await expect(createDriverOnboardingLink(DRIVER_A_ID)).rejects.toMatchObject({
      code: 'STRIPE_CONNECT_COUNTRY_UNSUPPORTED',
      statusCode: 400,
    });
  });

  it('returns STRIPE_CONNECT_ACCOUNT_CREATE_FAILED when Connect is not enabled on platform', async () => {
    const debugLines: string[] = [];
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      debugLines.push(args.map(String).join(' '));
    });
    const infoSpy = jest.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      debugLines.push(args.map(String).join(' '));
    });

    mockAccountsCreate.mockRejectedValue(
      Object.assign(new Error('Connect not enabled'), {
        type: 'StripeInvalidRequestError',
        message:
          'You can only create new accounts if you have signed up for Connect, which you can do at https://dashboard.stripe.com/connect.',
        statusCode: 400,
        requestId: 'req_connect_disabled',
      })
    );

    await expect(createDriverOnboardingLink(DRIVER_A_ID)).rejects.toMatchObject({
      code: 'STRIPE_CONNECT_ACCOUNT_CREATE_FAILED',
      statusCode: 502,
    });

    const joined = debugLines.join('\n');
    expect(joined).toContain('[STRIPE_CONNECT_DEBUG] operation=accounts.create');
    expect(joined).toContain('[STRIPE_CONNECT_DEBUG] stripeErrorMessage=');
    expect(joined).toContain('signed up for Connect');
    expect(joined).toContain('[STRIPE_CONNECT_DEBUG] dashboardAction=Enable Stripe Connect');
    expect(joined).not.toContain('sk_test');

    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it('G. account link uses configured return/refresh URLs', async () => {
    await createDriverOnboardingLink(DRIVER_A_ID);
    expect(mockAccountLinksCreate).toHaveBeenCalledWith({
      account: 'acct_test_1',
      refresh_url: REFRESH_URL,
      return_url: RETURN_URL,
      type: 'account_onboarding',
    });
  });

  it('H. no secret or account-link URL is logged', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_this_must_never_appear_in_logs';
    const logs: string[] = [];
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation((obj: unknown) => {
      logs.push(JSON.stringify(obj));
      return logger;
    });
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation((obj: unknown) => {
      logs.push(JSON.stringify(obj));
      return logger;
    });
    const result = await createDriverOnboardingLink(DRIVER_A_ID);
    const joined = logs.join('\n');
    expect(joined).not.toContain('sk_test_this_must_never_appear_in_logs');
    expect(joined).not.toContain(ACCOUNT_LINK_URL);
    expect(JSON.stringify(result)).not.toContain('sk_test');
    expect(JSON.stringify(result)).not.toContain('sk_live');
    expect(JSON.stringify(result)).not.toContain('whsec_');
    expect(result.url).toBe(ACCOUNT_LINK_URL);
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    delete process.env.STRIPE_SECRET_KEY;
  });

  it('I/J/K. status endpoint maps onboarding, pending, and ready', async () => {
    storedAccountId = 'acct_test_1';
    mockAccountsRetrieve.mockResolvedValueOnce(
      stripeAccount({ details_submitted: false, payouts_enabled: false })
    );
    const onboarding = await getDriverPayoutStatus(DRIVER_A_ID);
    expect(onboarding.status).toBe('onboarding_required');

    mockAccountsRetrieve.mockResolvedValueOnce(
      stripeAccount({
        details_submitted: true,
        payouts_enabled: false,
        requirements: { currently_due: [], eventually_due: [], disabled_reason: null },
        capabilities: { transfers: 'pending' },
      })
    );
    const pending = await getDriverPayoutStatus(DRIVER_A_ID);
    expect(pending.status).toBe('verification_pending');

    mockAccountsRetrieve.mockResolvedValueOnce(
      stripeAccount({
        details_submitted: true,
        charges_enabled: false,
        payouts_enabled: true,
        requirements: { currently_due: [], eventually_due: [], disabled_reason: null },
        capabilities: { transfers: 'active' },
      })
    );
    const ready = await getDriverPayoutStatus(DRIVER_A_ID);
    expect(ready.status).toBe('ready');
    expect(ready.payoutsEnabled).toBe(true);
    expect(ready.chargesEnabled).toBe(false);
  });

  it('L. account.updated persists readiness', async () => {
    mockFindDriverByStripeAccountId.mockResolvedValue(baseDriver({ stripeAccountId: 'acct_test_1' }));
    mockAccountsRetrieve.mockResolvedValue(
      stripeAccount({
        details_submitted: true,
        payouts_enabled: true,
        requirements: { currently_due: [], eventually_due: [], disabled_reason: null },
        capabilities: { transfers: 'active' },
      })
    );
    await handleStripeConnectWebhookEvent({
      id: 'evt_account_updated',
      type: 'account.updated',
      data: {
        object: stripeAccount({
          details_submitted: true,
          payouts_enabled: true,
          capabilities: { transfers: 'active' },
        }),
      },
    } as any);
    expect(mockPersistDriverStripeAccountSync).toHaveBeenCalledWith(
      DRIVER_A_ID,
      expect.objectContaining({
        status: 'ready',
        payoutsEnabled: true,
      })
    );
  });

  it('M. unknown account.updated is acknowledged and not attached', async () => {
    mockFindDriverByStripeAccountId.mockResolvedValue(null);
    await handleStripeConnectWebhookEvent({
      id: 'evt_unknown_acct',
      type: 'account.updated',
      data: { object: stripeAccount({ id: 'acct_unknown' }) },
    } as any);
    expect(mockPersistDriverStripeAccountSync).not.toHaveBeenCalled();
    expect(mockClaimDriverStripeAccountId).not.toHaveBeenCalled();
  });

  it('O. driver A cannot create onboarding for driver B', async () => {
    mockFindByAuth0Id.mockImplementation(async (auth0Id: string) => {
      if (auth0Id === 'auth0|driver-a') return baseDriver({ id: DRIVER_A_ID });
      if (auth0Id === 'auth0|driver-b') return baseDriver({ id: DRIVER_B_ID, auth0Id: 'auth0|driver-b' });
      return null;
    });
    const res = await request(createPayoutApp())
      .post('/api/v1/driver/payouts/onboarding-link')
      .send({ accountId: 'acct_driver_b', driverId: DRIVER_B_ID });
    expect(res.status).toBe(200);
    expect(mockAccountsCreate.mock.calls[0][0].metadata.driverId).toBe(DRIVER_A_ID);
    expect(mockAccountsCreate.mock.calls[0][0].metadata.driverId).not.toBe(DRIVER_B_ID);
  });

  it('returns STRIPE_NOT_CONFIGURED when Stripe is unset', async () => {
    mockIsStripeReady.mockReturnValue(false);
    await expect(getDriverPayoutStatus(DRIVER_A_ID)).rejects.toMatchObject({
      code: 'STRIPE_NOT_CONFIGURED',
      statusCode: 503,
    });
    await expect(createDriverOnboardingLink(DRIVER_A_ID)).rejects.toMatchObject({
      code: 'STRIPE_NOT_CONFIGURED',
    });
    expect(mockAccountsCreate).not.toHaveBeenCalled();
  });

  it('uses FinancialIdempotencyKey.connectAccount', () => {
    expect(FinancialIdempotencyKey.connectAccount(DRIVER_A_ID)).toBe(
      `driver:${DRIVER_A_ID}:stripe-connect-account:v2`
    );
    expect(stripeConnectAccountIdempotencyKey(DRIVER_A_ID)).toBe(
      FinancialIdempotencyKey.connectAccount(DRIVER_A_ID)
    );
  });

  it('getOrCreate reuses an existing stripe_account_id without creating', async () => {
    storedAccountId = 'acct_existing';
    const accountId = await getOrCreateDriverStripeAccountId(DRIVER_A_ID);
    expect(accountId).toBe('acct_existing');
    expect(mockAccountsCreate).not.toHaveBeenCalled();
  });

  it('extracts acct ids from account.updated and ignores non-account objects', () => {
    expect(
      extractConnectedAccountIdFromEvent({
        type: 'account.updated',
        data: { object: { id: 'acct_ok', object: 'account' } },
      } as any)
    ).toBe('acct_ok');
    expect(
      extractConnectedAccountIdFromEvent({
        type: 'account.updated',
        data: { object: { id: 'obj_1', object: 'payment_intent' } },
      } as any)
    ).toBeNull();
  });
});

describe('Stripe Phase B — security, cash, and no money movement', () => {
  it('P. logout/deactivation does not delete Stripe connected accounts', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/services/profile.service.ts'),
      'utf8'
    );
    expect(src).not.toMatch(/accounts\.del|accounts\.delete/);
    expect(src).toMatch(/must not delete or detach them/);
    const deactivateBlock = src.slice(src.indexOf('export async function deactivateDriverAccount'));
    expect(deactivateBlock).not.toMatch(/stripeAccountId:\s*null/);
  });

  it('Q. cash still allowed; card gated by Stripe config (Phase C)', () => {
    const savedSecret = process.env.STRIPE_SECRET_KEY;
    const savedPublishable = process.env.STRIPE_PUBLISHABLE_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    expect(() => assertCardPaymentAllowed(PaymentMethodCode.CASH)).not.toThrow();
    expect(() => assertCardPaymentAllowed(PaymentMethodCode.CARD)).toThrow(PaymentError);
    if (savedSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = savedSecret;
    if (savedPublishable === undefined) delete process.env.STRIPE_PUBLISHABLE_KEY;
    else process.env.STRIPE_PUBLISHABLE_KEY = savedPublishable;
  });

  it('R–U. no PaymentIntent, Charge, Transfer, or commission in Connect service', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/services/stripeConnect.service.ts'),
      'utf8'
    );
    expect(src).not.toMatch(/paymentIntents/);
    expect(src).not.toMatch(/charges\.create/);
    expect(src).not.toMatch(/transfers\.create/);
    expect(src).not.toMatch(/calculateSettlement/);
  });

  it('R–U. payment and settlement APIs still throw', async () => {
    await expect(preparePayment()).rejects.toMatchObject({ code: 'PAYMENT_NOT_IMPLEMENTED' });
    await expect(authorizePayment()).rejects.toMatchObject({ code: 'PAYMENT_NOT_IMPLEMENTED' });
    await expect(capturePayment()).rejects.toMatchObject({ code: 'PAYMENT_NOT_IMPLEMENTED' });
    await expect(settleCompletedBooking()).rejects.toMatchObject({
      code: 'PAYMENT_NOT_IMPLEMENTED',
    });
    expect(() =>
      calculateSettlement({ bookingId: 'b1', grossAmountMinor: 12000, currency: 'BDT' })
    ).toThrow(/COMMISSION BUSINESS RULES NOT YET CONFIGURED/);
  });

  it('V. backend validates without Stripe config', () => {
    const saved = { ...process.env };
    process.env.NODE_ENV = 'test';
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_CONNECT_DEFAULT_COUNTRY;
    expect(() => validateEnvironment()).not.toThrow();
    process.env = saved;
  });

  it('never prints Connect URL values or secrets', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_hidden_secret';
    process.env.STRIPE_CONNECT_RETURN_URL = 'https://secret-return.example/return';
    process.env.STRIPE_CONNECT_REFRESH_URL = 'https://secret-refresh.example/refresh';
    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    printEnvironmentInfo();
    const joined = logs.join('\n');
    expect(joined).not.toContain('sk_test_hidden_secret');
    expect(joined).not.toContain('https://secret-return.example/return');
    expect(joined).not.toContain('https://secret-refresh.example/refresh');
    expect(joined).toContain('STRIPE_CONNECT_RETURN_URL: [SET]');
    spy.mockRestore();
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_CONNECT_RETURN_URL;
    delete process.env.STRIPE_CONNECT_REFRESH_URL;
  });

  it('skips global rate limit for driver payout endpoints', () => {
    expect(shouldSkipGlobalRateLimit('/api/v1/driver/payouts/onboarding-link')).toBe(true);
    expect(shouldSkipGlobalRateLimit('/api/v1/driver/payouts/status')).toBe(true);
  });

  it('migration adds nullable Connect columns and does not rewrite fare', () => {
    const sql = fs.readFileSync(
      path.join(__dirname, '../src/db/migrations/0028_driver_stripe_connect.sql'),
      'utf8'
    );
    expect(sql).toContain('stripe_account_id');
    expect(sql).toContain('uq_drivers_stripe_account_id');
    expect(sql).not.toMatch(/UPDATE\s+"bookings"/i);
    expect(sql).not.toMatch(/ALTER TABLE "bookings"/i);
    expect(sql).not.toMatch(/country.*=.*BD/);
    const cfg = getTableConfig(drivers);
    expect(cfg.indexes.map((idx) => idx.config.name)).toContain('uq_drivers_stripe_account_id');
  });
});
