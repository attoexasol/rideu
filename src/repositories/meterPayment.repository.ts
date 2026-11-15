import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/connection';
import { bookings } from '../db/schema/bookings';
import { meterPayments, type NewMeterPayment } from '../db/schema/meter_payments';

export const UNPAID_ON_DEMAND_METER_STATUSES = [
  'pending',
  'checkout_open',
  'failed',
  'cancelled',
] as const;

export async function findMeterPaymentById(id: string) {
  const [row] = await db.select().from(meterPayments).where(eq(meterPayments.id, id)).limit(1);
  return row ?? null;
}

export async function findMeterPaymentByBooking(bookingId: string) {
  const [row] = await db
    .select()
    .from(meterPayments)
    .where(eq(meterPayments.bookingId, bookingId))
    .limit(1);
  return row ?? null;
}

export async function findMeterPaymentsByBookingIds(bookingIds: string[]) {
  if (bookingIds.length === 0) return [];
  return db.select().from(meterPayments).where(inArray(meterPayments.bookingId, bookingIds));
}

export async function findLatestUnpaidOnDemandMeterPayment(customerId: string) {
  const [row] = await db
    .select({ payment: meterPayments, completedAt: bookings.completedAt })
    .from(meterPayments)
    .innerJoin(bookings, eq(bookings.id, meterPayments.bookingId))
    .where(
      and(
        eq(bookings.customerId, customerId),
        eq(bookings.status, 'completed'),
        eq(meterPayments.subjectType, 'on_demand'),
        eq(meterPayments.settlementMode, 'stripe_test'),
        inArray(meterPayments.status, [...UNPAID_ON_DEMAND_METER_STATUSES])
      )
    )
    .orderBy(desc(bookings.completedAt))
    .limit(1);
  return row ?? null;
}

export async function findMeterPaymentByFare(fareRecordId: string) {
  const [row] = await db
    .select()
    .from(meterPayments)
    .where(eq(meterPayments.fareRecordId, fareRecordId))
    .limit(1);
  return row ?? null;
}

export async function findMeterPaymentByIdempotency(key: string) {
  const [row] = await db
    .select()
    .from(meterPayments)
    .where(eq(meterPayments.idempotencyKey, key))
    .limit(1);
  return row ?? null;
}

export async function findMeterPaymentByPaymentIntent(paymentIntentId: string) {
  const [row] = await db
    .select()
    .from(meterPayments)
    .where(eq(meterPayments.stripePaymentIntentId, paymentIntentId))
    .limit(1);
  return row ?? null;
}

export async function findMeterPaymentByCheckout(checkoutSessionId: string) {
  const [row] = await db
    .select()
    .from(meterPayments)
    .where(eq(meterPayments.stripeCheckoutSessionId, checkoutSessionId))
    .limit(1);
  return row ?? null;
}

export async function insertMeterPayment(values: NewMeterPayment) {
  const [row] = await db.insert(meterPayments).values(values).returning();
  return row;
}

export async function updateMeterPayment(id: string, patch: Partial<NewMeterPayment>) {
  const [row] = await db
    .update(meterPayments)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(meterPayments.id, id))
    .returning();
  return row ?? null;
}

export async function listMeterPayments(filters: { status?: string; limit: number; offset: number }) {
  return db
    .select()
    .from(meterPayments)
    .where(filters.status ? eq(meterPayments.status, filters.status) : sql`true`)
    .orderBy(desc(meterPayments.createdAt))
    .limit(filters.limit)
    .offset(filters.offset);
}
