/**
 * U.S. USD end-to-end financial QA.
 *
 * TEST fixtures only (market US, airport TESTUS). Does not seed production
 * migrations or invent SAN production airport values.
 */

import fs from 'fs';
import path from 'path';
import * as routeService from '../src/services/route.service';
import { quoteAllServiceCategories } from '../src/services/fare.service';
import * as rideMarket from '../src/services/rideMarket.service';
import { detectAirportTrip } from '../src/services/airportDetection.service';
import {
  BookingPaymentStatus,
  FinancialIdempotencyKey,
  PaymentMethodCode,
  PaymentProvider,
  SettlementStatus,
} from '../src/constants/payment';
import { majorToMinorUnits } from '../src/utils/money';
import { calculateSettlement, ensureSettlementForCapturedPayment } from '../src/services/settlement.service';
import { recordCompletedCashBookingPayment } from '../src/services/cashPayment.service';
import {
  buildPlatformPaymentIntentParams,
  prepareCardPaymentForBooking,
  resetPaymentIntentLocksForTests,
} from '../src/services/stripePaymentIntent.service';
import {
  captureAuthorizedBookingPayment,
  resetCaptureLocksForTests,
} from '../src/services/stripeCapture.service';
import { formatDriverPaymentHistoryItem } from '../src/services/driverPaymentHistory.service';
import { formatPassengerRideSnapshot as formatPassengerHistory } from '../src/services/rideHistory.service';
import type { DriverPaymentHistoryRow } from '../src/repositories/driverPaymentHistory.repository';

const mockListActiveAirports = jest.fn();
const mockFindBookingPaymentByBookingId = jest.fn();
const mockClaimPendingCardPayment = jest.fn();
const mockClaimCompletedCashPayment = jest.fn();
const mockUpdateBookingPayment = jest.fn();
const mockFindBookingSettlementByBookingId = jest.fn();
const mockClaimBookingSettlement = jest.fn();
const mockFindBookingById = jest.fn();
const mockUpdateBooking = jest.fn();
const mockFindActiveSettlementSettings = jest.fn();
const mockGetStripeClient = jest.fn();
const mockFindActivePromotion = jest.fn();

jest.mock('../src/services/rideMarket.service', () => ({
  resolveRideMarket: jest.fn(),
  assertMarketPricingConfigured: jest.fn().mockResolvedValue(undefined),
  getMarketFareMap: jest.fn(),
}));

jest.mock('../src/services/serviceArea.service', () => ({
  assertRidePermitted: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/repositories/airport.repository', () => ({
  listActiveAirports: (...args: unknown[]) => mockListActiveAirports(...args),
  listAirports: jest.fn(),
  findAirportById: jest.fn(),
  findAirportByCode: jest.fn(),
  findAirportByGooglePlaceId: jest.fn(),
  insertAirport: jest.fn(),
  updateAirport: jest.fn(),
}));

jest.mock('../src/repositories/serviceCategory.repository', () => ({
  listCanonicalActiveServiceCategories: jest.fn().mockResolvedValue([
    {
      id: 'cat-regular',
      code: 'regular',
      name: 'Regular',
      description: 'TEST regular category',
      iconKey: 'regular',
      capacity: 4,
      baseFare: '50.00',
      perKmRate: '20.00',
      minFare: '80.00',
      isActive: true,
    },
  ]),
  listActiveServiceCategories: jest.fn().mockResolvedValue([]),
  findActivePromotion: (...args: unknown[]) => mockFindActivePromotion(...args),
  findServiceCategoryById: jest.fn(),
  findServiceCategoryByCode: jest.fn(),
}));

jest.mock('../src/services/stripe.service', () => {
  const actual = jest.requireActual('../src/services/stripe.service');
  return {
    ...actual,
    isStripeReady: () => true,
    getStripeClient: () => mockGetStripeClient(),
  };
});

jest.mock('../src/repositories/bookingPayment.repository', () => ({
  findBookingPaymentByBookingId: (...args: unknown[]) => mockFindBookingPaymentByBookingId(...args),
  findBookingPaymentByProviderPaymentIntentId: jest.fn(),
  claimPendingCardPayment: (...args: unknown[]) => mockClaimPendingCardPayment(...args),
  claimCompletedCashPayment: (...args: unknown[]) => mockClaimCompletedCashPayment(...args),
  updateBookingPayment: (...args: unknown[]) => mockUpdateBookingPayment(...args),
  insertBookingPayment: jest.fn(),
  findBookingSettlementByBookingId: (...args: unknown[]) =>
    mockFindBookingSettlementByBookingId(...args),
  insertBookingSettlement: jest.fn(),
  claimBookingSettlement: (...args: unknown[]) => mockClaimBookingSettlement(...args),
}));

jest.mock('../src/repositories/booking.repository', () => ({
  findBookingById: (...args: unknown[]) => mockFindBookingById(...args),
  updateBooking: (...args: unknown[]) => mockUpdateBooking(...args),
}));

jest.mock('../src/repositories/settlementSettings.repository', () => ({
  findActiveSettlementSettings: (...args: unknown[]) => mockFindActiveSettlementSettings(...args),
  findLatestSettlementSettingsVersion: jest.fn(),
  insertSettlementSettings: jest.fn(),
  replaceActiveSettlementSettings: jest.fn(),
}));

jest.mock('../src/middleware/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const BOOKING_ID = '22222222-2222-2222-2222-222222222222';
const PASSENGER_ID = '33333333-3333-3333-3333-333333333333';
const PAYMENT_ID = '11111111-1111-1111-1111-111111111111';

const US_MARKET = {
  id: 'market-us-test',
  code: 'US',
  name: 'United States',
  countryCode: 'US',
  currency: 'USD',
  countrySource: 'reverse_geocode' as const,
};

const BD_MARKET = {
  id: 'market-bd-test',
  code: 'BD',
  name: 'Bangladesh',
  countryCode: 'BD',
  currency: 'BDT',
  countrySource: 'reverse_geocode' as const,
};

const TESTUS_AIRPORT = {
  id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  code: 'TESTUS',
  name: 'Test United States Airport',
  googlePlaceId: 'test-place-us-airport',
  countryCode: 'US',
  currency: 'USD',
  isActive: true,
  geofenceType: 'radius',
  centerLatitude: '32.80000000',
  centerLongitude: '-117.15000000',
  radiusMeters: 1500,
  geofencePolygon: null,
  pickupFeeMinor: 500,
  dropoffFeeMinor: 700,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const INSIDE_TESTUS = { latitude: 32.8, longitude: -117.15 };
const OUTSIDE_TESTUS = { latitude: 32.9, longitude: -117.05 };

const US_FARES = new Map([
  ['cat-regular', { baseFare: '20.00', perKmRate: '2.00', minFare: '10.00' }],
]);
const BD_FARES = new Map([
  ['cat-regular', { baseFare: '50.00', perKmRate: '20.00', minFare: '80.00' }],
]);

const SETTINGS = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  driverPercentage: '25.00',
  companyPercentage: '75.00',
  version: 1,
  updatedAt: new Date('2026-09-11T00:00:00.000Z'),
};

function mockRoute(distanceKm = 10) {
  jest.spyOn(routeService, 'previewRoute').mockResolvedValue({
    pickup: INSIDE_TESTUS,
    dropoff: OUTSIDE_TESTUS,
    stops: [],
    distanceMeters: distanceKm * 1000,
    distanceKm,
    durationSeconds: 1200,
    durationMin: 20,
    staticDurationSeconds: 1100,
    trafficDelaySeconds: 100,
    encodedPolyline: 'test-polyline',
    routeBounds: {
      northeast: INSIDE_TESTUS,
      southwest: OUTSIDE_TESTUS,
    },
    legs: [],
    provider: 'google',
    calculatedAt: new Date().toISOString(),
  });
}

function snapshotFromQuote(quote: {
  currency: string;
  marketCode: string;
  pickupCountryCode: string;
  regularFare: number;
  airportFee: number;
  finalFare: number;
  airport: { id: string; code: string; name: string; tripType: string } | null;
}) {
  return {
    currency: quote.currency,
    marketCode: quote.marketCode,
    pickupCountryCode: quote.pickupCountryCode,
    airportId: quote.airport?.id ?? null,
    airportCodeSnapshot: quote.airport?.code ?? null,
    airportNameSnapshot: quote.airport?.name ?? null,
    airportTripType: quote.airport?.tripType ?? null,
    airportFeeAmount: String(quote.airportFee.toFixed(2)),
    regularTripFare: String(quote.regularFare.toFixed(2)),
    finalFare: String(quote.finalFare.toFixed(2)),
  };
}

function usdIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pi_usd_test_1',
    object: 'payment_intent',
    amount: 4500,
    currency: 'usd',
    status: 'requires_payment_method',
    capture_method: 'manual',
    client_secret: 'pi_usd_test_1_secret_abc',
    amount_capturable: 0,
    metadata: { bookingId: BOOKING_ID, passengerId: PASSENGER_ID },
    latest_charge: null,
    last_payment_error: null,
    ...overrides,
  };
}

function historyRow(overrides: Partial<DriverPaymentHistoryRow> = {}): DriverPaymentHistoryRow {
  return {
    paymentId: PAYMENT_ID,
    paymentMethod: 'card',
    paymentCurrency: 'USD',
    paymentGrossAmount: 4500,
    paymentStatus: BookingPaymentStatus.CAPTURED,
    paymentAuthorizedAt: new Date('2026-09-11T10:00:00.000Z'),
    paymentCapturedAt: new Date('2026-09-11T11:00:00.000Z'),
    paymentFailedAt: null,
    paymentRefundedAt: null,
    paymentFailureCode: null,
    paymentFailureMessage: null,
    paymentCreatedAt: new Date('2026-09-11T09:00:00.000Z'),
    catalogPaymentMethodCode: 'card',
    bookingId: BOOKING_ID,
    bookingNumber: 'RYD-US-1001',
    bookingStatus: 'completed',
    bookingCompletedAt: new Date('2026-09-11T10:55:00.000Z'),
    pickupAddress: 'TESTUS pickup',
    pickupLatitude: '32.80000000',
    pickupLongitude: '-117.15000000',
    pickupSpotLabel: null,
    dropoffAddress: 'Downtown',
    dropoffLatitude: '32.90000000',
    dropoffLongitude: '-117.05000000',
    serviceName: 'Regular',
    serviceCode: 'regular',
    settlementId: 'settlement-1',
    settlementStatus: SettlementStatus.PENDING,
    settlementGrossAmount: 4500,
    settlementDriverAmount: 1000,
    settlementPlatformAmount: 3000,
    settlementAirportFee: 500,
    settlementCurrency: 'USD',
    settlementCreatedAt: new Date('2026-09-11T11:00:00.000Z'),
    settlementUpdatedAt: new Date('2026-09-11T11:00:00.000Z'),
    ...overrides,
  };
}

describe('USD end-to-end financial QA — TESTUS fixtures', () => {
  const mockCreate = jest.fn();
  const mockRetrieve = jest.fn();
  const mockCapture = jest.fn();
  const mockCancel = jest.fn();
  const mockTransfersCreate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    resetPaymentIntentLocksForTests();
    resetCaptureLocksForTests();
    mockFindActivePromotion.mockResolvedValue(null);
    mockListActiveAirports.mockResolvedValue([{ ...TESTUS_AIRPORT }]);
    (rideMarket.resolveRideMarket as jest.Mock).mockResolvedValue({ ...US_MARKET });
    (rideMarket.getMarketFareMap as jest.Mock).mockResolvedValue(US_FARES);
    mockFindActiveSettlementSettings.mockResolvedValue(SETTINGS);
    mockRoute(10);

    mockCreate.mockResolvedValue(usdIntent({ status: 'requires_capture', amount_capturable: 4500 }));
    mockRetrieve.mockResolvedValue(usdIntent({ status: 'requires_capture', amount_capturable: 4500 }));
    mockCapture.mockResolvedValue(
      usdIntent({ status: 'succeeded', amount_capturable: 0, latest_charge: 'ch_usd_1' })
    );
    mockGetStripeClient.mockReturnValue({
      paymentIntents: {
        create: mockCreate,
        retrieve: mockRetrieve,
        capture: mockCapture,
        cancel: mockCancel,
      },
      transfers: { create: mockTransfersCreate },
    });

    mockClaimPendingCardPayment.mockImplementation(async (values: Record<string, unknown>) => ({
      id: PAYMENT_ID,
      ...values,
    }));
    mockClaimCompletedCashPayment.mockImplementation(async (values: Record<string, unknown>) => ({
      id: PAYMENT_ID,
      ...values,
    }));
    mockUpdateBookingPayment.mockImplementation(async (_id: string, patch: Record<string, unknown>) => patch);
    mockFindBookingPaymentByBookingId.mockResolvedValue(null);
    mockFindBookingSettlementByBookingId.mockResolvedValue(null);
    mockClaimBookingSettlement.mockImplementation(async (values: Record<string, unknown>) => ({
      id: 'settlement-1',
      providerTransferId: null,
      ...values,
    }));
    mockFindBookingById.mockResolvedValue({
      id: BOOKING_ID,
      status: 'completed',
      paymentStatus: 'pending',
      currency: 'USD',
      marketCode: 'US',
      pickupCountryCode: 'US',
      finalFare: '45.00',
      regularTripFare: '40.00',
      airportFeeAmount: '5.00',
      airportId: TESTUS_AIRPORT.id,
      airportCodeSnapshot: 'TESTUS',
    });
    mockUpdateBooking.mockImplementation(async (_id: string, patch: Record<string, unknown>) => patch);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    resetPaymentIntentLocksForTests();
    resetCaptureLocksForTests();
  });

  it('A. US regular quote resolves USD with market-specific fares', async () => {
    const result = await quoteAllServiceCategories(OUTSIDE_TESTUS, {
      latitude: 32.91,
      longitude: -117.04,
    });
    expect(result.market).toEqual({ code: 'US', countryCode: 'US', currency: 'USD' });
    expect(result.quotes[0].currency).toBe('USD');
    expect(result.quotes[0].marketCode).toBe('US');
    expect(result.quotes[0].pickupCountryCode).toBe('US');
    expect(result.quotes[0].regularFare).toBe(40);
    expect(result.quotes[0].airportFee).toBe(0);
    expect(result.quotes[0].finalFare).toBe(40);
    expect(result.quotes[0].airport).toBeNull();
    expect(result.quotes[0].originalFare).not.toBe(250);
  });

  it('B/D. US airport pickup uses TESTUS fixed USD fee and total = regular + fee', async () => {
    const result = await quoteAllServiceCategories(INSIDE_TESTUS, OUTSIDE_TESTUS);
    expect(result.quotes[0].regularFare).toBe(40);
    expect(result.quotes[0].airportFee).toBe(5);
    expect(result.quotes[0].finalFare).toBe(45);
    expect(result.quotes[0].currency).toBe('USD');
    expect(result.quotes[0].airport).toEqual({
      id: TESTUS_AIRPORT.id,
      code: 'TESTUS',
      name: 'Test United States Airport',
      tripType: 'pickup',
    });
  });

  it('C/D. US airport drop-off uses configured TESTUS drop-off fee', async () => {
    const result = await quoteAllServiceCategories(OUTSIDE_TESTUS, INSIDE_TESTUS);
    expect(result.quotes[0].airport?.tripType).toBe('dropoff');
    expect(result.quotes[0].airport?.code).toBe('TESTUS');
    expect(result.quotes[0].regularFare).toBe(40);
    expect(result.quotes[0].airportFee).toBe(7);
    expect(result.quotes[0].finalFare).toBe(47);
    expect(result.quotes[0].currency).toBe('USD');
  });

  it('E. booking snapshot fields are USD / US / TESTUS from the quote', async () => {
    const result = await quoteAllServiceCategories(INSIDE_TESTUS, OUTSIDE_TESTUS);
    const snapshot = snapshotFromQuote(result.quotes[0]);
    expect(snapshot).toEqual({
      currency: 'USD',
      marketCode: 'US',
      pickupCountryCode: 'US',
      airportId: TESTUS_AIRPORT.id,
      airportCodeSnapshot: 'TESTUS',
      airportNameSnapshot: 'Test United States Airport',
      airportTripType: 'pickup',
      airportFeeAmount: '5.00',
      regularTripFare: '40.00',
      finalFare: '45.00',
    });
  });

  it('confirmBooking persists the quote currency and airport snapshot columns', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/services/booking.service.ts'), 'utf8');
    expect(src).toContain('currency: quote.currency');
    expect(src).toContain('marketCode: quote.marketCode ?? null');
    expect(src).toContain('pickupCountryCode: quote.pickupCountryCode ?? null');
    expect(src).toContain('airportId: quote.airport?.id ?? null');
    expect(src).toContain('airportCodeSnapshot: quote.airport?.code ?? null');
    expect(src).toContain('airportNameSnapshot: quote.airport?.name ?? null');
    expect(src).toContain('airportTripType: quote.airport?.tripType ?? null');
    expect(src).toContain('regularTripFare: String(quote.regularFare)');
    expect(src).toContain('airportFeeAmount: String(quote.airportFee)');
    expect(src).toContain('finalFare: String(quote.finalFare)');
  });

  it('F/Q. later TESTUS fee changes do not rewrite an existing snapshot', async () => {
    const first = await quoteAllServiceCategories(INSIDE_TESTUS, OUTSIDE_TESTUS);
    const booked = snapshotFromQuote(first.quotes[0]);
    mockListActiveAirports.mockResolvedValue([{ ...TESTUS_AIRPORT, pickupFeeMinor: 900 }]);
    const second = await quoteAllServiceCategories(INSIDE_TESTUS, OUTSIDE_TESTUS);
    expect(booked.airportFeeAmount).toBe('5.00');
    expect(booked.finalFare).toBe('45.00');
    expect(second.quotes[0].airportFee).toBe(9);
    expect(second.quotes[0].finalFare).toBe(49);
  });

  it('R. later US fare changes do not rewrite an existing snapshot', async () => {
    const first = await quoteAllServiceCategories(OUTSIDE_TESTUS, {
      latitude: 32.91,
      longitude: -117.04,
    });
    const booked = snapshotFromQuote(first.quotes[0]);
    (rideMarket.getMarketFareMap as jest.Mock).mockResolvedValue(
      new Map([['cat-regular', { baseFare: '30.00', perKmRate: '3.00', minFare: '10.00' }]])
    );
    const second = await quoteAllServiceCategories(OUTSIDE_TESTUS, {
      latitude: 32.91,
      longitude: -117.04,
    });
    expect(booked.regularTripFare).toBe('40.00');
    expect(booked.currency).toBe('USD');
    expect(second.quotes[0].regularFare).toBe(60);
    expect(second.quotes[0].currency).toBe('USD');
  });

  it('G/H. USD PaymentIntent amount is passenger total in minor units', async () => {
    const params = buildPlatformPaymentIntentParams({
      amountMinor: majorToMinorUnits('45.00'),
      currency: 'USD',
      bookingId: BOOKING_ID,
      passengerId: PASSENGER_ID,
    });
    expect(params.amount).toBe(4500);
    expect(params.currency).toBe('usd');
    expect(params.capture_method).toBe('manual');
    expect(params.transfer_data).toBeUndefined();

    mockFindBookingPaymentByBookingId.mockResolvedValue(null);
    const view = await prepareCardPaymentForBooking({
      bookingId: BOOKING_ID,
      passengerId: PASSENGER_ID,
      finalFare: '45.00',
      currency: 'USD',
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      amount: 4500,
      currency: 'usd',
      capture_method: 'manual',
    });
    expect(mockCreate.mock.calls[0][1]).toEqual({
      idempotencyKey: FinancialIdempotencyKey.payment(BOOKING_ID),
    });
    expect(view.amount).toBe(4500);
    expect(view.currency).toBe('USD');
    expect(mockTransfersCreate).not.toHaveBeenCalled();
  });

  it('I. authorized then captured USD ledger keeps currency and gross', async () => {
    const ledger: Record<string, unknown> = {
      id: PAYMENT_ID,
      bookingId: BOOKING_ID,
      paymentMethod: PaymentMethodCode.CARD,
      status: BookingPaymentStatus.AUTHORIZED,
      providerPaymentIntentId: 'pi_usd_test_1',
      grossAmount: 4500,
      currency: 'USD',
    };
    mockFindBookingPaymentByBookingId.mockImplementation(async () => ({ ...ledger }));
    mockUpdateBookingPayment.mockImplementation(async (_id: string, patch: Record<string, unknown>) => {
      Object.assign(ledger, patch);
      return { ...ledger };
    });

    const captured = await captureAuthorizedBookingPayment(BOOKING_ID);
    expect(captured.status).toBe(BookingPaymentStatus.CAPTURED);
    expect(ledger.currency).toBe('USD');
    expect(ledger.grossAmount).toBe(4500);
    expect(ledger.status).toBe(BookingPaymentStatus.CAPTURED);
    mockRetrieve.mockResolvedValue(
      usdIntent({ status: 'succeeded', amount_capturable: 0, latest_charge: 'ch_usd_1' })
    );
    const retried = await captureAuthorizedBookingPayment(BOOKING_ID);
    expect(retried.alreadyCaptured).toBe(true);
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockTransfersCreate).not.toHaveBeenCalled();
  });

  it('J/K/L/M. airport settlement is 25/75 of $40 plus $5 airport, pending, no Transfer', async () => {
    const allocation = calculateSettlement({
      bookingId: BOOKING_ID,
      grossAmountMinor: 4500,
      airportFeeMinor: 500,
      currency: 'USD',
      settings: SETTINGS,
    });
    expect(allocation.commissionableFare).toBe(4000);
    expect(allocation.driverAmount).toBe(1000);
    expect(allocation.platformAmount).toBe(3000);
    expect(allocation.airportFee).toBe(500);
    expect(allocation.driverAmount + allocation.platformAmount + allocation.airportFee).toBe(4500);
    expect(allocation.currency).toBe('USD');

    mockFindBookingPaymentByBookingId.mockResolvedValue({
      id: PAYMENT_ID,
      bookingId: BOOKING_ID,
      paymentMethod: PaymentMethodCode.CARD,
      status: BookingPaymentStatus.CAPTURED,
      grossAmount: 4500,
      currency: 'USD',
    });
    mockFindBookingById.mockResolvedValue({
      id: BOOKING_ID,
      airportFeeAmount: '5.00',
      currency: 'USD',
    });

    const settlement = await ensureSettlementForCapturedPayment(BOOKING_ID);
    expect(mockClaimBookingSettlement).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: BOOKING_ID,
        status: SettlementStatus.PENDING,
        grossAmount: 4500,
        driverAmount: 1000,
        platformAmount: 3000,
        airportFee: 500,
        currency: 'USD',
        airportFeePercentage: null,
        driverPercentage: '25.00',
        companyPercentage: '75.00',
      })
    );
    expect(settlement?.providerTransferId ?? null).toBeNull();
    expect(mockTransfersCreate).not.toHaveBeenCalled();
  });

  it('N. regular US settlement has airport fee 0 and 25/75 of full fare', () => {
    const allocation = calculateSettlement({
      bookingId: BOOKING_ID,
      grossAmountMinor: 4000,
      airportFeeMinor: 0,
      currency: 'USD',
      settings: SETTINGS,
    });
    expect(allocation.airportFee).toBe(0);
    expect(allocation.driverAmount).toBe(1000);
    expect(allocation.platformAmount).toBe(3000);
    expect(allocation.driverAmount + allocation.platformAmount).toBe(4000);
  });

  it('O/P. USD cash ledger and skipped_cash settlement, no Stripe', async () => {
    const cashRow = {
      id: PAYMENT_ID,
      bookingId: BOOKING_ID,
      paymentMethod: PaymentMethodCode.CASH,
      provider: PaymentProvider.CASH,
      status: BookingPaymentStatus.CAPTURED,
      currency: 'USD',
      grossAmount: 4500,
    };
    mockFindBookingPaymentByBookingId
      .mockResolvedValueOnce(null)
      .mockResolvedValue(cashRow);
    mockClaimCompletedCashPayment.mockResolvedValue(cashRow);
    mockFindBookingById.mockResolvedValue({
      id: BOOKING_ID,
      airportFeeAmount: '5.00',
      currency: 'USD',
    });

    const row = await recordCompletedCashBookingPayment({
      bookingId: BOOKING_ID,
      finalFare: '45.00',
      currency: 'USD',
      completedAt: new Date('2026-09-11T11:00:00.000Z'),
    });

    expect(mockClaimCompletedCashPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: 'USD',
        grossAmount: 4500,
        provider: PaymentProvider.CASH,
        paymentMethod: PaymentMethodCode.CASH,
      })
    );
    expect(row?.currency).toBe('USD');
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
    expect(mockClaimBookingSettlement).toHaveBeenCalledWith(
      expect.objectContaining({
        status: SettlementStatus.SKIPPED_CASH,
        currency: 'USD',
        driverAmount: 1000,
        platformAmount: 3000,
        airportFee: 500,
      })
    );
  });

  it('S. BD quote stays BDT and does not use US 40.00 fares', async () => {
    (rideMarket.resolveRideMarket as jest.Mock).mockResolvedValue({ ...BD_MARKET });
    (rideMarket.getMarketFareMap as jest.Mock).mockResolvedValue(BD_FARES);
    mockListActiveAirports.mockResolvedValue([]);
    const result = await quoteAllServiceCategories(
      { latitude: 23.81, longitude: 90.41 },
      { latitude: 23.75, longitude: 90.38 }
    );
    expect(result.market.currency).toBe('BDT');
    expect(result.quotes[0].currency).toBe('BDT');
    expect(result.quotes[0].marketCode).toBe('BD');
    expect(result.quotes[0].regularFare).toBe(250);
    expect(result.quotes[0].finalFare).toBe(250);
    expect(result.quotes[0].regularFare).not.toBe(40);
  });

  it('S. BD settlement stays BDT', () => {
    const bdt = calculateSettlement({
      bookingId: BOOKING_ID,
      grossAmountMinor: 25000,
      airportFeeMinor: 0,
      currency: 'BDT',
      settings: SETTINGS,
    });
    expect(bdt.currency).toBe('BDT');
    expect(bdt.driverAmount).toBe(6250);
    expect(bdt.platformAmount).toBe(18750);
  });

  it('V. payment / capture / settlement retries stay idempotent', async () => {
    mockFindBookingPaymentByBookingId.mockResolvedValue({
      bookingId: BOOKING_ID,
      providerPaymentIntentId: 'pi_usd_test_1',
      paymentMethod: 'card',
      status: 'requires_payment_method',
      currency: 'USD',
      grossAmount: 4500,
    });
    mockRetrieve.mockResolvedValue(usdIntent({ status: 'requires_payment_method' }));
    const first = await prepareCardPaymentForBooking({
      bookingId: BOOKING_ID,
      passengerId: PASSENGER_ID,
      finalFare: '45.00',
      currency: 'USD',
    });
    const second = await prepareCardPaymentForBooking({
      bookingId: BOOKING_ID,
      passengerId: PASSENGER_ID,
      finalFare: '99.00',
      currency: 'USD',
    });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(first.paymentIntentId).toBe(second.paymentIntentId);

    const existingSettlement = {
      id: 'settlement-1',
      bookingId: BOOKING_ID,
      status: SettlementStatus.PENDING,
      currency: 'USD',
      providerTransferId: null,
    };
    mockFindBookingSettlementByBookingId.mockResolvedValue(existingSettlement);
    const again = await ensureSettlementForCapturedPayment(BOOKING_ID);
    expect(again).toEqual(existingSettlement);
    expect(mockClaimBookingSettlement).not.toHaveBeenCalled();
  });

  it('W. driver payment-history returns USD amounts and does not label airport as earnings', () => {
    const item = formatDriverPaymentHistoryItem(historyRow());
    expect(item.passengerPayment.amount).toEqual({
      minor: 4500,
      formatted: '45.00',
      currency: 'USD',
    });
    expect(item.settlement.driverAmount).toEqual({
      minor: 1000,
      formatted: '10.00',
      currency: 'USD',
    });
    expect(item.settlement.platformAmount).toEqual({
      minor: 3000,
      formatted: '30.00',
      currency: 'USD',
    });
    expect(item.settlement.airportFee).toEqual({
      minor: 500,
      formatted: '5.00',
      currency: 'USD',
    });
    expect(item.settlement.driverAmount?.minor).not.toBe(item.passengerPayment.amount?.minor);
    expect(JSON.stringify(item)).not.toMatch(/driver earnings|totalEarnings|paidToDriver/i);
  });

  it('X. passenger quote/payment contract exposes USD fare breakdown without new duplicate fields', async () => {
    const result = await quoteAllServiceCategories(INSIDE_TESTUS, OUTSIDE_TESTUS);
    const quote = result.quotes[0];
    expect(quote).toEqual(
      expect.objectContaining({
        currency: 'USD',
        regularFare: 40,
        airportFee: 5,
        finalFare: 45,
        airport: expect.objectContaining({ code: 'TESTUS', tripType: 'pickup' }),
      })
    );
    const controllerSrc = fs.readFileSync(
      path.join(__dirname, '../src/controllers/passengerBooking.controller.ts'),
      'utf8'
    );
    expect(controllerSrc).toContain('regularFare: quote.regularFare');
    expect(controllerSrc).toContain('airportFee: quote.airportFee');
    expect(controllerSrc).toContain('currency: quote.currency');
    expect(controllerSrc).toContain('airport: quote.airport');
    expect(controllerSrc).not.toContain('passengerTotalUsd');
    expect(controllerSrc).not.toContain('convertedFare');
  });
});

describe('USD airport detection TESTUS', () => {
  beforeEach(() => {
    mockListActiveAirports.mockResolvedValue([{ ...TESTUS_AIRPORT }]);
  });

  it('classifies pickup inside TESTUS', async () => {
    const result = await detectAirportTrip({
      pickupLatitude: INSIDE_TESTUS.latitude,
      pickupLongitude: INSIDE_TESTUS.longitude,
      dropoffLatitude: OUTSIDE_TESTUS.latitude,
      dropoffLongitude: OUTSIDE_TESTUS.longitude,
      transactionCurrency: 'USD',
    });
    expect(result.airportCode).toBe('TESTUS');
    expect(result.tripType).toBe('pickup');
    expect(result.feeMinor).toBe(500);
    expect(result.currencyMismatch).toBe(false);
  });

  it('regular ride outside TESTUS has fee 0', async () => {
    const result = await detectAirportTrip({
      pickupLatitude: OUTSIDE_TESTUS.latitude,
      pickupLongitude: OUTSIDE_TESTUS.longitude,
      dropoffLatitude: 32.91,
      dropoffLongitude: -117.04,
      transactionCurrency: 'USD',
    });
    expect(result.tripType).toBeNull();
    expect(result.feeMinor).toBe(0);
    expect(result.airportId).toBeNull();
  });
});

describe('USD QA source guards', () => {
  const files = [
    'src/services/fare.service.ts',
    'src/services/payment.service.ts',
    'src/services/stripePaymentIntent.service.ts',
    'src/services/stripeCapture.service.ts',
    'src/services/settlement.service.ts',
    'src/services/cashPayment.service.ts',
  ];

  it('T. no FX conversion in payment/fare/settlement path', () => {
    for (const file of files) {
      const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
      expect(src).not.toMatch(/exchangeRate|fxConvert|convertCurrency|spotRate/i);
    }
  });

  it('U. no SAN-specific payment logic', () => {
    for (const file of files) {
      const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
      expect(src).not.toMatch(/\bSAN\b|\bLAX\b|\bJFK\b|\bDAC\b|\bTESTUS\b/);
    }
  });

  it('M. settlement claim does not write a Stripe Transfer', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/services/settlement.service.ts'),
      'utf8'
    );
    expect(src).not.toMatch(/transfers\.create|providerTransferId:/);
    expect(src).toContain('No Stripe Transfer is created here');
  });

  it('TESTUS is a test fixture only and is not seeded in migrations', () => {
    const migrationsDir = path.join(__dirname, '../src/db/migrations');
    const sqlFiles = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'));
    for (const name of sqlFiles) {
      const sql = fs.readFileSync(path.join(migrationsDir, name), 'utf8');
      expect(sql).not.toContain('TESTUS');
    }
    const marketSql = fs.readFileSync(
      path.join(migrationsDir, '0031_ride_markets_and_booking_currency.sql'),
      'utf8'
    );
    expect(marketSql).toContain('Do not copy them to US');
  });
});

describe('passenger booking fare currency', () => {
  it('X. passenger ride snapshot uses booking currency USD', () => {
    const detail = {
      booking: {
        id: BOOKING_ID,
        status: 'completed',
        bookingNumber: 'RYD-US-1001',
        pickupLatitude: '32.80000000',
        pickupLongitude: '-117.15000000',
        pickupAddress: 'TESTUS pickup',
        pickupSpotLabel: null,
        dropoffLatitude: '32.90000000',
        dropoffLongitude: '-117.05000000',
        dropoffAddress: 'Downtown',
        dropoffPlaceId: null,
        serviceCategoryId: 'cat-regular',
        finalFare: '45.00',
        estimatedFare: '45.00',
        discountAmount: '0.00',
        currency: 'USD',
        routeEncodedPolyline: null,
        estimatedDistanceKm: '10.00',
        estimatedDurationMin: 20,
        assignedDriverId: null,
        createdAt: new Date('2026-09-11T09:00:00.000Z'),
        acceptedAt: null,
        arrivedAt: null,
        startedAt: null,
        completedAt: new Date('2026-09-11T11:00:00.000Z'),
        cancelledAt: null,
        cancelledBy: null,
        cancellationReason: null,
        schedulingType: 'instant',
        searchStartedAt: null,
      },
      serviceCode: 'regular',
      serviceName: 'Regular',
      driverName: null,
      driverPhone: null,
      vehiclePlate: null,
      vehicleMake: null,
      vehicleModel: null,
      vehicleColor: null,
      vehicleId: null,
      paymentMethodCode: 'card',
      paymentMethodName: 'Card',
      paymentStatus: 'paid',
      recordingAvailable: false,
      customerName: 'Test Passenger',
      customerEmail: 'passenger@example.com',
      driverVehicleColor: null,
    };
    const snapshot = formatPassengerHistory(detail as unknown as Parameters<typeof formatPassengerHistory>[0]);
    expect(snapshot.fare.currency).toBe('USD');
    expect(snapshot.fare.amount).toBe(45);
  });
});
