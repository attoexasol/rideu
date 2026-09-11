/**
 * Cash passenger-payment ledger.
 *
 * Cash never uses Stripe. On ride completion the booking already sets
 * `bookings.payment_status = paid`. This module writes the matching
 * `booking_payments` row so Driver Payment History can return the
 * authoritative fare (`bookings.final_fare` → `gross_amount` minor units).
 *
 * Ledger status `captured` is the existing schema success state (no cash-only
 * status exists). `provider = cash` distinguishes this from Stripe capture.
 * Settlement is calculated from Admin settings; no Stripe Transfer is created.
 */

import {
  BookingPaymentStatus,
  PaymentMethodCode,
  PaymentProvider,
  resolveBookingCurrency,
} from '../constants/payment';
import { logger } from '../middleware/logger';
import {
  claimCompletedCashPayment,
  findBookingPaymentByBookingId,
} from '../repositories/bookingPayment.repository';
import type { BookingPayment } from '../db/schema/booking_payments';
import { majorToMinorUnits } from '../utils/money';
import { ensureSettlementForCapturedPayment } from './settlement.service';

async function settleIfCapturedCash(payment: BookingPayment | null): Promise<void> {
  if (!payment) return;
  if (payment.paymentMethod !== PaymentMethodCode.CASH) return;
  if (payment.status !== BookingPaymentStatus.CAPTURED) return;
  await ensureSettlementForCapturedPayment(payment.bookingId);
}

export async function recordCompletedCashBookingPayment(input: {
  bookingId: string;
  finalFare: string | number | null | undefined;
  currency?: string | null;
  completedAt?: Date | null;
}): Promise<BookingPayment | null> {
  const existing = await findBookingPaymentByBookingId(input.bookingId);
  if (existing) {
    await settleIfCapturedCash(existing);
    return existing;
  }

  let amountMinor: number;
  try {
    amountMinor = majorToMinorUnits(String(input.finalFare ?? ''));
  } catch {
    logger.warn({
      type: 'cash.payment.ledger_skipped_invalid_fare',
      bookingId: input.bookingId,
    });
    return null;
  }

  if (amountMinor <= 0) {
    logger.warn({
      type: 'cash.payment.ledger_skipped_non_positive_fare',
      bookingId: input.bookingId,
    });
    return null;
  }

  const capturedAt =
    input.completedAt instanceof Date && !Number.isNaN(input.completedAt.getTime())
      ? input.completedAt
      : new Date();

  const created = await claimCompletedCashPayment({
    bookingId: input.bookingId,
    paymentMethod: PaymentMethodCode.CASH,
    currency: resolveBookingCurrency({ currency: input.currency }),
    grossAmount: amountMinor,
    provider: PaymentProvider.CASH,
    status: BookingPaymentStatus.CAPTURED,
    capturedAt,
  });
  await settleIfCapturedCash(created);
  return created;
}
