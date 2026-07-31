import * as routeService from '../src/services/route.service';
import { quoteAllServiceCategories } from '../src/services/fare.service';

jest.mock('../src/repositories/serviceCategory.repository', () => ({
  listCanonicalActiveServiceCategories: jest.fn().mockResolvedValue([
    {
      id: 'cat-1',
      code: 'cng',
      name: 'CNG',
      description: 'Affordable rides',
      iconKey: 'cng',
      capacity: 4,
      baseFare: '50.00',
      perKmRate: '20.00',
      minFare: '80.00',
      isActive: true,
    },
  ]),
  listActiveServiceCategories: jest.fn().mockResolvedValue([
    {
      id: 'cat-1',
      code: 'cng',
      name: 'CNG',
      description: 'Affordable rides',
      iconKey: 'cng',
      capacity: 4,
      baseFare: '50.00',
      perKmRate: '20.00',
      minFare: '80.00',
      isActive: true,
    },
  ]),
  findActivePromotion: jest.fn().mockResolvedValue({
    id: 'promo-1',
    title: '30% promotion',
    discountType: 'percent',
    discountValue: '30',
  }),
  findServiceCategoryById: jest.fn(),
  findServiceCategoryByCode: jest.fn(),
}));

describe('fare.service', () => {
  beforeEach(() => {
    jest.spyOn(routeService, 'previewRoute').mockResolvedValue({
      pickup: { latitude: 23.81, longitude: 90.41 },
      dropoff: { latitude: 23.75, longitude: 90.38 },
      stops: [],
      distanceMeters: 7600,
      distanceKm: 7.6,
      durationSeconds: 1440,
      durationMin: 24,
      staticDurationSeconds: 1260,
      trafficDelaySeconds: 180,
      encodedPolyline: 'polyline',
      routeBounds: {
        northeast: { latitude: 23.81, longitude: 90.41 },
        southwest: { latitude: 23.75, longitude: 90.38 },
      },
      legs: [],
      provider: 'google',
      calculatedAt: new Date().toISOString(),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('calculates route once and applies minimum fare and promotion', async () => {
    const result = await quoteAllServiceCategories(
      { latitude: 23.81, longitude: 90.41 },
      { latitude: 23.75, longitude: 90.38 }
    );

    expect(routeService.previewRoute).toHaveBeenCalledTimes(1);
    expect(result.route.distanceKm).toBe(7.6);
    expect(result.quotes[0].distanceKm).toBe(7.6);
    expect(result.quotes[0].finalFare).toBeGreaterThan(0);
    expect(result.quotes[0].discountAmount).toBeGreaterThan(0);
    expect(result.quotes[0].currency).toBe('BDT');
  });
});
