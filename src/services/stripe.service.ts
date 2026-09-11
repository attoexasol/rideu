import Stripe from 'stripe';
import {
  getStripeSecretKey,
  isStripeSecretConfigured,
  isStripeWebhookConfigured,
  getStripeWebhookSecret,
} from '../config/stripe';
import { PaymentError } from './payment.errors';

let stripeClient: Stripe | null = null;

/**
 * Central Stripe SDK accessor. Instantiated once, lazily.
 * Cash bookings must not require this client.
 */
export function isStripeReady(): boolean {
  return isStripeSecretConfigured();
}

export function getStripeClient(): Stripe {
  const secret = getStripeSecretKey();
  if (!secret) {
    throw new PaymentError(
      'STRIPE_NOT_CONFIGURED',
      'Stripe is not configured. Cash bookings remain available.',
      503
    );
  }
  if (!stripeClient) {
    stripeClient = new Stripe(secret);
  }
  return stripeClient;
}

/**
 * Verify a Stripe webhook using the webhook secret only (no charge APIs).
 */
export function constructStripeWebhookEvent(
  payload: string | Buffer,
  signatureHeader: string
): Stripe.Event {
  const secret = getStripeWebhookSecret();
  if (!secret) {
    throw new PaymentError(
      'STRIPE_WEBHOOK_NOT_CONFIGURED',
      'Stripe webhook secret is not configured.',
      503
    );
  }
  try {
    return Stripe.webhooks.constructEvent(payload, signatureHeader, secret);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid Stripe signature';
    throw new PaymentError('STRIPE_WEBHOOK_SIGNATURE_INVALID', message, 400);
  }
}

export function assertStripeWebhookConfigured(): void {
  if (!isStripeWebhookConfigured()) {
    throw new PaymentError(
      'STRIPE_WEBHOOK_NOT_CONFIGURED',
      'Stripe webhook secret is not configured.',
      503
    );
  }
}

/** Test helper — do not call from application code. */
export function resetStripeClientForTests(): void {
  stripeClient = null;
}

export type { Stripe };
