import fs from 'fs';
import path from 'path';
import {
  DEFAULT_PAYMENT_CURRENCY,
  resolveBookingCurrency,
  SUPPORTED_TRANSACTION_CURRENCIES,
} from '../src/constants/payment';
import { calculateSettlement } from '../src/services/settlement.service';
import { detectAirportTrip } from '../src/services/airportDetection.service';
import {
  resolveRideMarket,
  UnsupportedMarketError,
} from '../src/services/rideMarket.service';

const mockFindByCountry = jest.fn();
const mockFetchPlaceDetails = jest.fn();
const mockReverseGeocode = jest.fn();
const mockListActive = jest.fn();

jest.mock('../src/repositories/rideMarket.repository', () => ({
  findRideMarketByCountryCode: (...args: unknown[]) => mockFindByCountry(...args),
  listActiveRideMarkets: jest.fn(),
  listRideMarkets: jest.fn(),
  findRideMarketByCode: jest.fn(),
  listMarketFares: jest.fn(),
  upsertMarketFare: jest.fn(),
}));

jest.mock('../src/services/googleMaps/googleMaps.client', () => ({
  normalizePlacesCountryCode: (value: unknown) => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return /^[A-Za-z]{2}$/.test(trimmed) ? trimmed.toUpperCase() : undefined;
  },
  fetchPlaceDetails: (...args: unknown[]) => mockFetchPlaceDetails(...args),
  reverseGeocode: (...args: unknown[]) => mockReverseGeocode(...args),
}));

jest.mock('../src/repositories/airport.repository', () => ({
  listActiveAirports: (...args: unknown[]) => mockListActive(...args),
}));

jest.mock('../src/middleware/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

const BD_MARKET = {
  id: 'm-bd',
  code: 'BD',
  name: 'Bangladesh',
  countryCode: 'BD',
  currency: 'BDT',
  isActive: true,
};

const US_MARKET = {
  id: 'm-us',
  code: 'US',
  name: 'United States',
  countryCode: 'US',
  currency: 'USD',
  isActive: true,
};

const USD_AIRPORT = {
  id: '33333333-3333-3333-3333-333333333333',
  code: 'TESTU',
  name: 'USD Airport',
  googlePlaceId: 'place-usd',
  countryCode: 'US',
  currency: 'USD',
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

const BDT_AIRPORT = {
  ...USD_AIRPORT,
  id: '11111111-1111-1111-1111-111111111111',
  code: 'TESTA',
  countryCode: 'BD',
  currency: 'BDT',
};

function settings() {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    driverPercentage: '25.00',
    companyPercentage: '75.00',
    version: 1,
    updatedAt: new Date(),
  };
}

describe('ride market resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindByCountry.mockImplementation(async (code: string) => {
      if (code === 'BD') return BD_MARKET;
      if (code === 'US') return US_MARKET;
      return null;
    });
    mockFetchPlaceDetails.mockRejectedValue(new Error('unused'));
    mockReverseGeocode.mockResolvedValue({ countryCode: 'BD' });
  });

  it('A. Bangladesh pickup resolves BDT', async () => {
    mockReverseGeocode.mockResolvedValue({ countryCode: 'BD' });
    const market = await resolveRideMarket({
      pickupLatitude: 23.81,
      pickupLongitude: 90.41,
    });
    expect(market.currency).toBe('BDT');
    expect(market.code).toBe('BD');
    expect(market.countrySource).toBe('reverse_geocode');
  });

  it('B. U.S. pickup resolves USD', async () => {
    mockReverseGeocode.mockResolvedValue({ countryCode: 'US' });
    const market = await resolveRideMarket({
      pickupLatitude: 32.7157,
      pickupLongitude: -117.1611,
    });
    expect(market.currency).toBe('USD');
    expect(market.code).toBe('US');
  });

  it('F. client country cannot override Google country', async () => {
    mockReverseGeocode.mockResolvedValue({ countryCode: 'BD' });
    const market = await resolveRideMarket({
      pickupLatitude: 23.81,
      pickupLongitude: 90.41,
      pickupCountryCode: 'US',
    });
    expect(market.currency).toBe('BDT');
    expect(market.code).toBe('BD');
  });

  it('W. unsupported country fails safely', async () => {
    mockReverseGeocode.mockResolvedValue({ countryCode: 'FR' });
    await expect(
      resolveRideMarket({
        pickupLatitude: 48.85,
        pickupLongitude: 2.35,
      })
    ).rejects.toBeInstanceOf(UnsupportedMarketError);
  });

  it('uses Place ID country before reverse geocode', async () => {
    mockFetchPlaceDetails.mockResolvedValue({ countryCode: 'US' });
    const market = await resolveRideMarket({
      pickupLatitude: 23.81,
      pickupLongitude: 90.41,
      pickupPlaceId: 'place-us',
      pickupCountryCode: 'BD',
    });
    expect(market.code).toBe('US');
    expect(market.countrySource).toBe('place_id');
    expect(mockReverseGeocode).not.toHaveBeenCalled();
  });
});

describe('booking currency snapshot', () => {
  it('C. booking currency helper prefers the snapshot', () => {
    expect(resolveBookingCurrency({ currency: 'USD' })).toBe('USD');
    expect(resolveBookingCurrency({ currency: 'usd' })).toBe('USD');
  });

  it('D/S. historical missing currency defaults to BDT', () => {
    expect(resolveBookingCurrency({ currency: null })).toBe('BDT');
    expect(resolveBookingCurrency({})).toBe(DEFAULT_PAYMENT_CURRENCY);
  });

  it('X. snapshotted currency does not change after booking', () => {
    const booking = { currency: 'USD', marketCode: 'US' };
    expect(resolveBookingCurrency(booking)).toBe('USD');
    expect(resolveBookingCurrency(booking)).toBe('USD');
  });
});

describe('airport fees follow booking currency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListActive.mockResolvedValue([USD_AIRPORT]);
  });

  it('I. USD airport fee applies to a USD booking', async () => {
    const result = await detectAirportTrip({
      pickupLatitude: 32.7338,
      pickupLongitude: -117.1933,
      dropoffLatitude: 32.8,
      dropoffLongitude: -117.1,
      transactionCurrency: 'USD',
    });
    expect(result.feeMinor).toBe(500);
    expect(result.currencyMismatch).toBe(false);
  });

  it('J. USD airport fee does not apply to a BDT booking', async () => {
    const result = await detectAirportTrip({
      pickupLatitude: 32.7338,
      pickupLongitude: -117.1933,
      dropoffLatitude: 32.8,
      dropoffLongitude: -117.1,
      transactionCurrency: 'BDT',
    });
    expect(result.feeMinor).toBe(0);
    expect(result.currencyMismatch).toBe(true);
  });

  it('K. BDT airport fee applies to a BDT booking', async () => {
    mockListActive.mockResolvedValue([BDT_AIRPORT]);
    const result = await detectAirportTrip({
      pickupLatitude: 32.7338,
      pickupLongitude: -117.1933,
      dropoffLatitude: 32.8,
      dropoffLongitude: -117.1,
      transactionCurrency: 'BDT',
    });
    expect(result.feeMinor).toBe(500);
    expect(result.currency).toBe('BDT');
  });
});

describe('payments and settlement stay in booking currency', () => {
  it('L/M/N. card PI uses the currency passed from the booking snapshot', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/services/stripePaymentIntent.service.ts'),
      'utf8'
    );
    const bookingSrc = fs.readFileSync(
      path.join(__dirname, '../src/services/booking.service.ts'),
      'utf8'
    );
    const controllerSrc = fs.readFileSync(
      path.join(__dirname, '../src/controllers/passengerBooking.controller.ts'),
      'utf8'
    );
    expect(src).toContain('currency: input.currency');
    expect(bookingSrc).toContain('resolveBookingCurrency(booking)');
    expect(controllerSrc).toContain('resolveBookingCurrency(booking)');
    expect(controllerSrc).not.toContain("payment?.currency || 'BDT'");
  });

  it('O. cash ledger uses booking currency', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/services/cashPayment.service.ts'),
      'utf8'
    );
    expect(src).toContain('resolveBookingCurrency({ currency: input.currency })');
  });

  it('P/Q. settlement uses payment currency and excludes airport fee in both currencies', () => {
    const usd = calculateSettlement({
      bookingId: US_MARKET.id,
      grossAmountMinor: 4500,
      airportFeeMinor: 500,
      currency: 'USD',
      settings: settings(),
    });
    expect(usd.currency).toBe('USD');
    expect(usd.driverAmount).toBe(1000);
    expect(usd.platformAmount).toBe(3000);
    expect(usd.airportFee).toBe(500);

    const bdt = calculateSettlement({
      bookingId: BD_MARKET.id,
      grossAmountMinor: 4500,
      airportFeeMinor: 500,
      currency: 'BDT',
      settings: settings(),
    });
    expect(bdt.currency).toBe('BDT');
    expect(bdt.driverAmount).toBe(1000);
  });
});

describe('source guards', () => {
  it('T. no FX conversion introduced', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/services/rideMarket.service.ts'), 'utf8');
    expect(src).not.toMatch(/exchangeRate|fxConvert|convertCurrency/i);
  });

  it('U. no airport-code-specific currency logic', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/services/rideMarket.service.ts'), 'utf8');
    expect(src).not.toMatch(/\bSAN\b|\bLAX\b|\bJFK\b|\bDAC\b/);
  });

  it('V. no device-locale currency logic', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/services/rideMarket.service.ts'), 'utf8');
    expect(src).not.toMatch(/navigator\.language|Accept-Language|deviceLanguage/i);
  });

  it('D. migration backfills historical bookings to BDT without rewriting amounts', () => {
    const sql = fs.readFileSync(
      path.join(__dirname, '../src/db/migrations/0031_ride_markets_and_booking_currency.sql'),
      'utf8'
    );
    expect(sql).toContain('SET "currency" = \'BDT\'');
    expect(sql).not.toMatch(/UPDATE\s+"bookings"\s+SET\s+"final_fare"/i);
    expect(sql).not.toMatch(/UPDATE\s+"booking_payments"/i);
    expect(sql).not.toMatch(/UPDATE\s+"booking_settlements"/i);
    expect(sql).toContain("m.code = 'BD'");
    expect(sql).toContain('Do not copy them to US');
  });

  it('USD is supported only with a market architecture', () => {
    expect([...SUPPORTED_TRANSACTION_CURRENCIES]).toEqual(['BDT', 'USD']);
  });
});
