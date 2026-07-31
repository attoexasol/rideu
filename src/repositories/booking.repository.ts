import { db } from '../db/connection';
import {
  bookings,
  bookingStops,
  bookingOffers,
  bookingEvents,
  bookingIdempotencyKeys,
  drivers,
  vehicles,
  customers,
  serviceCategories,
} from '../db/schema';
import { eq, and, desc, inArray, sql, gt, lte } from 'drizzle-orm';
import {
  ACTIVE_BOOKING_STATUSES,
  PASSENGER_ONGOING_BOOKING_STATUSES,
  BookingOfferStatus,
  BookingStatus,
  TERMINAL_OFFER_STATUSES,
} from '../constants/bookingStatus';
import {
  assertOfferExpiryAfterOffered,
  buildOfferTimeWindow,
} from '../utils/offerTimestamps';

/** Database-side clock for offer expiry comparisons (avoids JS/session TZ skew). */
const dbNow = sql`CURRENT_TIMESTAMP`;

/** Bookings that may still surface pending offers to drivers. */
const DISPATCHABLE_BOOKING_STATUSES = [BookingStatus.SEARCHING, BookingStatus.OFFERED] as const;

export async function insertBooking(data: typeof bookings.$inferInsert) {
  const [row] = await db.insert(bookings).values(data).returning();
  return row;
}

export async function findBookingById(id: string) {
  const rows = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findBookingByShareToken(token: string) {
  const rows = await db.select().from(bookings).where(eq(bookings.shareToken, token)).limit(1);
  return rows[0] ?? null;
}

export async function updateBooking(id: string, data: Partial<typeof bookings.$inferInsert>) {
  const [row] = await db
    .update(bookings)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(bookings.id, id))
    .returning();
  return row;
}

export async function getBookingForUpdate(id: string) {
  const rows = await db.execute(sql`SELECT * FROM bookings WHERE id = ${id} FOR UPDATE`);
  return (rows as any)[0] ?? null;
}

export async function insertBookingStops(stops: (typeof bookingStops.$inferInsert)[]) {
  if (!stops.length) return [];
  return db.insert(bookingStops).values(stops).returning();
}

export async function listBookingsByCustomer(customerId: string, limit = 20, offset = 0) {
  return db
    .select()
    .from(bookings)
    .where(eq(bookings.customerId, customerId))
    .orderBy(desc(bookings.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function findActiveBookingByCustomer(customerId: string) {
  const rows = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.customerId, customerId),
        inArray(bookings.status, PASSENGER_ONGOING_BOOKING_STATUSES)
      )
    )
    .orderBy(desc(bookings.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function findActiveBookingByDriver(driverId: string) {
  const rows = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.assignedDriverId, driverId),
        inArray(bookings.status, ACTIVE_BOOKING_STATUSES)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function vehicleHasActiveRide(vehicleId: string): Promise<boolean> {
  const rows = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.assignedVehicleId, vehicleId),
        inArray(bookings.status, ACTIVE_BOOKING_STATUSES)
      )
    )
    .limit(1);
  return rows.length > 0;
}

export async function insertBookingOffer(data: typeof bookingOffers.$inferInsert) {
  if (data.offeredAt && data.expiresAt) {
    const offeredAt =
      data.offeredAt instanceof Date ? data.offeredAt : new Date(String(data.offeredAt));
    const expiresAt =
      data.expiresAt instanceof Date ? data.expiresAt : new Date(String(data.expiresAt));
    assertOfferExpiryAfterOffered(offeredAt, expiresAt);
  }

  const [row] = await db.insert(bookingOffers).values(data).returning();

  if (row && !(row.expiresAt.getTime() > row.offeredAt.getTime())) {
    console.error('[OfferTimestamp] configuration error after insert', {
      code: 'OFFER_TIMESTAMP_CONFIG_ERROR',
      offerId: row.id,
      offeredAtIso: row.offeredAt.toISOString(),
      expiresAtIso: row.expiresAt.toISOString(),
    });
    await db.delete(bookingOffers).where(eq(bookingOffers.id, row.id));
    throw new Error('OFFER_TIMESTAMP_CONFIG_ERROR');
  }

  return row;
}

/**
 * Create a pending offer with TTL derived from a single clock reading (UTC-safe with timestamptz).
 */
export async function createPendingBookingOffer(input: {
  bookingId: string;
  driverId: string;
  distanceToPickupKm: string;
  ttlSeconds: number;
}) {
  const { offeredAt, expiresAt } = buildOfferTimeWindow(input.ttlSeconds);

  return insertBookingOffer({
    bookingId: input.bookingId,
    driverId: input.driverId,
    status: BookingOfferStatus.PENDING,
    distanceToPickupKm: input.distanceToPickupKm,
    offeredAt,
    expiresAt,
  });
}

export async function updateBookingOffer(
  id: string,
  data: Partial<typeof bookingOffers.$inferInsert>
) {
  const [row] = await db
    .update(bookingOffers)
    .set(data)
    .where(eq(bookingOffers.id, id))
    .returning();
  return row;
}

export async function findOfferById(offerId: string) {
  const rows = await db.select().from(bookingOffers).where(eq(bookingOffers.id, offerId)).limit(1);
  return rows[0] ?? null;
}

export async function findPendingOfferForDriver(bookingId: string, driverId: string) {
  const rows = await db
    .select()
    .from(bookingOffers)
    .where(
      and(
        eq(bookingOffers.bookingId, bookingId),
        eq(bookingOffers.driverId, driverId),
        eq(bookingOffers.status, BookingOfferStatus.PENDING),
        gt(bookingOffers.expiresAt, dbNow)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listExcludedDriverIdsForBooking(bookingId: string): Promise<string[]> {
  const rows = await db
    .select({ driverId: bookingOffers.driverId })
    .from(bookingOffers)
    .where(
      and(
        eq(bookingOffers.bookingId, bookingId),
        inArray(bookingOffers.status, [...TERMINAL_OFFER_STATUSES])
      )
    );
  return [...new Set(rows.map((r) => r.driverId))];
}

export async function supersedePendingOffers(bookingId: string, exceptDriverId?: string) {
  const conditions = [
    eq(bookingOffers.bookingId, bookingId),
    eq(bookingOffers.status, BookingOfferStatus.PENDING),
  ];
  const offers = await db
    .select()
    .from(bookingOffers)
    .where(and(...conditions));

  for (const offer of offers) {
    if (exceptDriverId && offer.driverId === exceptDriverId) continue;
    await db
      .update(bookingOffers)
      .set({ status: BookingOfferStatus.TAKEN, respondedAt: new Date() })
      .where(eq(bookingOffers.id, offer.id));
  }
}

export async function listPendingOffersForDriver(driverId: string) {
  return db
    .select({
      offer: bookingOffers,
      booking: bookings,
      serviceName: serviceCategories.name,
      serviceCode: serviceCategories.code,
    })
    .from(bookingOffers)
    .innerJoin(bookings, eq(bookingOffers.bookingId, bookings.id))
    .innerJoin(serviceCategories, eq(bookings.serviceCategoryId, serviceCategories.id))
    .where(
      and(
        eq(bookingOffers.driverId, driverId),
        eq(bookingOffers.status, BookingOfferStatus.PENDING),
        inArray(bookings.status, [...DISPATCHABLE_BOOKING_STATUSES]),
        gt(bookingOffers.expiresAt, dbNow)
      )
    )
    .orderBy(desc(bookingOffers.offeredAt));
}

export async function cancelPendingOffersForDriver(
  driverId: string,
  _reason: string
): Promise<{ id: string; bookingId: string; driverId: string }[]> {
  const pending = await db
    .select()
    .from(bookingOffers)
    .where(
      and(eq(bookingOffers.driverId, driverId), eq(bookingOffers.status, BookingOfferStatus.PENDING))
    );

  if (!pending.length) return [];

  await db
    .update(bookingOffers)
    .set({ status: BookingOfferStatus.CANCELLED, respondedAt: new Date() })
    .where(
      and(eq(bookingOffers.driverId, driverId), eq(bookingOffers.status, BookingOfferStatus.PENDING))
    );

  return pending.map((o) => ({ id: o.id, bookingId: o.bookingId, driverId: o.driverId }));
}

export async function cancelPendingOffersForBooking(
  bookingId: string,
  _reason: string
): Promise<{ id: string; driverId: string }[]> {
  const pending = await db
    .select()
    .from(bookingOffers)
    .where(
      and(eq(bookingOffers.bookingId, bookingId), eq(bookingOffers.status, BookingOfferStatus.PENDING))
    );

  if (!pending.length) return [];

  await db
    .update(bookingOffers)
    .set({ status: BookingOfferStatus.CANCELLED, respondedAt: new Date() })
    .where(
      and(eq(bookingOffers.bookingId, bookingId), eq(bookingOffers.status, BookingOfferStatus.PENDING))
    );

  return pending.map((o) => ({ id: o.id, driverId: o.driverId }));
}

export async function countPendingOffersForBooking(bookingId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bookingOffers)
    .where(
      and(
        eq(bookingOffers.bookingId, bookingId),
        eq(bookingOffers.status, BookingOfferStatus.PENDING),
        gt(bookingOffers.expiresAt, dbNow)
      )
    );
  return rows[0]?.count ?? 0;
}

export async function insertBookingEvent(data: typeof bookingEvents.$inferInsert) {
  const [row] = await db.insert(bookingEvents).values(data).returning();
  return row;
}

export async function getBookingDetail(id: string) {
  const rows = await db
    .select({
      booking: bookings,
      customerName: customers.name,
      customerEmail: customers.email,
      driverName: drivers.name,
      driverPhone: drivers.phone,
      vehiclePlate: vehicles.plateNumber,
      serviceName: serviceCategories.name,
      serviceCode: serviceCategories.code,
    })
    .from(bookings)
    .innerJoin(customers, eq(bookings.customerId, customers.id))
    .innerJoin(serviceCategories, eq(bookings.serviceCategoryId, serviceCategories.id))
    .leftJoin(drivers, eq(bookings.assignedDriverId, drivers.id))
    .leftJoin(vehicles, eq(bookings.assignedVehicleId, vehicles.id))
    .where(eq(bookings.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function countCustomerBookings(customerId: string) {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bookings)
    .where(eq(bookings.customerId, customerId));
  return rows[0]?.count ?? 0;
}

export async function expireStaleOffers(): Promise<{ id: string; bookingId: string; driverId: string }[]> {
  // Exact boundary: expired when expires_at <= CURRENT_TIMESTAMP
  const stale = await db
    .select()
    .from(bookingOffers)
    .where(
      and(
        eq(bookingOffers.status, BookingOfferStatus.PENDING),
        lte(bookingOffers.expiresAt, dbNow)
      )
    );

  if (!stale.length) return [];

  const ids = stale.map((o) => o.id);

  await db
    .update(bookingOffers)
    .set({ status: BookingOfferStatus.EXPIRED, respondedAt: sql`CURRENT_TIMESTAMP` })
    .where(
      and(
        eq(bookingOffers.status, BookingOfferStatus.PENDING),
        inArray(bookingOffers.id, ids),
        lte(bookingOffers.expiresAt, dbNow)
      )
    );

  return stale.map((o) => ({ id: o.id, bookingId: o.bookingId, driverId: o.driverId }));
}

export async function listDriversWithActiveBookings(): Promise<string[]> {
  const rows = await db
    .select({ driverId: bookings.assignedDriverId })
    .from(bookings)
    .where(
      and(
        inArray(bookings.status, ACTIVE_BOOKING_STATUSES),
        sql`${bookings.assignedDriverId} IS NOT NULL`
      )
    );
  return rows.map((r) => r.driverId!).filter(Boolean);
}

export async function findIdempotencyRecord(customerId: string, idempotencyKey: string) {
  const rows = await db
    .select()
    .from(bookingIdempotencyKeys)
    .where(
      and(
        eq(bookingIdempotencyKeys.customerId, customerId),
        eq(bookingIdempotencyKeys.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function insertIdempotencyRecord(data: typeof bookingIdempotencyKeys.$inferInsert) {
  const [row] = await db.insert(bookingIdempotencyKeys).values(data).returning();
  return row;
}

export async function attachBookingToIdempotency(
  customerId: string,
  idempotencyKey: string,
  bookingId: string
) {
  await db
    .update(bookingIdempotencyKeys)
    .set({ bookingId })
    .where(
      and(
        eq(bookingIdempotencyKeys.customerId, customerId),
        eq(bookingIdempotencyKeys.idempotencyKey, idempotencyKey)
      )
    );
}
