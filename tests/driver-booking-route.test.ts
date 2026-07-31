/**
 * Driver booking payload route contract (unit-level around serializers).
 * Authorization: getDriverBookingDetailForDriver returns null without assignment/offer.
 */
import { BookingStatus } from '../src/constants/bookingStatus';

const mockFindBookingById = jest.fn();
const mockFindPendingOfferForDriver = jest.fn();
const mockGetBookingDetail = jest.fn();
const mockFindActiveBookingByDriver = jest.fn();
const mockResolveBookingRoute = jest.fn();

jest.mock('../src/db/connection', () => ({
  db: {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(async () => []),
        })),
      })),
    })),
  },
}));

jest.mock('../src/repositories/booking.repository', () => ({
  findBookingById: (...args: unknown[]) => mockFindBookingById(...args),
  findActiveBookingByDriver: (...args: unknown[]) => mockFindActiveBookingByDriver(...args),
  getBookingDetail: (...args: unknown[]) => mockGetBookingDetail(...args),
  findPendingOfferForDriver: (...args: unknown[]) => mockFindPendingOfferForDriver(...args),
}));

jest.mock('../src/services/liveVideo.service', () => ({
  findActiveSessionByBooking: jest.fn(async () => null),
  listLiveSegments: jest.fn(async () => []),
}));

jest.mock('../src/services/bookingRoute.service', () => ({
  resolveBookingRoute: (...args: unknown[]) => mockResolveBookingRoute(...args),
}));

describe('driver booking route authorization and payload', () => {
  const driverId = 'driver-1';
  const bookingId = 'booking-1';

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveBookingRoute.mockResolvedValue({
      encodedPolyline: 'abc123',
      distanceMeters: 11050,
      durationSeconds: 1560,
      distanceKm: 11.05,
      durationMin: 26,
      bounds: {
        southwest: { latitude: 23.7, longitude: 90.3 },
        northeast: { latitude: 23.9, longitude: 90.5 },
      },
    });
  });

  it('unauthorized driver cannot read booking route (no assignment / offer)', async () => {
    const { getDriverBookingDetailForDriver } = await import(
      '../src/services/driverBooking.service'
    );
    mockFindBookingById.mockResolvedValue({
      id: bookingId,
      assignedDriverId: 'other-driver',
      status: BookingStatus.DRIVER_EN_ROUTE,
    });

    const result = await getDriverBookingDetailForDriver(bookingId, driverId);
    expect(result).toBeNull();
    expect(mockResolveBookingRoute).not.toHaveBeenCalled();
  });

  it('active booking returns route geometry', async () => {
    const { getDriverActiveBookingResponse } = await import(
      '../src/services/driverBooking.service'
    );
    mockFindActiveBookingByDriver.mockResolvedValue({ id: bookingId });
    mockGetBookingDetail.mockResolvedValue({
      booking: {
        id: bookingId,
        bookingNumber: 'BK1',
        status: BookingStatus.DRIVER_EN_ROUTE,
        recordingConsentedAt: null,
        pickupLatitude: '23.81',
        pickupLongitude: '90.41',
        pickupAddress: 'A',
        pickupSpotLabel: null,
        dropoffLatitude: '23.75',
        dropoffLongitude: '90.38',
        dropoffAddress: 'B',
        finalFare: '120.00',
        assignedVehicleId: null,
        serviceCategoryId: 'cat-1',
        routeEncodedPolyline: 'abc123',
        estimatedDistanceKm: '11.05',
        estimatedDurationMin: 26,
      },
      customerName: 'Rider',
      serviceCode: 'ride',
      serviceName: 'Ride',
    });

    const result = await getDriverActiveBookingResponse(driverId);
    expect(result?.booking.route).toMatchObject({
      encodedPolyline: 'abc123',
      distanceMeters: 11050,
      durationSeconds: 1560,
    });
    expect(result?.booking.route?.bounds).toBeTruthy();
  });

  it('missing route does not fail booking endpoint', async () => {
    const { getDriverActiveBookingResponse } = await import(
      '../src/services/driverBooking.service'
    );
    mockFindActiveBookingByDriver.mockResolvedValue({ id: bookingId });
    mockResolveBookingRoute.mockResolvedValue(null);
    mockGetBookingDetail.mockResolvedValue({
      booking: {
        id: bookingId,
        bookingNumber: 'BK1',
        status: BookingStatus.DRIVER_EN_ROUTE,
        recordingConsentedAt: null,
        pickupLatitude: '23.81',
        pickupLongitude: '90.41',
        pickupAddress: 'A',
        pickupSpotLabel: null,
        dropoffLatitude: '23.75',
        dropoffLongitude: '90.38',
        dropoffAddress: 'B',
        finalFare: '120.00',
        assignedVehicleId: null,
        serviceCategoryId: 'cat-1',
        routeEncodedPolyline: null,
        estimatedDistanceKm: null,
        estimatedDurationMin: null,
      },
      customerName: 'Rider',
      serviceCode: 'ride',
      serviceName: 'Ride',
    });

    const result = await getDriverActiveBookingResponse(driverId);
    expect(result).not.toBeNull();
    expect(result?.booking.id).toBe(bookingId);
    expect(result?.booking.route).toBeNull();
  });

  it('offer payload includes route geometry from stored booking', async () => {
    const { buildOfferEventPayload } = await import('../src/services/driverBooking.service');
    mockGetBookingDetail.mockResolvedValue({
      booking: {
        id: bookingId,
        bookingNumber: 'BK1',
        status: BookingStatus.OFFERED,
        pickupLatitude: '23.81',
        pickupLongitude: '90.41',
        pickupAddress: 'A',
        pickupSpotLabel: null,
        dropoffLatitude: '23.75',
        dropoffLongitude: '90.38',
        dropoffAddress: 'B',
        finalFare: '120.00',
        serviceCategoryId: 'cat-1',
        routeEncodedPolyline: 'abc123',
        estimatedDistanceKm: '11.05',
        estimatedDurationMin: 26,
      },
      customerName: 'Rider',
      serviceCode: 'ride',
      serviceName: 'Ride',
    });

    const offer = await buildOfferEventPayload(
      'offer-1',
      bookingId,
      driverId,
      new Date('2030-01-01T00:00:00Z'),
      1.2
    );

    expect(offer?.route).toMatchObject({
      encodedPolyline: 'abc123',
      distanceMeters: 11050,
      durationSeconds: 1560,
    });
    // offer path must not force Google regeneration
    expect(mockResolveBookingRoute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ allowGenerate: false })
    );
  });
});
