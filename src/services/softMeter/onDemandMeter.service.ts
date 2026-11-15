import { BookingStatus } from '../../constants/bookingStatus';
import { logger } from '../../middleware/logger';
import { findBookingById } from '../../repositories/booking.repository';
import { findMeterByBooking } from '../../repositories/meterSession.repository';
import { findOpenWalkUpByDriver } from '../../repositories/walkUp.repository';
import { MeterError } from './errors';
import {
  finalizeMeterSession,
  getMeterSessionForDriver,
  ingestMeterPoints,
  startMeterSession,
  stopMeterSession,
  toMeterState,
} from './meterSession.service';
import { onDemandSettlementView } from './paymentState';
import type { GpsPointInput } from './gps';

async function requireInProgressBooking(bookingId: string, driverId: string) {
  const booking = await findBookingById(bookingId);
  if (!booking || booking.assignedDriverId !== driverId) {
    throw new MeterError('BOOKING_NOT_FOUND', 'Booking not found.', 404);
  }
  return booking;
}

export async function startOnDemandMeter(
  bookingId: string,
  driverId: string,
  idempotencyKey?: string | null
) {
  const booking = await requireInProgressBooking(bookingId, driverId);
  if (booking.status !== BookingStatus.IN_PROGRESS) {
    throw new MeterError(
      'BOOKING_NOT_IN_PROGRESS',
      'The on-demand meter starts only after the existing trip is in progress.',
      409
    );
  }
  if (!booking.assignedVehicleId) {
    throw new MeterError('VEHICLE_NOT_APPROVED', 'Booking has no assigned vehicle.', 409);
  }
  const walkUp = await findOpenWalkUpByDriver(driverId);
  if (walkUp) {
    throw new MeterError('DRIVER_BUSY', 'Driver already has an active walk-up trip.', 409);
  }
  const started = await startMeterSession({
    driverId,
    vehicleId: booking.assignedVehicleId,
    tripKind: 'on_demand',
    bookingId: booking.id,
    customerId: booking.customerId,
    idempotencyKey,
  });
  const session = await getMeterSessionForDriver(started.session.id, driverId);
  return {
    idempotent: started.idempotent,
    meter: toMeterState(session),
    quotedFareUnchanged: true,
    bookingFinalFare: booking.finalFare,
  };
}

export async function readOnDemandMeter(bookingId: string, driverId: string) {
  const booking = await requireInProgressBooking(bookingId, driverId);
  const session = await findMeterByBooking(bookingId);
  return {
    meter: session ? toMeterState(session) : null,
    settlement: onDemandSettlementView({
      billable: false,
      blockedReasons: session
        ? toMeterState(session).fare.blockedReasons
        : ['METER_NOT_ATTACHED'],
    }),
    quotedFareUnchanged: true,
    bookingStatus: booking.status,
    bookingFinalFare: booking.finalFare,
  };
}

export async function readPassengerMeter(bookingId: string, customerId: string) {
  const booking = await findBookingById(bookingId);
  if (!booking || booking.customerId !== customerId) {
    throw new MeterError('BOOKING_NOT_FOUND', 'Booking not found.', 404);
  }
  const session = await findMeterByBooking(bookingId);
  return {
    meter: session ? toMeterState(session) : null,
    settlement: onDemandSettlementView({
      billable: false,
      blockedReasons: session
        ? toMeterState(session).fare.blockedReasons
        : ['METER_NOT_ATTACHED'],
    }),
    quotedFareUnchanged: true,
  };
}

export async function stopOnDemandMeter(
  bookingId: string,
  driverId: string,
  idempotencyKey?: string | null
) {
  await requireInProgressBooking(bookingId, driverId);
  const session = await findMeterByBooking(bookingId);
  if (!session) throw new MeterError('METER_NOT_FOUND', 'Meter session not found.', 404);
  const stopped = await stopMeterSession(session.id, driverId, idempotencyKey);
  return { idempotent: stopped.idempotent, meter: toMeterState(stopped.session) };
}

export async function finalizeOnDemandMeter(bookingId: string, driverId: string) {
  const booking = await requireInProgressBooking(bookingId, driverId);
  const session = await findMeterByBooking(bookingId);
  if (!session) throw new MeterError('METER_NOT_FOUND', 'Meter session not found.', 404);
  const finalized = await finalizeMeterSession(session.id, driverId);
  return {
    idempotent: finalized.idempotent,
    meter: toMeterState(finalized.session),
    fareRecordId: finalized.fare.id,
    billable: false,
    quotedFareUnchanged: true,
    bookingFinalFare: booking.finalFare,
  };
}

export async function ingestOnDemandPoints(
  bookingId: string,
  driverId: string,
  points: GpsPointInput[]
) {
  await requireInProgressBooking(bookingId, driverId);
  const session = await findMeterByBooking(bookingId);
  if (!session) throw new MeterError('METER_NOT_FOUND', 'Meter session not found.', 404);
  const ingested = await ingestMeterPoints(session.id, driverId, points);
  return { meter: toMeterState(ingested.session), results: ingested.results };
}

/** Stops a running on-demand preview when the existing booking completes. Does not capture. */
export async function previewFinalizeOnDemandMeter(
  bookingId: string,
  driverId: string
): Promise<void> {
  try {
    const session = await findMeterByBooking(bookingId);
    if (!session || session.driverId !== driverId) return;
    if (session.status === 'finalized' || session.status === 'voided' || session.status === 'pending') {
      return;
    }
    await finalizeMeterSession(session.id, driverId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'finalize failed';
    if (message.includes('does not exist')) return;
    logger.warn({
      type: 'meter.ondemand.preview_finalize_failed',
      bookingId,
      message,
    });
  }
}
