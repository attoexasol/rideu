import {
  METER_CHECKOUT_PURPOSE,
  MeterPaymentStatus,
  MeterSettlementMode,
  TEST_ONLY_UNAPPROVED_TARIFF,
  type MeterPaymentStatusType,
  type MeterSettlementModeType,
} from '../../constants/softMeter';
import {
  classifyStripePublishableMode,
  classifyStripeSecretMode,
  type StripeKeyMode,
} from '../../config/stripe';
import { MeterError, isUniqueViolation } from './errors';
import { previewFare } from './fare';
import { KeyedMutex } from './lifecycle';
import type { RateSnapshot } from './rules';

/** Stripe requires expires_at at least 30 minutes ahead. One extra minute absorbs clock skew. */
export const WALKUP_TEST_CHECKOUT_TTL_MS = 31 * 60 * 1000;

export const WALKUP_TEST_FARE_LIMITATIONS = [
  'This amount is a Stripe test-mode fare, not a production charge.',
  'Flag drop, completed distance increments, and eligible stopped time from the server meter are included.',
  'Paused distance and paused time are excluded.',
  'Stopped time is charged per completed minute only. Partial minutes are stored and not billed. This minute policy is not regulator-approved.',
  'Partial-increment rounding beyond completed increments is not applied.',
  'The below-10-mph distance/time switch is not applied. Slow travel still bills distance, and time bills only while the vehicle is fully stopped.',
] as const;

const checkoutMutex = new KeyedMutex();

export interface WalkUpStripeTestConfig {
  paymentsFlag: string | undefined;
  sandboxFlag: string | undefined;
  nodeEnv: string | undefined;
  secretMode: StripeKeyMode;
  publishableMode: StripeKeyMode;
  webhookConfigured: boolean;
  successUrl: string | undefined;
  cancelUrl: string | undefined;
}

export type WalkUpStripeTestGate =
  | { action: 'disabled' }
  | { action: 'reject'; code: string; message: string; status: number }
  | { action: 'ready' };

export function readWalkUpStripeTestConfig(
  env: NodeJS.ProcessEnv = process.env
): WalkUpStripeTestConfig {
  const paymentsFlag = env.WALKUP_STRIPE_TEST_PAYMENTS?.trim();
  const sandboxFlag = env.WALKUP_STRIPE_TEST_SANDBOX?.trim();
  return {
    paymentsFlag: paymentsFlag || undefined,
    sandboxFlag: sandboxFlag || undefined,
    nodeEnv: env.NODE_ENV,
    secretMode: env.STRIPE_SECRET_KEY?.trim()
      ? classifyStripeSecretMode(env.STRIPE_SECRET_KEY.trim())
      : 'not_configured',
    publishableMode: env.STRIPE_PUBLISHABLE_KEY?.trim()
      ? classifyStripePublishableMode(env.STRIPE_PUBLISHABLE_KEY.trim())
      : 'not_configured',
    webhookConfigured: Boolean(env.STRIPE_WEBHOOK_SECRET?.trim()),
    successUrl: env.METER_CHECKOUT_SUCCESS_URL?.trim() || undefined,
    cancelUrl: env.METER_CHECKOUT_CANCEL_URL?.trim() || undefined,
  };
}

/**
 * The client cannot turn this on. Only an exact server flag plus test credentials can.
 * Anything unsafe fails closed instead of falling through to a live charge.
 */
export function evaluateWalkUpStripeTestConfig(
  config: WalkUpStripeTestConfig
): WalkUpStripeTestGate {
  if (config.paymentsFlag !== 'true') return { action: 'disabled' };
  if (config.secretMode === 'live' || config.publishableMode === 'live') {
    return {
      action: 'reject',
      code: 'STRIPE_LIVE_CREDENTIALS_REJECTED',
      message: 'Walk-up test Checkout refuses live Stripe credentials.',
      status: 409,
    };
  }
  if (config.secretMode !== 'test') {
    return {
      action: 'reject',
      code: 'WALKUP_STRIPE_TEST_NOT_CONFIGURED',
      message: 'Walk-up test Checkout requires an sk_test Stripe secret.',
      status: 503,
    };
  }
  if (config.publishableMode !== 'not_configured' && config.publishableMode !== 'test') {
    return {
      action: 'reject',
      code: 'WALKUP_STRIPE_TEST_NOT_CONFIGURED',
      message: 'The Stripe publishable key must be a pk_test key when it is set.',
      status: 503,
    };
  }
  if (config.nodeEnv === 'production' && config.sandboxFlag !== 'authorized') {
    return {
      action: 'reject',
      code: 'WALKUP_TEST_SANDBOX_NOT_AUTHORIZED',
      message:
        'Production refuses walk-up test Checkout unless this process is an isolated sandbox (WALKUP_STRIPE_TEST_SANDBOX=authorized) using test keys.',
      status: 409,
    };
  }
  if (!config.webhookConfigured || !config.successUrl || !config.cancelUrl) {
    return {
      action: 'reject',
      code: 'WALKUP_STRIPE_TEST_NOT_CONFIGURED',
      message:
        'Walk-up test Checkout requires STRIPE_WEBHOOK_SECRET, METER_CHECKOUT_SUCCESS_URL, and METER_CHECKOUT_CANCEL_URL.',
      status: 503,
    };
  }
  return { action: 'ready' };
}

export interface TestFareInput {
  id: string;
  sessionId: string;
  totalCents: number;
  currency: string;
  billable: boolean;
  chargingEnabled: boolean;
  acceptedDistanceMillimeters: number;
  waitingSeconds: number;
  waitingChargeCents: number;
  rateSnapshot: RateSnapshot;
}

export function assertWalkUpTestFare(fare: TestFareInput): void {
  if (!fare.id || !fare.sessionId) {
    throw new MeterError('METER_FARE_MISSING', 'Final fare record is missing.', 409);
  }
  if (fare.billable || fare.chargingEnabled || fare.rateSnapshot.chargingEnabled) {
    throw new MeterError(
      'WALKUP_TEST_FARE_NOT_ISOLATED',
      'A production billable fare cannot be collected through walk-up test Checkout.',
      409
    );
  }
  if (fare.currency.toUpperCase() !== 'USD' || fare.rateSnapshot.currency.toUpperCase() !== 'USD') {
    throw new MeterError(
      'WALKUP_TEST_CURRENCY_UNSUPPORTED',
      'Walk-up Stripe test Checkout collects the finalized fare in USD cents only.',
      409
    );
  }
  if (!Number.isInteger(fare.totalCents) || fare.totalCents <= 0) {
    throw new MeterError(
      'WALKUP_TEST_FARE_INVALID',
      'The finalized test fare must be a positive integer cent amount.',
      409
    );
  }
  if (fare.rateSnapshot.rules.speedSwitchBelow10Mph) {
    throw new MeterError(
      'TARIFF_RULE_NOT_APPROVED',
      'The below-10-mph switch is not an approved test calculation. Test Checkout stays disabled for this rate snapshot.',
      409
    );
  }
  const preview = previewFare(
    fare.rateSnapshot,
    fare.acceptedDistanceMillimeters,
    fare.waitingSeconds
  );
  if (
    preview.totalCents !== fare.totalCents ||
    preview.waitingChargeCents !== fare.waitingChargeCents ||
    preview.flagDropCents + preview.distanceChargeCents + preview.waitingChargeCents !== fare.totalCents
  ) {
    throw new MeterError(
      'FARE_EVIDENCE_MISMATCH',
      'The stored fare does not match the server meter calculation.',
      409
    );
  }
  if (preview.waitingPolicyApplied !== 'test_only_completed_minutes' && preview.waitingChargeCents !== 0) {
    throw new MeterError(
      'TARIFF_RULE_NOT_APPROVED',
      'Stopped time in test Checkout uses completed minutes only.',
      409
    );
  }
  if (
    preview.partialIncrementPolicyApplied !== 'withheld_completed_increments_only' &&
    preview.partialIncrementPolicyApplied !== 'completed_increments_only'
  ) {
    throw new MeterError(
      'TARIFF_RULE_NOT_APPROVED',
      'This test Checkout only collects completed distance increments. Other rounding rules stay disabled.',
      409
    );
  }
  if (preview.billable || preview.chargingEnabled) {
    throw new MeterError(
      'WALKUP_TEST_FARE_NOT_ISOLATED',
      'The meter preview is billable, so it cannot be used as a test-only fare.',
      409
    );
  }
}

export interface StoredTestPayment {
  id: string;
  status: MeterPaymentStatusType;
  hostedUrl: string | null;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  receiptUrl: string | null;
  amountCents: number;
  currency: string;
  settlementMode: MeterSettlementModeType;
  testOnly: boolean;
  fareClassification: string | null;
  expiresAtMs: number | null;
  fareRecordId: string;
  idempotencyKey: string;
  failureCode: string | null;
  paidAtMs: number | null;
  createdAtMs: number | null;
  updatedAtMs: number | null;
}

export interface TestCheckoutResult {
  tripId: string;
  testMode: true;
  testOnly: true;
  billable: false;
  productionCharge: false;
  fareClassification: typeof TEST_ONLY_UNAPPROVED_TARIFF;
  limitations: readonly string[];
  amountCents: number;
  currency: 'USD';
  paymentStatus: MeterPaymentStatusType;
  checkoutState: MeterPaymentStatusType;
  hostedUrl: string | null;
  qrPayload: string | null;
  stripeCheckoutSessionId: string | null;
  expiresAt: string | null;
  idempotent: boolean;
  receiptAvailable: false;
  fareRecordId: string;
  paymentId: string;
}

function view(tripId: string, payment: StoredTestPayment, idempotent: boolean): TestCheckoutResult {
  const open = payment.status === MeterPaymentStatus.CHECKOUT_OPEN && Boolean(payment.hostedUrl);
  return {
    tripId,
    testMode: true,
    testOnly: true,
    billable: false,
    productionCharge: false,
    fareClassification: TEST_ONLY_UNAPPROVED_TARIFF,
    limitations: WALKUP_TEST_FARE_LIMITATIONS,
    amountCents: payment.amountCents,
    currency: 'USD',
    paymentStatus: payment.status,
    checkoutState: payment.status,
    hostedUrl: open ? payment.hostedUrl : null,
    qrPayload: open ? payment.hostedUrl : null,
    stripeCheckoutSessionId: payment.stripeCheckoutSessionId,
    expiresAt: payment.expiresAtMs == null ? null : new Date(payment.expiresAtMs).toISOString(),
    idempotent,
    receiptAvailable: false,
    fareRecordId: payment.fareRecordId,
    paymentId: payment.id,
  };
}

function checkoutStillOpen(payment: StoredTestPayment, nowMs: number): boolean {
  return (
    payment.status === MeterPaymentStatus.CHECKOUT_OPEN &&
    Boolean(payment.hostedUrl) &&
    payment.expiresAtMs != null &&
    payment.expiresAtMs > nowMs
  );
}

export interface TestPaymentStore {
  findByFare: (fareId: string) => Promise<StoredTestPayment | null>;
  insert: (row: StoredTestPayment) => Promise<StoredTestPayment>;
  update: (id: string, patch: Partial<StoredTestPayment>) => Promise<StoredTestPayment>;
}

function stripeIdempotencyKey(fareId: string, previousSessionId: string | null): string {
  return previousSessionId
    ? `meter_test_checkout:${fareId}:${previousSessionId}`
    : `meter_test_checkout:${fareId}`;
}

export async function openWalkUpTestCheckout(input: {
  actorDriverId: string;
  trip: { id: string; driverId: string; currency: string; status: string };
  session: { id: string; status: string };
  fare: TestFareInput;
  config: WalkUpStripeTestConfig;
  nowMs: number;
  store: TestPaymentStore;
  createCheckout: (request: {
    amountCents: number;
    currency: string;
    idempotencyKey: string;
    metadata: Record<string, string>;
    subjectId: string;
    expiresAtUnix: number;
    productName: string;
  }) => Promise<{ id: string; url: string }>;
  expireCheckout: (checkoutSessionId: string) => Promise<'expired' | 'paid'>;
}): Promise<TestCheckoutResult> {
  const gate = evaluateWalkUpStripeTestConfig(input.config);
  if (gate.action === 'disabled') {
    throw new MeterError(
      'METER_CHARGING_DISABLED',
      'Walk-up test Checkout is disabled. Production metered charging remains off.',
      409
    );
  }
  if (gate.action === 'reject') {
    throw new MeterError(gate.code, gate.message, gate.status);
  }
  if (input.trip.driverId !== input.actorDriverId) {
    throw new MeterError('WALK_UP_NOT_FOUND', 'Walk-up trip not found.', 404);
  }
  if (input.session.status !== 'finalized') {
    throw new MeterError('METER_NOT_FINALIZED', 'Finalize the meter before requesting payment.', 409);
  }
  assertWalkUpTestFare(input.fare);
  if (input.trip.currency.toUpperCase() !== 'USD') {
    throw new MeterError(
      'WALKUP_TEST_CURRENCY_UNSUPPORTED',
      'Walk-up Stripe test Checkout collects the finalized fare in USD cents only.',
      409
    );
  }

  return checkoutMutex.run(input.fare.id, async () => {
    const existing = await input.store.findByFare(input.fare.id);
    if (
      existing &&
      (existing.status === MeterPaymentStatus.PAID || existing.status === MeterPaymentStatus.REFUNDED)
    ) {
      return view(input.trip.id, existing, true);
    }
    if (existing && checkoutStillOpen(existing, input.nowMs)) {
      return view(input.trip.id, existing, true);
    }
    if (existing?.status === MeterPaymentStatus.CHECKOUT_OPEN && existing.stripeCheckoutSessionId) {
      const expired = await input.expireCheckout(existing.stripeCheckoutSessionId);
      if (expired === 'paid') {
        const paid = await input.store.update(existing.id, {
          status: MeterPaymentStatus.PAID,
          paidAtMs: input.nowMs,
          hostedUrl: null,
        });
        return view(input.trip.id, paid, true);
      }
    }

    const expiresAtMs = input.nowMs + WALKUP_TEST_CHECKOUT_TTL_MS;
    const metadata: Record<string, string> = {
      purpose: METER_CHECKOUT_PURPOSE.WALK_UP_TEST,
      walkUpTripId: input.trip.id,
      meterSessionId: input.session.id,
      fareRecordId: input.fare.id,
      settlementMode: MeterSettlementMode.STRIPE_TEST,
      testOnly: 'true',
      fareClassification: TEST_ONLY_UNAPPROVED_TARIFF,
    };
    let checkout: { id: string; url: string };
    try {
      checkout = await input.createCheckout({
        amountCents: input.fare.totalCents,
        currency: 'usd',
        idempotencyKey: stripeIdempotencyKey(
          input.fare.id,
          existing?.stripeCheckoutSessionId ?? null
        ),
        metadata,
        subjectId: input.trip.id,
        expiresAtUnix: Math.floor(expiresAtMs / 1000),
        productName: 'DriveWize walk-up test fare (test mode)',
      });
    } catch (error) {
      if (existing) {
        await input.store.update(existing.id, {
          failureCode: 'STRIPE_NETWORK',
          status: existing.status === MeterPaymentStatus.NOT_BILLABLE ? existing.status : MeterPaymentStatus.FAILED,
        });
      }
      if (error instanceof MeterError) throw error;
      throw new MeterError(
        'METER_CHECKOUT_FAILED',
        'Stripe test Checkout could not be created.',
        502
      );
    }

    const next: StoredTestPayment = {
      id: existing?.id ?? '',
      status: MeterPaymentStatus.CHECKOUT_OPEN,
      hostedUrl: checkout.url,
      stripeCheckoutSessionId: checkout.id,
      stripePaymentIntentId: existing?.stripePaymentIntentId ?? null,
      receiptUrl: null,
      amountCents: input.fare.totalCents,
      currency: 'USD',
      settlementMode: MeterSettlementMode.STRIPE_TEST,
      testOnly: true,
      fareClassification: TEST_ONLY_UNAPPROVED_TARIFF,
      expiresAtMs,
      fareRecordId: input.fare.id,
      idempotencyKey: `meter_checkout:${input.fare.id}`,
      failureCode: null,
      paidAtMs: null,
      createdAtMs: existing?.createdAtMs ?? input.nowMs,
      updatedAtMs: input.nowMs,
    };
    try {
      const saved = existing
        ? await input.store.update(existing.id, next)
        : await input.store.insert(next);
      return view(input.trip.id, saved, false);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await input.store.findByFare(input.fare.id);
      if (!raced) throw error;
      return view(input.trip.id, raced, true);
    }
  });
}

export interface TestWebhookVerdict {
  acceptPaid: boolean;
  changed: boolean;
  status: MeterPaymentStatusType;
  failureCode: string | null;
}

export function verifyTestCheckoutWebhook(input: {
  livemode: boolean;
  action: 'paid' | 'failed' | 'expired' | 'ignore';
  amountTotal: number | null;
  currency: string | null;
  expectedAmountCents: number;
  expectedCurrency: string;
  currentStatus: MeterPaymentStatusType;
  testPayment: boolean;
}): TestWebhookVerdict {
  if (!input.testPayment) {
    return {
      acceptPaid: input.action === 'paid',
      changed: false,
      status: input.currentStatus,
      failureCode: null,
    };
  }
  if (input.livemode) {
    return {
      acceptPaid: false,
      changed: false,
      status: input.currentStatus,
      failureCode: 'LIVE_MODE_REJECTED',
    };
  }
  if (input.currentStatus === MeterPaymentStatus.PAID || input.currentStatus === MeterPaymentStatus.REFUNDED) {
    return { acceptPaid: false, changed: false, status: input.currentStatus, failureCode: null };
  }
  if (input.action !== 'paid') {
    return { acceptPaid: false, changed: false, status: input.currentStatus, failureCode: null };
  }
  const currency = (input.currency ?? '').toUpperCase();
  if (currency !== input.expectedCurrency.toUpperCase()) {
    return {
      acceptPaid: false,
      changed: true,
      status: MeterPaymentStatus.FAILED,
      failureCode: 'CURRENCY_MISMATCH',
    };
  }
  if (input.amountTotal !== input.expectedAmountCents) {
    return {
      acceptPaid: false,
      changed: true,
      status: MeterPaymentStatus.FAILED,
      failureCode: 'AMOUNT_MISMATCH',
    };
  }
  return {
    acceptPaid: true,
    changed: true,
    status: MeterPaymentStatus.PAID,
    failureCode: null,
  };
}

export function toWalkUpPaymentStatus(input: {
  tripId: string;
  tripStatus: string;
  currency: string;
  payment: StoredTestPayment | null;
  tripPaymentStatus: string;
  fare: {
    id: string;
    totalCents: number;
    billable: boolean;
    flagDropCents: number;
    distanceChargeCents: number;
    waitingChargeCents: number;
    blockedReasons: string[];
    acceptedDistanceMillimeters: number;
    createdAt: string;
  } | null;
  nowMs: number;
}) {
  const payment = input.payment;
  const testMode = payment?.testOnly === true || payment?.settlementMode === MeterSettlementMode.STRIPE_TEST;
  const open =
    payment?.status === MeterPaymentStatus.CHECKOUT_OPEN &&
    Boolean(payment.hostedUrl) &&
    (payment.expiresAtMs == null || payment.expiresAtMs > input.nowMs);
  return {
    tripId: input.tripId,
    tripStatus: input.tripStatus,
    paymentStatus: payment?.status ?? input.tripPaymentStatus,
    paymentState: payment?.status ?? input.tripPaymentStatus,
    checkoutState: payment?.status ?? 'none',
    paid: payment?.status === MeterPaymentStatus.PAID,
    testMode,
    testOnly: testMode,
    settlementMode: payment?.settlementMode ?? null,
    fareClassification: testMode ? TEST_ONLY_UNAPPROVED_TARIFF : null,
    hostedUrl: open ? payment?.hostedUrl ?? null : null,
    qrPayload: open ? payment?.hostedUrl ?? null : null,
    receiptUrl: payment?.receiptUrl ?? null,
    receiptAvailable: Boolean(payment?.receiptUrl),
    amountCents: input.fare?.totalCents ?? payment?.amountCents ?? null,
    currency: input.currency,
    billable: false,
    productionCharge: false,
    fareRecordId: input.fare?.id ?? payment?.fareRecordId ?? null,
    stripeCheckoutSessionId: payment?.stripeCheckoutSessionId ?? null,
    stripePaymentIntentId: payment?.stripePaymentIntentId ?? null,
    expiresAt: payment?.expiresAtMs == null ? null : new Date(payment.expiresAtMs).toISOString(),
    paidAt: payment?.paidAtMs == null ? null : new Date(payment.paidAtMs).toISOString(),
    createdAt: payment?.createdAtMs == null ? null : new Date(payment.createdAtMs).toISOString(),
    updatedAt: payment?.updatedAtMs == null ? null : new Date(payment.updatedAtMs).toISOString(),
    serverTime: new Date(input.nowMs).toISOString(),
    limitations: testMode ? WALKUP_TEST_FARE_LIMITATIONS : [],
  };
}

export function toAdminMeterPayment<T extends {
  settlementMode?: string | null;
  testOnly?: boolean | null;
  fareClassification?: string | null;
  stripeLivemode?: boolean | null;
  status: string;
}>(payment: T) {
  const testMode =
    payment.testOnly === true || payment.settlementMode === MeterSettlementMode.STRIPE_TEST;
  return {
    ...payment,
    testMode,
    testOnly: testMode,
    productionCharge: false,
    fareClassification: payment.fareClassification ?? (testMode ? TEST_ONLY_UNAPPROVED_TARIFF : null),
    stripeLivemode: payment.stripeLivemode === true,
  };
}

