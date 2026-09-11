import { dispatchConfig } from '../config/dispatch';

export const BookingStatus = {
  QUOTED: 'quoted',
  SEARCHING: 'searching',
  OFFERED: 'offered',
  ACCEPTED: 'accepted',
  DRIVER_EN_ROUTE: 'driver_en_route',
  ARRIVED: 'arrived',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  NO_DRIVERS: 'no_drivers',
  SCHEDULED: 'scheduled',
} as const;

export type BookingStatusType = (typeof BookingStatus)[keyof typeof BookingStatus];

/** Statuses where the passenger may cancel. Includes quoted (card payment pending). */
export const CANCELLABLE_BY_PASSENGER: BookingStatusType[] = [
  BookingStatus.QUOTED,
  BookingStatus.SEARCHING,
  BookingStatus.OFFERED,
  BookingStatus.DRIVER_EN_ROUTE,
  BookingStatus.ARRIVED,
];

/** Active booking statuses that block new dispatch for driver/customer. */
export const ACTIVE_BOOKING_STATUSES: BookingStatusType[] = [
  BookingStatus.ACCEPTED,
  BookingStatus.DRIVER_EN_ROUTE,
  BookingStatus.ARRIVED,
  BookingStatus.IN_PROGRESS,
];

/** Passenger bookings that block creating another booking or represent an in-flight ride request. */
export const PASSENGER_ONGOING_BOOKING_STATUSES: BookingStatusType[] = [
  BookingStatus.QUOTED,
  BookingStatus.SEARCHING,
  BookingStatus.OFFERED,
  BookingStatus.SCHEDULED,
  ...ACTIVE_BOOKING_STATUSES,
];

/** Terminal passenger history statuses. Excludes quoted and unused booking status `expired`. */
export const PASSENGER_HISTORY_STATUSES: BookingStatusType[] = [
  BookingStatus.COMPLETED,
  BookingStatus.CANCELLED,
  BookingStatus.NO_DRIVERS,
];

/** Driver history: assigned rides that are no longer active. Unassigned states are excluded. */
export const DRIVER_HISTORY_STATUSES: BookingStatusType[] = [
  BookingStatus.COMPLETED,
  BookingStatus.CANCELLED,
];

export type RideHistoryFilter = 'all' | 'completed' | 'cancelled';

export function resolvePassengerHistoryStatuses(
  filter: RideHistoryFilter = 'all'
): BookingStatusType[] {
  if (filter === 'completed') return [BookingStatus.COMPLETED];
  if (filter === 'cancelled') return [BookingStatus.CANCELLED, BookingStatus.NO_DRIVERS];
  return [...PASSENGER_HISTORY_STATUSES];
}

export function resolveDriverHistoryStatuses(
  filter: RideHistoryFilter = 'all'
): BookingStatusType[] {
  if (filter === 'completed') return [BookingStatus.COMPLETED];
  if (filter === 'cancelled') return [BookingStatus.CANCELLED];
  return [...DRIVER_HISTORY_STATUSES];
}

export const BookingOfferStatus = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  /** @deprecated use DECLINED */
  REJECTED: 'rejected',
  DECLINED: 'declined',
  EXPIRED: 'expired',
  /** @deprecated use TAKEN */
  SUPERSEDED: 'superseded',
  TAKEN: 'taken',
  CANCELLED: 'cancelled',
} as const;

/** Terminal offer statuses — driver should not be re-offered the same booking in the same dispatch cycle. */
export const TERMINAL_OFFER_STATUSES = [
  BookingOfferStatus.REJECTED,
  BookingOfferStatus.DECLINED,
  BookingOfferStatus.EXPIRED,
  BookingOfferStatus.TAKEN,
  BookingOfferStatus.CANCELLED,
  BookingOfferStatus.SUPERSEDED,
  BookingOfferStatus.ACCEPTED,
] as const;

export const DISPATCH_OFFER_TTL_SECONDS = dispatchConfig.dispatchOfferTimeoutSeconds;
export const DISPATCH_BATCH_SIZE = dispatchConfig.dispatchBatchSize;
export const DISPATCH_MAX_BATCHES = dispatchConfig.dispatchMaxBatches;
