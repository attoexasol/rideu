import type Stripe from 'stripe';
import { logger } from '../middleware/logger';
import {
  claimStripeWebhookEvent,
  markStripeWebhookEventFailed,
  markStripeWebhookEventProcessed,
} from '../repositories/stripeWebhookEvent.repository';
import { PaymentError } from './payment.errors';
import { handleStripeConnectWebhookEvent } from './stripeConnect.service';
import { handleStripePaymentIntentEvent } from './stripePaymentIntent.service';
import { activateAuthorizedCardBooking } from './cardBookingActivation.service';
import { markBookingPaidIfCaptured } from './stripeCapture.service';
import { BookingPaymentStatus } from '../constants/payment';
import { assertStripeWebhookConfigured, constructStripeWebhookEvent } from './stripe.service';

export type StripeWebhookProcessResult = {
  duplicate: boolean;
  eventId: string;
  eventType: string;
};

const KNOWN_EVENT_PREFIXES = [
  'payment_intent.',
  'charge.',
  'transfer.',
  'account.',
  'capability.',
] as const;

let testProcessHook: ((event: Stripe.Event) => Promise<void>) | null = null;

/** Jest-only hook to simulate handler failure. Forbidden outside test. */
export function setStripeWebhookProcessHookForTests(
  hook: ((event: Stripe.Event) => Promise<void>) | null
): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Stripe webhook test hook is only available in test');
  }
  testProcessHook = hook;
}

export function isKnownStripeEventType(eventType: string): boolean {
  return KNOWN_EVENT_PREFIXES.some((prefix) => eventType.startsWith(prefix));
}

/**
 * Phase A dispatcher plus Phase C/D PaymentIntent ledger updates.
 * Does not capture or transfer from the webhook itself.
 * After a captured PaymentIntent is persisted, markBookingPaidIfCaptured
 * creates an idempotent booking_settlements row (no Stripe Transfer).
 */
export async function dispatchStripeWebhookEvent(event: Stripe.Event): Promise<void> {
  if (testProcessHook) {
    await testProcessHook(event);
    return;
  }

  logger.info({
    type: 'stripe.webhook',
    stripeEventId: event.id,
    stripeEventType: event.type,
    knownFamily: isKnownStripeEventType(event.type),
  });

  await handleStripeConnectWebhookEvent(event);
  const paymentResult = await handleStripePaymentIntentEvent(event);
  if (
    paymentResult.bookingId &&
    paymentResult.status === BookingPaymentStatus.AUTHORIZED
  ) {
    await activateAuthorizedCardBooking(paymentResult.bookingId);
  }
  if (paymentResult.bookingId && paymentResult.status === BookingPaymentStatus.CAPTURED) {
    await markBookingPaidIfCaptured(paymentResult.bookingId);
  }
}

export async function processStripeWebhookRawBody(
  rawBody: Buffer | string,
  signatureHeader: string | undefined
): Promise<StripeWebhookProcessResult> {
  assertStripeWebhookConfigured();

  if (!signatureHeader || Array.isArray(signatureHeader)) {
    throw new PaymentError(
      'STRIPE_WEBHOOK_SIGNATURE_MISSING',
      'Stripe-Signature header is required.',
      400
    );
  }

  const event = constructStripeWebhookEvent(rawBody, signatureHeader);
  const claim = await claimStripeWebhookEvent(event.id, event.type);

  if (claim.action === 'skip_processed') {
    return { duplicate: true, eventId: event.id, eventType: event.type };
  }

  if (claim.action === 'in_flight') {
    throw new PaymentError(
      'STRIPE_WEBHOOK_IN_FLIGHT',
      'Stripe event is already being processed.',
      503
    );
  }

  try {
    await dispatchStripeWebhookEvent(event);
    await markStripeWebhookEventProcessed(event.id);
    return { duplicate: false, eventId: event.id, eventType: event.type };
  } catch (error) {
    if (error instanceof PaymentError) {
      throw error;
    }
    await markStripeWebhookEventFailed(event.id, error);
    throw error;
  }
}
