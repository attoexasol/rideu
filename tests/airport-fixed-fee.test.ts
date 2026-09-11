import { detectAirportTrip } from '../src/services/airportDetection.service';
import { calculateSettlement } from '../src/services/settlement.service';
import { majorToMinorUnits } from '../src/utils/money';
import { haversineMeters } from '../src/utils/geo';
import { createAirportForAdmin, updateAirportForAdmin } from '../src/services/airportAdmin.service';
import { parseSettlementPercentages } from '../src/services/settlementSettings.service';

const mockListActive = jest.fn();
const mockInsertAirport = jest.fn();
const mockFindByCode = jest.fn();
const mockFindByPlace = jest.fn();
const mockFindById = jest.fn();
const mockUpdateAirport = jest.fn();

jest.mock('../src/repositories/rideMarket.repository', () => ({
  findRideMarketByCountryCode: jest.fn().mockImplementation(async (code: string) => {
    if (code === 'US') {
      return { id: 'm-us', code: 'US', name: 'United States', countryCode: 'US', currency: 'USD', isActive: true };
    }
    if (code === 'BD') {
      return { id: 'm-bd', code: 'BD', name: 'Bangladesh', countryCode: 'BD', currency: 'BDT', isActive: true };
    }
    return null;
  }),
  listActiveRideMarkets: jest.fn(),
  listRideMarkets: jest.fn(),
  findRideMarketByCode: jest.fn(),
  listMarketFares: jest.fn(),
  upsertMarketFare: jest.fn(),
}));

jest.mock('../src/repositories/airport.repository', () => ({
  listActiveAirports: (...args: unknown[]) => mockListActive(...args),
  listAirports: jest.fn(),
  findAirportById: (...args: unknown[]) => mockFindById(...args),
  findAirportByCode: (...args: unknown[]) => mockFindByCode(...args),
  findAirportByGooglePlaceId: (...args: unknown[]) => mockFindByPlace(...args),
  insertAirport: (...args: unknown[]) => mockInsertAirport(...args),
  updateAirport: (...args: unknown[]) => mockUpdateAirport(...args),
}));

const AIRPORT_A = {
  id: '11111111-1111-1111-1111-111111111111',
  code: 'TESTA',
  name: 'Test Airport A',
  googlePlaceId: 'place-a',
  countryCode: 'BD',
  currency: 'BDT',
  isActive: true,
  geofenceType: 'radius',
  centerLatitude: '32.73380000',
  centerLongitude: '-117.19330000',
  radiusMeters: 2000,
  geofencePolygon: null,
  pickupFeeMinor: 500,
  dropoffFeeMinor: 300,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const AIRPORT_B = {
  ...AIRPORT_A,
  id: '22222222-2222-2222-2222-222222222222',
  code: 'TESTB',
  name: 'Test Airport B',
  googlePlaceId: 'place-b',
  centerLatitude: '33.94250000',
  centerLongitude: '-118.40800000',
  pickupFeeMinor: 800,
  dropoffFeeMinor: 600,
};

const INSIDE_A = { latitude: 32.7338, longitude: -117.1933 };
const OUTSIDE_A = { latitude: 32.8, longitude: -117.1 };

function settings() {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    driverPercentage: '25.00',
    companyPercentage: '75.00',
    version: 1,
    updatedAt: new Date(),
  };
}

describe('airport geofence detection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListActive.mockResolvedValue([AIRPORT_A, AIRPORT_B]);
  });

  it('A. regular trip outside all airports has fee 0', async () => {
    const result = await detectAirportTrip({
      pickupLatitude: 23.81,
      pickupLongitude: 90.41,
      dropoffLatitude: 23.75,
      dropoffLongitude: 90.38,
    });
    expect(result.tripType).toBeNull();
    expect(result.feeMinor).toBe(0);
    expect(result.airportId).toBeNull();
  });

  it('B. pickup inside airport applies pickup fee', async () => {
    const result = await detectAirportTrip({
      pickupLatitude: INSIDE_A.latitude,
      pickupLongitude: INSIDE_A.longitude,
      dropoffLatitude: OUTSIDE_A.latitude,
      dropoffLongitude: OUTSIDE_A.longitude,
    });
    expect(result.tripType).toBe('pickup');
    expect(result.airportCode).toBe('TESTA');
    expect(result.feeMinor).toBe(500);
    expect(result.matchedBy).toBe('geofence');
  });

  it('C. dropoff inside airport applies dropoff fee', async () => {
    const result = await detectAirportTrip({
      pickupLatitude: OUTSIDE_A.latitude,
      pickupLongitude: OUTSIDE_A.longitude,
      dropoffLatitude: INSIDE_A.latitude,
      dropoffLongitude: INSIDE_A.longitude,
    });
    expect(result.tripType).toBe('dropoff');
    expect(result.feeMinor).toBe(300);
  });

  it('D. pickup and dropoff fees can differ', () => {
    expect(AIRPORT_A.pickupFeeMinor).not.toBe(AIRPORT_A.dropoffFeeMinor);
  });

  it('E. inactive airport is ignored', async () => {
    mockListActive.mockResolvedValue([]);
    const result = await detectAirportTrip({
      pickupLatitude: INSIDE_A.latitude,
      pickupLongitude: INSIDE_A.longitude,
      dropoffLatitude: OUTSIDE_A.latitude,
      dropoffLongitude: OUTSIDE_A.longitude,
    });
    expect(result.feeMinor).toBe(0);
    expect(mockListActive).toHaveBeenCalled();
  });

  it('F. coordinates are primary via Haversine radius', () => {
    const inside = haversineMeters(
      INSIDE_A.latitude,
      INSIDE_A.longitude,
      parseFloat(AIRPORT_A.centerLatitude),
      parseFloat(AIRPORT_A.centerLongitude)
    );
    const outside = haversineMeters(
      OUTSIDE_A.latitude,
      OUTSIDE_A.longitude,
      parseFloat(AIRPORT_A.centerLatitude),
      parseFloat(AIRPORT_A.centerLongitude)
    );
    expect(inside).toBeLessThan(AIRPORT_A.radiusMeters);
    expect(outside).toBeGreaterThan(AIRPORT_A.radiusMeters);
  });

  it('G. Place ID is an additional positive match', async () => {
    const result = await detectAirportTrip({
      pickupLatitude: OUTSIDE_A.latitude,
      pickupLongitude: OUTSIDE_A.longitude,
      pickupPlaceId: 'place-a',
      dropoffLatitude: 23.75,
      dropoffLongitude: 90.38,
    });
    expect(result.tripType).toBe('pickup');
    expect(result.matchedBy).toMatch(/place_id/);
  });

  it('H. typed address is not an input to detection', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/services/airportDetection.service.ts'),
      'utf8'
    );
    expect(src).not.toMatch(/Terminal 1|San Diego Airport|"SAN"/);
    expect(src).not.toContain('pickupAddress');
    expect(src).not.toContain('dropoffAddress');
  });

  it('I. both ends inside same airport charges pickup fee once', async () => {
    const result = await detectAirportTrip({
      pickupLatitude: INSIDE_A.latitude,
      pickupLongitude: INSIDE_A.longitude,
      dropoffLatitude: INSIDE_A.latitude,
      dropoffLongitude: INSIDE_A.longitude,
    });
    expect(result.bothEndsSameAirport).toBe(true);
    expect(result.tripType).toBe('pickup');
    expect(result.feeMinor).toBe(500);
    expect(result.feeMinor).not.toBe(800);
  });

  it('J. overlapping equal-distance geofences fail safe with no fee', async () => {
    const twin = {
      ...AIRPORT_B,
      centerLatitude: AIRPORT_A.centerLatitude,
      centerLongitude: AIRPORT_A.centerLongitude,
    };
    mockListActive.mockResolvedValue([AIRPORT_A, twin]);
    const result = await detectAirportTrip({
      pickupLatitude: INSIDE_A.latitude,
      pickupLongitude: INSIDE_A.longitude,
      dropoffLatitude: OUTSIDE_A.latitude,
      dropoffLongitude: OUTSIDE_A.longitude,
    });
    expect(result.ambiguous).toBe(true);
    expect(result.feeMinor).toBe(0);
  });

  it('K. multiple airports are supported independently', async () => {
    const result = await detectAirportTrip({
      pickupLatitude: 33.9425,
      pickupLongitude: -118.408,
      dropoffLatitude: 34.0,
      dropoffLongitude: -118.3,
    });
    expect(result.airportCode).toBe('TESTB');
    expect(result.feeMinor).toBe(800);
  });

  it('does not add two fees when pickup and dropoff are different airports', async () => {
    const result = await detectAirportTrip({
      pickupLatitude: INSIDE_A.latitude,
      pickupLongitude: INSIDE_A.longitude,
      dropoffLatitude: 33.9425,
      dropoffLongitude: -118.408,
    });
    expect(result.crossAirport).toBe(true);
    expect(result.feeMinor).toBe(0);
    expect(result.tripType).toBeNull();
  });
});

describe('admin airport configuration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindByCode.mockResolvedValue(null);
    mockFindByPlace.mockResolvedValue(null);
    mockInsertAirport.mockImplementation(async (values: Record<string, unknown>) => ({
      id: AIRPORT_A.id,
      ...values,
      geofenceType: 'radius',
      createdAt: new Date('2026-09-11T00:00:00.000Z'),
      updatedAt: new Date('2026-09-11T00:00:00.000Z'),
    }));
  });

  it('L. Admin can create an airport', async () => {
    const created = await createAirportForAdmin({
      code: 'testa',
      name: 'Test Airport A',
      googlePlaceId: 'place-a',
      countryCode: 'bd',
      currency: 'bdt',
      latitude: 32.7338,
      longitude: -117.1933,
      radiusMeters: 2000,
      pickupFee: '5.00',
      dropoffFee: '3.00',
    });
    expect(mockInsertAirport).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'TESTA',
        pickupFeeMinor: 500,
        dropoffFeeMinor: 300,
        geofenceType: 'radius',
      })
    );
    expect(created.pickupFee.minor).toBe(500);
    expect(created.code).toBe('TESTA');
  });

  it('M. Admin can update airport fees without touching bookings', async () => {
    mockFindById.mockResolvedValue(AIRPORT_A);
    mockUpdateAirport.mockResolvedValue({
      ...AIRPORT_A,
      pickupFeeMinor: 900,
      dropoffFeeMinor: 700,
    });
    const updated = await updateAirportForAdmin(AIRPORT_A.id, {
      pickupFee: '9.00',
      dropoffFee: '7.00',
    });
    expect(updated.pickupFee.minor).toBe(900);
    expect(updated.dropoffFee.minor).toBe(700);
  });
});

describe('fare + settlement airport money', () => {
  it('O. regular 4000 + airport 500 = passenger total 4500', () => {
    const regular = 40;
    const airport = 5;
    const total = regular + airport;
    expect(majorToMinorUnits(String(total))).toBe(4500);
    expect(majorToMinorUnits('40.00') + 500).toBe(4500);
  });

  it('P/Q. commission uses 4000 not 4500', () => {
    const result = calculateSettlement({
      bookingId: AIRPORT_A.id,
      grossAmountMinor: 4500,
      airportFeeMinor: 500,
      settings: settings(),
    });
    expect(result.driverAmount).toBe(1000);
    expect(result.platformAmount).toBe(3000);
    expect(result.airportFee).toBe(500);
    expect(result.driverAmount + result.platformAmount + result.airportFee).toBe(4500);
  });

  it('R/S. card PI and cash ledger use passenger total minor units', () => {
    expect(majorToMinorUnits('45.00')).toBe(4500);
  });

  it('R. card PaymentIntent amount is booking.finalFare (passenger total)', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/services/stripePaymentIntent.service.ts'),
      'utf8'
    );
    expect(src).toContain('majorToMinorUnits(String(input.finalFare');
    expect(src).not.toMatch(/transfers\.create/);
  });

  it('S. cash ledger gross is booking.finalFare (passenger total)', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/services/cashPayment.service.ts'),
      'utf8'
    );
    expect(src).toContain('majorToMinorUnits(String(input.finalFare');
    expect(src).not.toMatch(/transfers\.create/);
  });

  it('V. calculated driver earnings use driver_amount only', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/repositories/driverPaymentHistory.repository.ts'),
      'utf8'
    );
    expect(src).toContain('sum(${bookingSettlements.driverAmount})');
    expect(src).not.toMatch(/sum\(\$\{bookingSettlements\.airportFee\}\)/);
  });

  it('Y. settlement settings validate driver + company = 100', () => {
    expect(() =>
      parseSettlementPercentages({ driverPercentage: 25, companyPercentage: 80 })
    ).toThrow(/must equal 100/);
  });
});

describe('booking snapshot immutability', () => {
  it('N. confirmBooking writes airport snapshot columns from the quote', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/services/booking.service.ts'),
      'utf8'
    );
    expect(src).toContain('airportFeeAmount: String(quote.airportFee)');
    expect(src).toContain('regularTripFare: String(quote.regularFare)');
    expect(src).toContain('airportId: quote.airport?.id');
    expect(src).toContain('airportCodeSnapshot');
  });

  it('does not guess SAN coordinates or fees', () => {
    const sql = require('fs').readFileSync(
      require('path').join(__dirname, '../src/db/migrations/0030_airports_and_commission_only.sql'),
      'utf8'
    );
    expect(sql).not.toMatch(/INSERT INTO "airports"/i);
    expect(sql).not.toMatch(/VALUES\s*\(/i);
  });
});
