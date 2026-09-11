import fs from 'fs';
import path from 'path';
import {
  currenciesAreEqual,
  DEFAULT_PAYMENT_CURRENCY,
  getTransactionCurrency,
  isAirportFeeChargeable,
  isSupportedTransactionCurrency,
  normalizeCurrencyCode,
} from '../src/constants/payment';
import { detectAirportTrip, airportPublicView } from '../src/services/airportDetection.service';
import { calculateSettlement } from '../src/services/settlement.service';
import { createAirportForAdmin } from '../src/services/airportAdmin.service';
import { AirportConfigError } from '../src/services/airportAdmin.service';
import { majorToMinorUnits } from '../src/utils/money';

const mockListActive = jest.fn();
const mockInsertAirport = jest.fn();
const mockFindByCode = jest.fn();
const mockFindByPlace = jest.fn();

jest.mock('../src/repositories/rideMarket.repository', () => ({
  findRideMarketByCountryCode: jest.fn().mockImplementation(async (code: string) => {
    if (code === 'US') {
      return { id: 'm-us', code: 'US', countryCode: 'US', currency: 'USD', name: 'United States', isActive: true };
    }
    if (code === 'BD') {
      return { id: 'm-bd', code: 'BD', countryCode: 'BD', currency: 'BDT', name: 'Bangladesh', isActive: true };
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
  findAirportById: jest.fn(),
  findAirportByCode: (...args: unknown[]) => mockFindByCode(...args),
  findAirportByGooglePlaceId: (...args: unknown[]) => mockFindByPlace(...args),
  insertAirport: (...args: unknown[]) => mockInsertAirport(...args),
  updateAirport: jest.fn(),
}));

jest.mock('../src/middleware/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

const BDT_AIRPORT = {
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

const USD_AIRPORT = {
  ...BDT_AIRPORT,
  id: '33333333-3333-3333-3333-333333333333',
  code: 'TESTU',
  name: 'USD Airport',
  googlePlaceId: 'place-usd',
  countryCode: 'US',
  currency: 'USD',
  pickupFeeMinor: 500,
  dropoffFeeMinor: 500,
};

const ZERO_FEE_AIRPORT = {
  ...BDT_AIRPORT,
  id: '44444444-4444-4444-4444-444444444444',
  code: 'TESTZ',
  name: 'Zero Fee Airport',
  googlePlaceId: 'place-z',
  pickupFeeMinor: 0,
  dropoffFeeMinor: 0,
};

const INSIDE = { latitude: 32.7338, longitude: -117.1933 };
const OUTSIDE = { latitude: 32.8, longitude: -117.1 };

function settings() {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    driverPercentage: '25.00',
    companyPercentage: '75.00',
    version: 1,
    updatedAt: new Date(),
  };
}

describe('current market currency model', () => {
  it('I. supported transaction currencies are BDT and USD', () => {
    expect(DEFAULT_PAYMENT_CURRENCY).toBe('BDT');
    expect(getTransactionCurrency()).toBe('BDT');
    expect(isSupportedTransactionCurrency('usd')).toBe(true);
    expect(isSupportedTransactionCurrency('bdt')).toBe(true);
    expect(isSupportedTransactionCurrency('eur')).toBe(false);
  });

  it('H. currency comparison is case-insensitive after normalize', () => {
    expect(normalizeCurrencyCode('usd')).toBe('USD');
    expect(currenciesAreEqual('usd', 'USD')).toBe(true);
    expect(currenciesAreEqual('bdt', 'BDT')).toBe(true);
    expect(currenciesAreEqual('USD', 'BDT')).toBe(false);
    expect(isAirportFeeChargeable('usd', 'BDT')).toBe(false);
    expect(isAirportFeeChargeable('bdt', 'BDT')).toBe(true);
  });

  it('J. airport/fare/settlement modules do not convert FX', () => {
    const files = [
      '../src/services/airportDetection.service.ts',
      '../src/services/fare.service.ts',
      '../src/services/settlement.service.ts',
      '../src/constants/payment.ts',
    ];
    for (const rel of files) {
      const src = fs.readFileSync(path.join(__dirname, rel), 'utf8');
      expect(src).not.toMatch(/exchangeRate|fxConvert|convertCurrency|spotRate/i);
    }
  });
});

describe('airport fee currency guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('A. same-currency BDT airport fee applies', async () => {
    mockListActive.mockResolvedValue([BDT_AIRPORT]);
    const result = await detectAirportTrip({
      pickupLatitude: INSIDE.latitude,
      pickupLongitude: INSIDE.longitude,
      dropoffLatitude: OUTSIDE.latitude,
      dropoffLongitude: OUTSIDE.longitude,
    });
    expect(result.feeMinor).toBe(500);
    expect(result.currencyMismatch).toBe(false);
    expect(result.currency).toBe('BDT');
    expect(airportPublicView(result)?.code).toBe('TESTA');
  });

  it('B. USD airport + BDT fare does not numerically add the fee', async () => {
    mockListActive.mockResolvedValue([USD_AIRPORT]);
    const result = await detectAirportTrip({
      pickupLatitude: INSIDE.latitude,
      pickupLongitude: INSIDE.longitude,
      dropoffLatitude: OUTSIDE.latitude,
      dropoffLongitude: OUTSIDE.longitude,
      transactionCurrency: 'BDT',
    });
    expect(result.currencyMismatch).toBe(true);
    expect(result.feeMinor).toBe(0);
    expect(result.feeMajor).toBe('0.00');
    expect(result.currency).toBe('USD');
    expect(airportPublicView(result)).toBeNull();
  });

  it('H. lowercase usd airport currency is still a mismatch against BDT', async () => {
    mockListActive.mockResolvedValue([{ ...USD_AIRPORT, currency: 'usd' }]);
    const result = await detectAirportTrip({
      pickupLatitude: INSIDE.latitude,
      pickupLongitude: INSIDE.longitude,
      dropoffLatitude: OUTSIDE.latitude,
      dropoffLongitude: OUTSIDE.longitude,
      transactionCurrency: 'bdt',
    });
    expect(result.currencyMismatch).toBe(true);
    expect(result.feeMinor).toBe(0);
  });

  it('G. zero-fee same-currency airport remains safe', async () => {
    mockListActive.mockResolvedValue([ZERO_FEE_AIRPORT]);
    const result = await detectAirportTrip({
      pickupLatitude: INSIDE.latitude,
      pickupLongitude: INSIDE.longitude,
      dropoffLatitude: OUTSIDE.latitude,
      dropoffLongitude: OUTSIDE.longitude,
    });
    expect(result.currencyMismatch).toBe(false);
    expect(result.feeMinor).toBe(0);
    expect(result.tripType).toBe('pickup');
  });

  it('F. non-airport booking is unchanged', async () => {
    mockListActive.mockResolvedValue([USD_AIRPORT, BDT_AIRPORT]);
    const result = await detectAirportTrip({
      pickupLatitude: 23.81,
      pickupLongitude: 90.41,
      dropoffLatitude: 23.75,
      dropoffLongitude: 90.38,
    });
    expect(result.feeMinor).toBe(0);
    expect(result.airportId).toBeNull();
    expect(result.currencyMismatch).toBe(false);
  });
});

describe('payment and settlement stay in one currency', () => {
  it('C/D. card PI and cash ledger charge finalFare in transaction currency only', () => {
    const regularMinor = 150000;
    const usdFeeMinor = 500;
    const invalidMixed = regularMinor + usdFeeMinor;
    const transactionMinor = regularMinor;
    expect(transactionMinor).not.toBe(invalidMixed);
    expect(majorToMinorUnits('1500.00')).toBe(150000);

    const pi = fs.readFileSync(
      path.join(__dirname, '../src/services/stripePaymentIntent.service.ts'),
      'utf8'
    );
    const cash = fs.readFileSync(
      path.join(__dirname, '../src/services/cashPayment.service.ts'),
      'utf8'
    );
    expect(pi).toContain('majorToMinorUnits(String(input.finalFare');
    expect(pi).toContain('currency: input.currency');
    expect(cash).toContain('majorToMinorUnits(String(input.finalFare');
    expect(cash).toContain('resolveBookingCurrency({ currency: input.currency })');
  });

  it('E. settlement currency stays BDT and does not mix a withheld USD fee', () => {
    const result = calculateSettlement({
      bookingId: BDT_AIRPORT.id,
      grossAmountMinor: 150000,
      airportFeeMinor: 0,
      currency: getTransactionCurrency(),
      settings: settings(),
    });
    expect(result.currency).toBe('BDT');
    expect(result.airportFee).toBe(0);
    expect(result.grossAmount).toBe(150000);
    expect(result.driverAmount + result.platformAmount + result.airportFee).toBe(150000);
  });
});

describe('admin airport currency activation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindByCode.mockResolvedValue(null);
    mockFindByPlace.mockResolvedValue(null);
    mockInsertAirport.mockImplementation(async (values: Record<string, unknown>) => ({
      id: USD_AIRPORT.id,
      ...values,
      geofenceType: 'radius',
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
  });

  it('rejects activating an airport whose currency is not a booking currency', async () => {
    await expect(
      createAirportForAdmin({
        code: 'TESTE',
        name: 'Euro Airport',
        countryCode: 'FR',
        currency: 'eur',
        latitude: 48.72,
        longitude: 2.36,
        radiusMeters: 2000,
        pickupFee: '5.00',
        dropoffFee: '5.00',
        isActive: true,
      })
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_AIRPORT_CURRENCY' });
    expect(mockInsertAirport).not.toHaveBeenCalled();
  });

  it('rejects a USD airport in the Bangladesh market', async () => {
    await expect(
      createAirportForAdmin({
        code: 'TESTX',
        name: 'Mismatched Airport',
        countryCode: 'BD',
        currency: 'USD',
        latitude: 23.84,
        longitude: 90.4,
        radiusMeters: 2000,
        pickupFee: '5.00',
        dropoffFee: '5.00',
        isActive: true,
      })
    ).rejects.toMatchObject({ code: 'AIRPORT_MARKET_CURRENCY_MISMATCH' });
  });

  it('allows activating a USD airport in the U.S. market', async () => {
    await createAirportForAdmin({
      code: 'TESTU',
      name: 'USD Airport',
      countryCode: 'US',
      currency: 'usd',
      latitude: 32.7338,
      longitude: -117.1933,
      radiusMeters: 2000,
      pickupFee: '5.00',
      dropoffFee: '5.00',
      isActive: true,
    });
    expect(mockInsertAirport).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'USD', countryCode: 'US', isActive: true })
    );
  });

  it('allows saving an unchargeable airport as inactive for later markets', async () => {
    const created = await createAirportForAdmin({
      code: 'TESTU',
      name: 'USD Airport',
      countryCode: 'US',
      currency: 'USD',
      latitude: 32.7338,
      longitude: -117.1933,
      radiusMeters: 2000,
      pickupFee: '5.00',
      dropoffFee: '5.00',
      isActive: false,
    });
    expect(created.isActive).toBe(false);
    expect(created.currency).toBe('USD');
    expect(mockInsertAirport).toHaveBeenCalled();
  });

  it('still allows active BDT airports', async () => {
    await createAirportForAdmin({
      code: 'TESTA',
      name: 'Test Airport A',
      countryCode: 'BD',
      currency: 'bdt',
      latitude: 32.7338,
      longitude: -117.1933,
      radiusMeters: 2000,
      pickupFee: '5.00',
      dropoffFee: '3.00',
    });
    expect(mockInsertAirport).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'BDT', isActive: true })
    );
  });
});

describe('AirportConfigError export', () => {
  it('is a typed config error', () => {
    const error = new AirportConfigError('UNSUPPORTED_AIRPORT_CURRENCY', 'no', 400);
    expect(error.code).toBe('UNSUPPORTED_AIRPORT_CURRENCY');
  });
});
