import {
  ACTIVE_BOOKING_STATUSES,
  BookingStatus,
  DRIVER_HISTORY_STATUSES,
  PASSENGER_HISTORY_STATUSES,
  PASSENGER_ONGOING_BOOKING_STATUSES,
  resolveDriverHistoryStatuses,
  resolvePassengerHistoryStatuses,
} from '../src/constants/bookingStatus';
import { bookingHistoryQuerySchema } from '../src/validators';
import {
  asRecordingAvailable,
  formatDriverHistorySnapshot,
  formatPassengerRideSnapshot,
  historyDetailFields,
} from '../src/services/rideHistory.service';
import type { RideHistoryRow } from '../src/repositories/booking.repository';

function completedRow(overrides: Partial<RideHistoryRow['booking']> = {}): RideHistoryRow {
  return {
    booking: {
      id: '11111111-1111-1111-1111-111111111111',
      bookingNumber: 'RYD-1001',
      customerId: 'cust-1',
      serviceCategoryId: 'cat-1',
      status: BookingStatus.COMPLETED,
      schedulingType: 'instant',
      scheduledPickupAt: null,
      pickupLatitude: '23.81',
      pickupLongitude: '90.41',
      pickupAddress: 'Gulshan',
      pickupSpotLabel: 'Gate 1',
      dropoffLatitude: '23.75',
      dropoffLongitude: '90.38',
      dropoffAddress: 'Dhanmondi',
      dropoffPlaceId: 'place-1',
      estimatedDistanceKm: '11.05',
      estimatedDurationMin: 28,
      estimatedFare: '220.00',
      originalFare: '220.00',
      promotionId: null,
      discountAmount: '20.00',
      finalFare: '200.00',
      paymentMethodId: 'pay-1',
      paymentStatus: 'paid',
      assignedDriverId: 'driver-1',
      assignedVehicleId: 'veh-1',
      linkedTripId: 'trip-1',
      driverEtaMinutes: 5,
      recordingConsentedAt: null,
      recordingConsentStatus: 'granted',
      recordingConsentRevokedAt: null,
      recordingConsentVersion: 'v1',
      searchStartedAt: new Date('2026-08-01T10:00:00.000Z'),
      acceptedAt: new Date('2026-08-01T10:02:00.000Z'),
      arrivedAt: new Date('2026-08-01T10:10:00.000Z'),
      startedAt: new Date('2026-08-01T10:12:00.000Z'),
      completedAt: new Date('2026-08-01T10:40:00.000Z'),
      cancelledAt: null,
      cancelledBy: null,
      cancellationReason: null,
      shareToken: 'share',
      routeEncodedPolyline: 'poly',
      dispatchBatch: 1,
      createdAt: new Date('2026-08-01T10:00:00.000Z'),
      updatedAt: new Date('2026-08-01T10:40:00.000Z'),
      ...overrides,
    },
    customerName: 'Rahim',
    customerEmail: 'rahim@example.com',
    driverName: 'Karim',
    driverPhone: '+8801711111111',
    driverVehicleColor: 'White',
    vehicleId: 'veh-1',
    vehicleMake: 'Toyota',
    vehicleModel: 'Axio',
    vehicleColor: 'Silver',
    vehiclePlate: 'DHK-1234',
    serviceName: 'Ride',
    serviceCode: 'ride',
    paymentMethodCode: 'cash',
    paymentMethodName: 'Cash',
    recordingAvailable: true,
  } as RideHistoryRow;
}

describe('ride history status classification', () => {
  it('passenger history all is completed + cancelled + no_drivers', () => {
    expect(resolvePassengerHistoryStatuses('all')).toEqual([
      BookingStatus.COMPLETED,
      BookingStatus.CANCELLED,
      BookingStatus.NO_DRIVERS,
    ]);
    expect(PASSENGER_HISTORY_STATUSES).toEqual(resolvePassengerHistoryStatuses('all'));
  });

  it('passenger completed filter is completed only', () => {
    expect(resolvePassengerHistoryStatuses('completed')).toEqual([BookingStatus.COMPLETED]);
  });

  it('passenger cancelled filter includes cancelled and no_drivers', () => {
    expect(resolvePassengerHistoryStatuses('cancelled')).toEqual([
      BookingStatus.CANCELLED,
      BookingStatus.NO_DRIVERS,
    ]);
  });

  it('does not silently map no_drivers to completed', () => {
    expect(resolvePassengerHistoryStatuses('completed')).not.toContain(BookingStatus.NO_DRIVERS);
    expect(resolvePassengerHistoryStatuses('all')).toContain(BookingStatus.NO_DRIVERS);
  });

  it('passenger history excludes ongoing/active statuses', () => {
    const history = new Set(resolvePassengerHistoryStatuses('all'));
    for (const status of PASSENGER_ONGOING_BOOKING_STATUSES) {
      expect(history.has(status)).toBe(false);
    }
  });

  it('driver history is completed + cancelled only', () => {
    expect(resolveDriverHistoryStatuses('all')).toEqual([
      BookingStatus.COMPLETED,
      BookingStatus.CANCELLED,
    ]);
    expect(DRIVER_HISTORY_STATUSES).toEqual(resolveDriverHistoryStatuses('all'));
  });

  it('driver cancelled filter does not include no_drivers or unassigned states', () => {
    const cancelled = resolveDriverHistoryStatuses('cancelled');
    expect(cancelled).toEqual([BookingStatus.CANCELLED]);
    expect(cancelled).not.toContain(BookingStatus.NO_DRIVERS);
    expect(cancelled).not.toContain(BookingStatus.SEARCHING);
    expect(cancelled).not.toContain(BookingStatus.OFFERED);
    expect(cancelled).not.toContain(BookingStatus.SCHEDULED);
  });

  it('driver history excludes active statuses', () => {
    const history = new Set(resolveDriverHistoryStatuses('all'));
    for (const status of ACTIVE_BOOKING_STATUSES) {
      expect(history.has(status)).toBe(false);
    }
  });

  it('does not treat quoted or expired as history booking statuses', () => {
    expect(resolvePassengerHistoryStatuses('all')).not.toContain(BookingStatus.QUOTED);
    expect(resolvePassengerHistoryStatuses('all')).not.toContain(BookingStatus.EXPIRED);
    expect(resolveDriverHistoryStatuses('all')).not.toContain(BookingStatus.QUOTED);
    expect(resolveDriverHistoryStatuses('all')).not.toContain(BookingStatus.EXPIRED);
  });
});

describe('bookingHistoryQuerySchema', () => {
  it('defaults page=1 limit=20 filter=all', () => {
    const parsed = bookingHistoryQuerySchema.parse({});
    expect(parsed).toEqual({ page: 1, limit: 20, filter: 'all' });
  });

  it('accepts valid pagination and filters', () => {
    expect(bookingHistoryQuerySchema.parse({ page: '2', limit: '50', filter: 'completed' })).toEqual({
      page: 2,
      limit: 50,
      filter: 'completed',
    });
  });

  it('rejects page < 1', () => {
    expect(bookingHistoryQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });

  it('rejects limit above max 50', () => {
    expect(bookingHistoryQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
  });

  it('rejects invalid filter', () => {
    expect(bookingHistoryQuerySchema.safeParse({ filter: 'expired' }).success).toBe(false);
  });
});

describe('passenger history DTO', () => {
  it('maps stored fields for a completed ride', () => {
    const snapshot = formatPassengerRideSnapshot(completedRow());
    expect(snapshot.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(snapshot.bookingNumber).toBe('RYD-1001');
    expect(snapshot.status).toBe(BookingStatus.COMPLETED);
    expect(snapshot.createdAt).toBe('2026-08-01T10:00:00.000Z');
    expect(snapshot.acceptedAt).toBe('2026-08-01T10:02:00.000Z');
    expect(snapshot.arrivedAt).toBe('2026-08-01T10:10:00.000Z');
    expect(snapshot.startedAt).toBe('2026-08-01T10:12:00.000Z');
    expect(snapshot.completedAt).toBe('2026-08-01T10:40:00.000Z');
    expect(snapshot.cancelledAt).toBeNull();
    expect(snapshot.pickup.address).toBe('Gulshan');
    expect(snapshot.dropoff.address).toBe('Dhanmondi');
    expect(snapshot.route.distanceKm).toBeCloseTo(11.05);
    expect(snapshot.route.durationMin).toBe(28);
    expect(snapshot.route.encodedPolyline).toBe('poly');
    expect(snapshot.service.serviceCode).toBe('ride');
    expect(snapshot.fare).toEqual({
      amount: 200,
      estimatedAmount: 220,
      discountAmount: 20,
      currency: 'BDT',
    });
    expect(snapshot.payment).toEqual({
      methodCode: 'cash',
      methodName: 'Cash',
      status: 'paid',
    });
    expect(snapshot.driver).toEqual({
      id: 'driver-1',
      name: 'Karim',
      phone: '+8801711111111',
      plateNumber: 'DHK-1234',
    });
    expect(snapshot.vehicle).toEqual({
      id: 'veh-1',
      make: 'Toyota',
      model: 'Axio',
      color: 'Silver',
      plateNumber: 'DHK-1234',
    });
    expect(snapshot.recording).toEqual({ available: true });
  });

  it('maps cancellation fields for a cancelled ride', () => {
    const snapshot = formatPassengerRideSnapshot(
      completedRow({
        status: BookingStatus.CANCELLED,
        completedAt: null,
        cancelledAt: new Date('2026-08-01T10:05:00.000Z'),
        cancelledBy: 'customer',
        cancellationReason: 'changed_mind',
        paymentStatus: 'pending',
        assignedDriverId: null,
      })
    );
    expect(snapshot.status).toBe(BookingStatus.CANCELLED);
    expect(snapshot.cancelledAt).toBe('2026-08-01T10:05:00.000Z');
    expect(snapshot.cancelledBy).toBe('customer');
    expect(snapshot.cancellationReason).toBe('changed_mind');
    expect(snapshot.driver).toBeNull();
  });

  it('keeps no_drivers distinct from cancelled', () => {
    const snapshot = formatPassengerRideSnapshot(
      completedRow({
        status: BookingStatus.NO_DRIVERS,
        completedAt: null,
        cancelledAt: null,
        assignedDriverId: null,
        assignedVehicleId: null,
      })
    );
    expect(snapshot.status).toBe(BookingStatus.NO_DRIVERS);
    expect(snapshot.cancelledAt).toBeNull();
  });

  it('preserves backward-compatible passenger fields', () => {
    const snapshot = formatPassengerRideSnapshot(completedRow());
    expect(snapshot.schedulingType).toBe('instant');
    expect(snapshot.searchStartedAt).toBe('2026-08-01T10:00:00.000Z');
    expect(snapshot.dropoff.placeId).toBe('place-1');
  });
});

describe('driver history DTO', () => {
  it('maps assigned completed ride without earnings', () => {
    const snapshot = formatDriverHistorySnapshot(completedRow());
    expect(snapshot.passenger).toEqual({ id: 'cust-1', name: 'Rahim' });
    expect(snapshot.vehicle?.make).toBe('Toyota');
    expect(snapshot.payment.status).toBe('paid');
    expect(snapshot.recording.available).toBe(true);
    expect(snapshot).not.toHaveProperty('earnings');
    expect((snapshot as any).commission).toBeUndefined();
  });

  it('maps driver cancellation fields', () => {
    const snapshot = formatDriverHistorySnapshot(
      completedRow({
        status: BookingStatus.CANCELLED,
        completedAt: null,
        cancelledAt: new Date('2026-08-01T10:08:00.000Z'),
        cancelledBy: 'driver',
        cancellationReason: 'vehicle_issue',
      })
    );
    expect(snapshot.cancelledBy).toBe('driver');
    expect(snapshot.cancellationReason).toBe('vehicle_issue');
  });
});

describe('recording.available', () => {
  it('coerces playable flags', () => {
    expect(asRecordingAvailable(true)).toBe(true);
    expect(asRecordingAvailable('t')).toBe(true);
    expect(asRecordingAvailable(1)).toBe(true);
    expect(asRecordingAvailable(false)).toBe(false);
    expect(asRecordingAvailable('f')).toBe(false);
    expect(asRecordingAvailable(null)).toBe(false);
  });

  it('historyDetailFields exposes recording without session internals', () => {
    const fields = historyDetailFields(completedRow());
    expect(fields.recording).toEqual({ available: true });
    expect(fields).not.toHaveProperty('sessionId');
    expect(fields.payment.methodCode).toBe('cash');
    expect(fields.vehicle?.plateNumber).toBe('DHK-1234');
  });
});
