import { eq } from 'drizzle-orm';
import { db } from '../db/connection';
import { bookingPayments } from '../db/schema/booking_payments';
import { bookingSettlements } from '../db/schema/booking_settlements';
import type { NewBookingPayment, BookingPayment } from '../db/schema/booking_payments';
import type { NewBookingSettlement } from '../db/schema/booking_settlements';

export async function findBookingPaymentByBookingId(bookingId: string) {
  const rows = await db
    .select()
    .from(bookingPayments)
    .where(eq(bookingPayments.bookingId, bookingId))
    .limit(1);
  return rows[0] ?? null;
}

export async function findBookingPaymentByProviderPaymentIntentId(paymentIntentId: string) {
  const rows = await db
    .select()
    .from(bookingPayments)
    .where(eq(bookingPayments.providerPaymentIntentId, paymentIntentId))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertBookingPayment(values: NewBookingPayment) {
  const [row] = await db.insert(bookingPayments).values(values).returning();
  return row;
}

export async function claimPendingCardPayment(values: NewBookingPayment): Promise<BookingPayment> {
  const [inserted] = await db
    .insert(bookingPayments)
    .values(values)
    .onConflictDoNothing({ target: bookingPayments.bookingId })
    .returning();
  if (inserted) return inserted;
  const existing = await findBookingPaymentByBookingId(values.bookingId);
  if (!existing) {
    throw new Error('Failed to claim booking payment row');
  }
  return existing;
}

export async function claimCompletedCashPayment(values: NewBookingPayment): Promise<BookingPayment> {
  const [inserted] = await db
    .insert(bookingPayments)
    .values(values)
    .onConflictDoNothing({ target: bookingPayments.bookingId })
    .returning();
  if (inserted) return inserted;
  const existing = await findBookingPaymentByBookingId(values.bookingId);
  if (!existing) {
    throw new Error('Failed to claim cash booking payment row');
  }
  return existing;
}

export async function updateBookingPayment(
  bookingId: string,
  patch: Partial<NewBookingPayment>
): Promise<BookingPayment | null> {
  const [row] = await db
    .update(bookingPayments)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(bookingPayments.bookingId, bookingId))
    .returning();
  return row ?? null;
}

export async function findBookingSettlementByBookingId(bookingId: string) {
  const rows = await db
    .select()
    .from(bookingSettlements)
    .where(eq(bookingSettlements.bookingId, bookingId))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertBookingSettlement(values: NewBookingSettlement) {
  const [row] = await db.insert(bookingSettlements).values(values).returning();
  return row;
}

export async function claimBookingSettlement(values: NewBookingSettlement) {
  const [inserted] = await db
    .insert(bookingSettlements)
    .values(values)
    .onConflictDoNothing({ target: bookingSettlements.bookingId })
    .returning();
  if (inserted) return inserted;
  const existing = await findBookingSettlementByBookingId(values.bookingId);
  if (!existing) {
    throw new Error('Failed to claim booking settlement row');
  }
  return existing;
}
