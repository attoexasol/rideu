import {
  type RideHistoryFilter,
  resolveDriverHistoryStatuses,
  resolvePassengerHistoryStatuses,
} from '../constants/bookingStatus';
import { resolveBookingCurrency } from '../constants/payment';
import {
  countRideHistoryByCustomer,
  countRideHistoryByDriver,
  listRideHistoryByCustomer,
  listRideHistoryByDriver,
  type RideHistoryRow,
} from '../repositories/booking.repository';
import { resolvePublicProfileImageUrl } from './avatar-storage.service';
import { bookingBillingFields } from './softMeter/billingMode';
import { meterPaymentsForBookings } from './softMeter/onDemandMeterPayment.service';
import { toOnDemandMeterPaymentView } from './softMeter/onDemandMeterPayment';
import type { StoredTestPayment } from './softMeter/testPayment';
import type { MeterPayment } from '../db/schema/meter_payments';
import type { MeterPaymentStatusType, MeterSettlementModeType } from '../constants/softMeter';

export interface RidePaymentSnapshot {
  methodCode: string | null;
  methodName: string | null;
  status: string;
}

export interface RideVehicleSnapshot {
  id: string;
  make: string | null;
  model: string | null;
  color: string | null;
  year: number | null;
  plateNumber: string | null;
}

export interface AssignedRideVehicle {
  id: string;
  make: string | null;
  model: string | null;
  color: string | null;
  year: number | null;
  plateNumber: string | null;
}

export interface PassengerRideSnapshot {
  id: string;
  status: string;
  bookingNumber: string;
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
    placeId: string | null;
  };
  service: {
    serviceCategoryId: string;
    serviceCode: string | null;
    serviceName: string | null;
  };
  fare: {
    amount: number | null;
    currency: string;
    estimatedAmount: number | null;
    discountAmount: number | null;
  };
  route: {
    encodedPolyline: string | null;
    distanceKm: number | null;
    durationMin: number | null;
  };
  driver: {
    id: string;
    name: string | null;
    phone: string | null;
    profileImageUrl: string | null;
    plateNumber: string | null;
  } | null;
  vehicle: RideVehicleSnapshot | null;
  etaMinutes: number | null;
  payment: RidePaymentSnapshot;
  billingMode: string;
  paymentRequiredBeforeDispatch: boolean;
  paymentRequiredAfterCompletion: boolean;
  fareClassification: string | null;
  meterPayment?: {
    bookingId: string;
    rideStatus: string;
    paymentStatus: string;
    paymentRequired: boolean;
    paymentMode: 'stripe_test' | null;
    finalFareCents: number | null;
    currency: string | null;
    meterSessionId: string | null;
    completedAt: string | null;
    paidAt: string | null;
    receiptAvailable: boolean;
    testMode: boolean;
    fareClassification: string | null;
    paymentVersion: number;
  } | null;
  recording: { available: boolean };
  createdAt: string;
  acceptedAt: string | null;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  schedulingType?: string;
  searchStartedAt?: string | null;
}

export interface DriverHistorySnapshot {
  id: string;
  bookingNumber: string;
  status: string;
  createdAt: string;
  acceptedAt: string | null;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
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
  route: {
    distanceKm: number | null;
    durationMin: number | null;
    encodedPolyline: string | null;
  };
  fare: {
    amount: number | null;
    currency: string;
  };
  service: {
    serviceCategoryId: string;
    serviceCode: string | null;
    serviceName: string | null;
  };
  passenger: {
    id: string;
    name: string | null;
  };
  vehicle: RideVehicleSnapshot | null;
  payment: RidePaymentSnapshot;
  recording: { available: boolean };
}

function parseDecimal(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

function iso(value: Date | string | null | undefined): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function asRecordingAvailable(value: unknown): boolean {
  return value === true || value === 1 || value === 't' || value === 'true';
}

export function formatAssignedVehicle(
  vehicle: AssignedRideVehicle | null | undefined
): RideVehicleSnapshot | null {
  if (!vehicle?.id) return null;
  return {
    id: vehicle.id,
    make: vehicle.make ?? null,
    model: vehicle.model ?? null,
    color: vehicle.color ?? null,
    year: vehicle.year ?? null,
    plateNumber: vehicle.plateNumber ?? null,
  };
}

function formatVehicle(row: {
  vehicleId?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehicleColor?: string | null;
  vehicleYear?: number | null;
  vehiclePlate?: string | null;
}): RideVehicleSnapshot | null {
  return formatAssignedVehicle(
    row.vehicleId
      ? {
          id: row.vehicleId,
          make: row.vehicleMake ?? null,
          model: row.vehicleModel ?? null,
          color: row.vehicleColor ?? null,
          year: row.vehicleYear ?? null,
          plateNumber: row.vehiclePlate ?? null,
        }
      : null
  );
}

export function formatPassengerAcceptedEvent(input: {
  bookingId: string;
  status: string;
  etaMinutes: number | null;
  driver: {
    id: string;
    name: string | null;
    phone: string | null;
    profileImageUrl: string | null;
  };
  assignedVehicle: AssignedRideVehicle | null;
}) {
  const vehicle = formatAssignedVehicle(input.assignedVehicle);
  return {
    bookingId: input.bookingId,
    status: input.status,
    driver: {
      id: input.driver.id,
      name: input.driver.name,
      phone: input.driver.phone,
      profileImageUrl: resolvePublicProfileImageUrl(input.driver.profileImageUrl),
      plateNumber: vehicle?.plateNumber ?? null,
    },
    vehicle,
    etaMinutes: input.etaMinutes,
  };
}

function formatPayment(row: {
  booking: { paymentStatus?: string | null };
  paymentMethodCode?: string | null;
  paymentMethodName?: string | null;
}): RidePaymentSnapshot {
  return {
    methodCode: row.paymentMethodCode ?? null,
    methodName: row.paymentMethodName ?? null,
    status: row.booking.paymentStatus ?? 'pending',
  };
}

export function formatPassengerRideSnapshot(detail: RideHistoryRow): PassengerRideSnapshot {
  const booking = detail.booking;
  const vehicle = formatVehicle(detail);
  return {
    id: booking.id,
    status: booking.status,
    bookingNumber: booking.bookingNumber,
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
      placeId: booking.dropoffPlaceId,
    },
    service: {
      serviceCategoryId: booking.serviceCategoryId,
      serviceCode: detail.serviceCode,
      serviceName: detail.serviceName,
    },
    fare: {
      amount: parseDecimal(booking.finalFare),
      currency: resolveBookingCurrency(booking),
      estimatedAmount: parseDecimal(booking.estimatedFare),
      discountAmount: parseDecimal(booking.discountAmount),
    },
    route: {
      encodedPolyline: booking.routeEncodedPolyline,
      distanceKm: parseDecimal(booking.estimatedDistanceKm),
      durationMin: booking.estimatedDurationMin,
    },
    driver: booking.assignedDriverId
      ? {
          id: booking.assignedDriverId,
          name: detail.driverName ?? null,
          phone: detail.driverPhone ?? null,
          profileImageUrl: resolvePublicProfileImageUrl(detail.driverProfileImageUrl),
          plateNumber: detail.vehicleId ? (detail.vehiclePlate ?? null) : null,
        }
      : null,
    vehicle,
    etaMinutes: booking.driverEtaMinutes ?? null,
    payment: formatPayment(detail),
    ...bookingBillingFields(booking.billingMode, detail.paymentMethodCode),
    recording: { available: asRecordingAvailable(detail.recordingAvailable) },
    createdAt: iso(booking.createdAt) ?? new Date(0).toISOString(),
    acceptedAt: iso(booking.acceptedAt),
    arrivedAt: iso(booking.arrivedAt),
    startedAt: iso(booking.startedAt),
    completedAt: iso(booking.completedAt),
    cancelledAt: iso(booking.cancelledAt),
    cancelledBy: booking.cancelledBy ?? null,
    cancellationReason: booking.cancellationReason ?? null,
    schedulingType: booking.schedulingType,
    searchStartedAt: iso(booking.searchStartedAt),
  };
}

export function formatDriverHistorySnapshot(detail: RideHistoryRow): DriverHistorySnapshot {
  const booking = detail.booking;
  return {
    id: booking.id,
    bookingNumber: booking.bookingNumber,
    status: booking.status,
    createdAt: iso(booking.createdAt) ?? new Date(0).toISOString(),
    acceptedAt: iso(booking.acceptedAt),
    arrivedAt: iso(booking.arrivedAt),
    startedAt: iso(booking.startedAt),
    completedAt: iso(booking.completedAt),
    cancelledAt: iso(booking.cancelledAt),
    cancelledBy: booking.cancelledBy ?? null,
    cancellationReason: booking.cancellationReason ?? null,
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
    route: {
      distanceKm: parseDecimal(booking.estimatedDistanceKm),
      durationMin: booking.estimatedDurationMin,
      encodedPolyline: booking.routeEncodedPolyline,
    },
    fare: {
      amount: parseDecimal(booking.finalFare),
      currency: resolveBookingCurrency(booking),
    },
    service: {
      serviceCategoryId: booking.serviceCategoryId,
      serviceCode: detail.serviceCode,
      serviceName: detail.serviceName,
    },
    passenger: {
      id: booking.customerId,
      name: detail.customerName ?? null,
    },
    vehicle: formatVehicle(detail),
    payment: formatPayment(detail),
    recording: { available: asRecordingAvailable(detail.recordingAvailable) },
  };
}

export function historyDetailFields(detail: RideHistoryRow) {
  const booking = detail.booking;
  return {
    createdAt: iso(booking.createdAt),
    acceptedAt: iso(booking.acceptedAt),
    arrivedAt: iso(booking.arrivedAt),
    startedAt: iso(booking.startedAt),
    completedAt: iso(booking.completedAt),
    cancelledAt: iso(booking.cancelledAt),
    cancelledBy: booking.cancelledBy ?? null,
    cancellationReason: booking.cancellationReason ?? null,
    payment: formatPayment(detail),
    vehicle: formatVehicle(detail),
    recording: { available: asRecordingAvailable(detail.recordingAvailable) },
  };
}

export async function listPassengerRideHistory(
  customerId: string,
  page = 1,
  limit = 20,
  filter: RideHistoryFilter = 'all'
) {
  const statuses = resolvePassengerHistoryStatuses(filter);
  const offset = (page - 1) * limit;
  const [items, total] = await Promise.all([
    listRideHistoryByCustomer(customerId, statuses, limit, offset),
    countRideHistoryByCustomer(customerId, statuses),
  ]);
  const formatted = items.map(formatPassengerRideSnapshot);
  let payments: MeterPayment[] = [];
  try {
    payments = await meterPaymentsForBookings(formatted.map((item) => item.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (!message.includes('does not exist')) throw error;
  }
  const byBooking = new Map(
    payments.filter((payment) => payment.bookingId).map((payment) => [payment.bookingId as string, payment])
  );
  return {
    items: formatted.map((item) => {
      const payment = byBooking.get(item.id);
      if (!payment || payment.subjectType !== 'on_demand') return { ...item, meterPayment: null };
      const stored: StoredTestPayment = {
        id: payment.id,
        status: payment.status as MeterPaymentStatusType,
        hostedUrl: payment.hostedUrl,
        stripeCheckoutSessionId: payment.stripeCheckoutSessionId,
        stripePaymentIntentId: payment.stripePaymentIntentId,
        receiptUrl: payment.receiptUrl,
        amountCents: payment.amountCents,
        currency: payment.currency,
        settlementMode: payment.settlementMode as MeterSettlementModeType,
        testOnly: payment.testOnly,
        fareClassification: payment.fareClassification,
        expiresAtMs: payment.expiresAt?.getTime() ?? null,
        fareRecordId: payment.fareRecordId,
        idempotencyKey: payment.idempotencyKey,
        failureCode: payment.failureCode,
        paidAtMs: payment.paidAt?.getTime() ?? null,
        createdAtMs: payment.createdAt.getTime(),
        updatedAtMs: payment.updatedAt.getTime(),
      };
      const view = toOnDemandMeterPaymentView({
        bookingId: item.id,
        rideStatus: item.status,
        completedAt: item.completedAt,
        meterSessionId: payment.meterSessionId,
        payment: stored,
      });
      return { ...item, meterPayment: view };
    }),
    total,
    page,
    limit,
  };
}

export async function listDriverRideHistory(
  driverId: string,
  page = 1,
  limit = 20,
  filter: RideHistoryFilter = 'all'
) {
  const statuses = resolveDriverHistoryStatuses(filter);
  const offset = (page - 1) * limit;
  const [items, total] = await Promise.all([
    listRideHistoryByDriver(driverId, statuses, limit, offset),
    countRideHistoryByDriver(driverId, statuses),
  ]);
  return {
    items: items.map(formatDriverHistorySnapshot),
    total,
    page,
    limit,
  };
}
