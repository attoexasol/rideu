/**
 * Stripe Connect debug logging tests.
 */

import {
  extractStripeConnectErrorDetails,
  isStripeConnectPlatformNotEnabled,
  logStripeConnectAccountCreateFailure,
} from '../src/services/stripeConnect.debug';

describe('stripeConnect.debug', () => {
  const savedSecret = process.env.STRIPE_SECRET_KEY;
  const savedCountry = process.env.STRIPE_CONNECT_DEFAULT_COUNTRY;

  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_debug_only_not_real';
    process.env.STRIPE_CONNECT_DEFAULT_COUNTRY = 'US';
  });

  afterEach(() => {
    if (savedSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = savedSecret;
    if (savedCountry === undefined) delete process.env.STRIPE_CONNECT_DEFAULT_COUNTRY;
    else process.env.STRIPE_CONNECT_DEFAULT_COUNTRY = savedCountry;
  });

  it('extracts Stripe SDK error fields safely', () => {
    const error = {
      type: 'StripeInvalidRequestError',
      code: undefined,
      param: undefined,
      message: 'You can only create new accounts if you have signed up for Connect',
      statusCode: 400,
      requestId: 'req_test_123',
    };

    expect(extractStripeConnectErrorDetails(error)).toEqual({
      stripeErrorType: 'StripeInvalidRequestError',
      stripeErrorCode: null,
      stripeErrorParam: null,
      stripeErrorMessage:
        'You can only create new accounts if you have signed up for Connect',
      stripeHttpStatus: 400,
      requestId: 'req_test_123',
    });
  });

  it('detects Connect-not-enabled platform errors', () => {
    expect(
      isStripeConnectPlatformNotEnabled({
        message: 'You can only create new accounts if you have signed up for Connect',
      })
    ).toBe(true);
    expect(
      isStripeConnectPlatformNotEnabled({
        param: 'country',
        code: 'country_unsupported',
        message: 'You cannot create connected accounts in BD',
      })
    ).toBe(false);
  });

  it('logs debug fields without secrets', () => {
    const lines: string[] = [];
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });
    const infoSpy = jest.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });

    logStripeConnectAccountCreateFailure('driver-abc', 'US', {
      type: 'StripeInvalidRequestError',
      message: 'You can only create new accounts if you have signed up for Connect',
      statusCode: 400,
      requestId: 'req_safe_1',
    });

    const joined = lines.join('\n');
    expect(joined).toContain('[STRIPE_CONNECT_DEBUG] operation=accounts.create');
    expect(joined).toContain('[STRIPE_CONNECT_DEBUG] driverId=driver-abc');
    expect(joined).toContain('[STRIPE_CONNECT_DEBUG] configuredCountry=US');
    expect(joined).toContain('[STRIPE_CONNECT_DEBUG] stripeSecretPresent=true');
    expect(joined).toContain('[STRIPE_CONNECT_DEBUG] stripeSecretMode=test');
    expect(joined).toContain('[STRIPE_CONNECT_DEBUG] stripeHttpStatus=400');
    expect(joined).toContain('[STRIPE_CONNECT_DEBUG] requestId=req_safe_1');
    expect(joined).toContain('dashboardAction=Enable Stripe Connect');
    expect(joined).not.toContain('sk_test_debug_only_not_real');

    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });
});
