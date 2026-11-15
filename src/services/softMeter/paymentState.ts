import {
  METER_CHECKOUT_PURPOSE,
  MeterPaymentStatus,
  type MeterPaymentStatusType,
} from '../../constants/softMeter';
import { MeterError } from './errors';

export type PaymentSignal =
  | { type: 'customer_returned' }
  | { type: 'checkout_created' }
  | { type: 'webhook_paid' }
  | { type: 'webhook_failed' }
  | { type: 'webhook_expired' }
  | { type: 'webhook_refunded' }
  | { type: 'retry_requested' };

export interface PaymentTransition {
  status: MeterPaymentStatusType;
  changed: boolean;
  markPaid: boolean;
}

export function applyPaymentSignal(
  status: MeterPaymentStatusType,
  signal: PaymentSignal
): PaymentTransition {
  if (signal.type === 'customer_returned') {
    return { status, changed: false, markPaid: false };
  }
  if (signal.type === 'webhook_paid') {
    if (status === MeterPaymentStatus.PAID) {
      return { status, changed: false, markPaid: false };
    }
    if (
      status === MeterPaymentStatus.NOT_BILLABLE ||
      status === MeterPaymentStatus.CANCELLED ||
      status === MeterPaymentStatus.REFUNDED
    ) {
      return { status, changed: false, markPaid: false };
    }
    return { status: MeterPaymentStatus.PAID, changed: true, markPaid: true };
  }
  if (signal.type === 'checkout_created') {
    if (status !== MeterPaymentStatus.PENDING) {
      throw new MeterError(
        'METER_PAYMENT_NOT_READY',
        'A hosted payment link can only be created for a billable pending fare.',
        409
      );
    }
    return { status: MeterPaymentStatus.CHECKOUT_OPEN, changed: true, markPaid: false };
  }
  if (signal.type === 'webhook_failed') {
    if (status === MeterPaymentStatus.PAID || status === MeterPaymentStatus.REFUNDED) {
      return { status, changed: false, markPaid: false };
    }
    if (status === MeterPaymentStatus.FAILED) {
      return { status, changed: false, markPaid: false };
    }
    return { status: MeterPaymentStatus.FAILED, changed: true, markPaid: false };
  }
  if (signal.type === 'webhook_expired') {
    if (status === MeterPaymentStatus.PAID || status === MeterPaymentStatus.REFUNDED) {
      return { status, changed: false, markPaid: false };
    }
    if (status === MeterPaymentStatus.CANCELLED) {
      return { status, changed: false, markPaid: false };
    }
    return { status: MeterPaymentStatus.CANCELLED, changed: true, markPaid: false };
  }
  if (signal.type === 'webhook_refunded') {
    if (status === MeterPaymentStatus.REFUNDED) {
      return { status, changed: false, markPaid: false };
    }
    if (status !== MeterPaymentStatus.PAID) {
      return { status, changed: false, markPaid: false };
    }
    return { status: MeterPaymentStatus.REFUNDED, changed: true, markPaid: false };
  }
  if (status === MeterPaymentStatus.FAILED || status === MeterPaymentStatus.CANCELLED) {
    return { status: MeterPaymentStatus.PENDING, changed: true, markPaid: false };
  }
  return { status, changed: false, markPaid: false };
}

export interface CheckoutInterpretation {
  action: 'ignore' | 'paid' | 'failed' | 'expired';
  reason: string;
  checkoutSessionId: string | null;
  paymentIntentId: string | null;
  receiptUrl: string | null;
  amountTotal: number | null;
  currency: string | null;
  livemode: boolean;
  walkUpTripId: string | null;
  bookingId: string | null;
  meterSessionId: string | null;
  fareRecordId: string | null;
}

interface CheckoutObject {
  id?: string;
  payment_status?: string | null;
  status?: string | null;
  url?: string | null;
  metadata?: Record<string, string> | null;
  payment_intent?: string | { id?: string } | null;
  receipt_url?: string | null;
  amount_total?: number | null;
  currency?: string | null;
}

function paymentIntentId(value: CheckoutObject['payment_intent']): string | null {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object' && typeof value.id === 'string') return value.id;
  return null;
}

/**
 * A Checkout return or an unpaid completed session never marks the trip paid.
 * Only a verified webhook whose payment_status is paid (or async success) does.
 */
export function interpretCheckoutEvent(event: {
  type: string;
  livemode?: boolean;
  data?: { object?: unknown };
}): CheckoutInterpretation {
  const object = (event.data?.object ?? {}) as CheckoutObject;
  const metadata = object.metadata ?? {};
  const purpose = metadata.purpose;
  const known =
    purpose === METER_CHECKOUT_PURPOSE.WALK_UP ||
    purpose === METER_CHECKOUT_PURPOSE.WALK_UP_TEST ||
    purpose === METER_CHECKOUT_PURPOSE.ON_DEMAND;
  const base = {
    checkoutSessionId: object.id ?? null,
    paymentIntentId: paymentIntentId(object.payment_intent),
    receiptUrl: object.receipt_url ?? null,
    amountTotal: typeof object.amount_total === 'number' ? object.amount_total : null,
    currency: object.currency ?? null,
    livemode: event.livemode === true,
    walkUpTripId: metadata.walkUpTripId ?? null,
    bookingId: metadata.bookingId ?? null,
    meterSessionId: metadata.meterSessionId ?? null,
    fareRecordId: metadata.fareRecordId ?? null,
  };
  if (event.livemode === true) {
    return { action: 'ignore', reason: 'live_mode_rejected', ...base };
  }
  if (!known) {
    return { action: 'ignore', reason: 'not_meter_checkout', ...base };
  }
  if (event.type === 'checkout.session.completed') {
    if (object.payment_status !== 'paid') {
      return { action: 'ignore', reason: 'checkout_completed_unpaid', ...base };
    }
    return { action: 'paid', reason: 'payment_status_paid', ...base };
  }
  if (event.type === 'checkout.session.async_payment_succeeded') {
    return { action: 'paid', reason: 'async_payment_succeeded', ...base };
  }
  if (event.type === 'checkout.session.async_payment_failed') {
    return { action: 'failed', reason: 'async_payment_failed', ...base };
  }
  if (event.type === 'checkout.session.expired') {
    return { action: 'expired', reason: 'checkout_expired', ...base };
  }
  return { action: 'ignore', reason: 'unhandled_checkout_event', ...base };
}

export interface OnDemandPaymentIntentInterpretation {
  action: 'ignore' | 'paid' | 'failed' | 'canceled' | 'mismatch';
  reason: string;
  paymentIntentId: string | null;
  amount: number | null;
  currency: string | null;
  receiptUrl: string | null;
  purpose: string | null;
}

/**
 * A PaymentSheet confirmation is not an event. Only a verified PaymentIntent
 * webhook with livemode false can mark an on-demand meter fare paid.
 */
export function interpretOnDemandPaymentIntentEvent(event: {
  type: string;
  livemode?: boolean;
  data?: { object?: unknown };
}): OnDemandPaymentIntentInterpretation {
  const object = (event.data?.object ?? {}) as {
    id?: string;
    object?: string;
    amount?: number;
    currency?: string | null;
    metadata?: Record<string, string> | null;
    livemode?: boolean;
    charges?: { data?: Array<{ receipt_url?: string | null }> };
    receipt_url?: string | null;
  };
  const purpose = object.metadata?.purpose ?? null;
  const receipt =
    object.receipt_url ??
    object.charges?.data?.find((charge) => charge.receipt_url)?.receipt_url ??
    null;
  const base = {
    paymentIntentId: object.id ?? null,
    amount: typeof object.amount === 'number' ? object.amount : null,
    currency: object.currency ?? null,
    receiptUrl: receipt,
    purpose,
  };
  if (event.livemode === true || object.livemode === true) {
    return { action: 'ignore', reason: 'live_mode_rejected', ...base };
  }
  if (purpose !== METER_CHECKOUT_PURPOSE.ON_DEMAND_TEST) {
    return { action: 'ignore', reason: 'not_on_demand_meter_payment_intent', ...base };
  }
  if (object.object && object.object !== 'payment_intent') {
    return { action: 'ignore', reason: 'not_a_payment_intent', ...base };
  }
  if (event.type === 'payment_intent.succeeded') {
    return { action: 'paid', reason: 'payment_intent_succeeded', ...base };
  }
  if (event.type === 'payment_intent.payment_failed') {
    return { action: 'failed', reason: 'payment_intent_failed', ...base };
  }
  if (event.type === 'payment_intent.canceled') {
    return { action: 'canceled', reason: 'payment_intent_canceled', ...base };
  }
  return { action: 'ignore', reason: 'unhandled_payment_intent_event', ...base };
}

export interface StoredPaymentIntentSnapshot {
  id: string;
  status: string;
  livemode: boolean;
  amount: number;
  currency: string;
  receiptUrl: string | null;
  purpose: string | null;
  bookingId: string | null;
  meterPaymentId: string | null;
  fareRecordId: string | null;
  lastPaymentError: boolean;
}

export type StoredPaymentIntentAssessment =
  | 'paid'
  | 'pending'
  | 'failed'
  | 'canceled'
  | 'blocked_live'
  | 'blocked_identity'
  | 'blocked_amount';

/**
 * A retrieved PaymentIntent can settle a meter fare only when it is the stored
 * test intent for this booking, fare, and amount. PaymentSheet success is not an input.
 */
export function assessStoredOnDemandPaymentIntent(input: {
  expectedBookingId: string;
  expectedPaymentId: string;
  expectedFareRecordId: string;
  expectedAmountCents: number;
  expectedCurrency: string;
  storedPaymentIntentId: string;
  snapshot: StoredPaymentIntentSnapshot;
}): StoredPaymentIntentAssessment {
  const snap = input.snapshot;
  if (snap.livemode) return 'blocked_live';
  if (snap.id !== input.storedPaymentIntentId) return 'blocked_identity';
  if (snap.purpose !== METER_CHECKOUT_PURPOSE.ON_DEMAND_TEST) return 'blocked_identity';
  if (
    snap.bookingId !== input.expectedBookingId ||
    snap.meterPaymentId !== input.expectedPaymentId ||
    snap.fareRecordId !== input.expectedFareRecordId
  ) {
    return 'blocked_identity';
  }
  const currency = snap.currency.toUpperCase();
  if (
    snap.amount !== input.expectedAmountCents ||
    currency !== input.expectedCurrency.toUpperCase() ||
    currency !== 'USD'
  ) {
    return 'blocked_amount';
  }
  if (snap.status === 'succeeded') return 'paid';
  if (snap.status === 'processing' || snap.status === 'requires_action' || snap.status === 'requires_capture') {
    return 'pending';
  }
  if (snap.status === 'canceled') return 'canceled';
  if (snap.status === 'failed' || snap.lastPaymentError) return 'failed';
  return 'pending';
}

export function meterPaymentIntentWebhookDecision(input: {
  action: 'paid' | 'failed' | 'canceled';
  amount: number | null;
  currency: string | null;
  expectedAmountCents: number;
  expectedCurrency: string;
  currentStatus: MeterPaymentStatusType;
}): { accept: boolean; status: MeterPaymentStatusType; markPaid: boolean; failureCode: string | null } {
  const currency = (input.currency ?? '').toUpperCase();
  const amountMatches =
    input.amount === input.expectedAmountCents &&
    currency === input.expectedCurrency.toUpperCase();
  if (!amountMatches) {
    if (
      input.currentStatus === MeterPaymentStatus.PAID ||
      input.currentStatus === MeterPaymentStatus.REFUNDED
    ) {
      return {
        accept: false,
        status: input.currentStatus,
        markPaid: false,
        failureCode: null,
      };
    }
    return {
      accept: false,
      status: MeterPaymentStatus.FAILED,
      markPaid: false,
      failureCode: 'amount_mismatch',
    };
  }
  const signal =
    input.action === 'paid'
      ? ({ type: 'webhook_paid' } as const)
      : input.action === 'failed'
        ? ({ type: 'webhook_failed' } as const)
        : ({ type: 'webhook_expired' } as const);
  const next = applyPaymentSignal(input.currentStatus, signal);
  return {
    accept: true,
    status: next.status,
    markPaid: next.markPaid,
    failureCode: input.action === 'failed' ? 'payment_intent_failed' : null,
  };
}

export function interpretRefundEvent(event: {
  type: string;
  livemode?: boolean;
  data?: { object?: unknown };
}): { action: 'ignore' | 'refunded'; reason: string; paymentIntentId: string | null } {
  if (event.livemode === true) {
    return { action: 'ignore', reason: 'live_mode_rejected', paymentIntentId: null };
  }
  if (event.type !== 'charge.refunded') {
    return { action: 'ignore', reason: 'not_a_refund', paymentIntentId: null };
  }
  const object = (event.data?.object ?? {}) as { payment_intent?: string | { id?: string } | null };
  const paymentIntent = paymentIntentId(object.payment_intent);
  if (!paymentIntent) {
    return { action: 'ignore', reason: 'refund_missing_payment_intent', paymentIntentId: null };
  }
  return { action: 'refunded', reason: 'charge_refunded', paymentIntentId: paymentIntent };
}

export interface OnDemandSettlementView {
  bookingPaymentUnchanged: true;
  meterBillable: boolean;
  captureMeterFare: false;
  existingQuotedFareRemains: true;
  authorizationCanBeIncreased: false;
  authorizationHeldIndefinitely: false;
  finalSettlementSeparatedFromAcceptance: true;
  blockedReasons: string[];
}

export function onDemandSettlementView(input: {
  billable: boolean;
  blockedReasons: string[];
}): OnDemandSettlementView {
  return {
    bookingPaymentUnchanged: true,
    meterBillable: input.billable,
    captureMeterFare: false,
    existingQuotedFareRemains: true,
    authorizationCanBeIncreased: false,
    authorizationHeldIndefinitely: false,
    finalSettlementSeparatedFromAcceptance: true,
    blockedReasons: input.blockedReasons,
  };
}
