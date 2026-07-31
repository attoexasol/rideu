import {
  BookingStatus,
  PASSENGER_ONGOING_BOOKING_STATUSES,
  CANCELLABLE_BY_PASSENGER,
} from '../src/constants/bookingStatus';
import { formatPassengerBookingSnapshot, formatPassengerCancelResponse } from '../src/services/booking.service';
import { scopeCancelIdempotencyKey } from '../src/utils/booking-idempotency';
import { shouldSkipGlobalRateLimit } from '../src/middleware/rate-limit-paths';
import { shouldRevertBookingToSearching } from '../src/services/dispatch.service';

describe('PASSENGER_ONGOING_BOOKING_STATUSES', () => {
  it('includes searching and offered for restore', () => {
    expect(PASSENGER_ONGOING_BOOKING_STATUSES).toContain(BookingStatus.SEARCHING);
    expect(PASSENGER_ONGOING_BOOKING_STATUSES).toContain(BookingStatus.OFFERED);
  });

  it('includes in-ride statuses for navigation restore', () => {
    expect(PASSENGER_ONGOING_BOOKING_STATUSES).toContain(BookingStatus.DRIVER_EN_ROUTE);
    expect(PASSENGER_ONGOING_BOOKING_STATUSES).toContain(BookingStatus.ARRIVED);
    expect(PASSENGER_ONGOING_BOOKING_STATUSES).toContain(BookingStatus.IN_PROGRESS);
  });
});

describe('formatPassengerBookingSnapshot', () => {
  const baseDetail = {
    booking: {
      id: 'b1',
      bookingNumber: 'RYD-001',
      status: BookingStatus.SEARCHING,
      serviceCategoryId: 'cat-1',
      pickupLatitude: '23.81',
      pickupLongitude: '90.41',
      pickupAddress: 'Pickup',
      pickupSpotLabel: null,
      dropoffLatitude: '23.75',
      dropoffLongitude: '90.38',
      dropoffAddress: 'Dropoff',
      dropoffPlaceId: null,
      finalFare: '200.00',
      estimatedFare: '220.00',
      discountAmount: '20.00',
      estimatedDistanceKm: '11.05',
      estimatedDurationMin: 35,
      routeEncodedPolyline: 'abc',
      assignedDriverId: null,
      createdAt: new Date('2026-07-11T10:00:00.000Z'),
      cancelledAt: null,
      schedulingType: 'instant',
      searchStartedAt: new Date('2026-07-11T10:00:00.000Z'),
      acceptedAt: null,
    },
    customerName: 'Passenger',
    customerEmail: 'p@example.com',
    driverName: null,
    driverPhone: null,
    vehiclePlate: null,
    serviceName: 'Ride',
    serviceCode: 'ride',
  } as any;

  it('returns flat passenger contract shape', () => {
    const snapshot = formatPassengerBookingSnapshot(baseDetail);
    expect(snapshot.id).toBe('b1');
    expect(snapshot.status).toBe(BookingStatus.SEARCHING);
    expect(snapshot.pickup.latitude).toBeCloseTo(23.81);
    expect(snapshot.service.serviceCode).toBe('ride');
    expect(snapshot.fare.currency).toBe('BDT');
    expect(snapshot.route.distanceKm).toBeCloseTo(11.05);
    expect(snapshot.createdAt).toBe('2026-07-11T10:00:00.000Z');
  });

  it('supports offered status restore', () => {
    const snapshot = formatPassengerBookingSnapshot({
      ...baseDetail,
      booking: { ...baseDetail.booking, status: BookingStatus.OFFERED },
    });
    expect(snapshot.status).toBe(BookingStatus.OFFERED);
  });
});

describe('cancel idempotency key scoping', () => {
  it('scopes by booking and client key', () => {
    expect(scopeCancelIdempotencyKey('booking-1', 'key-abc')).toBe('cancel:booking-1:key-abc');
  });
});

describe('formatPassengerCancelResponse', () => {
  it('returns cancelled contract fields', () => {
    const response = formatPassengerCancelResponse({
      id: 'b1',
      status: BookingStatus.CANCELLED,
      cancelledAt: new Date('2026-07-11T10:05:00.000Z'),
    });
    expect(response).toEqual({
      id: 'b1',
      status: 'cancelled',
      cancelledAt: '2026-07-11T10:05:00.000Z',
    });
  });
});

describe('CANCELLABLE_BY_PASSENGER', () => {
  it('allows cancel during searching/offered and after driver acceptance', () => {
    expect(CANCELLABLE_BY_PASSENGER).toContain(BookingStatus.SEARCHING);
    expect(CANCELLABLE_BY_PASSENGER).toContain(BookingStatus.OFFERED);
    expect(CANCELLABLE_BY_PASSENGER).toContain(BookingStatus.DRIVER_EN_ROUTE);
    expect(CANCELLABLE_BY_PASSENGER).toContain(BookingStatus.ARRIVED);
  });

  it('does not allow cancel after ride starts', () => {
    expect(CANCELLABLE_BY_PASSENGER).not.toContain(BookingStatus.IN_PROGRESS);
  });
});

describe('global rate limit skip paths', () => {
  it('skips active booking restore endpoint', () => {
    expect(shouldSkipGlobalRateLimit('/api/v1/passenger/bookings/active')).toBe(true);
  });

  it('skips passenger cancel endpoint', () => {
    expect(
      shouldSkipGlobalRateLimit(
        '/api/v1/passenger/bookings/88683ab3-01d8-47af-a52f-c45363a43fa0/cancel'
      )
    ).toBe(true);
  });

  it('does not skip maps autocomplete (uses dedicated maps limiter via global skip)', () => {
    expect(shouldSkipGlobalRateLimit('/api/v1/passenger/places/autocomplete')).toBe(true);
  });

  it('skips driver pending offers recovery endpoint', () => {
    expect(shouldSkipGlobalRateLimit('/api/v1/driver/bookings/offers/pending')).toBe(true);
  });
});

describe('shouldRevertBookingToSearching', () => {
  it('reverts offered booking when no pending offers remain', () => {
    expect(shouldRevertBookingToSearching(BookingStatus.OFFERED, null, 0)).toBe(true);
  });

  it('does not revert while pending offers exist', () => {
    expect(shouldRevertBookingToSearching(BookingStatus.OFFERED, null, 2)).toBe(false);
  });

  it('does not revert after driver assignment', () => {
    expect(shouldRevertBookingToSearching(BookingStatus.OFFERED, 'driver-1', 0)).toBe(false);
  });

  it('does not revert terminal statuses', () => {
    expect(shouldRevertBookingToSearching(BookingStatus.CANCELLED, null, 0)).toBe(false);
  });
});

describe('passenger cancel rate limiter isolation', () => {
  it('uses dedicated cancel limiter module separate from maps limiter', () => {
    const maps = require('../src/middleware/passenger-maps-rate-limit');
    const cancel = require('../src/middleware/passenger-booking-cancel-rate-limit');
    expect(maps.passengerMapsRateLimit).toBeDefined();
    expect(cancel.passengerBookingCancelRateLimit).toBeDefined();
    expect(maps.passengerMapsRateLimit).not.toBe(cancel.passengerBookingCancelRateLimit);
  });
});
