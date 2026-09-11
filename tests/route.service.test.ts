import axios from 'axios';
import { computeRoute } from '../src/services/googleMaps/googleMaps.client';

jest.mock('axios');
jest.mock('../src/config/redis', () => ({
  mapsCache: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('computeRoute', () => {
  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    jest.clearAllMocks();
  });

  it('returns encoded polyline, bounds, distance and duration', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        routes: [
          {
            duration: '1440s',
            staticDuration: '1260s',
            distanceMeters: 7600,
            polyline: { encodedPolyline: 'encoded_test_polyline' },
            viewport: {
              northeast: { latitude: 23.81, longitude: 90.41 },
              southwest: { latitude: 23.75, longitude: 90.38 },
            },
            legs: [
              {
                duration: '1440s',
                distanceMeters: 7600,
                startLocation: { latLng: { latitude: 23.81, longitude: 90.41 } },
                endLocation: { latLng: { latitude: 23.75, longitude: 90.38 } },
              },
            ],
          },
        ],
      },
    });

    const route = await computeRoute({
      pickup: { latitude: 23.8103, longitude: 90.4125, address: 'Pickup' },
      dropoff: { latitude: 23.7527, longitude: 90.3818, address: 'Dropoff' },
    });

    expect(route.encodedPolyline).toBe('encoded_test_polyline');
    expect(route.distanceMeters).toBe(7600);
    expect(route.distanceKm).toBe(7.6);
    expect(route.durationMin).toBe(24);
    expect(route.routeBounds.northeast.latitude).toBe(23.81);
    expect(route.provider).toBe('google');
  });

  it('accepts United States coordinates without a country restriction', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        routes: [
          {
            duration: '600s',
            distanceMeters: 1200,
            polyline: { encodedPolyline: 'us_route' },
            viewport: {
              northeast: { latitude: 40.76, longitude: -73.98 },
              southwest: { latitude: 40.74, longitude: -73.99 },
            },
          },
        ],
      },
    });

    const route = await computeRoute({
      pickup: { latitude: 40.758, longitude: -73.9855 },
      dropoff: { latitude: 40.7484, longitude: -73.9857 },
    });

    expect(route.encodedPolyline).toBe('us_route');
    const body = mockedAxios.post.mock.calls[0][1] as { origin: unknown };
    expect(body.origin).toEqual({
      location: { latLng: { latitude: 40.758, longitude: -73.9855 } },
    });
    expect(body).not.toHaveProperty('country');
  });

  it('throws NO_ROUTE_FOUND when polyline missing', async () => {
    mockedAxios.post.mockResolvedValue({ data: { routes: [{}] } });

    await expect(
      computeRoute({
        pickup: { latitude: 23.81, longitude: 90.41 },
        dropoff: { latitude: 23.75, longitude: 90.38 },
      })
    ).rejects.toMatchObject({ code: 'NO_ROUTE_FOUND' });
  });
});
