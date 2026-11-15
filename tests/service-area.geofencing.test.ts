import { readFileSync } from 'fs';
import { join } from 'path';
import type { MultiPolygon, Polygon } from 'geojson';
import { quoteAllServiceCategories } from '../src/services/fare.service';
import { OutOfServiceAreaError, ServiceAreaUnavailableError } from '../src/services/payment.errors';
import {
  listServiceAreasForMarket,
  findServiceAreaById,
  insertServiceArea,
  activateServiceAreaRecord,
  nextServiceAreaVersion,
} from '../src/repositories/serviceArea.repository';
import { previewRoute } from '../src/services/route.service';
import { resolveRideMarket } from '../src/services/rideMarket.service';
import {
  activateServiceArea,
  activeRideStatusAfterServiceAreaExit,
  assertQueryPointPermitted,
  assertRidePermitted,
  clearServiceAreaCache,
  createServiceAreaDraft,
  getPassengerServiceAreaConfig,
  pointInsideGeometry,
  validateServiceAreaGeometry,
} from '../src/services/serviceArea.service';

jest.mock('../src/repositories/serviceArea.repository', () => ({
  listServiceAreasForMarket: jest.fn(),
  findServiceAreaById: jest.fn(),
  nextServiceAreaVersion: jest.fn(),
  insertServiceArea: jest.fn(),
  activateServiceAreaRecord: jest.fn(),
}));

jest.mock('../src/services/route.service', () => ({
  previewRoute: jest.fn(),
  toRouteSummary: jest.fn((route) => route),
}));

jest.mock('../src/services/rideMarket.service', () => ({
  resolveRideMarket: jest.fn(),
  assertMarketPricingConfigured: jest.fn().mockResolvedValue(undefined),
  getMarketFareMap: jest.fn().mockResolvedValue(
    new Map([['cat-1', { baseFare: '50.00', perKmRate: '20.00', minFare: '80.00' }]])
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
      name: 'Economy',
      description: null,
      iconKey: 'economy',
      capacity: 3,
      baseFare: '0.00',
      perKmRate: '0.00',
      minFare: '0.00',
      isActive: true,
    },
  ]),
  findActivePromotion: jest.fn().mockResolvedValue(null),
  findServiceCategoryById: jest.fn(),
}));

const listAreas = listServiceAreasForMarket as jest.Mock;
const findArea = findServiceAreaById as jest.Mock;
const insertArea = insertServiceArea as jest.Mock;
const activateRecord = activateServiceAreaRecord as jest.Mock;

function square(minLng: number, minLat: number, maxLng: number, maxLat: number): Polygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [minLng, minLat],
        [maxLng, minLat],
        [maxLng, maxLat],
        [minLng, maxLat],
        [minLng, minLat],
      ],
    ],
  };
}

const zone = square(0, 0, 2, 2);
const inside = { latitude: 1, longitude: 1 };
const outside = { latitude: 1, longitude: 3 };

function enforcedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'area-1',
    marketCode: 'US',
    code: 'coronado',
    name: 'Coronado',
    version: 1,
    status: 'active',
    geometry: zone,
    policy: 'pickup_and_dropoff',
    enforcementEnabled: true,
    sourceLabel: 'synthetic test polygon',
    sourceUrl: null,
    approvedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('service area geometry', () => {
  it('accepts a polygon, a hole, a multipolygon, and a boundary point', () => {
    const holed: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
          [0, 0],
        ],
        [
          [1, 1],
          [1, 2],
          [2, 2],
          [2, 1],
          [1, 1],
        ],
      ],
    };
    expect(validateServiceAreaGeometry(holed).type).toBe('Polygon');
    expect(pointInsideGeometry(0.5, 0.5, holed)).toBe(true);
    expect(pointInsideGeometry(1.5, 1.5, holed)).toBe(false);
    expect(pointInsideGeometry(1, 0, zone)).toBe(true);

    const multi: MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [square(0, 0, 1, 1).coordinates, square(10, 10, 11, 11).coordinates],
    };
    expect(pointInsideGeometry(10.5, 10.5, validateServiceAreaGeometry(multi))).toBe(true);
    expect(pointInsideGeometry(5, 5, multi)).toBe(false);
  });

  it('unwraps a single feature and rejects invalid geometry', () => {
    const feature = { type: 'Feature', properties: {}, geometry: zone };
    expect(validateServiceAreaGeometry(feature)).toEqual(zone);

    expect(() =>
      validateServiceAreaGeometry({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [2, 0],
            [2, 2],
            [0, 2],
          ],
        ],
      })
    ).toThrow(/closed/);

    expect(() =>
      validateServiceAreaGeometry({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [2, 2],
            [0, 2],
            [2, 0],
            [0, 0],
          ],
        ],
      })
    ).toThrow(/self-intersects/);

    expect(() => validateServiceAreaGeometry({ type: 'Point', coordinates: [1, 1] })).toThrow(
      /Polygon or MultiPolygon/
    );
    expect(() =>
      validateServiceAreaGeometry({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [2, 0],
            [2, 200],
            [0, 0],
          ],
        ],
      })
    ).toThrow(/out of range/);
  });
});

describe('market ride permission', () => {
  beforeEach(() => {
    clearServiceAreaCache();
    listAreas.mockReset();
    listAreas.mockResolvedValue([]);
  });

  it('allows a US pickup and drop-off inside the active polygon', async () => {
    listAreas.mockResolvedValue([enforcedRow()]);
    await expect(assertRidePermitted('US', inside, { latitude: 0.5, longitude: 0.5 }, [])).resolves.toBeUndefined();
  });

  it('rejects a US drop-off outside the polygon', async () => {
    listAreas.mockResolvedValue([enforcedRow()]);
    await expect(assertRidePermitted('US', inside, outside, [])).rejects.toMatchObject({
      code: 'OUT_OF_SERVICE_AREA',
      message: 'This ride is outside the current service area.',
      statusCode: 400,
      details: { failedPoints: ['dropoff'] },
    });
  });

  it('rejects a US pickup outside the polygon', async () => {
    listAreas.mockResolvedValue([enforcedRow()]);
    await expect(assertRidePermitted('US', outside, inside, [])).rejects.toBeInstanceOf(
      OutOfServiceAreaError
    );
    try {
      await assertRidePermitted('US', outside, inside, []);
    } catch (error) {
      expect((error as OutOfServiceAreaError).details).toEqual({ failedPoints: ['pickup'] });
    }
  });

  it('rejects a US intermediate stop outside the polygon', async () => {
    listAreas.mockResolvedValue([enforcedRow()]);
    await expect(assertRidePermitted('US', inside, inside, [outside])).rejects.toMatchObject({
      details: { failedPoints: ['stop'] },
    });
  });

  it('does not apply the polygon to Bangladesh', async () => {
    listAreas.mockResolvedValue([enforcedRow({ marketCode: 'BD' })]);
    await expect(assertRidePermitted('BD', outside, outside, [outside])).resolves.toBeUndefined();
    expect(listAreas).not.toHaveBeenCalled();
  });

  it('fails closed when US enforcement is enabled without usable geometry', async () => {
    listAreas.mockResolvedValue([
      enforcedRow({ geometry: { type: 'Point', coordinates: [1, 1] }, approvedAt: new Date() }),
    ]);
    await expect(assertRidePermitted('US', inside, inside, [])).rejects.toBeInstanceOf(
      ServiceAreaUnavailableError
    );
    await expect(assertRidePermitted('us', inside, inside, [])).rejects.toMatchObject({
      code: 'SERVICE_AREA_UNAVAILABLE',
      message: 'The service area is temporarily unavailable. Please try again later.',
      statusCode: 503,
    });
  });

  it('preserves existing behavior while US enforcement is disabled', async () => {
    listAreas.mockResolvedValue([
      enforcedRow({ status: 'draft', enforcementEnabled: false, approvedAt: null }),
    ]);
    await expect(assertRidePermitted('US', outside, outside, [outside])).resolves.toBeUndefined();
  });

  it('does not publish a draft boundary', async () => {
    listAreas.mockResolvedValue([
      enforcedRow({ status: 'draft', enforcementEnabled: false, approvedAt: null }),
    ]);
    await expect(getPassengerServiceAreaConfig('US')).resolves.toEqual({
      marketCode: 'US',
      enforcementEnabled: false,
      areas: [],
    });
    await expect(getPassengerServiceAreaConfig('BD')).resolves.toEqual({
      marketCode: 'BD',
      enforcementEnabled: false,
      areas: [],
    });
    expect(listAreas).not.toHaveBeenCalledWith('BD');
  });

  it('returns the active US polygon for passengers', async () => {
    listAreas.mockResolvedValue([enforcedRow()]);
    const view = await getPassengerServiceAreaConfig('US');
    expect(view.enforcementEnabled).toBe(true);
    expect(view.areas[0]).toMatchObject({
      code: 'coronado',
      name: 'Coronado',
      version: 1,
      policy: 'pickup_and_dropoff',
    });
    expect(view.areas[0].geometry.type).toBe('Polygon');
    expect(JSON.stringify(view)).not.toMatch(/sourceLabel|sourceUrl|approvedAt/);
  });
});

describe('quote runs the service-area check before Google Routes', () => {
  const route = {
    pickup: inside,
    dropoff: inside,
    stops: [],
    distanceMeters: 1000,
    distanceKm: 1,
    durationSeconds: 60,
    durationMin: 1,
    staticDurationSeconds: 60,
    trafficDelaySeconds: 0,
    encodedPolyline: 'abc',
    routeBounds: null,
    legs: [],
    provider: 'google',
    calculatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    clearServiceAreaCache();
    listAreas.mockClear();
    (previewRoute as jest.Mock).mockReset();
    (previewRoute as jest.Mock).mockResolvedValue(route);
    (resolveRideMarket as jest.Mock).mockResolvedValue({
      id: 'market-us',
      code: 'US',
      name: 'United States',
      countryCode: 'US',
      currency: 'USD',
      countrySource: 'reverse_geocode',
    });
    listAreas.mockResolvedValue([enforcedRow()]);
  });

  it('does not request a route when the US drop-off is outside', async () => {
    await expect(
      quoteAllServiceCategories(inside, outside, [])
    ).rejects.toBeInstanceOf(OutOfServiceAreaError);
    expect(previewRoute).not.toHaveBeenCalled();
  });

  it('requests a route when both US points are inside', async () => {
    const result = await quoteAllServiceCategories(inside, { latitude: 0.4, longitude: 0.4 }, []);
    expect(previewRoute).toHaveBeenCalledTimes(1);
    expect(result.market.code).toBe('US');
  });

  it('still quotes Bangladesh when a US polygon is enforced', async () => {
    (resolveRideMarket as jest.Mock).mockResolvedValue({
      id: 'market-bd',
      code: 'BD',
      name: 'Bangladesh',
      countryCode: 'BD',
      currency: 'BDT',
      countrySource: 'place_id',
    });
    await quoteAllServiceCategories(outside, outside, []);
    expect(previewRoute).toHaveBeenCalledTimes(1);
    expect(listAreas).not.toHaveBeenCalled();
  });
});

describe('activation keeps enforcement off until an approved row is promoted', () => {
  beforeEach(() => {
    findArea.mockReset();
    insertArea.mockReset();
    activateRecord.mockReset();
    (nextServiceAreaVersion as jest.Mock).mockResolvedValue(1);
  });

  it('saves a draft without enabling enforcement', async () => {
    insertArea.mockImplementation(async (values) => ({ id: 'draft-1', ...values }));
    const row = await createServiceAreaDraft({
      marketCode: 'us',
      code: 'coronado',
      name: 'Coronado',
      geometry: zone,
      sourceLabel: 'synthetic',
    });
    expect(row.enforcementEnabled).toBe(false);
    expect(row.status).toBe('draft');
    expect(row.marketCode).toBe('US');
    expect(activateRecord).not.toHaveBeenCalled();
  });

  it('refuses to activate a Bangladesh polygon', async () => {
    findArea.mockResolvedValue(enforcedRow({ marketCode: 'BD', status: 'draft', enforcementEnabled: false }));
    await expect(activateServiceArea('area-1')).rejects.toThrow(/Bangladesh/);
    expect(activateRecord).not.toHaveBeenCalled();
  });
});

describe('query points and active rides', () => {
  beforeEach(() => {
    clearServiceAreaCache();
    listAreas.mockResolvedValue([enforcedRow()]);
  });

  it('rejects a US nearby pin outside the polygon and ignores Bangladesh', async () => {
    await expect(assertQueryPointPermitted('US', outside)).rejects.toMatchObject({
      details: { failedPoints: ['pickup'] },
    });
    await expect(assertQueryPointPermitted('BD', outside)).resolves.toBeUndefined();
  });

  it('does not change an active ride that leaves the polygon', () => {
    expect(activeRideStatusAfterServiceAreaExit('in_progress')).toBe('in_progress');
    expect(activeRideStatusAfterServiceAreaExit('driver_en_route')).toBe('driver_en_route');
    const root = join(__dirname, '..');
    for (const relative of [
      'src/routes/locations.ts',
      'src/websocket/handlers/location.ts',
      'src/services/duty.service.ts',
    ]) {
      const source = readFileSync(join(root, relative), 'utf8');
      expect(source).not.toMatch(/serviceArea|OUTSIDE_SERVICE_AREA|assertRidePermitted/);
    }
  });

  it('keeps idempotent booking replay ahead of a new quote', () => {
    const source = readFileSync(join(__dirname, '../src/services/booking.service.ts'), 'utf8');
    const idempotency = source.indexOf('findIdempotencyRecord');
    const quote = source.indexOf('const quote = await createBookingQuote');
    expect(idempotency).toBeGreaterThan(-1);
    expect(quote).toBeGreaterThan(idempotency);
  });
});
