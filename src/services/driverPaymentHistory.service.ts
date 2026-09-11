/**
 * Read-only driver financial history.
 *
 * Passenger capture, settlement, Stripe Transfer, and bank payout are separate.
 * This module never calculates commission, never queries Stripe, and never
 * labels passenger captured gross as driver earnings.
 */

import {
  BOOKING_PAYMENT_STATUSES,
  BookingPaymentStatus,
  DriverPaymentRecordStatus,
  DriverSettlementRecordStatus,
  DriverTransferRecordStatus,
  SETTLEMENT_STATUSES,
  type BookingPaymentStatusType,
  type SettlementStatusType,
} from '../constants/payment';
import type { DriverPaymentHistoryRow } from '../repositories/driverPaymentHistory.repository';
import {
  countDriverPaymentHistory,
  countHistoryRowsWithoutSettlement,
  countSettlementsByStatusForDriver,
  findDriverPaymentHistoryItem,
  listDriverPaymentHistory,
  sumCalculatedDriverEarningsByCurrency,
  sumCapturedPassengerPaymentsByCurrency,
} from '../repositories/driverPaymentHistory.repository';
import { minorToMajorString } from '../utils/money';

export interface MoneyAmountView {
  minor: number;
  formatted: string;
  currency: string;
}

export interface DriverPaymentHistoryListItem {
  id: string;
  bookingId: string;
  bookingNumber: string;
  paymentRecordId: string | null;
  ride: {
    status: string;
    completedAt: string | null;
    pickup: {
      latitude: number;
      longitude: number;
      address: string;
      spotLabel: string | null;
    };
    dropoff: {
      latitude: number;
      longitude: number;
      address: string;
    };
    serviceName: string | null;
    serviceCode: string | null;
  };
  passengerPayment: {
    amount: MoneyAmountView | null;
    status: BookingPaymentStatusType | typeof DriverPaymentRecordStatus.NOT_RECORDED;
    methodCode: string | null;
    capturedAt: string | null;
  };
  settlement: {
    status: SettlementStatusType | typeof DriverSettlementRecordStatus.NOT_CREATED;
    driverAmount: MoneyAmountView | null;
    platformAmount: MoneyAmountView | null;
    airportFee: MoneyAmountView | null;
    settledAt: null;
  };
  transfer: {
    status: typeof DriverTransferRecordStatus.NOT_STARTED;
    transferredAt: null;
  };
}

export interface DriverPaymentHistoryDetail extends DriverPaymentHistoryListItem {
  passengerPayment: DriverPaymentHistoryListItem['passengerPayment'] & {
    authorizedAt: string | null;
    failedAt: string | null;
    refundedAt: string | null;
    failureCode: string | null;
    failureMessage: string | null;
  };
  settlement: DriverPaymentHistoryListItem['settlement'] & {
    createdAt: string | null;
    updatedAt: string | null;
  };
}

export interface DriverPaymentHistorySummary {
  /** False until Stripe Transfer / bank payout exists. Calculated share is not paid. */
  driverEarningsAvailable: false;
  calculatedDriverEarnings: Array<MoneyAmountView & { count: number }>;
  capturedPassengerPayments: Array<MoneyAmountView & { count: number }>;
  settlementCounts: {
    notCreated: number;
    unresolved: number;
    pending: number;
    processing: number;
    settled: number;
    failed: number;
    skippedCash: number;
  };
}

const BOOKING_PAYMENT_STATUS_SET = new Set<string>(BOOKING_PAYMENT_STATUSES);
const SETTLEMENT_STATUS_SET = new Set<string>(SETTLEMENT_STATUSES);

function iso(value: Date | string | null | undefined): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseCoordinate(value: string | number | null | undefined): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : 0;
}

export function formatMoneyAmount(
  minor: number | null | undefined,
  currency: string | null | undefined
): MoneyAmountView | null {
  if (minor == null || !Number.isInteger(minor) || !Number.isSafeInteger(minor)) {
    return null;
  }
  if (!currency) return null;
  return {
    minor,
    formatted: minorToMajorString(minor),
    currency,
  };
}

export function normalizePassengerPaymentStatus(
  status: string | null | undefined
): BookingPaymentStatusType | typeof DriverPaymentRecordStatus.NOT_RECORDED {
  if (!status) return DriverPaymentRecordStatus.NOT_RECORDED;
  if (BOOKING_PAYMENT_STATUS_SET.has(status)) {
    return status as BookingPaymentStatusType;
  }
  return DriverPaymentRecordStatus.NOT_RECORDED;
}

export function normalizeSettlementStatus(
  status: string | null | undefined
): SettlementStatusType | typeof DriverSettlementRecordStatus.NOT_CREATED {
  if (!status) return DriverSettlementRecordStatus.NOT_CREATED;
  if (SETTLEMENT_STATUS_SET.has(status)) {
    return status as SettlementStatusType;
  }
  return DriverSettlementRecordStatus.NOT_CREATED;
}

function resolveMethodCode(row: DriverPaymentHistoryRow): string | null {
  return row.paymentMethod ?? row.catalogPaymentMethodCode ?? null;
}

function resourceId(row: DriverPaymentHistoryRow): string {
  return row.paymentId ?? row.bookingId;
}

export function formatDriverPaymentHistoryItem(
  row: DriverPaymentHistoryRow
): DriverPaymentHistoryListItem {
  const paymentCurrency = row.paymentCurrency;
  const settlementCurrency = row.settlementCurrency ?? row.paymentCurrency;

  return {
    id: resourceId(row),
    bookingId: row.bookingId,
    bookingNumber: row.bookingNumber,
    paymentRecordId: row.paymentId,
    ride: {
      status: row.bookingStatus,
      completedAt: iso(row.bookingCompletedAt),
      pickup: {
        latitude: parseCoordinate(row.pickupLatitude),
        longitude: parseCoordinate(row.pickupLongitude),
        address: row.pickupAddress,
        spotLabel: row.pickupSpotLabel,
      },
      dropoff: {
        latitude: parseCoordinate(row.dropoffLatitude),
        longitude: parseCoordinate(row.dropoffLongitude),
        address: row.dropoffAddress,
      },
      serviceName: row.serviceName,
      serviceCode: row.serviceCode,
    },
    passengerPayment: {
      amount: formatMoneyAmount(row.paymentGrossAmount, paymentCurrency),
      status: normalizePassengerPaymentStatus(row.paymentStatus),
      methodCode: resolveMethodCode(row),
      capturedAt: iso(row.paymentCapturedAt),
    },
    settlement: {
      status: normalizeSettlementStatus(row.settlementStatus),
      driverAmount: formatMoneyAmount(row.settlementDriverAmount, settlementCurrency),
      platformAmount: formatMoneyAmount(row.settlementPlatformAmount, settlementCurrency),
      airportFee: formatMoneyAmount(row.settlementAirportFee, settlementCurrency),
      settledAt: null,
    },
    transfer: {
      status: DriverTransferRecordStatus.NOT_STARTED,
      transferredAt: null,
    },
  };
}

export function formatDriverPaymentHistoryDetail(
  row: DriverPaymentHistoryRow
): DriverPaymentHistoryDetail {
  const item = formatDriverPaymentHistoryItem(row);
  return {
    ...item,
    passengerPayment: {
      ...item.passengerPayment,
      authorizedAt: iso(row.paymentAuthorizedAt),
      failedAt: iso(row.paymentFailedAt),
      refundedAt: iso(row.paymentRefundedAt),
      failureCode: row.paymentFailureCode,
      failureMessage: row.paymentFailureMessage,
    },
    settlement: {
      ...item.settlement,
      createdAt: iso(row.settlementCreatedAt),
      updatedAt: iso(row.settlementUpdatedAt),
    },
  };
}

function formatCurrencyTotals(
  rows: Array<{ currency: string; amountMinor: string | number; count: number }>
): Array<MoneyAmountView & { count: number }> {
  return rows
    .map((row) => {
      const minor = typeof row.amountMinor === 'number' ? row.amountMinor : parseInt(row.amountMinor, 10);
      const amount = formatMoneyAmount(Number.isFinite(minor) ? minor : null, row.currency);
      if (!amount) return null;
      return { ...amount, count: row.count };
    })
    .filter((row): row is MoneyAmountView & { count: number } => row != null);
}

export function formatDriverPaymentSummary(input: {
  capturedByCurrency: Array<{ currency: string; amountMinor: string | number; count: number }>;
  calculatedDriverByCurrency?: Array<{ currency: string; amountMinor: string | number; count: number }>;
  settlementByStatus: Array<{ status: string; count: number }>;
  notCreatedCount: number;
}): DriverPaymentHistorySummary {
  const capturedPassengerPayments = formatCurrencyTotals(input.capturedByCurrency);
  const calculatedDriverEarnings = formatCurrencyTotals(input.calculatedDriverByCurrency ?? []);

  const counts: DriverPaymentHistorySummary['settlementCounts'] = {
    notCreated: input.notCreatedCount,
    unresolved: 0,
    pending: 0,
    processing: 0,
    settled: 0,
    failed: 0,
    skippedCash: 0,
  };

  for (const row of input.settlementByStatus) {
    if (row.status === 'unresolved') counts.unresolved = row.count;
    else if (row.status === 'pending') counts.pending = row.count;
    else if (row.status === 'processing') counts.processing = row.count;
    else if (row.status === 'settled') counts.settled = row.count;
    else if (row.status === 'failed') counts.failed = row.count;
    else if (row.status === 'skipped_cash') counts.skippedCash = row.count;
  }

  return {
    driverEarningsAvailable: false,
    calculatedDriverEarnings,
    capturedPassengerPayments,
    settlementCounts: counts,
  };
}

export async function listDriverPayments(driverId: string, page: number, limit: number) {
  const offset = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    listDriverPaymentHistory(driverId, limit, offset),
    countDriverPaymentHistory(driverId),
  ]);
  return {
    items: rows.map(formatDriverPaymentHistoryItem),
    total,
    page,
    limit,
  };
}

export async function getDriverPaymentDetail(driverId: string, paymentId: string) {
  const row = await findDriverPaymentHistoryItem(driverId, paymentId);
  if (!row) return null;
  return formatDriverPaymentHistoryDetail(row);
}

export async function getDriverPaymentSummary(driverId: string): Promise<DriverPaymentHistorySummary> {
  const [capturedByCurrency, calculatedDriverByCurrency, settlementByStatus, notCreatedCount] =
    await Promise.all([
      sumCapturedPassengerPaymentsByCurrency(driverId),
      sumCalculatedDriverEarningsByCurrency(driverId),
      countSettlementsByStatusForDriver(driverId),
      countHistoryRowsWithoutSettlement(driverId),
    ]);
  return formatDriverPaymentSummary({
    capturedByCurrency,
    calculatedDriverByCurrency,
    settlementByStatus,
    notCreatedCount,
  });
}

export const DRIVER_PAYMENT_HISTORY_FORBIDDEN_KEYS = [
  'client_secret',
  'clientSecret',
  'providerPaymentIntentId',
  'provider_payment_intent_id',
  'providerChargeId',
  'provider_charge_id',
  'providerTransferId',
  'provider_transfer_id',
  'stripeAccountId',
  'accountLink',
] as const;

export function assertNoSensitivePaymentFields(payload: unknown): void {
  const serialized = JSON.stringify(payload);
  for (const key of DRIVER_PAYMENT_HISTORY_FORBIDDEN_KEYS) {
    if (serialized.includes(`"${key}"`)) {
      throw new Error(`Driver payment history must not expose ${key}`);
    }
  }
  if (serialized.includes('_secret') || serialized.includes('sk_live') || serialized.includes('sk_test')) {
    throw new Error('Driver payment history must not expose Stripe secrets');
  }
}

export { BookingPaymentStatus, DriverTransferRecordStatus };
