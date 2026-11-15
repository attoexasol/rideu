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

const ECONOMY_ID = 'a1111111-1111-1111-1111-111111111111';
const EXECUTIVE_ID = 'a2222222-2222-2222-2222-222222222222';
const SUV_ID = 'a3333333-3333-3333-3333-333333333333';
const VAN_ID = 'a4444444-4444-4444-4444-444444444444';
const MINIVAN_ID = 'a5555555-5555-5555-5555-555555555555';
const ADA_ID = 'a6666666-6666-6666-6666-666666666666';
const LEGACY_BIKE_ID = '0f28ee39-d7f0-450f-8fa8-a797e164e4e2';
const LEGACY_RIDE_ID = '59ab7ef9-0bb3-47c8-8afa-3313b295151e';

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
  { id: ECONOMY_ID, code: 'economy', name: 'Economy Sedan' },
  { id: EXECUTIVE_ID, code: 'executive', name: 'Executive Sedan' },
  { id: SUV_ID, code: 'suv', name: 'SUV' },
  { id: VAN_ID, code: 'van', name: 'Passenger Van' },
  { id: MINIVAN_ID, code: 'minivan', name: 'Mini-Van' },
  { id: ADA_ID, code: 'ada', name: 'ADA Accessible' },
];

const BD_FARES = [
  {
    id: 'fare-economy',
    marketId: BD_MARKET.id,
    serviceCategoryId: ECONOMY_ID,
    baseFare: '10.00',
    perKmRate: '2.00',
    minFare: '12.00',
  },
  {
    id: 'fare-executive',
    marketId: BD_MARKET.id,
    serviceCategoryId: EXECUTIVE_ID,
    baseFare: '20.00',
    perKmRate: '3.00',
    minFare: '25.00',
  },
  {
    id: 'fare-legacy-bike',
    marketId: BD_MARKET.id,
    serviceCategoryId: LEGACY_BIKE_ID,
    baseFare: '30.00',
    perKmRate: '15.00',
    minFare: '50.00',
  },
  {
    id: 'fare-legacy-ride',
    marketId: BD_MARKET.id,
    serviceCategoryId: LEGACY_RIDE_ID,
    baseFare: '50.00',
    perKmRate: '25.00',
    minFare: '80.00',
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
      'economy',
      'executive',
      'suv',
      'van',
      'minivan',
      'ada',
    ]);
    expect(result.fares.map((row) => row.name)).toEqual([
      'Economy Sedan',
      'Executive Sedan',
      'SUV',
      'Passenger Van',
      'Mini-Van',
      'ADA Accessible',
    ]);
  });

  it('B/G. historical/inactive categories do not appear as editable current fares', async () => {
    mockListMarketFares.mockResolvedValue(BD_FARES);
    const result = await getMarketFaresForAdmin('BD');
    expect(result.fares.some((row) => row.serviceCategoryId === LEGACY_BIKE_ID)).toBe(false);
    expect(result.fares.some((row) => row.serviceCategoryId === LEGACY_RIDE_ID)).toBe(false);
    expect(result.fares.some((row) => /[0-9a-f]{8}-[0-9a-f]{4}/i.test(row.name))).toBe(false);
    expect(JSON.stringify(result.fares)).not.toContain(LEGACY_BIKE_ID);
  });

  it('H. existing category fare amounts are preserved for valid categories', async () => {
    mockListMarketFares.mockResolvedValue(BD_FARES);
    const result = await getMarketFaresForAdmin('BD');
    const economy = result.fares.find((row) => row.code === 'economy');
    expect(economy).toMatchObject({
      serviceCategoryId: ECONOMY_ID,
      baseFare: '10.00',
      perKmRate: '2.00',
      minFare: '12.00',
    });
    const suv = result.fares.find((row) => row.code === 'suv');
    expect(suv).toMatchObject({
      serviceCategoryId: SUV_ID,
      baseFare: null,
      perKmRate: null,
      minFare: null,
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
