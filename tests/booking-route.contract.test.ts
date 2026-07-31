import {
  decodeGooglePolyline,
  boundsFromEncodedPolyline,
} from '../src/utils/polyline';
import {
  serializeBookingRoute,
  kmToMeters,
  minutesToSeconds,
  resolveBookingRoute,
} from '../src/services/bookingRoute.service';

jest.mock('../src/middleware/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockUpdateBooking = jest.fn();
const mockPreviewRoute = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisDel = jest.fn();

jest.mock('../src/repositories/booking.repository', () => ({
  updateBooking: (...args: unknown[]) => mockUpdateBooking(...args),
}));

jest.mock('../src/services/route.service', () => ({
  previewRoute: (...args: unknown[]) => mockPreviewRoute(...args),
}));

jest.mock('../src/config/redis', () => ({
  redis: {
    set: (...args: unknown[]) => mockRedisSet(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
  },
}));

describe('polyline decode and bounds', () => {
  // Encoded form of (38.5, -120.2), (40.7, -120.95), (43.252, -126.453)
  const sample = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

  it('decodes Google encoded polyline points', () => {
    const points = decodeGooglePolyline(sample);
    expect(points.length).toBe(3);
    expect(points[0].latitude).toBeCloseTo(38.5, 3);
    expect(points[0].longitude).toBeCloseTo(-120.2, 3);
  });

  it('calculates bounds from encoded polyline', () => {
    const bounds = boundsFromEncodedPolyline(sample);
    expect(bounds).not.toBeNull();
    expect(bounds!.southwest.latitude).toBeLessThanOrEqual(bounds!.northeast.latitude);
    expect(bounds!.southwest.longitude).toBeLessThanOrEqual(bounds!.northeast.longitude);
    expect(bounds!.southwest.latitude).toBeCloseTo(38.5, 2);
    expect(bounds!.northeast.latitude).toBeCloseTo(43.252, 2);
  });

  it('returns null bounds for empty polyline', () => {
    expect(boundsFromEncodedPolyline(null)).toBeNull();
    expect(boundsFromEncodedPolyline('')).toBeNull();
  });
});

describe('booking route DTO units and contract', () => {
  it('normalizes distance km → meters and duration min → seconds', () => {
    expect(kmToMeters(11.05)).toBe(11050);
    expect(minutesToSeconds(26)).toBe(1560);
  });

  it('nested route object matches driver contract', () => {
    const sample = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
    const route = serializeBookingRoute({
      encodedPolyline: sample,
      distanceKm: 11.05,
      durationMin: 26,
    });

    expect(route).toMatchObject({
      encodedPolyline: sample,
      distanceMeters: 11050,
      durationSeconds: 1560,
      distanceKm: 11.05,
      durationMin: 26,
    });
    expect(route!.bounds).toEqual(
      expect.objectContaining({
        southwest: expect.objectContaining({
          latitude: expect.any(Number),
          longitude: expect.any(Number),
        }),
        northeast: expect.objectContaining({
          latitude: expect.any(Number),
          longitude: expect.any(Number),
        }),
      })
    );
  });

  it('returns null when geometry and metrics are both missing', () => {
    expect(serializeBookingRoute({})).toBeNull();
  });

  it('keeps metrics-only route when polyline missing', () => {
    const route = serializeBookingRoute({ distanceKm: 5, durationMin: 10 });
    expect(route).toMatchObject({
      encodedPolyline: null,
      distanceMeters: 5000,
      durationSeconds: 600,
      bounds: null,
    });
  });
});

describe('resolveBookingRoute fallback', () => {
  const booking = {
    id: 'booking-1',
    routeEncodedPolyline: null as string | null,
    estimatedDistanceKm: null as string | null,
    estimatedDurationMin: null as number | null,
    pickupLatitude: '23.81',
    pickupLongitude: '90.41',
    pickupAddress: 'Pickup',
    dropoffLatitude: '23.75',
    dropoffLongitude: '90.38',
    dropoffAddress: 'Dropoff',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisSet.mockResolvedValue('OK');
    mockRedisDel.mockResolvedValue(1);
    mockUpdateBooking.mockResolvedValue({});
  });

  it('uses stored geometry without calling Google', async () => {
    const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
    const dto = await resolveBookingRoute({
      ...booking,
      routeEncodedPolyline: encoded,
      estimatedDistanceKm: '11.05',
      estimatedDurationMin: 26,
    });

    expect(dto?.encodedPolyline).toBe(encoded);
    expect(dto?.distanceMeters).toBe(11050);
    expect(mockPreviewRoute).not.toHaveBeenCalled();
    expect(mockUpdateBooking).not.toHaveBeenCalled();
  });

  it('generates once, persists, and returns when polyline missing', async () => {
    mockPreviewRoute.mockResolvedValue({
      distanceMeters: 11050,
      distanceKm: 11.05,
      durationSeconds: 1560,
      durationMin: 26,
      encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
      routeBounds: {
        southwest: { latitude: 23.7, longitude: 90.3 },
        northeast: { latitude: 23.9, longitude: 90.5 },
      },
    });

    const dto = await resolveBookingRoute(booking, { allowGenerate: true });

    expect(mockPreviewRoute).toHaveBeenCalledTimes(1);
    expect(mockUpdateBooking).toHaveBeenCalledWith(
      'booking-1',
      expect.objectContaining({
        routeEncodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
        estimatedDistanceKm: '11.05',
        estimatedDurationMin: 26,
      })
    );
    expect(dto?.encodedPolyline).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(dto?.distanceMeters).toBe(11050);
    expect(dto?.durationSeconds).toBe(1560);
  });

  it('does not fail when Google fill errors — returns null/metrics', async () => {
    mockPreviewRoute.mockRejectedValue(new Error('Maps down'));
    const dto = await resolveBookingRoute(booking, { allowGenerate: true });
    expect(dto).toBeNull();
  });

  it('skips generate when allowGenerate is false', async () => {
    const dto = await resolveBookingRoute(booking, { allowGenerate: false });
    expect(dto).toBeNull();
    expect(mockPreviewRoute).not.toHaveBeenCalled();
  });
});
