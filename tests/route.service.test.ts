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
