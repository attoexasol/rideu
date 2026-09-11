import { db } from '../db/connection';
import { drivers, vehicles, bookings, bookingOffers, bookingEvents } from '../db/schema';
import { eq, and, ne } from 'drizzle-orm';
import { realtimeCache } from '../config/redis';
import { dispatchConfig } from '../config/dispatch';
import { withTransactionTimeout, isTransactionTimeoutError } from '../utils/db-transaction';
import {
  DISPATCH_BATCH_SIZE,
  DISPATCH_MAX_BATCHES,
  DISPATCH_OFFER_TTL_SECONDS,
  BookingStatus,
  BookingOfferStatus,
} from '../constants/bookingStatus';
import {
  findBookingById,
  updateBooking,
  createPendingBookingOffer,
  insertBookingEvent,
  listExcludedDriverIdsForBooking,
  findOfferById,
  cancelPendingOffersForBooking,
} from '../repositories/booking.repository';
import { buildOfferTimeWindow, isOfferExpiredAt } from '../utils/offerTimestamps';
import { haversineKm, estimateMinutesFromKm } from '../utils/geo';
import {
  emitToDriver,
  emitToCustomer,
  emitToAdmins,
  emitOfferCancelled,
  emitBookingStatus,
} from './bookingNotify.service';
import { checkDriverEligibility, resolveDispatchVehicle } from './driverAvailability.service';
import { hasPendingExchange } from './vehicleExchange.service';
import {
  setDriverAcceptingOffer,
  clearDriverAcceptingOffer,
  isDriverAcceptingOffer,
} from './driverAcceptanceLock.service';
import { buildOfferEventPayload } from './driverBooking.service';
import { notifyDriverOfPersistedOffer } from './driverOfferNotify.service';
import { notifyPassengerOfRideEvent } from './passengerRideNotify.service';
import { logger } from '../middleware/logger';

interface DriverCandidate {
  driverId: string;
  driverName: string;
  distanceKm: number;
  vehicleId: string | null;
  plateNumber: string | null;
}

export interface AcceptOfferResult {
  success: boolean;
  code?: string;
  message?: string;
  booking?: unknown;
}

export async function findNearbyDriversForCategory(
  serviceCategoryId: string,
  pickupLat: number,
  pickupLng: number,
  radiusKm = dispatchConfig.dispatchRadiusKm,
  excludeBookingId?: string
): Promise<DriverCandidate[]> {
  const excludedDriverIds = excludeBookingId
    ? new Set(await listExcludedDriverIdsForBooking(excludeBookingId))
    : new Set<string>();

  const activeDriverIds = await realtimeCache.getActiveDrivers();
  const candidates: DriverCandidate[] = [];

  for (const driverId of activeDriverIds) {
    if (excludedDriverIds.has(driverId)) continue;

    const eligibility = await checkDriverEligibility(
      driverId,
      serviceCategoryId,
      pickupLat,
      pickupLng,
      { radiusKm }
    );
    if (!eligibility.eligible) continue;

    const location = await realtimeCache.getDriverLocation(driverId);
    const distanceKm = haversineKm(
      pickupLat,
      pickupLng,
      parseFloat(String(location!.latitude)),
      parseFloat(String(location!.longitude))
    );

    const driverRows = await db
      .select({
        id: drivers.id,
        name: drivers.name,
        vehicleId: drivers.vehicleId,
        plateNumber: vehicles.plateNumber,
      })
      .from(drivers)
      .leftJoin(vehicles, eq(drivers.vehicleId, vehicles.id))
      .where(eq(drivers.id, driverId))
      .limit(1);

    const driver = driverRows[0];
    if (!driver) continue;

    candidates.push({
      driverId: driver.id,
      driverName: driver.name,
      distanceKm,
      vehicleId: driver.vehicleId,
      plateNumber: driver.plateNumber,
    });
  }

  return candidates.sort((a, b) => a.distanceKm - b.distanceKm);
}

const dispatchTimers = new Map<string, NodeJS.Timeout>();

export function clearDispatchTimer(bookingId: string): void {
  const timer = dispatchTimers.get(bookingId);
  if (timer) {
    clearTimeout(timer);
    dispatchTimers.delete(bookingId);
  }
}

async function releaseCardAuthorizationForTerminalBooking(bookingId: string): Promise<void> {
  try {
    const { releaseCardPaymentAuthorization } = await import('./stripeCapture.service');
    await releaseCardPaymentAuthorization(bookingId);
  } catch (error) {
    logger.warn({
      type: 'stripe.payment_intent.terminal_release_failed',
      bookingId,
      message: error instanceof Error ? error.message : 'unknown',
    });
  }
}

export async function startDispatch(bookingId: string): Promise<void> {
  const booking = await findBookingById(bookingId);
  if (!booking) throw new Error('Booking not found');
  if (booking.status !== BookingStatus.SEARCHING && booking.status !== BookingStatus.OFFERED) {
    return;
  }

  const batch = (booking.dispatchBatch ?? 0) + 1;
  if (batch > DISPATCH_MAX_BATCHES) {
    await updateBooking(bookingId, { status: BookingStatus.NO_DRIVERS });
    await insertBookingEvent({
      bookingId,
      actorType: 'system',
      eventType: 'no_drivers',
      payload: { batch },
    });
    await emitToCustomer(booking.customerId, 'booking:expired', {
      bookingId,
      status: BookingStatus.NO_DRIVERS,
      reason: 'no_drivers',
    });
    notifyPassengerOfRideEvent({
      customerId: booking.customerId,
      bookingId,
      event: BookingStatus.NO_DRIVERS,
    });
    clearDispatchTimer(bookingId);
    await releaseCardAuthorizationForTerminalBooking(bookingId);
    return;
  }

  const pickupLat = parseFloat(booking.pickupLatitude);
  const pickupLng = parseFloat(booking.pickupLongitude);

  const batchDrivers = (
    await findNearbyDriversForCategory(
      booking.serviceCategoryId,
      pickupLat,
      pickupLng,
      dispatchConfig.dispatchRadiusKm,
      bookingId
    )
  ).slice(0, DISPATCH_BATCH_SIZE);

  if (!batchDrivers.length) {
    const activeDriverIds = await realtimeCache.getActiveDrivers();
    console.warn('[Dispatch] no eligible drivers in batch', {
      bookingId,
      batch,
      serviceCategoryId: booking.serviceCategoryId,
      activeDriverCount: activeDriverIds.length,
    });
    for (const driverId of activeDriverIds.slice(0, 10)) {
      const { diagnoseDriverEligibility } = await import('./driverAvailability.service');
      const diagnosis = await diagnoseDriverEligibility(
        driverId,
        booking.serviceCategoryId,
        pickupLat,
        pickupLng
      );
      if (!diagnosis.eligible) {
        console.info('[Dispatch] driver ineligible', diagnosis);
      }
    }

    if (batch >= DISPATCH_MAX_BATCHES) {
      await updateBooking(bookingId, { status: BookingStatus.NO_DRIVERS, dispatchBatch: batch });
      await emitToCustomer(booking.customerId, 'booking:expired', {
        bookingId,
        status: BookingStatus.NO_DRIVERS,
        reason: 'no_drivers',
      });
      notifyPassengerOfRideEvent({
        customerId: booking.customerId,
        bookingId,
        event: BookingStatus.NO_DRIVERS,
      });
      clearDispatchTimer(bookingId);
      await releaseCardAuthorizationForTerminalBooking(bookingId);
    } else {
      await updateBooking(bookingId, { dispatchBatch: batch });
      scheduleDispatchRetry(bookingId);
    }
    return;
  }

  const { offeredAt, ttlSeconds } = buildOfferTimeWindow(DISPATCH_OFFER_TTL_SECONDS);
  await updateBooking(bookingId, {
    status: BookingStatus.OFFERED,
    dispatchBatch: batch,
    searchStartedAt: booking.searchStartedAt ?? offeredAt,
  });

  for (const candidate of batchDrivers) {
    const offer = await createPendingBookingOffer({
      bookingId,
      driverId: candidate.driverId,
      distanceToPickupKm: candidate.distanceKm.toFixed(2),
      ttlSeconds,
    });

    // Prefer DB-persisted expiry (authoritative) for payload + emit
    const offerExpiresAt = offer.expiresAt;

    const payload = await buildOfferEventPayload(
      offer.id,
      bookingId,
      candidate.driverId,
      offerExpiresAt,
      candidate.distanceKm
    );

    try {
      await notifyDriverOfPersistedOffer({
        driverId: candidate.driverId,
        bookingId,
        offerId: offer.id,
        expiresAt: offerExpiresAt,
        socketPayload:
          payload ?? {
            offerId: offer.id,
            bookingId,
            bookingNumber: booking.bookingNumber,
            expiresAt: offerExpiresAt.toISOString(),
            pickupAddress: booking.pickupAddress,
            dropoffAddress: booking.dropoffAddress,
            finalFare: booking.finalFare,
            distanceToPickupKm: candidate.distanceKm,
          },
      });
    } catch (error) {
      logger.warn({
        event: 'dispatch.offer_notify_failed',
        bookingId,
        offerId: offer.id,
        driverId: candidate.driverId,
        message: error instanceof Error ? error.message : 'unknown',
      });
    }

    console.info('[Dispatch] booking:offer emitted', {
      bookingId,
      offerId: offer.id,
      driverId: candidate.driverId,
      batch,
      serviceCategoryId: booking.serviceCategoryId,
      offeredAt: offer.offeredAt.toISOString(),
      expiresAt: offerExpiresAt.toISOString(),
      room: `driver-${candidate.driverId}`,
    });
  }

  await emitToCustomer(booking.customerId, 'booking:searching', {
    bookingId,
    batch,
    status: BookingStatus.SEARCHING,
  });
  scheduleDispatchRetry(bookingId, ttlSeconds);
}

function scheduleDispatchRetry(bookingId: string, ttlSeconds = DISPATCH_OFFER_TTL_SECONDS): void {
  clearDispatchTimer(bookingId);

  const timer = setTimeout(async () => {
    dispatchTimers.delete(bookingId);
    const current = await findBookingById(bookingId);
    if (
      current &&
      (current.status === BookingStatus.SEARCHING || current.status === BookingStatus.OFFERED)
    ) {
      await startDispatch(bookingId);
    }
  }, ttlSeconds * 1000);

  dispatchTimers.set(bookingId, timer);
}

export async function acceptBookingOffer(
  bookingId: string,
  driverId: string,
  offerId?: string
): Promise<AcceptOfferResult> {
  clearDispatchTimer(bookingId);

  if (await hasPendingExchange(driverId)) {
    return {
      success: false,
      code: 'EXCHANGE_PENDING',
      message: 'Driver has a pending vehicle exchange',
    };
  }

  if (await isDriverAcceptingOffer(driverId)) {
    return {
      success: false,
      code: 'BOOKING_ACCEPTANCE_IN_PROGRESS',
      message: 'Another acceptance is in progress',
    };
  }

  await setDriverAcceptingOffer(driverId);

  try {
    return await acceptBookingOfferInternal(bookingId, driverId, offerId);
  } finally {
    await clearDriverAcceptingOffer(driverId);
  }
}

async function acceptBookingOfferInternal(
  bookingId: string,
  driverId: string,
  offerId?: string
): Promise<AcceptOfferResult> {
  clearDispatchTimer(bookingId);

  const bookingPreview = await findBookingById(bookingId);
  if (!bookingPreview) {
    logger.info({
      event: 'driver.accept.trace',
      bookingId,
      driverId,
      offerIdPresent: Boolean(offerId),
      stage: 'precheck',
      code: 'NOT_FOUND',
    });
    return { success: false, code: 'NOT_FOUND', message: 'Booking not found' };
  }

  let offerStatusBefore: string | null = null;
  if (offerId) {
    const offerBefore = await findOfferById(offerId);
    offerStatusBefore = offerBefore?.status ?? null;
  } else {
    const pendingPreview = await db
      .select({ status: bookingOffers.status })
      .from(bookingOffers)
      .where(
        and(
          eq(bookingOffers.bookingId, bookingId),
          eq(bookingOffers.driverId, driverId),
          eq(bookingOffers.status, BookingOfferStatus.PENDING)
        )
      )
      .limit(1);
    offerStatusBefore = pendingPreview[0]?.status ?? null;
  }

  logger.info({
    event: 'driver.accept.trace',
    bookingId,
    driverId,
    offerIdPresent: Boolean(offerId),
    offerId: offerId ?? null,
    offerStatusBefore,
    bookingStatusBefore: bookingPreview.status,
    stage: 'precheck',
  });

  if (bookingPreview.status === BookingStatus.CANCELLED) {
    return {
      success: false,
      code: 'BOOKING_ALREADY_CANCELLED',
      message: 'Booking has been cancelled',
    };
  }

  if (bookingPreview.assignedDriverId) {
    return {
      success: false,
      code: 'BOOKING_ALREADY_TAKEN',
      message: 'Booking has already been assigned to another driver',
    };
  }

  if (
    bookingPreview.status !== BookingStatus.SEARCHING &&
    bookingPreview.status !== BookingStatus.OFFERED
  ) {
    return {
      success: false,
      code: 'BOOKING_NOT_AVAILABLE',
      message: 'Booking is no longer available',
    };
  }

  const pickupLat = parseFloat(bookingPreview.pickupLatitude);
  const pickupLng = parseFloat(bookingPreview.pickupLongitude);
  const eligibility = await checkDriverEligibility(
    driverId,
    bookingPreview.serviceCategoryId,
    pickupLat,
    pickupLng,
    { skipAcceptingCheck: true }
  );
  logger.info({
    event: 'driver.accept.eligibility',
    bookingId,
    driverId,
    eligible: eligibility.eligible,
    code: eligibility.code ?? null,
  });
  if (!eligibility.eligible) {
    return {
      success: false,
      code: eligibility.code ?? 'DRIVER_NOT_ELIGIBLE',
      message: eligibility.message ?? 'Driver is not eligible',
    };
  }

  type TxSuccess = {
    ok: true;
    etaMin: number;
    customerId: string;
    acceptedOfferId: string;
    takenOffers: { id: string; driverId: string }[];
  };
  type TxFailure = { ok: false; code: string; message: string };
  type TxResult = TxSuccess | TxFailure;

  let txResult: TxResult;

  logger.info({
    event: 'driver.accept.transaction',
    bookingId,
    driverId,
    phase: 'started',
  });

  try {
    txResult = await withTransactionTimeout(async (tx) => {
      const locked = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.id, bookingId))
        .for('update')
        .limit(1);

      const booking = locked[0];
      if (!booking) {
        return { ok: false, code: 'NOT_FOUND', message: 'Booking not found' };
      }

      if (booking.status === BookingStatus.CANCELLED) {
        return {
          ok: false,
          code: 'BOOKING_ALREADY_CANCELLED',
          message: 'Booking has been cancelled',
        };
      }

      if (booking.assignedDriverId) {
        return {
          ok: false,
          code: 'BOOKING_ALREADY_TAKEN',
          message: 'Booking has already been assigned to another driver',
        };
      }

      if (booking.status !== BookingStatus.SEARCHING && booking.status !== BookingStatus.OFFERED) {
        return {
          ok: false,
          code: 'BOOKING_NOT_AVAILABLE',
          message: 'Booking is no longer available',
        };
      }

      const driverRows = await tx.select().from(drivers).where(eq(drivers.id, driverId)).limit(1);
      const driver = driverRows[0];
      if (!driver) {
        return { ok: false, code: 'DRIVER_NOT_ELIGIBLE', message: 'Driver not found' };
      }
      const dispatchVehicle = await resolveDispatchVehicle(driverId, driver.vehicleId);
      if (!dispatchVehicle) {
        return { ok: false, code: 'NO_ACTIVE_VEHICLE', message: 'Driver has no assigned vehicle' };
      }

      let offerRow;
      if (offerId) {
        const rows = await tx
          .select()
          .from(bookingOffers)
          .where(and(eq(bookingOffers.id, offerId), eq(bookingOffers.driverId, driverId)))
          .limit(1);
        offerRow = rows[0];
        if (!offerRow) {
          return { ok: false, code: 'OFFER_NOT_FOUND', message: 'Offer not found for driver' };
        }
      } else {
        const rows = await tx
          .select()
          .from(bookingOffers)
          .where(
            and(
              eq(bookingOffers.bookingId, bookingId),
              eq(bookingOffers.driverId, driverId),
              eq(bookingOffers.status, BookingOfferStatus.PENDING)
            )
          )
          .limit(1);
        offerRow = rows[0];
      }

      if (!offerRow || offerRow.status !== BookingOfferStatus.PENDING) {
        return {
          ok: false,
          code: 'OFFER_NOT_FOUND',
          message: 'No pending offer for this driver',
        };
      }

      if (isOfferExpiredAt(offerRow.expiresAt)) {
        await tx
          .update(bookingOffers)
          .set({ status: BookingOfferStatus.EXPIRED, respondedAt: new Date() })
          .where(eq(bookingOffers.id, offerRow.id));
        return { ok: false, code: 'OFFER_EXPIRED', message: 'Offer has expired' };
      }

      const distanceKm = offerRow.distanceToPickupKm ? parseFloat(offerRow.distanceToPickupKm) : 2;
      const etaMin = estimateMinutesFromKm(distanceKm);

      await tx
        .update(bookings)
        .set({
          status: BookingStatus.DRIVER_EN_ROUTE,
          assignedDriverId: driverId,
          assignedVehicleId: dispatchVehicle.vehicleId,
          acceptedAt: new Date(),
          driverEtaMinutes: etaMin,
          updatedAt: new Date(),
        })
        .where(eq(bookings.id, bookingId));

      await tx
        .update(bookingOffers)
        .set({ status: BookingOfferStatus.ACCEPTED, respondedAt: new Date() })
        .where(eq(bookingOffers.id, offerRow.id));

      const otherPending = await tx
        .select()
        .from(bookingOffers)
        .where(
          and(
            eq(bookingOffers.bookingId, bookingId),
            ne(bookingOffers.driverId, driverId),
            eq(bookingOffers.status, BookingOfferStatus.PENDING)
          )
        );

      const takenOffers: { id: string; driverId: string }[] = [];
      for (const offer of otherPending) {
        await tx
          .update(bookingOffers)
          .set({ status: BookingOfferStatus.TAKEN, respondedAt: new Date() })
          .where(eq(bookingOffers.id, offer.id));
        takenOffers.push({ id: offer.id, driverId: offer.driverId });
      }

      await tx
        .update(drivers)
        .set({ status: 'busy', updatedAt: new Date() })
        .where(eq(drivers.id, driverId));

      await tx.insert(bookingEvents).values({
        bookingId,
        actorType: 'driver',
        actorId: driverId,
        eventType: 'accepted',
        payload: { etaMin, offerId: offerRow.id },
      });

      return {
        ok: true,
        etaMin,
        customerId: booking.customerId,
        acceptedOfferId: offerRow.id,
        takenOffers,
      };
    });
  } catch (error) {
    if (isTransactionTimeoutError(error)) {
      logger.warn({
        event: 'driver.accept.transaction',
        bookingId,
        driverId,
        phase: 'rolled_back',
        reason: 'BOOKING_LOCK_TIMEOUT',
      });
      return {
        success: false,
        code: 'BOOKING_LOCK_TIMEOUT',
        message: 'Could not acquire booking lock in time. Please retry.',
      };
    }
    logger.error({
      event: 'driver.accept.transaction',
      bookingId,
      driverId,
      phase: 'rolled_back',
      reason: error instanceof Error ? error.message : 'unknown',
    });
    throw error;
  }

  logger.info({
    event: 'driver.accept.transaction',
    bookingId,
    driverId,
    phase: 'committed',
    ok: txResult.ok,
    code: txResult.ok ? null : txResult.code,
  });

  if (!txResult.ok) {
    return { success: false, code: txResult.code, message: txResult.message };
  }

  // --- Side effects after commit (no row locks held) ---
  await realtimeCache.setDriverStatus(driverId, 'busy');

  const booking = await findBookingById(bookingId);
  const driverRows = await db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1);
  const driver = driverRows[0];
  if (!booking || !driver) {
    return {
      success: false,
      code: 'NOT_FOUND',
      message: 'Booking or driver not found after accept',
    };
  }

  let plateNumber: string | null = null;
  let vehiclePayload: Record<string, unknown> | null = null;
  if (driver.vehicleId) {
    const v = await db.select().from(vehicles).where(eq(vehicles.id, driver.vehicleId)).limit(1);
    plateNumber = v[0]?.plateNumber ?? null;
    if (v[0]) {
      vehiclePayload = {
        id: v[0].id,
        make: v[0].make ?? driver.vehicleMake,
        model: v[0].model ?? driver.vehicleModel,
        color: driver.vehicleColor,
        plateNumber: v[0].plateNumber,
      };
    }
  }

  const etaMin = booking.driverEtaMinutes ?? txResult.etaMin;

  let offerCancelledEmitted = 0;
  for (const offer of txResult.takenOffers) {
    await emitOfferCancelled(offer.driverId, {
      bookingId,
      offerId: offer.id,
      reason: 'accepted_by_another_driver',
    });
    offerCancelledEmitted += 1;
    await emitToDriver(offer.driverId, 'booking:taken', { bookingId });
  }

  await emitToCustomer(booking.customerId, 'booking:accepted', {
    bookingId,
    status: BookingStatus.DRIVER_EN_ROUTE,
    driver: {
      id: driverId,
      name: driver.name,
      phone: driver.phone,
      plateNumber,
    },
    vehicle: vehiclePayload,
    etaMinutes: etaMin,
  });
  notifyPassengerOfRideEvent({
    customerId: booking.customerId,
    bookingId,
    event: BookingStatus.DRIVER_EN_ROUTE,
  });

  await emitToAdmins('booking:accepted', {
    bookingId,
    driverId,
    status: BookingStatus.DRIVER_EN_ROUTE,
  });

  const { videoConfig } = await import('../config/video');
  if (videoConfig.enabled) {
    const { emitRideVideoAvailable } = await import('./rideVideo.service');
    await emitRideVideoAvailable({
      bookingId,
      driverId,
      passengerId: booking.customerId,
    }).catch((error) => {
      logger.warn({
        event: 'recording.session_available_emit_failed',
        bookingId,
        driverId,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    });
  }

  logger.info({
    event: 'driver.accept.emits',
    bookingId,
    driverId,
    bookingStatusAfter: booking.status,
    bookingAcceptedEmittedToPassenger: true,
    offerCancelledEmitted: offerCancelledEmitted > 0,
    offerCancelledCount: offerCancelledEmitted,
  });

  const { getDriverBookingDetailForDriver } = await import('./driverBooking.service');
  let detail = null;
  try {
    detail = await getDriverBookingDetailForDriver(bookingId, driverId);
  } catch (error) {
    logger.warn({
      event: 'driver.accept.response_build_failed',
      bookingId,
      driverId,
      message: error instanceof Error ? error.message : 'unknown',
      pgCode: (error as { cause?: { code?: string } })?.cause?.code ?? null,
    });
  }
  return { success: true, booking: detail };
}

export async function rejectBookingOffer(
  bookingId: string,
  driverId: string,
  _reason?: string
): Promise<void> {
  await db
    .update(bookingOffers)
    .set({ status: BookingOfferStatus.DECLINED, respondedAt: new Date() })
    .where(
      and(
        eq(bookingOffers.bookingId, bookingId),
        eq(bookingOffers.driverId, driverId),
        eq(bookingOffers.status, BookingOfferStatus.PENDING)
      )
    );
}

export async function cancelDispatchForBooking(bookingId: string, reason: string): Promise<void> {
  clearDispatchTimer(bookingId);
  const cancelled = await cancelPendingOffersForBooking(bookingId, reason);
  for (const offer of cancelled) {
    await emitOfferCancelled(offer.driverId, {
      bookingId,
      offerId: offer.id,
      reason,
    });
  }
}

export async function getOfferDetailForDriver(offerId: string, driverId: string) {
  const offer = await findOfferById(offerId);
  if (!offer || offer.driverId !== driverId) return null;
  if (offer.status !== BookingOfferStatus.PENDING || isOfferExpiredAt(offer.expiresAt)) return null;

  const payload = await buildOfferEventPayload(
    offer.id,
    offer.bookingId,
    driverId,
    offer.expiresAt,
    offer.distanceToPickupKm ? parseFloat(offer.distanceToPickupKm) : 0
  );
  return payload;
}

export async function processExpiredOffers(): Promise<void> {
  const { expireStaleOffers, countPendingOffersForBooking } = await import(
    '../repositories/booking.repository'
  );
  const expired = await expireStaleOffers();
  const affectedBookingIds = new Set<string>();

  for (const offer of expired) {
    affectedBookingIds.add(offer.bookingId);
    await emitOfferCancelled(offer.driverId, {
      bookingId: offer.bookingId,
      offerId: offer.id,
      reason: 'offer_expired',
    });
  }

  for (const bookingId of affectedBookingIds) {
    await revertOfferedBookingToSearching(bookingId, countPendingOffersForBooking);
  }
}

export function shouldRevertBookingToSearching(
  status: string,
  assignedDriverId: string | null | undefined,
  pendingOfferCount: number
): boolean {
  if (assignedDriverId) return false;
  if (status !== BookingStatus.OFFERED && status !== BookingStatus.SEARCHING) return false;
  return pendingOfferCount === 0;
}

export async function revertOfferedBookingToSearching(
  bookingId: string,
  countPending: (id: string) => Promise<number> = async (id) => {
    const { countPendingOffersForBooking } = await import('../repositories/booking.repository');
    return countPendingOffersForBooking(id);
  }
): Promise<void> {
  const booking = await findBookingById(bookingId);
  if (!booking) return;

  const pendingCount = await countPending(bookingId);
  if (!shouldRevertBookingToSearching(booking.status, booking.assignedDriverId, pendingCount)) {
    return;
  }

  if (booking.status === BookingStatus.OFFERED) {
    await updateBooking(bookingId, { status: BookingStatus.SEARCHING });
  }

  await emitToCustomer(booking.customerId, 'booking:searching', {
    bookingId,
    status: BookingStatus.SEARCHING,
    batch: booking.dispatchBatch ?? 0,
  });
  await emitBookingStatus(bookingId, booking.customerId, null, BookingStatus.SEARCHING);
}
