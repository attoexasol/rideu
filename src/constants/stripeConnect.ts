/**
 * Driver Stripe Connect payout readiness.
 *
 * Product statuses are backend-normalized. Do not expose the raw Stripe Account object.
 */

export const StripeConnectAccountStatus = {
  NOT_CONNECTED: 'not_connected',
  ONBOARDING_REQUIRED: 'onboarding_required',
  VERIFICATION_PENDING: 'verification_pending',
  RESTRICTED: 'restricted',
  READY: 'ready',
} as const;

export type StripeConnectAccountStatusType =
  (typeof StripeConnectAccountStatus)[keyof typeof StripeConnectAccountStatus];

export const STRIPE_CONNECT_ACCOUNT_STATUSES: StripeConnectAccountStatusType[] = [
  StripeConnectAccountStatus.NOT_CONNECTED,
  StripeConnectAccountStatus.ONBOARDING_REQUIRED,
  StripeConnectAccountStatus.VERIFICATION_PENDING,
  StripeConnectAccountStatus.RESTRICTED,
  StripeConnectAccountStatus.READY,
];

export type StripeTransfersCapability =
  | 'active'
  | 'inactive'
  | 'pending'
  | 'unrequested'
  | null;

/**
 * Fields used to map a Stripe Account onto the product status enum.
 * charges_enabled is persisted for diagnostics but is not the ready signal.
 */
export type StripeConnectAccountSnapshot = {
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  currentlyDue: string[];
  eventuallyDue: string[];
  disabledReason: string | null;
  transfersCapability: StripeTransfersCapability;
};

export type NormalizedStripeConnectAccount = {
  country: string | null;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  currentlyDue: string[];
  eventuallyDue: string[];
  disabledReason: string | null;
  transfersCapability: StripeTransfersCapability;
  status: StripeConnectAccountStatusType;
};

/**
 * Deterministic mapping (evaluated in this order):
 *
 * not_connected:
 *   no stripe_account_id (handled by the caller; this function assumes an account exists)
 *
 * restricted:
 *   Stripe requirements.disabled_reason is set
 *
 * ready:
 *   payouts_enabled === true
 *   AND transfers capability is active, or Stripe omitted it (Express-equivalent default)
 *   charges_enabled is NOT used as the ready signal
 *
 * onboarding_required:
 *   details_submitted === false OR currently_due is non-empty
 *
 * verification_pending:
 *   details submitted, no currently_due items, payouts not yet enabled, not restricted
 */
export function normalizeStripeConnectStatus(
  snapshot: StripeConnectAccountSnapshot
): StripeConnectAccountStatusType {
  if (snapshot.disabledReason) {
    return StripeConnectAccountStatus.RESTRICTED;
  }

  if (snapshot.payoutsEnabled && isTransferCapable(snapshot.transfersCapability)) {
    return StripeConnectAccountStatus.READY;
  }

  if (!snapshot.detailsSubmitted || snapshot.currentlyDue.length > 0) {
    return StripeConnectAccountStatus.ONBOARDING_REQUIRED;
  }

  return StripeConnectAccountStatus.VERIFICATION_PENDING;
}

function isTransferCapable(capability: StripeTransfersCapability): boolean {
  if (
    capability === 'inactive' ||
    capability === 'pending' ||
    capability === 'unrequested'
  ) {
    return false;
  }
  return true;
}

export const STRIPE_CONNECT_CREATE_IDEMPOTENCY_PREFIX = 'driver';

/**
 * Increment when Stripe must accept a fresh idempotency namespace (e.g. cached failed
 * accounts.create before Connect / Accounts v1 was ready). Persisted stripe_account_id
 * always wins — this only affects drivers with no connected account yet.
 *
 * - v1 (implicit, no suffix): Phase B initial key; replays pre-Connect failures.
 * - v2: 2026-09-09 — Accounts v1 verified on platform; bypasses stale v1 cache.
 */
export const STRIPE_CONNECT_ACCOUNT_CREATE_IDEMPOTENCY_VERSION = 'v2';

export function buildDriverStripeAccountCreateIdempotencyKey(driverId: string): string {
  return `${STRIPE_CONNECT_CREATE_IDEMPOTENCY_PREFIX}:${driverId}:stripe-connect-account:${STRIPE_CONNECT_ACCOUNT_CREATE_IDEMPOTENCY_VERSION}`;
}

/** Alias for Connect service and tests. */
export function stripeConnectAccountIdempotencyKey(driverId: string): string {
  return buildDriverStripeAccountCreateIdempotencyKey(driverId);
}
