/**
 * Safe Stripe Connect debug logging for account-creation failures.
 * Development/operations aid — does not log secrets or PII.
 */

import Stripe from 'stripe';
import {
  classifyStripeSecretMode,
  getStripeConnectDefaultCountry,
  isStripeSecretConfigured,
} from '../config/stripe';

const DEBUG_PREFIX = '[STRIPE_CONNECT_DEBUG]';

export type StripeConnectDebugErrorDetails = {
  stripeErrorType: string | null;
  stripeErrorCode: string | null;
  stripeErrorParam: string | null;
  stripeErrorMessage: string | null;
  stripeHttpStatus: number | null;
  requestId: string | null;
};

export function extractStripeConnectErrorDetails(error: unknown): StripeConnectDebugErrorDetails {
  if (error instanceof Stripe.errors.StripeError) {
    const param = (error as Stripe.errors.StripeError & { param?: string }).param;
    return {
      stripeErrorType: error.type ?? null,
      stripeErrorCode: error.code ?? null,
      stripeErrorParam: typeof param === 'string' ? param : null,
      stripeErrorMessage: error.message ?? null,
      stripeHttpStatus: error.statusCode ?? null,
      requestId: error.requestId ?? null,
    };
  }

  const err = error as {
    type?: string;
    code?: string;
    param?: string;
    message?: string;
    statusCode?: number;
    requestId?: string;
  };

  return {
    stripeErrorType: typeof err.type === 'string' ? err.type : null,
    stripeErrorCode: typeof err.code === 'string' ? err.code : null,
    stripeErrorParam: typeof err.param === 'string' ? err.param : null,
    stripeErrorMessage: typeof err.message === 'string' ? err.message : null,
    stripeHttpStatus: typeof err.statusCode === 'number' ? err.statusCode : null,
    requestId: typeof err.requestId === 'string' ? err.requestId : null,
  };
}

/** True when the platform Stripe account has not enrolled in Connect. */
export function isStripeConnectPlatformNotEnabled(error: unknown): boolean {
  const { stripeErrorMessage } = extractStripeConnectErrorDetails(error);
  if (!stripeErrorMessage) return false;
  if (isStripeAccountsV1Disabled(error)) return false;
  return /signed up for Connect|sign up for Connect|Connect is not enabled/i.test(
    stripeErrorMessage
  );
}

/** True when Connect is enabled but Accounts v1 create is disabled for the platform. */
export function isStripeAccountsV1Disabled(error: unknown): boolean {
  const { stripeErrorMessage } = extractStripeConnectErrorDetails(error);
  if (!stripeErrorMessage) return false;
  return /Accounts v1|feat_accounts_v1_support|v2\/core\/accounts/i.test(stripeErrorMessage);
}

export function logStripeConnectEnvironment(): void {
  console.info(`${DEBUG_PREFIX} stripeSecretPresent=${isStripeSecretConfigured()}`);
  console.info(`${DEBUG_PREFIX} stripeSecretMode=${classifyStripeSecretMode()}`);
  console.info(
    `${DEBUG_PREFIX} configuredCountry=${getStripeConnectDefaultCountry() ?? 'MISSING'}`
  );
}

export function logStripeConnectAccountCreateFailure(
  driverId: string,
  country: string,
  error: unknown
): void {
  const details = extractStripeConnectErrorDetails(error);

  // Structured logger in stripeConnect.service.ts carries operational fields.
  // Console detail is dev/test-only to avoid noisy production logs.
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv !== 'development' && nodeEnv !== 'test') {
    return;
  }

  console.warn(`${DEBUG_PREFIX} operation=accounts.create`);
  console.warn(`${DEBUG_PREFIX} driverId=${driverId}`);
  console.warn(`${DEBUG_PREFIX} configuredCountry=${country}`);
  logStripeConnectEnvironment();
  console.warn(`${DEBUG_PREFIX} stripeErrorType=${details.stripeErrorType ?? 'null'}`);
  console.warn(`${DEBUG_PREFIX} stripeErrorCode=${details.stripeErrorCode ?? 'null'}`);
  console.warn(`${DEBUG_PREFIX} stripeErrorParam=${details.stripeErrorParam ?? 'null'}`);
  console.warn(`${DEBUG_PREFIX} stripeErrorMessage=${details.stripeErrorMessage ?? 'null'}`);
  console.warn(`${DEBUG_PREFIX} stripeHttpStatus=${details.stripeHttpStatus ?? 'null'}`);
  console.warn(`${DEBUG_PREFIX} requestId=${details.requestId ?? 'null'}`);

  if (isStripeAccountsV1Disabled(error)) {
    console.warn(
      `${DEBUG_PREFIX} dashboardAction=Enable Accounts v1 support at https://dashboard.stripe.com/settings/features/feat_accounts_v1_support (test mode) or migrate to Accounts v2.`
    );
  } else if (isStripeConnectPlatformNotEnabled(error)) {
    console.warn(
      `${DEBUG_PREFIX} dashboardAction=Enable Stripe Connect at https://dashboard.stripe.com/connect for this platform account (test mode uses the test dashboard).`
    );
  }
}
