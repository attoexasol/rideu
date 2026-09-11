/**
 * Settlement allocation.
 *
 * Commission (driver/company) applies only to the regular trip fare.
 * Airport fee is a fixed snapshot from the booking and is excluded from commission.
 *
 * driverAmount = floor(commissionable * driver%)
 * platformAmount = commissionable - driverAmount  (company gets remainder)
 * airportFee = booking snapshot (0 when absent)
 *
 * driver + platform + airport === passengerGross
 *
 * No Stripe Transfer is created here.
 */

import {
  BookingPaymentStatus,
  DEFAULT_PAYMENT_CURRENCY,
  PaymentMethodCode,
  SettlementStatus,
} from '../constants/payment';
import { logger } from '../middleware/logger';
import { findBookingById } from '../repositories/booking.repository';
import {
  claimBookingSettlement,
  findBookingPaymentByBookingId,
  findBookingSettlementByBookingId,
} from '../repositories/bookingPayment.repository';
import type { BookingSettlement } from '../db/schema/booking_settlements';
import { allocateCommissionableByPercentages, majorToMinorUnits } from '../utils/money';
import { SettlementRulesNotConfiguredError } from './payment.errors';
import {
  getActiveSettlementSettings,
  type ActiveSettlementSettings,
} from './settlementSettings.service';

export { SettlementRulesNotConfiguredError } from './payment.errors';

export interface SettlementInput {
  bookingId: string;
  grossAmountMinor: number;
  currency?: string;
  airportFeeMinor?: number;
  settings?: ActiveSettlementSettings;
}

export interface SettlementResult {
  grossAmount: number;
  driverAmount: number;
  platformAmount: number;
  airportFee: number;
  commissionableFare: number;
  currency: string;
  calculationVersion: string;
  driverPercentage: string;
  companyPercentage: string;
}

function snapshotAirportFeeMinor(booking: {
  airportFeeAmount?: string | number | null;
} | null): number {
  if (!booking?.airportFeeAmount) return 0;
  try {
    const minor = majorToMinorUnits(String(booking.airportFeeAmount));
    return minor > 0 ? minor : 0;
  } catch {
    return 0;
  }
}

export function calculateSettlement(input: SettlementInput): SettlementResult {
  if (!input.settings) {
    throw new SettlementRulesNotConfiguredError();
  }
  const currency = input.currency ?? DEFAULT_PAYMENT_CURRENCY;
  const airportFee = Math.max(0, input.airportFeeMinor ?? 0);
  if (!Number.isInteger(airportFee) || !Number.isSafeInteger(airportFee)) {
    throw new Error('Airport fee must be a safe integer');
  }
  if (airportFee > input.grossAmountMinor) {
    throw new Error('Airport fee cannot exceed passenger gross');
  }
  const commissionableFare = input.grossAmountMinor - airportFee;
  if (commissionableFare < 0) {
    throw new Error('Commissionable fare must be >= 0');
  }

  const allocated = allocateCommissionableByPercentages(commissionableFare, input.settings);
  return {
    grossAmount: input.grossAmountMinor,
    driverAmount: allocated.driverAmount,
    platformAmount: allocated.platformAmount,
    airportFee,
    commissionableFare,
    currency,
    calculationVersion: String(input.settings.version),
    driverPercentage: input.settings.driverPercentage,
    companyPercentage: input.settings.companyPercentage,
  };
}

/** @deprecated Placeholder kept for older tests/docs. */
export function unresolvedSettlementPlaceholder(input: SettlementInput): {
  grossAmount: number;
  driverAmount: null;
  platformAmount: null;
  airportFee: null;
  currency: string;
} {
  return {
    grossAmount: input.grossAmountMinor,
    driverAmount: null,
    platformAmount: null,
    airportFee: null,
    currency: input.currency ?? DEFAULT_PAYMENT_CURRENCY,
  };
}

export async function ensureSettlementForCapturedPayment(
  bookingId: string
): Promise<BookingSettlement | null> {
  const existing = await findBookingSettlementByBookingId(bookingId);
  if (existing) return existing;

  const payment = await findBookingPaymentByBookingId(bookingId);
  if (!payment || payment.status !== BookingPaymentStatus.CAPTURED) {
    return null;
  }

  let settings: ActiveSettlementSettings;
  try {
    settings = await getActiveSettlementSettings();
  } catch (error) {
    logger.warn({
      type: 'settlement.skipped_no_active_settings',
      bookingId,
      code: error instanceof SettlementRulesNotConfiguredError ? error.code : undefined,
    });
    return null;
  }

  const booking = await findBookingById(bookingId);
  const airportFeeMinor = snapshotAirportFeeMinor(booking);

  let allocation: SettlementResult;
  try {
    allocation = calculateSettlement({
      bookingId,
      grossAmountMinor: payment.grossAmount,
      currency: payment.currency,
      airportFeeMinor,
      settings,
    });
  } catch (error) {
    logger.warn({
      type: 'settlement.allocation_failed',
      bookingId,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const status =
    payment.paymentMethod === PaymentMethodCode.CASH
      ? SettlementStatus.SKIPPED_CASH
      : SettlementStatus.PENDING;

  try {
    return await claimBookingSettlement({
      bookingId,
      paymentId: payment.id,
      status,
      grossAmount: allocation.grossAmount,
      driverAmount: allocation.driverAmount,
      platformAmount: allocation.platformAmount,
      airportFee: allocation.airportFee,
      currency: allocation.currency,
      calculationVersion: allocation.calculationVersion,
      airportFeePercentage: null,
      driverPercentage: allocation.driverPercentage,
      companyPercentage: allocation.companyPercentage,
    });
  } catch (error) {
    const raced = await findBookingSettlementByBookingId(bookingId);
    if (raced) return raced;
    logger.warn({
      type: 'settlement.claim_failed',
      bookingId,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
