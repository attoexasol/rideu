/**
 * Driver Stripe Connect onboarding and payout-readiness sync.
 *
 * Phase B: connected accounts + hosted Account Links only.
 * Does not create PaymentIntents, Charges, Transfers, or commission.
 */

import type Stripe from 'stripe';
import {
  getStripeConnectDefaultCountry,
  getStripeConnectRefreshUrl,
  getStripeConnectReturnUrl,
} from '../config/stripe';
import {
  buildDriverStripeAccountCreateIdempotencyKey,
  normalizeStripeConnectStatus,
  StripeConnectAccountStatus,
  type NormalizedStripeConnectAccount,
  type StripeConnectAccountStatusType,
  type StripeTransfersCapability,
} from '../constants/stripeConnect';
import { logger } from '../middleware/logger';
import {
  claimDriverStripeAccountId,
  findDriverById,
  findDriverByStripeAccountId,
  persistDriverStripeAccountSync,
} from '../repositories/driverStripe.repository';
import { PaymentError } from './payment.errors';
import { getStripeClient, isStripeReady } from './stripe.service';
import {
  extractStripeConnectErrorDetails,
  isStripeAccountsV1Disabled,
  isStripeConnectPlatformNotEnabled,
  logStripeConnectAccountCreateFailure,
} from './stripeConnect.debug';

const accountCreateLocks = new Map<string, Promise<string>>();

export function resetStripeConnectLocksForTests(): void {
  accountCreateLocks.clear();
}

export type DriverPayoutStatusResponse = {
  connected: boolean;
  accountId: string | null;
  country: string | null;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  status: StripeConnectAccountStatusType;
  requirements: {
    currentlyDue: string[];
    eventuallyDue: string[];
  };
  lastSyncedAt: string | null;
};

export type DriverOnboardingLinkResponse = {
  url: string;
  expiresAt: string;
  accountId: string;
  status: StripeConnectAccountStatusType;
};

function assertStripeConfiguredForConnect(): void {
  if (!isStripeReady()) {
    throw new PaymentError(
      'STRIPE_NOT_CONFIGURED',
      'Stripe is not configured. Cash bookings remain available.',
      503
    );
  }
}

function resolveConnectCountryOrThrow(): string {
  const country = getStripeConnectDefaultCountry();
  if (!country) {
    throw new PaymentError(
      'STRIPE_CONNECT_COUNTRY_REQUIRED',
      'A payout country is required to create a Stripe connected account. Set STRIPE_CONNECT_DEFAULT_COUNTRY (ISO 3166-1 alpha-2). Fare currency BDT is not a country.',
      400
    );
  }
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new PaymentError(
      'STRIPE_CONNECT_COUNTRY_REQUIRED',
      'STRIPE_CONNECT_DEFAULT_COUNTRY must be an ISO 3166-1 alpha-2 code. Do not infer country from locale, IP, phone, or fare currency.',
      400
    );
  }
  return country;
}

function parseConnectHttpUrl(value: string | undefined, missingCode: string): string {
  if (!value) {
    throw new PaymentError(
      missingCode,
      'Stripe Connect return and refresh URLs must be configured. Set STRIPE_CONNECT_RETURN_URL and STRIPE_CONNECT_REFRESH_URL.',
      503
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new PaymentError(
      'STRIPE_CONNECT_URL_INVALID',
      'Stripe Connect return/refresh URL is not a valid URL.',
      503
    );
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new PaymentError(
      'STRIPE_CONNECT_URL_INVALID',
      'Stripe Connect return/refresh URLs must use http or https.',
      503
    );
  }
  return value;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function asTransfersCapability(value: unknown): StripeTransfersCapability {
  if (
    value === 'active' ||
    value === 'inactive' ||
    value === 'pending' ||
    value === 'unrequested'
  ) {
    return value;
  }
  return null;
}

function isCountryRejectedByStripe(error: unknown): boolean {
  const err = error as { param?: string; code?: string; message?: string };
  const message = typeof err.message === 'string' ? err.message : '';
  if (err.param === 'country') return true;
  if (err.code === 'country_unsupported' || err.code === 'account_invalid') {
    return /country/i.test(message) || err.code === 'country_unsupported';
  }
  return /unsupported.{0,40}country|invalid.{0,20}country|cannot create .{0,80}account.?s? in /i.test(
    message
  );
}

function mapStripeAccountCreateError(error: unknown, driverId: string, country: string): never {
  logStripeConnectAccountCreateFailure(driverId, country, error);
  const err = extractStripeConnectErrorDetails(error);
  logger.warn({
    type: 'stripe.connect.account_create_failed',
    driverId,
    configuredCountry: country,
    stripeErrorType: err.stripeErrorType,
    stripeErrorCode: err.stripeErrorCode,
    stripeErrorParam: err.stripeErrorParam,
    stripeConnectNotEnabled: isStripeConnectPlatformNotEnabled(error),
    stripeAccountsV1Disabled: isStripeAccountsV1Disabled(error),
  });
  if (isCountryRejectedByStripe(error)) {
    throw new PaymentError(
      'STRIPE_CONNECT_COUNTRY_UNSUPPORTED',
      'Stripe rejected the configured connected-account country. Set a Stripe-supported country. Do not substitute another country.',
      400
    );
  }
  throw new PaymentError(
    'STRIPE_CONNECT_ACCOUNT_CREATE_FAILED',
    'Unable to create a Stripe connected account.',
    502
  );
}

export function normalizeStripeAccount(
  account: Pick<
    Stripe.Account,
    | 'country'
    | 'details_submitted'
    | 'charges_enabled'
    | 'payouts_enabled'
    | 'requirements'
    | 'capabilities'
  >
): NormalizedStripeConnectAccount {
  const currentlyDue = asStringArray(account.requirements?.currently_due);
  const eventuallyDue = asStringArray(account.requirements?.eventually_due);
  const disabledReason =
    typeof account.requirements?.disabled_reason === 'string' &&
    account.requirements.disabled_reason.length > 0
      ? account.requirements.disabled_reason
      : null;
  const transfersCapability = asTransfersCapability(account.capabilities?.transfers);
  const snapshot = {
    detailsSubmitted: Boolean(account.details_submitted),
    chargesEnabled: Boolean(account.charges_enabled),
    payoutsEnabled: Boolean(account.payouts_enabled),
    currentlyDue,
    eventuallyDue,
    disabledReason,
    transfersCapability,
  };
  return {
    country: account.country ?? null,
    ...snapshot,
    status: normalizeStripeConnectStatus(snapshot),
  };
}

export function extractConnectedAccountIdFromEvent(event: Stripe.Event): string | null {
  if (event.type === 'account.updated') {
    const obj = event.data.object as { id?: string; object?: string };
    if (obj.object === 'account' && typeof obj.id === 'string') return obj.id;
    if (typeof obj.id === 'string' && obj.id.startsWith('acct_')) return obj.id;
    return null;
  }

  if (event.type === 'capability.updated') {
    const obj = event.data.object as { account?: string | { id?: string } };
    if (typeof obj.account === 'string') return obj.account;
    if (obj.account && typeof obj.account === 'object' && typeof obj.account.id === 'string') {
      return obj.account.id;
    }
    if (typeof event.account === 'string') return event.account;
    return null;
  }

  return typeof event.account === 'string' ? event.account : null;
}

export async function syncDriverStripeAccount(
  driverId: string,
  stripeAccountId: string,
  accountHint?: Stripe.Account
): Promise<NormalizedStripeConnectAccount> {
  let account = accountHint;
  try {
    account = await getStripeClient().accounts.retrieve(stripeAccountId);
  } catch (error) {
    if (!accountHint) {
      logger.warn({
        type: 'stripe.connect.sync_failed',
        driverId,
        stripeAccountId,
      });
      throw new PaymentError(
        'STRIPE_CONNECT_SYNC_FAILED',
        'Unable to refresh Stripe connected-account status.',
        502
      );
    }
    logger.warn({
      type: 'stripe.connect.sync_retrieve_failed_using_hint',
      driverId,
      stripeAccountId,
    });
  }

  if (!account) {
    throw new PaymentError(
      'STRIPE_CONNECT_SYNC_FAILED',
      'Unable to refresh Stripe connected-account status.',
      502
    );
  }

  const normalized = normalizeStripeAccount(account);
  await persistDriverStripeAccountSync(driverId, {
    country: normalized.country,
    status: normalized.status,
    detailsSubmitted: normalized.detailsSubmitted,
    chargesEnabled: snapshotCharges(normalized),
    payoutsEnabled: normalized.payoutsEnabled,
    currentlyDue: normalized.currentlyDue,
    eventuallyDue: normalized.eventuallyDue,
  });
  return normalized;
}

function snapshotCharges(normalized: NormalizedStripeConnectAccount): boolean {
  return normalized.chargesEnabled;
}

async function createConnectedAccountForDriver(
  driverId: string,
  country: string
): Promise<string> {
  const stripe = getStripeClient();
  let account: Stripe.Account;
  try {
    account = await stripe.accounts.create(
      {
        country,
        business_type: 'individual',
        controller: {
          fees: { payer: 'application' },
          losses: { payments: 'application' },
          requirement_collection: 'stripe',
          stripe_dashboard: { type: 'express' },
        },
        capabilities: {
          transfers: { requested: true },
        },
        metadata: {
          driverId,
        },
      },
      { idempotencyKey: buildDriverStripeAccountCreateIdempotencyKey(driverId) }
    );
  } catch (error) {
    mapStripeAccountCreateError(error, driverId, country);
  }

  const claimed = await claimDriverStripeAccountId(driverId, account.id, country);
  if (!claimed.claimed && claimed.accountId !== account.id) {
    logger.warn({
      type: 'stripe.connect.account_id_race',
      driverId,
      persistedAccountId: claimed.accountId,
    });
  } else {
    logger.info({
      type: 'stripe.connect.account_created',
      driverId,
      stripeAccountId: claimed.accountId,
    });
  }

  try {
    await syncDriverStripeAccount(driverId, claimed.accountId, account);
  } catch (error) {
    logger.warn({
      type: 'stripe.connect.initial_sync_failed',
      driverId,
      stripeAccountId: claimed.accountId,
    });
    if (error instanceof PaymentError && error.code === 'STRIPE_CONNECT_SYNC_FAILED') {
      return claimed.accountId;
    }
    throw error;
  }

  return claimed.accountId;
}

export async function getOrCreateDriverStripeAccountId(driverId: string): Promise<string> {
  assertStripeConfiguredForConnect();
  const driver = await findDriverById(driverId);
  if (!driver) {
    throw new PaymentError('DRIVER_NOT_FOUND', 'Driver not found.', 404);
  }
  if (driver.stripeAccountId) {
    return driver.stripeAccountId;
  }

  const existingLock = accountCreateLocks.get(driverId);
  if (existingLock) {
    return existingLock;
  }

  const createPromise = (async () => {
    const latest = await findDriverById(driverId);
    if (latest?.stripeAccountId) {
      return latest.stripeAccountId;
    }
    const country = resolveConnectCountryOrThrow();
    return createConnectedAccountForDriver(driverId, country);
  })().finally(() => {
    accountCreateLocks.delete(driverId);
  });

  accountCreateLocks.set(driverId, createPromise);
  return createPromise;
}

export async function createDriverOnboardingLink(
  driverId: string
): Promise<DriverOnboardingLinkResponse> {
  assertStripeConfiguredForConnect();
  const returnUrl = parseConnectHttpUrl(
    getStripeConnectReturnUrl(),
    'STRIPE_CONNECT_RETURN_URL_REQUIRED'
  );
  const refreshUrl = parseConnectHttpUrl(
    getStripeConnectRefreshUrl(),
    'STRIPE_CONNECT_REFRESH_URL_REQUIRED'
  );

  const accountId = await getOrCreateDriverStripeAccountId(driverId);
  const stripe = getStripeClient();
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding',
  });

  logger.info({
    type: 'stripe.connect.account_link_created',
    driverId,
    stripeAccountId: accountId,
    expiresAt: accountLink.expires_at,
  });

  const driver = await findDriverById(driverId);
  let status: StripeConnectAccountStatusType =
    (driver?.stripeAccountStatus as StripeConnectAccountStatusType | undefined) ||
    StripeConnectAccountStatus.ONBOARDING_REQUIRED;
  try {
    const synced = await syncDriverStripeAccount(driverId, accountId);
    status = synced.status;
  } catch {
    // Account Link is still valid; status remains last persisted snapshot.
  }

  return {
    url: accountLink.url,
    expiresAt: new Date(accountLink.expires_at * 1000).toISOString(),
    accountId,
    status,
  };
}

function toStatusResponse(
  driver: Awaited<ReturnType<typeof findDriverById>>,
  normalized?: NormalizedStripeConnectAccount
): DriverPayoutStatusResponse {
  const accountId = driver?.stripeAccountId ?? null;
  if (!accountId) {
    return {
      connected: false,
      accountId: null,
      country: null,
      detailsSubmitted: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      status: StripeConnectAccountStatus.NOT_CONNECTED,
      requirements: { currentlyDue: [], eventuallyDue: [] },
      lastSyncedAt: null,
    };
  }

  const lastSyncedAt = driver?.stripeLastSyncedAt
    ? driver.stripeLastSyncedAt.toISOString()
    : new Date().toISOString();

  return {
    connected: true,
    accountId,
    country: normalized?.country ?? driver?.stripeAccountCountry ?? null,
    detailsSubmitted: normalized?.detailsSubmitted ?? driver?.stripeDetailsSubmitted ?? false,
    chargesEnabled: normalized?.chargesEnabled ?? driver?.stripeChargesEnabled ?? false,
    payoutsEnabled: normalized?.payoutsEnabled ?? driver?.stripePayoutsEnabled ?? false,
    status:
      normalized?.status ??
      (driver?.stripeAccountStatus as StripeConnectAccountStatusType | undefined) ??
      StripeConnectAccountStatus.ONBOARDING_REQUIRED,
    requirements: {
      currentlyDue: normalized?.currentlyDue ?? asStringArray(driver?.stripeRequirementsCurrentlyDue),
      eventuallyDue: normalized?.eventuallyDue ?? asStringArray(driver?.stripeRequirementsEventuallyDue),
    },
    lastSyncedAt,
  };
}

export async function getDriverPayoutStatus(driverId: string): Promise<DriverPayoutStatusResponse> {
  assertStripeConfiguredForConnect();
  const driver = await findDriverById(driverId);
  if (!driver) {
    throw new PaymentError('DRIVER_NOT_FOUND', 'Driver not found.', 404);
  }
  if (!driver.stripeAccountId) {
    return toStatusResponse(driver);
  }

  const normalized = await syncDriverStripeAccount(driverId, driver.stripeAccountId);
  const refreshed = await findDriverById(driverId);
  return toStatusResponse(refreshed ?? driver, normalized);
}

/**
 * account.updated / capability.updated: sync known drivers only.
 * Unknown connected-account ids are acknowledged and not attached to any driver.
 */
export async function handleStripeConnectWebhookEvent(event: Stripe.Event): Promise<void> {
  if (event.type !== 'account.updated' && event.type !== 'capability.updated') {
    return;
  }

  const accountId = extractConnectedAccountIdFromEvent(event);
  if (!accountId) {
    logger.info({
      type: 'stripe.connect.webhook_ignored',
      stripeEventId: event.id,
      stripeEventType: event.type,
      reason: 'missing_account_id',
    });
    return;
  }

  const driver = await findDriverByStripeAccountId(accountId);
  if (!driver) {
    logger.info({
      type: 'stripe.connect.unknown_account',
      stripeEventId: event.id,
      stripeEventType: event.type,
      stripeAccountId: accountId,
    });
    return;
  }

  const hint =
    event.type === 'account.updated' ? (event.data.object as Stripe.Account) : undefined;
  await syncDriverStripeAccount(driver.id, accountId, hint);
}
