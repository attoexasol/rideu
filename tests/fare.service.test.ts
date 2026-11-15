import * as routeService from '../src/services/route.service';
import { quoteAllServiceCategories } from '../src/services/fare.service';
import * as airportDetection from '../src/services/airportDetection.service';
import * as rideMarket from '../src/services/rideMarket.service';

jest.mock('../src/services/serviceArea.service', () => ({
  assertRidePermitted: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/services/rideMarket.service', () => ({
  resolveRideMarket: jest.fn().mockResolvedValue({
    id: 'market-bd',
    code: 'BD',
    name: 'Bangladesh',
    countryCode: 'BD',
    currency: 'BDT',
    countrySource: 'client',
  }),
  assertMarketPricingConfigured: jest.fn().mockResolvedValue(undefined),
  getMarketFareMap: jest.fn().mockResolvedValue(
    new Map([
      ['cat-1', { baseFare: '50.00', perKmRate: '20.00', minFare: '80.00' }],
    ])
  ),
}));

jest.mock('../src/services/airportDetection.service', () => ({
  EMPTY_AIRPORT_DETECTION: {
    airportId: null,
    airportCode: null,
    airportName: null,
    tripType: null,
    feeMinor: 0,
    feeMajor: '0.00',
    currency: null,
    matchedBy: null,
    bothEndsSameAirport: false,
    crossAirport: false,
    ambiguous: false,
    currencyMismatch: false,
  },
  detectAirportTrip: jest.fn().mockResolvedValue({
    airportId: null,
    airportCode: null,
    airportName: null,
    tripType: null,
    feeMinor: 0,
    feeMajor: '0.00',
    currency: null,
    matchedBy: null,
    bothEndsSameAirport: false,
    crossAirport: false,
    ambiguous: false,
    currencyMismatch: false,
  }),
  airportPublicView: jest.fn().mockReturnValue(null),
}));

jest.mock('../src/repositories/serviceCategory.repository', () => ({
  listCanonicalActiveServiceCategories: jest.fn().mockResolvedValue([
    {
      id: 'cat-1',
      code: 'economy',
      name: 'Economy Sedan',
      description: 'Comfortable, cost-effective sedan transportation for individuals and couples.',
      iconKey: 'economy',
      capacity: 3,
      baseFare: '0.00',
      perKmRate: '0.00',
      minFare: '0.00',
      isActive: true,
    },
  ]),
  listActiveServiceCategories: jest.fn().mockResolvedValue([
    {
      id: 'cat-1',
      code: 'economy',
      name: 'Economy Sedan',
      description: 'Comfortable, cost-effective sedan transportation for individuals and couples.',
      iconKey: 'economy',
      capacity: 3,
      baseFare: '0.00',
      perKmRate: '0.00',
      minFare: '0.00',
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
    (rideMarket.resolveRideMarket as jest.Mock).mockResolvedValue({
      id: 'market-bd',
      code: 'BD',
      name: 'Bangladesh',
      countryCode: 'BD',
      currency: 'BDT',
      countrySource: 'client',
    });
    (rideMarket.getMarketFareMap as jest.Mock).mockResolvedValue(
      new Map([['cat-1', { baseFare: '50.00', perKmRate: '20.00', minFare: '80.00' }]])
    );
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
    expect(result.market.currency).toBe('BDT');
    expect(result.quotes[0].regularFare).toBe(result.quotes[0].finalFare);
    expect(result.quotes[0].airportFee).toBe(0);
    expect(result.quotes[0].airport).toBeNull();
  });

  it('O. adds fixed airport fee after regular fare', async () => {
    (airportDetection.detectAirportTrip as jest.Mock).mockResolvedValueOnce({
      airportId: '11111111-1111-1111-1111-111111111111',
      airportCode: 'TESTA',
      airportName: 'Test Airport A',
      tripType: 'pickup',
      feeMinor: 500,
      feeMajor: '5.00',
      currency: 'BDT',
      matchedBy: 'geofence',
      bothEndsSameAirport: false,
      crossAirport: false,
      ambiguous: false,
      currencyMismatch: false,
    });
    (airportDetection.airportPublicView as jest.Mock).mockReturnValueOnce({
      id: '11111111-1111-1111-1111-111111111111',
      code: 'TESTA',
      name: 'Test Airport A',
      tripType: 'pickup',
    });

    const result = await quoteAllServiceCategories(
      { latitude: 32.7338, longitude: -117.1933 },
      { latitude: 32.8, longitude: -117.1 }
    );

    expect(result.quotes[0].airportFee).toBe(5);
    expect(result.quotes[0].finalFare).toBe(
      Math.round((result.quotes[0].regularFare + 5) * 100) / 100
    );
    expect(result.quotes[0].airport).toEqual({
      id: '11111111-1111-1111-1111-111111111111',
      code: 'TESTA',
      name: 'Test Airport A',
      tripType: 'pickup',
    });
  });

  it('B. does not add a USD airport fee onto a BDT fare', async () => {
    (airportDetection.detectAirportTrip as jest.Mock).mockResolvedValueOnce({
      airportId: '11111111-1111-1111-1111-111111111111',
      airportCode: 'SAN',
      airportName: 'San Diego',
      tripType: 'pickup',
      feeMinor: 500,
      feeMajor: '5.00',
      currency: 'USD',
      matchedBy: 'geofence',
      bothEndsSameAirport: false,
      crossAirport: false,
      ambiguous: false,
      currencyMismatch: true,
    });
    (airportDetection.airportPublicView as jest.Mock).mockReturnValueOnce(null);

    const result = await quoteAllServiceCategories(
      { latitude: 32.7338, longitude: -117.1933 },
      { latitude: 32.8, longitude: -117.1 }
    );

    expect(result.quotes[0].currency).toBe('BDT');
    expect(result.quotes[0].airportFee).toBe(0);
    expect(result.quotes[0].finalFare).toBe(result.quotes[0].regularFare);
    expect(result.quotes[0].finalFare).not.toBe(
      Math.round((result.quotes[0].regularFare + 5) * 100) / 100
    );
  });

  it('G/H. U.S. quotes use U.S. market fares, not Bangladesh rates', async () => {
    (rideMarket.resolveRideMarket as jest.Mock).mockResolvedValueOnce({
      id: 'market-us',
      code: 'US',
      name: 'United States',
      countryCode: 'US',
      currency: 'USD',
      countrySource: 'reverse_geocode',
    });
    (rideMarket.getMarketFareMap as jest.Mock).mockResolvedValueOnce(
      new Map([['cat-1', { baseFare: '8.00', perKmRate: '2.00', minFare: '10.00' }]])
    );

    const result = await quoteAllServiceCategories(
      { latitude: 32.7157, longitude: -117.1611, countryCode: 'US' },
      { latitude: 32.73, longitude: -117.17 }
    );

    expect(result.market.currency).toBe('USD');
    expect(result.quotes[0].currency).toBe('USD');
    expect(result.quotes[0].originalFare).toBe(23.2);
    expect(result.quotes[0].originalFare).not.toBe(202);
  });
});
