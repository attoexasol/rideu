import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db/connection';
import { bookings } from '../db/schema/bookings';
import { bookingPayments } from '../db/schema/booking_payments';
import { bookingSettlements } from '../db/schema/booking_settlements';
import { paymentMethods } from '../db/schema/payment_methods';
import { serviceCategories } from '../db/schema/service_categories';
import { BookingStatus } from '../constants/bookingStatus';
import { BookingPaymentStatus, PaymentMethodCode, SettlementStatus } from '../constants/payment';

const CASH_HISTORY_BOOKING_STATUSES = [BookingStatus.COMPLETED, BookingStatus.CANCELLED] as const;

/** Assigned-driver rows that have a payment ledger row, or completed/cancelled cash without one. */
export const driverPaymentHistoryEligible = or(
  isNotNull(bookingPayments.id),
  and(
    eq(paymentMethods.code, PaymentMethodCode.CASH),
    inArray(bookings.status, [...CASH_HISTORY_BOOKING_STATUSES])
  )
);

const historySortTimestamp = sql`COALESCE(${bookings.completedAt}, ${bookingPayments.capturedAt}, ${bookingPayments.createdAt}, ${bookings.createdAt})`;
const historySortId = sql`COALESCE(${bookingPayments.id}, ${bookings.id})`;

const driverPaymentHistorySelect = {
  paymentId: bookingPayments.id,
  paymentMethod: bookingPayments.paymentMethod,
  paymentCurrency: bookingPayments.currency,
  paymentGrossAmount: bookingPayments.grossAmount,
  paymentStatus: bookingPayments.status,
  paymentAuthorizedAt: bookingPayments.authorizedAt,
  paymentCapturedAt: bookingPayments.capturedAt,
  paymentFailedAt: bookingPayments.failedAt,
  paymentRefundedAt: bookingPayments.refundedAt,
  paymentFailureCode: bookingPayments.failureCode,
  paymentFailureMessage: bookingPayments.failureMessage,
  paymentCreatedAt: bookingPayments.createdAt,
  catalogPaymentMethodCode: paymentMethods.code,
  bookingId: bookings.id,
  bookingNumber: bookings.bookingNumber,
  bookingStatus: bookings.status,
  bookingCompletedAt: bookings.completedAt,
  pickupAddress: bookings.pickupAddress,
  pickupLatitude: bookings.pickupLatitude,
  pickupLongitude: bookings.pickupLongitude,
  pickupSpotLabel: bookings.pickupSpotLabel,
  dropoffAddress: bookings.dropoffAddress,
  dropoffLatitude: bookings.dropoffLatitude,
  dropoffLongitude: bookings.dropoffLongitude,
  serviceName: serviceCategories.name,
  serviceCode: serviceCategories.code,
  settlementId: bookingSettlements.id,
  settlementStatus: bookingSettlements.status,
  settlementGrossAmount: bookingSettlements.grossAmount,
  settlementDriverAmount: bookingSettlements.driverAmount,
  settlementPlatformAmount: bookingSettlements.platformAmount,
  settlementAirportFee: bookingSettlements.airportFee,
  settlementCurrency: bookingSettlements.currency,
  settlementCreatedAt: bookingSettlements.createdAt,
  settlementUpdatedAt: bookingSettlements.updatedAt,
};

export type DriverPaymentHistoryRow = {
  paymentId: string | null;
  paymentMethod: string | null;
  paymentCurrency: string | null;
  paymentGrossAmount: number | null;
  paymentStatus: string | null;
  paymentAuthorizedAt: Date | null;
  paymentCapturedAt: Date | null;
  paymentFailedAt: Date | null;
  paymentRefundedAt: Date | null;
  paymentFailureCode: string | null;
  paymentFailureMessage: string | null;
  paymentCreatedAt: Date | null;
  catalogPaymentMethodCode: string | null;
  bookingId: string;
  bookingNumber: string;
  bookingStatus: string;
  bookingCompletedAt: Date | null;
  pickupAddress: string;
  pickupLatitude: string;
  pickupLongitude: string;
  pickupSpotLabel: string | null;
  dropoffAddress: string;
  dropoffLatitude: string;
  dropoffLongitude: string;
  serviceName: string | null;
  serviceCode: string | null;
  settlementId: string | null;
  settlementStatus: string | null;
  settlementGrossAmount: number | null;
  settlementDriverAmount: number | null;
  settlementPlatformAmount: number | null;
  settlementAirportFee: number | null;
  settlementCurrency: string | null;
  settlementCreatedAt: Date | null;
  settlementUpdatedAt: Date | null;
};

function historyBaseQuery() {
  return db
    .select(driverPaymentHistorySelect)
    .from(bookings)
    .innerJoin(serviceCategories, eq(bookings.serviceCategoryId, serviceCategories.id))
    .leftJoin(bookingPayments, eq(bookingPayments.bookingId, bookings.id))
    .leftJoin(paymentMethods, eq(bookings.paymentMethodId, paymentMethods.id))
    .leftJoin(bookingSettlements, eq(bookingSettlements.bookingId, bookings.id));
}

export async function listDriverPaymentHistory(
  driverId: string,
  limit: number,
  offset: number
): Promise<DriverPaymentHistoryRow[]> {
  return historyBaseQuery()
    .where(and(eq(bookings.assignedDriverId, driverId), driverPaymentHistoryEligible))
    .orderBy(desc(historySortTimestamp), desc(historySortId))
    .limit(limit)
    .offset(offset);
}

export async function countDriverPaymentHistory(driverId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bookings)
    .leftJoin(bookingPayments, eq(bookingPayments.bookingId, bookings.id))
    .leftJoin(paymentMethods, eq(bookings.paymentMethodId, paymentMethods.id))
    .where(and(eq(bookings.assignedDriverId, driverId), driverPaymentHistoryEligible));
  return rows[0]?.count ?? 0;
}

export async function findDriverPaymentHistoryByPaymentId(
  driverId: string,
  paymentId: string
): Promise<DriverPaymentHistoryRow | null> {
  const rows = await historyBaseQuery()
    .where(and(eq(bookings.assignedDriverId, driverId), eq(bookingPayments.id, paymentId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findDriverPaymentHistoryByBookingId(
  driverId: string,
  bookingId: string
): Promise<DriverPaymentHistoryRow | null> {
  const rows = await historyBaseQuery()
    .where(
      and(
        eq(bookings.assignedDriverId, driverId),
        eq(bookings.id, bookingId),
        driverPaymentHistoryEligible
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function findDriverPaymentHistoryItem(
  driverId: string,
  id: string
): Promise<DriverPaymentHistoryRow | null> {
  const byPayment = await findDriverPaymentHistoryByPaymentId(driverId, id);
  if (byPayment) return byPayment;
  return findDriverPaymentHistoryByBookingId(driverId, id);
}

export async function sumCapturedPassengerPaymentsByCurrency(driverId: string) {
  return db
    .select({
      currency: bookingPayments.currency,
      amountMinor: sql<string>`coalesce(sum(${bookingPayments.grossAmount}), 0)::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(bookings)
    .innerJoin(bookingPayments, eq(bookingPayments.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.assignedDriverId, driverId),
        eq(bookingPayments.status, BookingPaymentStatus.CAPTURED)
      )
    )
    .groupBy(bookingPayments.currency)
    .orderBy(bookingPayments.currency);
}

const CALCULATED_DRIVER_EARNING_STATUSES = [
  SettlementStatus.PENDING,
  SettlementStatus.PROCESSING,
  SettlementStatus.SETTLED,
  SettlementStatus.SKIPPED_CASH,
] as const;

export async function sumCalculatedDriverEarningsByCurrency(driverId: string) {
  return db
    .select({
      currency: bookingSettlements.currency,
      amountMinor: sql<string>`coalesce(sum(${bookingSettlements.driverAmount}), 0)::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(bookings)
    .innerJoin(bookingSettlements, eq(bookingSettlements.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.assignedDriverId, driverId),
        isNotNull(bookingSettlements.driverAmount),
        inArray(bookingSettlements.status, [...CALCULATED_DRIVER_EARNING_STATUSES])
      )
    )
    .groupBy(bookingSettlements.currency)
    .orderBy(bookingSettlements.currency);
}

export async function countSettlementsByStatusForDriver(driverId: string) {
  return db
    .select({
      status: bookingSettlements.status,
      count: sql<number>`count(*)::int`,
    })
    .from(bookings)
    .innerJoin(bookingSettlements, eq(bookingSettlements.bookingId, bookings.id))
    .where(eq(bookings.assignedDriverId, driverId))
    .groupBy(bookingSettlements.status);
}

export async function countHistoryRowsWithoutSettlement(driverId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bookings)
    .leftJoin(bookingPayments, eq(bookingPayments.bookingId, bookings.id))
    .leftJoin(paymentMethods, eq(bookings.paymentMethodId, paymentMethods.id))
    .leftJoin(bookingSettlements, eq(bookingSettlements.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.assignedDriverId, driverId),
        driverPaymentHistoryEligible,
        isNull(bookingSettlements.id)
      )
    );
  return rows[0]?.count ?? 0;
}
