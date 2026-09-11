import fs from 'fs';
import path from 'path';
import { BookingPaymentStatus, PaymentMethodCode, SettlementStatus } from '../src/constants/payment';
import { allocateCommissionableByPercentages, percentageToScaled } from '../src/utils/money';
import {
  calculateSettlement,
  ensureSettlementForCapturedPayment,
} from '../src/services/settlement.service';
import {
  parseSettlementPercentages,
  toSettlementSettingsView,
  updateActiveSettlementSettings,
  type ActiveSettlementSettings,
} from '../src/services/settlementSettings.service';
import { SettlementSettingsError } from '../src/services/payment.errors';

const mockFindActive = jest.fn();
const mockFindLatestVersion = jest.fn();
const mockInsertSettings = jest.fn();
const mockReplaceActive = jest.fn();
const mockFindPayment = jest.fn();
const mockFindSettlement = jest.fn();
const mockClaimSettlement = jest.fn();
const mockFindBooking = jest.fn();

jest.mock('../src/repositories/settlementSettings.repository', () => ({
  findActiveSettlementSettings: (...args: unknown[]) => mockFindActive(...args),
  findLatestSettlementSettingsVersion: (...args: unknown[]) => mockFindLatestVersion(...args),
  insertSettlementSettings: (...args: unknown[]) => mockInsertSettings(...args),
  replaceActiveSettlementSettings: (...args: unknown[]) => mockReplaceActive(...args),
}));

jest.mock('../src/repositories/bookingPayment.repository', () => ({
  findBookingPaymentByBookingId: (...args: unknown[]) => mockFindPayment(...args),
  findBookingSettlementByBookingId: (...args: unknown[]) => mockFindSettlement(...args),
  claimBookingSettlement: (...args: unknown[]) => mockClaimSettlement(...args),
}));

jest.mock('../src/repositories/booking.repository', () => ({
  findBookingById: (...args: unknown[]) => mockFindBooking(...args),
}));

jest.mock('../src/middleware/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

const BOOKING_ID = '22222222-2222-2222-2222-222222222222';
const PAYMENT_ID = '11111111-1111-1111-1111-111111111111';

function defaultSettings(overrides: Partial<ActiveSettlementSettings> = {}): ActiveSettlementSettings {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    driverPercentage: '25.00',
    companyPercentage: '75.00',
    version: 1,
    updatedAt: new Date('2026-09-11T00:00:00.000Z'),
    ...overrides,
  };
}

describe('settlement percentage validation', () => {
  it('Y. default config parses as driver 25 + company 75', () => {
    const parsed = parseSettlementPercentages({
      driverPercentage: 25,
      companyPercentage: 75,
    });
    expect(parsed).toEqual({
      driverPercentage: '25.00',
      companyPercentage: '75.00',
    });
    expect(percentageToScaled(parsed.driverPercentage)).toBe(2500);
  });

  it('Y. percentages must total 100', () => {
    expect(() =>
      parseSettlementPercentages({
        driverPercentage: 25,
        companyPercentage: 80,
      })
    ).toThrow(SettlementSettingsError);
    const valid = parseSettlementPercentages({
      driverPercentage: 30,
      companyPercentage: 70,
    });
    expect(valid.driverPercentage).toBe('30.00');
    expect(valid.companyPercentage).toBe('70.00');
  });

  it('C. negative value is rejected', () => {
    expect(() =>
      parseSettlementPercentages({
        driverPercentage: -25,
        companyPercentage: 125,
      })
    ).toThrow(/negative|100/i);
  });

  it('D. decimal percentages that total 100 are accepted', () => {
    const parsed = parseSettlementPercentages({
      driverPercentage: 25.5,
      companyPercentage: 74.5,
    });
    expect(parsed).toEqual({
      driverPercentage: '25.50',
      companyPercentage: '74.50',
    });
  });
});

describe('settlement calculation', () => {
  it('W. non-airport gross 100000 splits 25000 / 75000 / 0', () => {
    const result = calculateSettlement({
      bookingId: BOOKING_ID,
      grossAmountMinor: 100000,
      currency: 'BDT',
      settings: defaultSettings(),
    });
    expect(result.driverAmount).toBe(25000);
    expect(result.platformAmount).toBe(75000);
    expect(result.airportFee).toBe(0);
    expect(result.commissionableFare).toBe(100000);
    expect(result.driverAmount + result.platformAmount + result.airportFee).toBe(100000);
  });

  it('O/P/Q. regular 4000 + airport 500 → driver 1000 company 3000 airport 500', () => {
    const result = calculateSettlement({
      bookingId: BOOKING_ID,
      grossAmountMinor: 4500,
      airportFeeMinor: 500,
      currency: 'BDT',
      settings: defaultSettings(),
    });
    expect(result.commissionableFare).toBe(4000);
    expect(result.driverAmount).toBe(1000);
    expect(result.platformAmount).toBe(3000);
    expect(result.airportFee).toBe(500);
    expect(result.driverAmount + result.platformAmount + result.airportFee).toBe(4500);
    expect(result.driverAmount).not.toBe(1125);
  });

  it('F. odd minor-unit amount reconciles exactly; remainder goes to company', () => {
    const result = calculateSettlement({
      bookingId: BOOKING_ID,
      grossAmountMinor: 100001,
      currency: 'BDT',
      settings: defaultSettings(),
    });
    expect(result.driverAmount).toBe(25000);
    expect(result.airportFee).toBe(0);
    expect(result.platformAmount).toBe(75001);
    expect(result.driverAmount + result.platformAmount + result.airportFee).toBe(100001);
  });

  it('uses integer allocation helper without binary float', () => {
    const allocated = allocateCommissionableByPercentages(4000, defaultSettings());
    expect(allocated).toEqual({ driverAmount: 1000, platformAmount: 3000 });
  });
});

describe('ensureSettlementForCapturedPayment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindSettlement.mockResolvedValue(null);
    mockFindBooking.mockResolvedValue({ id: BOOKING_ID, airportFeeAmount: '0.00' });
    mockFindActive.mockResolvedValue({
      id: defaultSettings().id,
      driverPercentage: '25.00',
      companyPercentage: '75.00',
      version: 1,
      isActive: true,
      updatedAt: defaultSettings().updatedAt,
      createdAt: defaultSettings().updatedAt,
    });
    mockClaimSettlement.mockImplementation(async (values: Record<string, unknown>) => ({
      id: '55555555-5555-5555-5555-555555555555',
      ...values,
    }));
  });

  it('T. captured card payment creates a pending settlement', async () => {
    mockFindPayment.mockResolvedValue({
      id: PAYMENT_ID,
      bookingId: BOOKING_ID,
      paymentMethod: PaymentMethodCode.CARD,
      status: BookingPaymentStatus.CAPTURED,
      grossAmount: 4500,
      currency: 'BDT',
    });
    mockFindBooking.mockResolvedValue({ id: BOOKING_ID, airportFeeAmount: '5.00' });

    const row = await ensureSettlementForCapturedPayment(BOOKING_ID);
    expect(mockClaimSettlement.mock.calls[0][0]).toMatchObject({
      status: SettlementStatus.PENDING,
      grossAmount: 4500,
      driverAmount: 1000,
      platformAmount: 3000,
      airportFee: 500,
      calculationVersion: '1',
      airportFeePercentage: null,
    });
    expect(row?.status).toBe(SettlementStatus.PENDING);
  });

  it('U. completed cash ledger creates skipped_cash settlement with same split', async () => {
    mockFindPayment.mockResolvedValue({
      id: PAYMENT_ID,
      bookingId: BOOKING_ID,
      paymentMethod: PaymentMethodCode.CASH,
      status: BookingPaymentStatus.CAPTURED,
      grossAmount: 4500,
      currency: 'BDT',
    });
    mockFindBooking.mockResolvedValue({ id: BOOKING_ID, airportFeeAmount: '5.00' });

    const row = await ensureSettlementForCapturedPayment(BOOKING_ID);
    expect(row?.status).toBe(SettlementStatus.SKIPPED_CASH);
    expect(mockClaimSettlement.mock.calls[0][0].driverAmount).toBe(1000);
    expect(mockClaimSettlement.mock.calls[0][0].airportFee).toBe(500);
  });

  it('G. settlement creation is idempotent', async () => {
    const existing = {
      id: '55555555-5555-5555-5555-555555555555',
      bookingId: BOOKING_ID,
      status: SettlementStatus.PENDING,
      driverAmount: 1000,
      calculationVersion: '1',
    };
    mockFindSettlement.mockResolvedValue(existing);
    const row = await ensureSettlementForCapturedPayment(BOOKING_ID);
    expect(row).toEqual(existing);
    expect(mockClaimSettlement).not.toHaveBeenCalled();
  });

  it('Z. existing settlement keeps old version/amount after settings would change', async () => {
    mockFindSettlement.mockResolvedValue({
      id: '55555555-5555-5555-5555-555555555555',
      bookingId: BOOKING_ID,
      status: SettlementStatus.PENDING,
      driverAmount: 1000,
      platformAmount: 3000,
      airportFee: 500,
      calculationVersion: '1',
      driverPercentage: '25.00',
      companyPercentage: '75.00',
    });
    mockFindActive.mockResolvedValue({
      ...defaultSettings(),
      driverPercentage: '30.00',
      companyPercentage: '70.00',
      version: 2,
    });
    const row = await ensureSettlementForCapturedPayment(BOOKING_ID);
    expect(row?.calculationVersion).toBe('1');
    expect(row?.driverAmount).toBe(1000);
    expect(mockClaimSettlement).not.toHaveBeenCalled();
  });
});

describe('settings versioning helper', () => {
  it('M. Admin update increments version and snapshots new percentages', async () => {
    mockFindActive.mockResolvedValue({
      id: defaultSettings().id,
      driverPercentage: '25.00',
      companyPercentage: '75.00',
      version: 1,
      isActive: true,
      updatedAt: defaultSettings().updatedAt,
      createdAt: defaultSettings().updatedAt,
    });
    mockFindLatestVersion.mockResolvedValue(1);
    mockReplaceActive.mockImplementation(async (input: { next: Record<string, unknown> }) => ({
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      ...input.next,
      updatedAt: new Date('2026-09-11T01:00:00.000Z'),
    }));

    const view = await updateActiveSettlementSettings({
      driverPercentage: 30,
      companyPercentage: 70,
    });

    expect(mockReplaceActive).toHaveBeenCalledWith({
      currentId: defaultSettings().id,
      next: {
        driverPercentage: '30.00',
        companyPercentage: '70.00',
        version: 2,
        isActive: true,
      },
    });
    expect(view.version).toBe(2);
    expect(view).not.toHaveProperty('airportFeePercentage');
    expect(toSettlementSettingsView(defaultSettings()).driverPercentage).toBe('25.00');
  });
});

describe('migrations do not rewrite historical settlements', () => {
  it('0029 and 0030 do not update or delete booking_settlements', () => {
    const sql29 = fs.readFileSync(
      path.join(__dirname, '../src/db/migrations/0029_settlement_settings.sql'),
      'utf8'
    );
    const sql30 = fs.readFileSync(
      path.join(__dirname, '../src/db/migrations/0030_airports_and_commission_only.sql'),
      'utf8'
    );
    expect(sql29).not.toMatch(/UPDATE\s+"booking_settlements"/i);
    expect(sql30).not.toMatch(/UPDATE\s+"booking_settlements"/i);
    expect(sql30).toContain('DROP COLUMN IF EXISTS "airport_fee_percentage"');
    expect(sql30).toContain('settlement_settings_commission_total_check');
  });
});

describe('cash does not transfer', () => {
  it('X. settlement and cash modules never call Stripe Transfer', () => {
    const settlementSrc = fs.readFileSync(
      path.join(__dirname, '../src/services/settlement.service.ts'),
      'utf8'
    );
    const cashSrc = fs.readFileSync(
      path.join(__dirname, '../src/services/cashPayment.service.ts'),
      'utf8'
    );
    expect(settlementSrc).not.toMatch(/transfers\.create/);
    expect(settlementSrc).not.toMatch(/getStripeClient/);
    expect(cashSrc).not.toMatch(/transfers\.create/);
    expect(cashSrc).not.toMatch(/getStripeClient/);
  });
});
