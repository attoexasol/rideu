import fs from 'fs';
import path from 'path';
import { BookingStatus } from '../src/constants/bookingStatus';
import {
  formatPassengerAcceptedEvent,
  formatPassengerRideSnapshot,
} from '../src/services/rideHistory.service';
import type { RideHistoryRow } from '../src/repositories/booking.repository';

const RIDE_VEHICLE = {
  id: 'veh-ride',
  make: 'Toyota',
  model: 'Axio',
  color: 'Silver',
  year: 2019,
  plateNumber: 'DHK-RIDE',
};

const PHOTO = '/uploads/avatars/drivers/11111111-1111-1111-1111-111111111111.jpg';

function rideRow(
  overrides: {
    booking?: Partial<RideHistoryRow['booking']>;
    detail?: Partial<Omit<RideHistoryRow, 'booking'>>;
  } = {}
): RideHistoryRow {
  return {
    booking: {
      id: '11111111-1111-1111-1111-111111111111',
      bookingNumber: 'RYD-1001',
      customerId: 'cust-1',
      serviceCategoryId: 'cat-1',
      status: BookingStatus.DRIVER_EN_ROUTE,
      schedulingType: 'instant',
      scheduledPickupAt: null,
      pickupLatitude: '23.81',
      pickupLongitude: '90.41',
      pickupAddress: 'Gulshan',
      pickupSpotLabel: null,
      dropoffLatitude: '23.75',
      dropoffLongitude: '90.38',
      dropoffAddress: 'Dhanmondi',
      dropoffPlaceId: null,
      estimatedDistanceKm: '11.05',
      estimatedDurationMin: 28,
      estimatedFare: '220.00',
      originalFare: '220.00',
      promotionId: null,
      discountAmount: '0.00',
      finalFare: '220.00',
      paymentMethodId: 'pay-1',
      paymentStatus: 'pending',
      assignedDriverId: 'driver-1',
      assignedVehicleId: RIDE_VEHICLE.id,
      linkedTripId: null,
      driverEtaMinutes: 7,
      recordingConsentedAt: null,
      recordingConsentStatus: 'required',
      recordingConsentRevokedAt: null,
      recordingConsentVersion: 'v1',
      searchStartedAt: null,
      acceptedAt: new Date('2026-08-01T10:02:00.000Z'),
      arrivedAt: null,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      cancelledBy: null,
      cancellationReason: null,
      shareToken: 'share',
      routeEncodedPolyline: null,
      dispatchBatch: 1,
      createdAt: new Date('2026-08-01T10:00:00.000Z'),
      updatedAt: new Date('2026-08-01T10:02:00.000Z'),
      ...overrides.booking,
    },
    customerName: 'Rahim',
    customerEmail: 'rahim@example.com',
    driverName: 'Karim',
    driverPhone: '+8801711111111',
    driverProfileImageUrl: PHOTO,
    driverVehicleColor: 'White',
    vehicleId: RIDE_VEHICLE.id,
    vehicleMake: RIDE_VEHICLE.make,
    vehicleModel: RIDE_VEHICLE.model,
    vehicleColor: RIDE_VEHICLE.color,
    vehicleYear: RIDE_VEHICLE.year,
    vehiclePlate: RIDE_VEHICLE.plateNumber,
    serviceName: 'Ride',
    serviceCode: 'ride',
    paymentMethodCode: 'cash',
    paymentMethodName: 'Cash',
    recordingAvailable: false,
    ...overrides.detail,
  } as RideHistoryRow;
}

function readSrc(relPath: string) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

describe('passenger assigned-vehicle identity', () => {
  const prevBase = process.env.API_PUBLIC_BASE_URL;

  beforeAll(() => {
    process.env.API_PUBLIC_BASE_URL = 'https://api.rydu.test';
  });

  afterAll(() => {
    if (prevBase === undefined) delete process.env.API_PUBLIC_BASE_URL;
    else process.env.API_PUBLIC_BASE_URL = prevBase;
  });

  it('returns the same assigned vehicle on REST and booking:accepted', () => {
    const rest = formatPassengerRideSnapshot(rideRow());
    const socket = formatPassengerAcceptedEvent({
      bookingId: rest.id,
      status: BookingStatus.DRIVER_EN_ROUTE,
      etaMinutes: 7,
      driver: {
        id: 'driver-1',
        name: 'Karim',
        phone: '+8801711111111',
        profileImageUrl: PHOTO,
      },
      assignedVehicle: RIDE_VEHICLE,
    });

    expect(rest.vehicle).toEqual(socket.vehicle);
    expect(rest.vehicle).toEqual({
      id: 'veh-ride',
      make: 'Toyota',
      model: 'Axio',
      color: 'Silver',
      year: 2019,
      plateNumber: 'DHK-RIDE',
    });
    expect(rest.driver?.plateNumber).toBe('DHK-RIDE');
    expect(socket.driver.plateNumber).toBe('DHK-RIDE');
    expect(rest.driver?.profileImageUrl).toBe(
      'https://api.rydu.test/uploads/avatars/drivers/11111111-1111-1111-1111-111111111111.jpg'
    );
    expect(socket.driver.profileImageUrl).toBe(rest.driver?.profileImageUrl);
    expect(rest.etaMinutes).toBe(7);
    expect(socket.etaMinutes).toBe(7);
  });

  it('does not let a mismatched current fleet vehicle replace the ride vehicle', () => {
    const rest = formatPassengerRideSnapshot(
      rideRow({
        detail: {
          driverVehicleColor: 'Black',
          vehicleMake: 'Honda',
          vehicleModel: 'Civic',
          vehicleColor: 'Blue',
          vehicleYear: 2021,
          vehiclePlate: 'DHK-RIDE',
          vehicleId: 'veh-ride',
        },
      })
    );
    const socket = formatPassengerAcceptedEvent({
      bookingId: rest.id,
      status: BookingStatus.DRIVER_EN_ROUTE,
      etaMinutes: rest.etaMinutes,
      driver: {
        id: 'driver-1',
        name: 'Karim',
        phone: '+8801711111111',
        profileImageUrl: null,
      },
      assignedVehicle: {
        id: 'veh-ride',
        make: 'Honda',
        model: 'Civic',
        color: 'Blue',
        year: 2021,
        plateNumber: 'DHK-RIDE',
      },
    });

    expect(rest.vehicle).toEqual(socket.vehicle);
    expect(rest.vehicle?.id).toBe('veh-ride');
    expect(rest.vehicle?.color).toBe('Blue');
    expect(rest.vehicle?.year).toBe(2021);
    expect(rest.driver?.plateNumber).toBe('DHK-RIDE');
  });

  it('returns a null photo when the driver has none', () => {
    const rest = formatPassengerRideSnapshot(
      rideRow({ detail: { driverProfileImageUrl: null } })
    );
    const socket = formatPassengerAcceptedEvent({
      bookingId: rest.id,
      status: BookingStatus.DRIVER_EN_ROUTE,
      etaMinutes: 7,
      driver: {
        id: 'driver-1',
        name: 'Karim',
        phone: '+8801711111111',
        profileImageUrl: null,
      },
      assignedVehicle: RIDE_VEHICLE,
    });
    expect(rest.driver?.profileImageUrl).toBeNull();
    expect(socket.driver.profileImageUrl).toBeNull();
  });

  it('returns a null year when the assigned vehicle has none', () => {
    const rest = formatPassengerRideSnapshot(rideRow({ detail: { vehicleYear: null } }));
    const socket = formatPassengerAcceptedEvent({
      bookingId: rest.id,
      status: BookingStatus.DRIVER_EN_ROUTE,
      etaMinutes: 7,
      driver: {
        id: 'driver-1',
        name: 'Karim',
        phone: null,
        profileImageUrl: null,
      },
      assignedVehicle: { ...RIDE_VEHICLE, year: null },
    });
    expect(rest.vehicle?.year).toBeNull();
    expect(socket.vehicle?.year).toBeNull();
  });

  it('omits the vehicle and plate when the booking has no assigned vehicle', () => {
    const rest = formatPassengerRideSnapshot(
      rideRow({
        booking: { assignedVehicleId: null, driverEtaMinutes: null },
        detail: {
          vehicleId: null,
          vehicleMake: 'StaleMake',
          vehicleModel: 'StaleModel',
          vehicleColor: 'Black',
          vehicleYear: 1999,
          vehiclePlate: 'STALE-PLATE',
          driverVehicleColor: 'Black',
        },
      })
    );
    const socket = formatPassengerAcceptedEvent({
      bookingId: rest.id,
      status: BookingStatus.DRIVER_EN_ROUTE,
      etaMinutes: null,
      driver: {
        id: 'driver-1',
        name: 'Karim',
        phone: '+8801711111111',
        profileImageUrl: PHOTO,
      },
      assignedVehicle: null,
    });
    expect(rest.vehicle).toBeNull();
    expect(rest.driver?.plateNumber).toBeNull();
    expect(socket.vehicle).toBeNull();
    expect(socket.driver.plateNumber).toBeNull();
    expect(rest.etaMinutes).toBeNull();
    expect(socket.etaMinutes).toBeNull();
  });
});

describe('accepted identity wiring', () => {
  it('loads booking:accepted from bookings.assigned_vehicle_id after commit', () => {
    const src = readSrc('src/services/dispatch.service.ts');
    const acceptStart = src.indexOf('export async function acceptBookingOffer');
    const acceptBody = src.slice(acceptStart);
    const postTx = acceptBody.slice(acceptBody.indexOf('// --- Side effects after commit'));
    const emitAt = postTx.indexOf("emitToCustomer(booking.customerId, 'booking:accepted'");
    const identityBlock = postTx.slice(0, emitAt);
    expect(identityBlock).toContain('booking.assignedVehicleId');
    expect(identityBlock).toContain('formatPassengerAcceptedEvent');
    expect(identityBlock).toContain('etaMinutes: etaMin');
    expect(identityBlock).not.toContain('driver.vehicleId');
    expect(identityBlock).not.toContain('driver.vehicleColor');
    expect(identityBlock).not.toContain('driver.vehicleMake');
    expect(identityBlock).not.toContain('driver.vehicleYear');
    expect(postTx).toContain('acceptedPayload');
  });

  it('keeps booking:status and driver:location payloads unchanged', () => {
    const src = readSrc('src/services/bookingNotify.service.ts');
    expect(src).toContain(
      'const payload = { bookingId, status, timestamp: new Date().toISOString(), ...extra };'
    );
    expect(src).toContain("await emitToCustomer(customerId, 'booking:status', payload);");
    expect(src).toContain("await emitToCustomer(customerId, 'driver:location', location);");
    expect(src).toContain('latitude: number;');
    expect(src).toContain('longitude: number;');
    expect(src).toContain('heading?: number | null;');
    expect(src).toContain('speedKph?: number | null;');
    expect(src).toContain('accuracyMeters?: number | null;');
  });

  it('still blocks vehicle exchange during an active ride', () => {
    const src = readSrc('src/services/vehicleExchange.service.ts');
    expect(src).toContain('ACTIVE_RIDE_BLOCKS_EXCHANGE');
    expect(src).toContain('assertNoActiveRide');
    expect(src).not.toContain('assignedVehicleId');
  });

  it('exposes driver and vehicle identity only on authenticated passenger booking reads', () => {
    const routes = readSrc('src/routes/v1/passenger/index.ts');
    const activeAt = routes.indexOf("'/bookings/active'");
    const detailAt = routes.indexOf('asyncHandler(getBookingHandler)');
    expect(activeAt).toBeGreaterThan(-1);
    expect(detailAt).toBeGreaterThan(activeAt);
    const activeBlock = routes.slice(activeAt, activeAt + 220);
    const detailBlock = routes.slice(detailAt - 280, detailAt);
    expect(activeBlock).toContain('requireCustomer');
    expect(detailBlock).toContain('requireCustomer');
    expect(detailBlock).toContain('requireAuth');
    expect(detailBlock).toContain("'/bookings/:bookingId'");
    const controller = readSrc('src/controllers/passengerBooking.controller.ts');
    expect(controller).toContain('formatPassengerBookingSnapshot');
    expect(controller).toContain('detail.booking.customerId !== user.userId');
  });
});
