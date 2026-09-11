import fs from 'fs';
import path from 'path';
import { BookingStatus } from '../src/constants/bookingStatus';
import { formatPassengerRideSnapshot } from '../src/services/rideHistory.service';
import type { RideHistoryRow } from '../src/repositories/booking.repository';
import { PaymentError } from '../src/services/payment.errors';

const mockFindByCode = jest.fn();
const mockListMarketFares = jest.fn();
const mockUpsertMarketFare = jest.fn();
const mockListCanonical = jest.fn();

jest.mock('../src/repositories/rideMarket.repository', () => ({
  findRideMarketByCode: (...args: unknown[]) => mockFindByCode(...args),
  findRideMarketByCountryCode: jest.fn(),
  listMarketFares: (...args: unknown[]) => mockListMarketFares(...args),
  listRideMarkets: jest.fn(),
  upsertMarketFare: (...args: unknown[]) => mockUpsertMarketFare(...args),
  listActiveRideMarkets: jest.fn(),
}));

jest.mock('../src/repositories/serviceCategory.repository', () => ({
  listCanonicalActiveServiceCategories: (...args: unknown[]) => mockListCanonical(...args),
}));

jest.mock('../src/middleware/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import {
  assertMarketPricingConfigured,
  getMarketFaresForAdmin,
  upsertMarketFaresForAdmin,
} from '../src/services/rideMarket.service';

const RIDE_ID = '59ab7ef9-0bb3-47c8-8afa-3313b295151e';
const BIKE_ID = 'd793ac30-c749-48b9-9c63-0b6b7d50289a';
const CNG_ID = '10ef8afd-7e45-4be2-97a4-00303a624cde';
const MOTO_ID = '264247c5-af89-4fcb-802a-d576791dc300';
const PREMIUM_ID = '2d7bcfdd-4343-4a07-b0df-214c807a8e87';
const COMFORT_ID = '9a9da7dd-f122-4e9c-a351-1c2ab6fe4e00';
const LEGACY_BIKE_ID = '0f28ee39-d7f0-450f-8fa8-a797e164e4e2';

const BD_MARKET = {
  id: 'aa038371-606e-4b1c-b95c-9ae095e29d75',
  code: 'BD',
  name: 'Bangladesh',
  countryCode: 'BD',
  currency: 'BDT',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const US_MARKET = {
  ...BD_MARKET,
  id: '57599676-fe79-47b5-88e1-88c5528dd9f8',
  code: 'US',
  name: 'United States',
  countryCode: 'US',
  currency: 'USD',
};

const BOOKABLE = [
  { id: RIDE_ID, code: 'ride', name: 'Ride' },
  { id: BIKE_ID, code: 'bike', name: 'Bike' },
  { id: CNG_ID, code: 'cng', name: 'CNG' },
  { id: MOTO_ID, code: 'moto', name: 'Moto' },
  { id: PREMIUM_ID, code: 'premium', name: 'Premium' },
  { id: COMFORT_ID, code: 'comfort', name: 'Comfort' },
];

const BD_FARES = [
  {
    id: 'fare-ride',
    marketId: BD_MARKET.id,
    serviceCategoryId: RIDE_ID,
    baseFare: '50.00',
    perKmRate: '25.00',
    minFare: '80.00',
  },
  {
    id: 'fare-bike',
    marketId: BD_MARKET.id,
    serviceCategoryId: BIKE_ID,
    baseFare: '30.00',
    perKmRate: '15.00',
    minFare: '50.00',
  },
  {
    id: 'fare-legacy',
    marketId: BD_MARKET.id,
    serviceCategoryId: LEGACY_BIKE_ID,
    baseFare: '30.00',
    perKmRate: '15.00',
    minFare: '50.00',
  },
  {
    id: 'fare-cng',
    marketId: BD_MARKET.id,
    serviceCategoryId: CNG_ID,
    baseFare: '40.00',
    perKmRate: '20.00',
    minFare: '70.00',
  },
  {
    id: 'fare-moto',
    marketId: BD_MARKET.id,
    serviceCategoryId: MOTO_ID,
    baseFare: '35.00',
    perKmRate: '18.00',
    minFare: '55.00',
  },
  {
    id: 'fare-premium',
    marketId: BD_MARKET.id,
    serviceCategoryId: PREMIUM_ID,
    baseFare: '120.00',
    perKmRate: '45.00',
    minFare: '200.00',
  },
  {
    id: 'fare-comfort',
    marketId: BD_MARKET.id,
    serviceCategoryId: COMFORT_ID,
    baseFare: '80.00',
    perKmRate: '35.00',
    minFare: '150.00',
  },
];

describe('admin market fare catalog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListCanonical.mockResolvedValue(BOOKABLE);
    mockFindByCode.mockImplementation(async (code: string) => {
      if (code === 'BD') return BD_MARKET;
      if (code === 'US') return US_MARKET;
      return null;
    });
  });

  it('A/E. current bookable categories appear in BD market fare config', async () => {
    mockListMarketFares.mockResolvedValue(BD_FARES);
    const result = await getMarketFaresForAdmin('BD');
    expect(result.fares).toHaveLength(6);
    expect(result.fares.map((row) => row.code)).toEqual([
      'ride',
      'bike',
      'cng',
      'moto',
      'premium',
      'comfort',
    ]);
    expect(result.fares.map((row) => row.name)).toEqual([
      'Ride',
      'Bike',
      'CNG',
      'Moto',
      'Premium',
      'Comfort',
    ]);
  });

  it('B/G. historical/inactive categories do not appear as editable current fares', async () => {
    mockListMarketFares.mockResolvedValue(BD_FARES);
    const result = await getMarketFaresForAdmin('BD');
    expect(result.fares.some((row) => row.serviceCategoryId === LEGACY_BIKE_ID)).toBe(false);
    expect(result.fares.some((row) => /[0-9a-f]{8}-[0-9a-f]{4}/i.test(row.name))).toBe(false);
    expect(JSON.stringify(result.fares)).not.toContain(LEGACY_BIKE_ID);
  });

  it('H. existing category fare amounts are preserved for valid categories', async () => {
    mockListMarketFares.mockResolvedValue(BD_FARES);
    const result = await getMarketFaresForAdmin('BD');
    const ride = result.fares.find((row) => row.code === 'ride');
    expect(ride).toMatchObject({
      serviceCategoryId: RIDE_ID,
      baseFare: '50.00',
      perKmRate: '25.00',
      minFare: '80.00',
    });
  });

  it('F. US uses the same current category catalog', async () => {
    mockListMarketFares.mockResolvedValue([]);
    const result = await getMarketFaresForAdmin('US');
    expect(result.fares).toHaveLength(6);
    expect(result.fares.map((row) => row.serviceCategoryId)).toEqual(BOOKABLE.map((row) => row.id));
    expect(result.fares.every((row) => row.baseFare === null)).toBe(true);
  });

  it('rejects configuring fares for a historical/orphan category', async () => {
    await expect(
      upsertMarketFaresForAdmin('BD', [
        {
          serviceCategoryId: LEGACY_BIKE_ID,
          baseFare: '30.00',
          perKmRate: '15.00',
          minFare: '50.00',
        },
      ])
    ).rejects.toMatchObject({ code: 'SERVICE_CATEGORY_NOT_BOOKABLE' });
    expect(mockUpsertMarketFare).not.toHaveBeenCalled();
  });

  it('legacy fare rows alone do not count as market pricing configured', async () => {
    mockListMarketFares.mockResolvedValue([
      {
        serviceCategoryId: LEGACY_BIKE_ID,
        baseFare: '30.00',
        perKmRate: '15.00',
        minFare: '50.00',
      },
    ]);
    await expect(assertMarketPricingConfigured(BD_MARKET.id)).rejects.toBeInstanceOf(PaymentError);
  });
});

describe('historical booking and payment safety', () => {
  it('C. historical bookings remain readable with a deactivated category id', () => {
    const detail = {
      booking: {
        id: '11111111-1111-1111-1111-111111111111',
        bookingNumber: 'RYD-LEGACY',
        customerId: 'cust-1',
        serviceCategoryId: LEGACY_BIKE_ID,
        status: BookingStatus.COMPLETED,
        schedulingType: 'instant',
        scheduledPickupAt: null,
        pickupLatitude: '23.81',
        pickupLongitude: '90.41',
        pickupAddress: 'Gulshan',
        pickupSpotLabel: null,
        dropoffLatitude: '23.75',
        dropoffLongitude: '90.38',
        dropoffAddress: 'Dhanmondi',
        dropoffPlaceId: null,
        estimatedDistanceKm: '5.00',
        estimatedDurationMin: 12,
        estimatedFare: '80.00',
        originalFare: '80.00',
        promotionId: null,
        discountAmount: '0.00',
        finalFare: '80.00',
        currency: 'BDT',
        paymentMethodId: 'pay-1',
        paymentStatus: 'paid',
        assignedDriverId: null,
        assignedVehicleId: null,
        linkedTripId: null,
        driverEtaMinutes: null,
        recordingConsentedAt: null,
        recordingConsentStatus: null,
        recordingConsentRevokedAt: null,
        recordingConsentVersion: null,
        searchStartedAt: null,
        acceptedAt: null,
        arrivedAt: null,
        startedAt: null,
        completedAt: new Date('2026-08-01T10:40:00.000Z'),
        cancelledAt: null,
        cancelledBy: null,
        cancellationReason: null,
        shareToken: 'share',
        routeEncodedPolyline: null,
        dispatchBatch: null,
        createdAt: new Date('2026-08-01T10:00:00.000Z'),
        updatedAt: new Date('2026-08-01T10:40:00.000Z'),
      },
      customerName: 'Rahim',
      customerEmail: 'rahim@example.com',
      driverName: null,
      driverPhone: null,
      driverVehicleColor: null,
      vehicleId: null,
      vehicleMake: null,
      vehicleModel: null,
      vehicleColor: null,
      vehiclePlate: null,
      serviceName: 'Bike f1eadf32',
      serviceCode: 'BIKE-15f7b27f',
      paymentMethodCode: 'cash',
      paymentMethodName: 'Cash',
      recordingAvailable: false,
    };
    const snapshot = formatPassengerRideSnapshot(detail as unknown as RideHistoryRow);
    expect(snapshot.id).toBe(detail.booking.id);
    expect(snapshot.service.serviceCategoryId).toBe(LEGACY_BIKE_ID);
    expect(snapshot.fare.amount).toBe(80);
    expect(snapshot.fare.currency).toBe('BDT');
  });

  it('D. payments and settlements have no service_category_id to rewrite', () => {
    const paymentSrc = fs.readFileSync(
      path.join(__dirname, '../src/db/schema/booking_payments.ts'),
      'utf8'
    );
    const settlementSrc = fs.readFileSync(
      path.join(__dirname, '../src/db/schema/booking_settlements.ts'),
      'utf8'
    );
    expect(paymentSrc).not.toMatch(/serviceCategoryId|service_category_id/);
    expect(settlementSrc).not.toMatch(/serviceCategoryId|service_category_id/);
  });
});

describe('migration 0031 BD fare seed', () => {
  it('copied every service_categories row into BD without is_active filter', () => {
    const sql = fs.readFileSync(
      path.join(__dirname, '../src/db/migrations/0031_ride_markets_and_booking_currency.sql'),
      'utf8'
    );
    expect(sql).toContain('JOIN "service_categories" c ON true');
    expect(sql).toContain('WHERE m.code = \'BD\'');
    expect(sql).not.toMatch(/c\.is_active\s*=\s*true/);
    expect(sql).toContain('Do not copy them to US');
  });
});
