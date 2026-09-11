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
    plateNumber: string | null;
  } | null;
  vehicle: RideVehicleSnapshot | null;
  payment: RidePaymentSnapshot;
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

function formatVehicle(row: {
  vehicleId?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehicleColor?: string | null;
  driverVehicleColor?: string | null;
  vehiclePlate?: string | null;
}): RideVehicleSnapshot | null {
  const id = row.vehicleId ?? null;
  const plateNumber = row.vehiclePlate ?? null;
  const make = row.vehicleMake ?? null;
  const model = row.vehicleModel ?? null;
  const color = row.vehicleColor ?? row.driverVehicleColor ?? null;
  if (!id && !plateNumber && !make && !model && !color) return null;
  return {
    id: id ?? '',
    make,
    model,
    color,
    plateNumber,
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
          plateNumber: detail.vehiclePlate ?? null,
        }
      : null,
    vehicle,
    payment: formatPayment(detail),
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
  return {
    items: items.map(formatPassengerRideSnapshot),
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
