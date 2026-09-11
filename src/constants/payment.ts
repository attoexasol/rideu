/**
 * Payment catalog codes and ledger statuses.
 *
 * `bookings.payment_status` (`pending` / `paid`) stays the cash-era booking field.
 * Stripe async state lives on `booking_payments.status`.
 */

export const PaymentMethodCode = {
  CASH: 'cash',
  CARD: 'card',
} as const;

export type PaymentMethodCodeType = (typeof PaymentMethodCode)[keyof typeof PaymentMethodCode];

export const PAYMENT_METHOD_CODES: PaymentMethodCodeType[] = [
  PaymentMethodCode.CASH,
  PaymentMethodCode.CARD,
];

export const PaymentProvider = {
  NONE: 'none',
  CASH: 'cash',
  STRIPE: 'stripe',
} as const;

export type PaymentProviderType = (typeof PaymentProvider)[keyof typeof PaymentProvider];

/** Ledger status for booking_payments — not bookings.payment_status. */
export const BookingPaymentStatus = {
  PENDING: 'pending',
  REQUIRES_PAYMENT_METHOD: 'requires_payment_method',
  REQUIRES_ACTION: 'requires_action',
  AUTHORIZED: 'authorized',
  CAPTURE_PENDING: 'capture_pending',
  CAPTURED: 'captured',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  REFUND_PENDING: 'refund_pending',
  REFUNDED: 'refunded',
} as const;

export type BookingPaymentStatusType =
  (typeof BookingPaymentStatus)[keyof typeof BookingPaymentStatus];

export const BOOKING_PAYMENT_STATUSES: BookingPaymentStatusType[] = [
  BookingPaymentStatus.PENDING,
  BookingPaymentStatus.REQUIRES_PAYMENT_METHOD,
  BookingPaymentStatus.REQUIRES_ACTION,
  BookingPaymentStatus.AUTHORIZED,
  BookingPaymentStatus.CAPTURE_PENDING,
  BookingPaymentStatus.CAPTURED,
  BookingPaymentStatus.FAILED,
  BookingPaymentStatus.CANCELLED,
  BookingPaymentStatus.REFUND_PENDING,
  BookingPaymentStatus.REFUNDED,
];

export const SettlementStatus = {
  UNRESOLVED: 'unresolved',
  PENDING: 'pending',
  PROCESSING: 'processing',
  SETTLED: 'settled',
  FAILED: 'failed',
  SKIPPED_CASH: 'skipped_cash',
} as const;

export type SettlementStatusType = (typeof SettlementStatus)[keyof typeof SettlementStatus];

export const SETTLEMENT_STATUSES: SettlementStatusType[] = [
  SettlementStatus.UNRESOLVED,
  SettlementStatus.PENDING,
  SettlementStatus.PROCESSING,
  SettlementStatus.SETTLED,
  SettlementStatus.FAILED,
  SettlementStatus.SKIPPED_CASH,
];

export const StripeWebhookProcessingStatus = {
  RECEIVED: 'received',
  PROCESSED: 'processed',
  FAILED: 'failed',
} as const;

export type StripeWebhookProcessingStatusType =
  (typeof StripeWebhookProcessingStatus)[keyof typeof StripeWebhookProcessingStatus];

/**
 * Historical / fallback currency for rows created before market snapshots.
 * Never use this for an existing booking that already has bookings.currency.
 */
export const DEFAULT_PAYMENT_CURRENCY = 'BDT';

export const SUPPORTED_TRANSACTION_CURRENCIES = ['BDT', 'USD'] as const;

export function normalizeCurrencyCode(code: string | null | undefined): string {
  return String(code ?? '').trim().toUpperCase();
}

/** Fallback only when no booking/quote market is available. */
export function getTransactionCurrency(): string {
  return DEFAULT_PAYMENT_CURRENCY;
}

/** Authoritative currency for an existing booking (historical null → BDT). */
export function resolveBookingCurrency(booking: {
  currency?: string | null;
} | null | undefined): string {
  const fromBooking = normalizeCurrencyCode(booking?.currency);
  if (fromBooking && isSupportedTransactionCurrency(fromBooking)) {
    return fromBooking;
  }
  return DEFAULT_PAYMENT_CURRENCY;
}

export function currenciesAreEqual(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  const a = normalizeCurrencyCode(left);
  const b = normalizeCurrencyCode(right);
  return a.length > 0 && a === b;
}

export function isSupportedTransactionCurrency(code: string | null | undefined): boolean {
  const normalized = normalizeCurrencyCode(code);
  return SUPPORTED_TRANSACTION_CURRENCIES.some((item) => item === normalized);
}

/**
 * An airport fee may be charged only in the booking transaction currency.
 * Different currencies are never added or converted.
 */
export function isAirportFeeChargeable(
  airportCurrency: string | null | undefined,
  transactionCurrency: string | null | undefined = getTransactionCurrency()
): boolean {
  return currenciesAreEqual(airportCurrency, transactionCurrency);
}

/**
 * Server-generated Stripe Idempotency-Key values for future money movement.
 * Do not use mobile-supplied keys as the only protection.
 */
export const FinancialIdempotencyKey = {
  payment: (bookingId: string) => `booking:${bookingId}:payment`,
  capture: (bookingId: string) => `booking:${bookingId}:capture`,
  paymentCancel: (bookingId: string) => `booking:${bookingId}:payment-cancel`,
  transfer: (bookingId: string) => `booking:${bookingId}:transfer`,
  refund: (bookingId: string, version: string) => `booking:${bookingId}:refund:${version}`,
  connectAccount: (driverId: string) =>
    `driver:${driverId}:stripe-connect-account:v2`,
} as const;

export const STRIPE_WEBHOOK_PATH = '/api/v1/webhooks/stripe';
export const STRIPE_PAYMENTS_CONFIG_PATH = '/api/v1/config/payments';

/**
 * Driver payment-history API states that are not booking_payments / booking_settlements
 * check-constraint values. Used only when the corresponding row is absent.
 */
export const DriverPaymentRecordStatus = {
  NOT_RECORDED: 'not_recorded',
} as const;

export type DriverPaymentRecordStatusType =
  (typeof DriverPaymentRecordStatus)[keyof typeof DriverPaymentRecordStatus];

export const DriverSettlementRecordStatus = {
  NOT_CREATED: 'not_created',
} as const;

export type DriverSettlementRecordStatusType =
  (typeof DriverSettlementRecordStatus)[keyof typeof DriverSettlementRecordStatus];

/**
 * Backend-normalized application state. Stripe Transfer is not implemented;
 * this is not a Stripe Transfer object status.
 */
export const DriverTransferRecordStatus = {
  NOT_STARTED: 'not_started',
} as const;

export type DriverTransferRecordStatusType =
  (typeof DriverTransferRecordStatus)[keyof typeof DriverTransferRecordStatus];
