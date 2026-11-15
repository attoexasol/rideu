import { db } from '../db/connection';
import {
  trips,
  bookings,
  bookingStops,
  bookingEvents,
  bookingIdempotencyKeys,
  drivers,
} from '../db/schema';
import { eq, and } from 'drizzle-orm';
import {
  BookingStatus,
  BookingOfferStatus,
  CANCELLABLE_BY_PASSENGER,
} from '../constants/bookingStatus';
import { resolveBookingCurrency } from '../constants/payment';
import {
  updateBooking,
  findBookingById,
  findActiveBookingByCustomer,
  insertBookingEvent,
  getBookingDetail,
  listBookingsByCustomer,
  countCustomerBookings,
  findIdempotencyRecord,
} from '../repositories/booking.repository';
import {
  findPaymentMethodByCode,
  findServiceCategoryById,
} from '../repositories/serviceCategory.repository';
import {
  BillingMode,
  classifyBookingBilling,
  completionSettlementPlan,
  planBookingCreate,
} from './softMeter/billingMode';
import { findBookingPaymentByBookingId } from '../repositories/bookingPayment.repository';
import { findMeterByBooking } from '../repositories/meterSession.repository';
import {
  assertCardPaymentAllowed,
  captureAuthorizedBookingPayment,
  prepareCardPaymentForBooking,
  recordCompletedCashBookingPayment,
  releaseCardPaymentAuthorization,
  type CardPaymentClientView,
} from './payment.service';
import { logger } from '../middleware/logger';
import { quoteSingleCategory } from './fare.service';
import { startDispatch, clearDispatchTimer } from './dispatch.service';
import {
  emitBookingStatus,
  emitRecordingConsent,
  emitOfferCancelled,
  emitToAdmins,
  emitToCustomer,
  emitToDriver,
} from './bookingNotify.service';
import { releaseDriverAvailability } from './driverAvailability.service';
import { videoConfig } from '../config/video';
import { generateBookingNumber, generateShareToken } from '../utils/geo';
import { scopeCancelIdempotencyKey } from '../utils/booking-idempotency';
import { bookingOffers } from '../db/schema/booking_offers';
import { withTransactionTimeout, isTransactionTimeoutError } from '../utils/db-transaction';
import { realtimeCache } from '../config/redis';
import {
  formatPassengerRideSnapshot,
  type PassengerRideSnapshot,
} from './rideHistory.service';
import { notifyPassengerOfRideEvent } from './passengerRideNotify.service';

export class BookingCancellationError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'BookingCancellationError';
  }
}

export type PassengerBookingSnapshot = PassengerRideSnapshot;

export function formatPassengerBookingSnapshot(
  detail: NonNullable<Awaited<ReturnType<typeof getBookingDetail>>>
): PassengerBookingSnapshot {
  return formatPassengerRideSnapshot(detail);
}

export function formatPassengerCancelResponse(booking: {
  id: string;
  status: string;
  cancelledAt?: Date | null;
}) {
  return {
    id: booking.id,
    status: booking.status,
    cancelledAt: booking.cancelledAt?.toISOString?.() ?? null,
  };
}

export async function getPassengerActiveBooking(customerId: string) {
  const booking = await findActiveBookingByCustomer(customerId);
  if (!booking) return null;
  const detail = await getBookingDetail(booking.id);
  if (!detail) return null;
  return formatPassengerBookingSnapshot(detail);
}

export interface CreateBookingInput {
  customerId: string;
  serviceCategoryId: string;
  pickup: {
    latitude: number;
    longitude: number;
    address: string;
    spotLabel?: string;
    placeId?: string;
    countryCode?: string;
  };
  dropoff: { latitude: number; longitude: number; address: string; placeId?: string };
  pickupCountryCode?: string;
  stops?: { latitude: number; longitude: number; address: string; placeId?: string }[];
  paymentMethodCode?: string;
  schedulingType?: 'instant' | 'scheduled';
  scheduledPickupAt?: string;
  idempotencyKey?: string;
}

export async function createBookingQuote(input: CreateBookingInput) {
  const waypoints =
    input.stops?.map((s) => ({
      latitude: s.latitude,
      longitude: s.longitude,
      address: s.address,
    })) ?? [];

  const result = await quoteSingleCategory(
    input.serviceCategoryId,
    {
      latitude: input.pickup.latitude,
      longitude: input.pickup.longitude,
      address: input.pickup.address,
      placeId: input.pickup.placeId,
      countryCode: input.pickup.countryCode ?? input.pickupCountryCode,
    },
    {
      latitude: input.dropoff.latitude,
      longitude: input.dropoff.longitude,
      address: input.dropoff.address,
      placeId: input.dropoff.placeId,
    },
    waypoints
  );

  const quote = result.quotes[0];
  if (!quote) {
    throw new Error('Could not calculate fare');
  }

  return {
    ...quote,
    route: result.route,
    promotionId: result.promotionId,
    encodedPolyline: result.route.encodedPolyline,
  };
}

export type ConfirmBookingResult = {
  booking: Awaited<ReturnType<typeof findBookingById>> & object;
  payment?: CardPaymentClientView;
};

export async function confirmBooking(input: CreateBookingInput): Promise<ConfirmBookingResult> {
  if (input.idempotencyKey) {
    const existing = await findIdempotencyRecord(input.customerId, input.idempotencyKey);
    if (existing?.bookingId) {
      const booking = await findBookingById(existing.bookingId);
      if (booking) {
        const paymentCode = (input.paymentMethodCode ?? 'cash').toLowerCase();
        if (paymentCode === 'card' && booking.billingMode !== BillingMode.METERED_POST_TRIP) {
          const payment = await prepareCardPaymentForBooking({
            bookingId: booking.id,
            passengerId: input.customerId,
            finalFare: booking.finalFare,
            currency: resolveBookingCurrency(booking),
          });
          return { booking, payment };
        }
        return { booking };
      }
    }
  }

  const active = await findActiveBookingByCustomer(input.customerId);
  if (active) {
    throw new Error('You already have an active booking');
  }

  const quote = await createBookingQuote(input);
  const payment = await findPaymentMethodByCode(input.paymentMethodCode ?? 'cash');
  if (!payment) {
    throw new Error('Payment method not found');
  }
  assertCardPaymentAllowed(payment.code);

  const category = await findServiceCategoryById(input.serviceCategoryId);
  if (!category || !category.isActive) {
    throw new Error('Service category not found');
  }
  const isScheduled = input.schedulingType === 'scheduled' && Boolean(input.scheduledPickupAt);
  const plan = planBookingCreate({
    billingMode: classifyBookingBilling({
      serviceCode: category.code,
      schedulingType: isScheduled ? 'scheduled' : 'instant',
    }),
    paymentMethodCode: payment.code,
    isScheduled,
  });
  const initialStatus = plan.initialStatus;
  const idempotencyExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const booking = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(bookings)
      .values({
        bookingNumber: generateBookingNumber(),
        customerId: input.customerId,
        serviceCategoryId: input.serviceCategoryId,
        status: initialStatus,
        schedulingType: isScheduled ? 'scheduled' : 'instant',
        scheduledPickupAt: isScheduled ? new Date(input.scheduledPickupAt!) : null,
        pickupLatitude: String(input.pickup.latitude),
        pickupLongitude: String(input.pickup.longitude),
        pickupAddress: input.pickup.address,
        pickupSpotLabel: input.pickup.spotLabel ?? null,
        pickupPlaceId: input.pickup.placeId ?? null,
        dropoffLatitude: String(input.dropoff.latitude),
        dropoffLongitude: String(input.dropoff.longitude),
        dropoffAddress: input.dropoff.address,
        dropoffPlaceId: input.dropoff.placeId ?? null,
        estimatedDistanceKm: String(quote.distanceKm),
        estimatedDurationMin: quote.durationMin,
        estimatedFare: String(quote.finalFare),
        originalFare: String(quote.originalFare),
        promotionId: quote.promotionId,
        discountAmount: String(quote.discountAmount),
        regularTripFare: String(quote.regularFare),
        airportFeeAmount: String(quote.airportFee),
        currency: quote.currency,
        marketCode: quote.marketCode ?? null,
        pickupCountryCode: quote.pickupCountryCode ?? null,
        airportId: quote.airport?.id ?? null,
        airportCodeSnapshot: quote.airport?.code ?? null,
        airportNameSnapshot: quote.airport?.name ?? null,
        airportTripType: quote.airport?.tripType ?? null,
        finalFare: String(quote.finalFare),
        routeEncodedPolyline: quote.encodedPolyline ?? null,
        paymentMethodId: payment.id,
        paymentStatus: 'pending',
        billingMode: plan.billingMode,
        shareToken: generateShareToken(),
        searchStartedAt: initialStatus === BookingStatus.SEARCHING ? new Date() : null,
      })
      .returning();

    if (input.stops?.length) {
      await tx.insert(bookingStops).values(
        input.stops.map((s, i) => ({
          bookingId: created.id,
          stopOrder: i + 1,
          latitude: String(s.latitude),
          longitude: String(s.longitude),
          address: s.address,
          placeId: s.placeId ?? null,
        }))
      );
    }

    await tx.insert(bookingEvents).values({
      bookingId: created.id,
      actorType: 'customer',
      actorId: input.customerId,
      eventType: 'created',
      payload: { status: initialStatus },
    });

    if (input.idempotencyKey) {
      const existingKey = await tx
        .select()
        .from(bookingIdempotencyKeys)
        .where(
          and(
            eq(bookingIdempotencyKeys.customerId, input.customerId),
            eq(bookingIdempotencyKeys.idempotencyKey, input.idempotencyKey)
          )
        )
        .limit(1);

      if (existingKey[0]) {
        await tx
          .update(bookingIdempotencyKeys)
          .set({ bookingId: created.id })
          .where(eq(bookingIdempotencyKeys.id, existingKey[0].id));
      } else {
        await tx.insert(bookingIdempotencyKeys).values({
          customerId: input.customerId,
          idempotencyKey: input.idempotencyKey,
          bookingId: created.id,
          expiresAt: idempotencyExpiresAt,
        });
      }
    }

    return created;
  });

  if (plan.createQuotePaymentIntent) {
    const cardPayment = await prepareCardPaymentForBooking({
      bookingId: booking.id,
      passengerId: input.customerId,
      finalFare: booking.finalFare,
      currency: quote.currency,
    });
    return { booking, payment: cardPayment };
  }

  if (plan.startDispatch) {
    await startDispatch(booking.id);
  }

  return { booking };
}

export async function cancelBookingByCustomer(
  bookingId: string,
  customerId: string,
  options: {
    reason?: string;
    reasonCode?: string;
    idempotencyKey?: string;
  } = {}
) {
  const { reason, reasonCode, idempotencyKey } = options;
  const scopedIdempotencyKey = idempotencyKey
    ? scopeCancelIdempotencyKey(bookingId, idempotencyKey)
    : undefined;

  if (scopedIdempotencyKey) {
    const existing = await findIdempotencyRecord(customerId, scopedIdempotencyKey);
    if (existing?.bookingId) {
      const prior = await findBookingById(existing.bookingId);
      if (prior?.status === BookingStatus.CANCELLED) {
        await releaseCardPaymentAuthorization(bookingId);
        return prior;
      }
    }
  }

  const booking = await findBookingById(bookingId);
  if (!booking) {
    throw new BookingCancellationError('NOT_FOUND', 'Booking not found', 404);
  }
  if (booking.customerId !== customerId) {
    throw new BookingCancellationError('FORBIDDEN', 'Access denied', 403);
  }

  if (booking.status === BookingStatus.CANCELLED) {
    await releaseCardPaymentAuthorization(bookingId);
    return booking;
  }

  if (!CANCELLABLE_BY_PASSENGER.includes(booking.status as any)) {
    throw new BookingCancellationError(
      'BOOKING_CANCELLATION_NOT_ALLOWED',
      'This ride can no longer be cancelled.',
      409
    );
  }

  const pendingOffers = await db
    .select()
    .from(bookingOffers)
    .where(
      and(
        eq(bookingOffers.bookingId, bookingId),
        eq(bookingOffers.status, BookingOfferStatus.PENDING)
      )
    );

  let updated;
  let assignedDriverId: string | null = null;
  let didCancel = false;

  try {
    updated = await withTransactionTimeout(async (tx) => {
      const locked = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.id, bookingId))
        .for('update')
        .limit(1);

      const current = locked[0];
      if (!current) {
        throw new BookingCancellationError('NOT_FOUND', 'Booking not found', 404);
      }
      if (current.status === BookingStatus.CANCELLED) {
        return current;
      }
      if (!CANCELLABLE_BY_PASSENGER.includes(current.status as any)) {
        throw new BookingCancellationError(
          'BOOKING_CANCELLATION_NOT_ALLOWED',
          'This ride can no longer be cancelled.',
          409
        );
      }

      assignedDriverId = current.assignedDriverId;

      const [row] = await tx
        .update(bookings)
        .set({
          status: BookingStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: 'customer',
          cancellationReason: reason ?? reasonCode ?? null,
          updatedAt: new Date(),
        })
        .where(eq(bookings.id, bookingId))
        .returning();

      await tx
        .update(bookingOffers)
        .set({ status: BookingOfferStatus.CANCELLED, respondedAt: new Date() })
        .where(
          and(
            eq(bookingOffers.bookingId, bookingId),
            eq(bookingOffers.status, BookingOfferStatus.PENDING)
          )
        );

      if (assignedDriverId) {
        await tx
          .update(drivers)
          .set({ status: 'online', updatedAt: new Date() })
          .where(eq(drivers.id, assignedDriverId));
      }

      await tx.insert(bookingEvents).values({
        bookingId,
        actorType: 'customer',
        actorId: customerId,
        eventType: 'cancelled',
        payload: { reason, reasonCode },
      });

      if (scopedIdempotencyKey) {
        const idempotencyExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const existingKey = await tx
          .select()
          .from(bookingIdempotencyKeys)
          .where(
            and(
              eq(bookingIdempotencyKeys.customerId, customerId),
              eq(bookingIdempotencyKeys.idempotencyKey, scopedIdempotencyKey)
            )
          )
          .limit(1);

        if (existingKey[0]) {
          await tx
            .update(bookingIdempotencyKeys)
            .set({ bookingId })
            .where(eq(bookingIdempotencyKeys.id, existingKey[0].id));
        } else {
          await tx.insert(bookingIdempotencyKeys).values({
            customerId,
            idempotencyKey: scopedIdempotencyKey,
            bookingId,
            expiresAt: idempotencyExpiresAt,
          });
        }
      }

      didCancel = true;
      return row;
    });
  } catch (error) {
    if (error instanceof BookingCancellationError) throw error;
    if (isTransactionTimeoutError(error)) {
      throw new BookingCancellationError(
        'BOOKING_LOCK_TIMEOUT',
        'Could not cancel booking right now. Please retry.',
        409
      );
    }
    throw error;
  }

  if (!didCancel) {
    await releaseCardPaymentAuthorization(bookingId);
    return updated;
  }

  await insertBookingEvent({
    bookingId,
    actorType: 'system',
    actorId: null,
    eventType: 'dispatch_stopped',
    payload: { reason: 'passenger_cancelled', reasonCode },
  });

  await emitBookingStatus(bookingId, customerId, assignedDriverId, BookingStatus.CANCELLED, {
    reason,
    reasonCode,
  });

  clearDispatchTimer(bookingId);

  if (assignedDriverId) {
    await realtimeCache.setDriverStatus(assignedDriverId, 'online');
  }

  for (const offer of pendingOffers) {
    await emitOfferCancelled(offer.driverId, {
      bookingId,
      offerId: offer.id,
      reason: 'passenger_cancelled',
    });
  }

  const { finalizeRideVideoSessionsForBooking } = await import('./rideVideo.service');
  await finalizeRideVideoSessionsForBooking(bookingId, 'Booking cancelled by passenger');

  await releaseCardPaymentAuthorization(bookingId);
  return updated;
}

export async function consentRecording(
  bookingId: string,
  customerId: string,
  consent: boolean,
  consentVersion = 'v1'
) {
  const booking = await findBookingById(bookingId);
  if (!booking) throw new Error('Booking not found');
  if (booking.customerId !== customerId) throw new Error('Access denied');
  if (
    ![
      BookingStatus.ACCEPTED,
      BookingStatus.DRIVER_EN_ROUTE,
      BookingStatus.ARRIVED,
      BookingStatus.IN_PROGRESS,
    ].includes(booking.status as any)
  ) {
    throw new Error('Recording consent can only be managed for an active assigned booking');
  }

  const nextStatus = consent ? 'granted' : 'denied';
  if (
    booking.recordingConsentStatus === nextStatus &&
    booking.recordingConsentVersion === consentVersion
  ) {
    return booking;
  }

  const now = new Date();
  const updated = await updateBooking(bookingId, {
    recordingConsentStatus: nextStatus,
    recordingConsentedAt: consent ? now : booking.recordingConsentedAt,
    recordingConsentRevokedAt: consent ? null : now,
    recordingConsentVersion: consentVersion,
  });

  if (booking.assignedDriverId) {
    const recordingConsentedAt = updated.recordingConsentedAt?.toISOString() ?? null;
    if (recordingConsentedAt) {
      await emitRecordingConsent(booking.assignedDriverId, {
        bookingId,
        consented: true,
        recordingConsentedAt,
      });
    }
    const payload = {
      bookingId,
      consentStatus: nextStatus,
      consentedAt: recordingConsentedAt,
      revokedAt: updated.recordingConsentRevokedAt?.toISOString() ?? null,
      consentVersion,
      timestamp: now.toISOString(),
    };
    await Promise.allSettled([
      emitToDriver(booking.assignedDriverId, 'recording:consent_updated', payload),
      emitToCustomer(customerId, 'recording:consent_updated', payload),
      emitToAdmins('recording:consent_updated', payload),
    ]);
    const { updateSessionsForConsent } = await import('./rideVideo.service');
    await updateSessionsForConsent(bookingId, nextStatus);
  }

  return updated;
}

const DRIVER_STATUS_TRANSITIONS: Record<string, string[]> = {
  [BookingStatus.DRIVER_EN_ROUTE]: [BookingStatus.ARRIVED],
  [BookingStatus.ARRIVED]: [BookingStatus.IN_PROGRESS],
  [BookingStatus.IN_PROGRESS]: [BookingStatus.COMPLETED],
};

export async function updateBookingStatusByDriver(
  bookingId: string,
  driverId: string,
  newStatus: string
) {
  const booking = await findBookingById(bookingId);
  if (!booking) throw new Error('Booking not found');
  if (booking.assignedDriverId !== driverId) throw new Error('Access denied');

  const meterSession =
    newStatus === BookingStatus.COMPLETED ? await findMeterByBooking(bookingId) : null;
  const meterAttached = Boolean(
    meterSession &&
      (meterSession.status === 'running' ||
        meterSession.status === 'paused' ||
        meterSession.status === 'stopped' ||
        meterSession.status === 'finalized')
  );
  const settlement = completionSettlementPlan({
    storedBillingMode: booking.billingMode,
    meterAttached,
    quoteAlreadyCaptured: false,
  });
  const metered = settlement !== 'capture_quote';

  if (booking.status === BookingStatus.COMPLETED && newStatus === BookingStatus.COMPLETED) {
    if (metered) {
      const { ensureOnDemandMeterSettlement, markMeterSettlementUnresolved } = await import(
        './softMeter/onDemandMeterPayment.service'
      );
      const payment = await ensureOnDemandMeterSettlement(bookingId, driverId);
      if (settlement === 'meter_unresolved' && !payment) {
        await markMeterSettlementUnresolved(bookingId);
      }
      return (await findBookingById(bookingId)) ?? booking;
    }
    await captureAuthorizedBookingPayment(bookingId);
    await recordCompletedCashBookingPayment({
      bookingId,
      finalFare: booking.finalFare,
      currency: booking.currency,
      completedAt: booking.completedAt,
    });
    return (await findBookingById(bookingId)) ?? booking;
  }

  const allowed = DRIVER_STATUS_TRANSITIONS[booking.status] ?? [];
  if (!allowed.includes(newStatus)) {
    throw new Error(`Cannot transition from ${booking.status} to ${newStatus}`);
  }

  const patch: Record<string, unknown> = { status: newStatus };
  const cardPayment =
    newStatus === BookingStatus.COMPLETED
      ? await findBookingPaymentByBookingId(bookingId)
      : null;
  const isCard = cardPayment?.paymentMethod === 'card';

  if (newStatus === BookingStatus.ARRIVED) {
    patch.arrivedAt = new Date();
  }

  if (newStatus === BookingStatus.IN_PROGRESS) {
    if (
      videoConfig.enabled &&
      videoConfig.consentRequired &&
      (booking.recordingConsentStatus === 'denied' ||
        (booking.recordingConsentStatus !== 'granted' && !booking.recordingConsentedAt))
    ) {
      const err = new Error('Passenger recording consent is required before starting the ride.');
      (err as any).code = 'RECORDING_CONSENT_REQUIRED';
      throw err;
    }
    const trip = await createTripFromBooking(booking, driverId);
    patch.linkedTripId = trip.id;
    patch.startedAt = new Date();
    const { linkSessionToTrip } = await import('./rideVideo.service');
    await linkSessionToTrip(booking.id, trip.id);
  }

  if (newStatus === BookingStatus.COMPLETED) {
    patch.completedAt = new Date();
    if (!isCard && !metered) {
      patch.paymentStatus = 'paid';
    }
    if (booking.linkedTripId) {
      await db
        .update(trips)
        .set({ status: 'completed', endTime: new Date(), updatedAt: new Date() })
        .where(eq(trips.id, booking.linkedTripId));
    }
    const { finalizeRideVideoSessionsForBooking } = await import('./rideVideo.service');
    await finalizeRideVideoSessionsForBooking(bookingId, 'Ride completed');
    await releaseDriverAvailability(driverId);
  }

  const updated = await updateBooking(bookingId, patch as any);

  await insertBookingEvent({
    bookingId,
    actorType: 'driver',
    eventType: 'status_change',
    actorId: driverId,
    payload: { from: booking.status, to: newStatus },
  });

  await emitBookingStatus(bookingId, booking.customerId, driverId, newStatus);

  if (
    newStatus === BookingStatus.ARRIVED ||
    newStatus === BookingStatus.IN_PROGRESS ||
    newStatus === BookingStatus.COMPLETED
  ) {
    notifyPassengerOfRideEvent({
      customerId: booking.customerId,
      bookingId,
      event: newStatus,
    });
  }

  if (newStatus === BookingStatus.COMPLETED && metered) {
    const { ensureOnDemandMeterSettlement, markMeterSettlementUnresolved } = await import(
      './softMeter/onDemandMeterPayment.service'
    );
    const payment = await ensureOnDemandMeterSettlement(bookingId, driverId);
    if (settlement === 'meter_unresolved' && !payment) {
      await markMeterSettlementUnresolved(bookingId);
    }
    return (await findBookingById(bookingId)) ?? updated;
  }

  if (newStatus === BookingStatus.COMPLETED && isCard && !metered) {
    await captureAuthorizedBookingPayment(bookingId);
    const { previewFinalizeOnDemandMeter } = await import('./softMeter/onDemandMeter.service');
    await previewFinalizeOnDemandMeter(bookingId, driverId);
    return (await findBookingById(bookingId)) ?? updated;
  }

  if (newStatus === BookingStatus.COMPLETED && !isCard && !metered) {
    await recordCompletedCashBookingPayment({
      bookingId,
      finalFare: booking.finalFare,
      currency: booking.currency,
      completedAt: updated.completedAt,
    });
    const { previewFinalizeOnDemandMeter } = await import('./softMeter/onDemandMeter.service');
    await previewFinalizeOnDemandMeter(bookingId, driverId);
  }

  if (
    newStatus === BookingStatus.IN_PROGRESS &&
    booking.billingMode === BillingMode.METERED_POST_TRIP
  ) {
    try {
      const { startOnDemandMeter } = await import('./softMeter/onDemandMeter.service');
      await startOnDemandMeter(bookingId, driverId);
    } catch (error) {
      logger.warn({
        type: 'meter.ondemand.auto_start_failed',
        bookingId,
        message: error instanceof Error ? error.message : 'start failed',
      });
    }
  }

  if (newStatus === BookingStatus.IN_PROGRESS) {
    const session = await (
      await import('./liveVideo.service')
    ).findActiveSessionByBooking(bookingId);
    return {
      ...updated,
      video: {
        required: true,
        sessionId: session?.id ?? null,
        segmentDurationSeconds: videoConfig.segmentDurationSeconds,
        nextSegmentIndex: 0,
      },
    };
  }

  return updated;
}

const DRIVER_CANCELLABLE_STATUSES = [BookingStatus.DRIVER_EN_ROUTE, BookingStatus.ARRIVED];

export async function cancelBookingByDriver(bookingId: string, driverId: string, reason?: string) {
  const booking = await findBookingById(bookingId);
  if (!booking) throw new Error('Booking not found');
  if (booking.assignedDriverId !== driverId) throw new Error('Access denied');

  if (booking.status === BookingStatus.CANCELLED) {
    await releaseCardPaymentAuthorization(bookingId);
    return booking;
  }

  if (!DRIVER_CANCELLABLE_STATUSES.includes(booking.status as any)) {
    throw new Error('Booking cannot be cancelled in the current status');
  }

  const updated = await updateBooking(bookingId, {
    status: BookingStatus.CANCELLED,
    cancelledAt: new Date(),
    cancelledBy: 'driver',
    cancellationReason: reason ?? null,
  });

  await insertBookingEvent({
    bookingId,
    actorType: 'driver',
    actorId: driverId,
    eventType: 'cancelled',
    payload: { reason },
  });

  const { finalizeRideVideoSessionsForBooking } = await import('./rideVideo.service');
  await finalizeRideVideoSessionsForBooking(bookingId, 'Booking cancelled by driver');
  await releaseDriverAvailability(driverId);

  await emitBookingStatus(bookingId, booking.customerId, driverId, BookingStatus.CANCELLED, {
    reason,
    cancelledBy: 'driver',
  });
  notifyPassengerOfRideEvent({
    customerId: booking.customerId,
    bookingId,
    event: BookingStatus.CANCELLED,
    cancelledBy: 'driver',
  });

  await releaseCardPaymentAuthorization(bookingId);
  return updated;
}

async function createTripFromBooking(
  booking: Awaited<ReturnType<typeof findBookingById>> & object,
  driverId: string
) {
  const [trip] = await db
    .insert(trips)
    .values({
      driverId,
      customerId: booking.customerId,
      bookingId: booking.id,
      startTime: new Date(),
      status: 'in_progress',
      tripType: 'passenger_ride',
    })
    .returning();
  return trip;
}

export async function getCustomerBookings(customerId: string, page = 1, limit = 20) {
  const offset = (page - 1) * limit;
  const [items, total] = await Promise.all([
    listBookingsByCustomer(customerId, limit, offset),
    countCustomerBookings(customerId),
  ]);
  return { items, total, page, limit };
}

export { getBookingDetail, findActiveBookingByCustomer, findBookingById };
