import { db } from '../db/connection';
import { drivers, vehicles, serviceCategories } from '../db/schema';
import { eq } from 'drizzle-orm';
import { videoConfig } from '../config/video';
import { BookingStatus } from '../constants/bookingStatus';
import { resolveBookingCurrency } from '../constants/payment';
import {
  findActiveBookingByDriver,
  findBookingById,
  getBookingDetail,
} from '../repositories/booking.repository';
import { findActiveSessionByBooking } from './liveVideo.service';
import { resolveBookingRoute, type BookingRouteDto } from './bookingRoute.service';
import { historyDetailFields } from './rideHistory.service';
import { logger } from '../middleware/logger';

const DRIVER_ACTIVE_STATUSES = [
  BookingStatus.ACCEPTED,
  BookingStatus.DRIVER_EN_ROUTE,
  BookingStatus.ARRIVED,
  BookingStatus.IN_PROGRESS,
];

export async function getDriverActiveBookingResponse(driverId: string) {
  const booking = await findActiveBookingByDriver(driverId);
  if (!booking) return null;

  return buildDriverBookingPayload(booking.id, driverId, true);
}

export async function getDriverBookingDetailForDriver(bookingId: string, driverId: string) {
  const booking = await findBookingById(bookingId);
  if (!booking) return null;

  const isAssigned = booking.assignedDriverId === driverId;
  const isDispatchable =
    booking.status === BookingStatus.SEARCHING || booking.status === BookingStatus.OFFERED;

  if (!isAssigned && !isDispatchable) {
    return null;
  }

  if (!isAssigned && isDispatchable) {
    const { findPendingOfferForDriver } = await import('../repositories/booking.repository');
    const offer = await findPendingOfferForDriver(bookingId, driverId);
    if (!offer) return null;
  }

  return buildDriverBookingPayload(bookingId, driverId, isAssigned);
}

type DriverVideoMetadata = {
  required: boolean;
  sessionId: string | null;
  nextSegmentIndex: number;
  segmentDurationSeconds: number;
  active: boolean;
};

async function loadOptionalVideoMetadata(
  bookingId: string,
  bookingStatus: string
): Promise<DriverVideoMetadata | null> {
  try {
    const session = await findActiveSessionByBooking(bookingId);
    const segments = session
      ? await (await import('./liveVideo.service')).listLiveSegments(session.id)
      : [];
    const nextSegmentIndex =
      segments.length > 0 ? Math.max(...segments.map((s) => s.sequenceNumber)) + 1 : 0;

    return {
      required: videoConfig.enabled,
      sessionId: session?.id ?? null,
      nextSegmentIndex,
      segmentDurationSeconds: videoConfig.segmentDurationSeconds,
      active:
        videoConfig.enabled &&
        DRIVER_ACTIVE_STATUSES.includes(bookingStatus as (typeof DRIVER_ACTIVE_STATUSES)[number]) &&
        session?.status === 'active',
    };
  } catch (error) {
    logger.warn({
      event: 'driver.booking.video_metadata_failed',
      bookingId,
      message: error instanceof Error ? error.message : 'unknown',
      pgCode: (error as { cause?: { code?: string } })?.cause?.code ?? null,
    });
    return null;
  }
}

async function loadRouteForBooking(
  booking: {
    id: string;
    routeEncodedPolyline?: string | null;
    estimatedDistanceKm?: string | number | null;
    estimatedDurationMin?: number | null;
    pickupLatitude: string | number;
    pickupLongitude: string | number;
    pickupAddress?: string | null;
    dropoffLatitude: string | number;
    dropoffLongitude: string | number;
    dropoffAddress?: string | null;
  },
  allowGenerate: boolean
): Promise<BookingRouteDto | null> {
  try {
    return await resolveBookingRoute(booking, { allowGenerate });
  } catch {
    return null;
  }
}

async function buildDriverBookingPayload(
  bookingId: string,
  driverId: string,
  includePassengerContact: boolean
) {
  const detail = await getBookingDetail(bookingId);
  if (!detail) return null;

  const booking = detail.booking;
  const vehicleRows = booking.assignedVehicleId
    ? await db.select().from(vehicles).where(eq(vehicles.id, booking.assignedVehicleId)).limit(1)
    : [];
  const driverRows = await db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1);
  const vehicleFromDriver = driverRows[0]?.vehicleId
    ? await db.select().from(vehicles).where(eq(vehicles.id, driverRows[0].vehicleId!)).limit(1)
    : [];

  const vehicle = vehicleRows[0] ?? vehicleFromDriver[0] ?? null;
  const video = await loadOptionalVideoMetadata(bookingId, booking.status);
  const historyFields = historyDetailFields(detail);
  const isActiveAssigned =
    includePassengerContact &&
    DRIVER_ACTIVE_STATUSES.includes(booking.status as (typeof DRIVER_ACTIVE_STATUSES)[number]);

  // Assigned/active: allow one-shot Google fill. Historical and offer preview: stored only.
  const route = await loadRouteForBooking(booking, isActiveAssigned);

  const vehicleSnapshot = vehicle
    ? {
        id: vehicle.id,
        make: vehicle.make ?? driverRows[0]?.vehicleMake ?? historyFields.vehicle?.make ?? null,
        model: vehicle.model ?? driverRows[0]?.vehicleModel ?? historyFields.vehicle?.model ?? null,
        color:
          vehicle.color ?? driverRows[0]?.vehicleColor ?? historyFields.vehicle?.color ?? null,
        plateNumber: vehicle.plateNumber ?? historyFields.vehicle?.plateNumber ?? null,
      }
    : historyFields.vehicle;

  return {
    booking: {
      id: booking.id,
      bookingNumber: booking.bookingNumber,
      status: booking.status,
      recordingConsentedAt: booking.recordingConsentedAt?.toISOString?.() ?? null,
      pickup: {
        latitude: parseFloat(booking.pickupLatitude),
        longitude: parseFloat(booking.pickupLongitude),
        address: booking.pickupAddress,
        spotLabel: booking.pickupSpotLabel,
      },
      dropoff: {
        latitude: parseFloat(booking.dropoffLatitude),
        longitude: parseFloat(booking.dropoffLongitude),
        address: booking.dropoffAddress,
      },
      route,
      fare: {
        amount: booking.finalFare ? parseFloat(booking.finalFare) : null,
        currency: resolveBookingCurrency(booking),
      },
      createdAt: historyFields.createdAt,
      acceptedAt: historyFields.acceptedAt,
      arrivedAt: historyFields.arrivedAt,
      startedAt: historyFields.startedAt,
      completedAt: historyFields.completedAt,
      cancelledAt: historyFields.cancelledAt,
      cancelledBy: historyFields.cancelledBy,
      cancellationReason: historyFields.cancellationReason,
      payment: historyFields.payment,
      recording: historyFields.recording,
    },
    passenger: includePassengerContact
      ? {
          id: booking.customerId,
          name: detail.customerName,
          phone: null,
          rating: null,
        }
      : {
          displayName: detail.customerName,
          rating: null,
        },
    vehicle: vehicleSnapshot,
    service: {
      serviceCategoryId: booking.serviceCategoryId,
      serviceCode: detail.serviceCode,
      serviceName: detail.serviceName,
    },
    recording: historyFields.recording,
    video,
  };
}

export async function buildOfferEventPayload(
  offerId: string,
  bookingId: string,
  driverId: string,
  expiresAt: Date,
  distanceToPickupKm: number
) {
  const detail = await getBookingDetail(bookingId);
  if (!detail) return null;

  const booking = detail.booking;
  const categoryRows = await db
    .select()
    .from(serviceCategories)
    .where(eq(serviceCategories.id, booking.serviceCategoryId))
    .limit(1);
  const category = categoryRows[0];

  // Offers: include stored route geometry; do not call Google on every offer broadcast
  const route = await loadRouteForBooking(booking, false);

  return {
    offerId,
    bookingId,
    bookingNumber: booking.bookingNumber,
    expiresAt: expiresAt.toISOString(),
    service: {
      serviceCategoryId: booking.serviceCategoryId,
      serviceCode: category?.code ?? detail.serviceCode,
      serviceName: category?.name ?? detail.serviceName,
      capacity: category?.capacity ?? 1,
    },
    pickup: {
      latitude: parseFloat(booking.pickupLatitude),
      longitude: parseFloat(booking.pickupLongitude),
      address: booking.pickupAddress,
      spotLabel: booking.pickupSpotLabel,
    },
    dropoff: {
      latitude: parseFloat(booking.dropoffLatitude),
      longitude: parseFloat(booking.dropoffLongitude),
      address: booking.dropoffAddress,
    },
    route,
    fare: {
      amount: booking.finalFare ? parseFloat(booking.finalFare) : null,
      currency: resolveBookingCurrency(booking),
    },
    passenger: {
      displayName: detail.customerName,
      rating: null,
    },
    distanceToPickupKm,
    driverId,
  };
}
