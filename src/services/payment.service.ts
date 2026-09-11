/**
 * Payment service boundary.
 *
 * Phase D: platform PaymentIntent capture on ride completion and
 * authorization release on terminal booking cancellation.
 * Transfer, refund-after-capture, and settlement remain unimplemented.
 */

import {
  areStripeCardPaymentsEnabled,
  areStripeKeyModesAligned,
  getStripePublishableKey,
  isStripeSecretConfigured,
} from '../config/stripe';
import { PaymentMethodCode } from '../constants/payment';
import { findPaymentMethodByCode, listPaymentMethods } from '../repositories/serviceCategory.repository';
import { PaymentError } from './payment.errors';
import { isStripeReady } from './stripe.service';
import {
  prepareCardPaymentForBooking,
  reconcileBookingPaymentFromStripe,
  type CardPaymentClientView,
} from './stripePaymentIntent.service';
import {
  captureAuthorizedBookingPayment,
  releaseCardPaymentAuthorization,
} from './stripeCapture.service';

export { PaymentError } from './payment.errors';
export type { CardPaymentClientView };
export {
  FinancialIdempotencyKey,
  BookingPaymentStatus,
  PaymentMethodCode,
  PaymentProvider,
} from '../constants/payment';
export { prepareCardPaymentForBooking, reconcileBookingPaymentFromStripe };
export { captureAuthorizedBookingPayment, releaseCardPaymentAuthorization };
export { recordCompletedCashBookingPayment } from './cashPayment.service';
export { ensureSettlementForCapturedPayment, calculateSettlement } from './settlement.service';
export { getActiveSettlementSettings } from './settlementSettings.service';

export function assertStripeConfiguredForCard(): void {
  if (!isStripeReady()) {
    throw new PaymentError(
      'STRIPE_NOT_CONFIGURED',
      'Stripe is not configured. Cash bookings remain available.',
      503
    );
  }
  if (!getStripePublishableKey()) {
    throw new PaymentError(
      'STRIPE_PUBLISHABLE_KEY_REQUIRED',
      'Stripe publishable key is not configured. Cash bookings remain available.',
      503
    );
  }
  if (!areStripeKeyModesAligned()) {
    throw new PaymentError(
      'STRIPE_MODE_MISMATCH',
      'Stripe secret and publishable keys are not both test or both live.',
      503
    );
  }
}

export function assertCardPaymentAllowed(paymentMethodCode: string): void {
  if (paymentMethodCode === PaymentMethodCode.CASH) {
    return;
  }
  if (paymentMethodCode === PaymentMethodCode.CARD) {
    if (!areStripeCardPaymentsEnabled()) {
      if (isStripeSecretConfigured() && getStripePublishableKey() && !areStripeKeyModesAligned()) {
        throw new PaymentError(
          'STRIPE_MODE_MISMATCH',
          'Stripe secret and publishable keys are not both test or both live.',
          503
        );
      }
      throw new PaymentError(
        'CARD_PAYMENTS_NOT_ENABLED',
        'Card payments are not enabled. Use cash.',
        400
      );
    }
    return;
  }
}

export async function listPassengerPaymentMethods() {
  const cash = (await listPaymentMethods()).filter((m) => m.code === PaymentMethodCode.CASH);
  if (!areStripeCardPaymentsEnabled()) {
    return cash;
  }
  const card = await findPaymentMethodByCode(PaymentMethodCode.CARD);
  if (!card) return cash;
  return [...cash, { ...card, isActive: true }];
}

export function getPassengerPaymentsConfig(): {
  stripeEnabled: boolean;
  cardEnabled: boolean;
  publishableKey: string | null;
} {
  if (isStripeSecretConfigured() && getStripePublishableKey() && !areStripeKeyModesAligned()) {
    throw new PaymentError(
      'STRIPE_MODE_MISMATCH',
      'Stripe secret and publishable keys are not both test or both live.',
      503
    );
  }
  const cardEnabled = areStripeCardPaymentsEnabled();
  return {
    stripeEnabled: isStripeSecretConfigured() && Boolean(getStripePublishableKey()),
    cardEnabled,
    publishableKey: cardEnabled ? getStripePublishableKey() ?? null : null,
  };
}

/** @deprecated Phase C uses prepareCardPaymentForBooking. */
export async function preparePayment(): Promise<never> {
  throw new PaymentError(
    'PAYMENT_NOT_IMPLEMENTED',
    'Call prepareCardPaymentForBooking for card authorization.',
    501
  );
}

export async function authorizePayment(): Promise<never> {
  throw new PaymentError(
    'PAYMENT_NOT_IMPLEMENTED',
    'Authorization is driven by Stripe PaymentIntent status (webhook or reconcile).',
    501
  );
}

export async function capturePayment(): Promise<never> {
  throw new PaymentError(
    'PAYMENT_NOT_IMPLEMENTED',
    'Call captureAuthorizedBookingPayment(bookingId) after ride completion.',
    501
  );
}

export async function cancelAuthorization(): Promise<never> {
  throw new PaymentError(
    'PAYMENT_NOT_IMPLEMENTED',
    'Call releaseCardPaymentAuthorization(bookingId) when a booking is cancelled.',
    501
  );
}

export async function refundPayment(): Promise<never> {
  throw new PaymentError(
    'PAYMENT_NOT_IMPLEMENTED',
    'refundPayment is not implemented in Phase C.',
    501
  );
}

export async function settleCompletedBooking(): Promise<never> {
  throw new PaymentError(
    'PAYMENT_NOT_IMPLEMENTED',
    'settleCompletedBooking is not implemented in Phase C.',
    501
  );
}
