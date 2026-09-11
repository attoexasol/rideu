import {
  BookingPaymentStatus,
  DriverPaymentRecordStatus,
  DriverSettlementRecordStatus,
  DriverTransferRecordStatus,
  SettlementStatus,
} from '../src/constants/payment';
import type { DriverPaymentHistoryRow } from '../src/repositories/driverPaymentHistory.repository';
import {
  assertNoSensitivePaymentFields,
  formatDriverPaymentHistoryDetail,
  formatDriverPaymentHistoryItem,
  formatDriverPaymentSummary,
  formatMoneyAmount,
  getDriverPaymentDetail,
  getDriverPaymentSummary,
  listDriverPayments,
  normalizePassengerPaymentStatus,
  normalizeSettlementStatus,
} from '../src/services/driverPaymentHistory.service';

const mockList = jest.fn();
const mockCount = jest.fn();
const mockFindItem = jest.fn();
const mockSumCaptured = jest.fn();
const mockSumDriverEarnings = jest.fn();
const mockCountSettlements = jest.fn();
const mockCountNotCreated = jest.fn();

jest.mock('../src/repositories/driverPaymentHistory.repository', () => ({
  listDriverPaymentHistory: (...args: unknown[]) => mockList(...args),
  countDriverPaymentHistory: (...args: unknown[]) => mockCount(...args),
  findDriverPaymentHistoryItem: (...args: unknown[]) => mockFindItem(...args),
  sumCapturedPassengerPaymentsByCurrency: (...args: unknown[]) => mockSumCaptured(...args),
  sumCalculatedDriverEarningsByCurrency: (...args: unknown[]) => mockSumDriverEarnings(...args),
  countSettlementsByStatusForDriver: (...args: unknown[]) => mockCountSettlements(...args),
  countHistoryRowsWithoutSettlement: (...args: unknown[]) => mockCountNotCreated(...args),
}));

const DRIVER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const DRIVER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PAYMENT_A = '11111111-1111-1111-1111-111111111111';
const BOOKING_A = '22222222-2222-2222-2222-222222222222';
const PAYMENT_B = '33333333-3333-3333-3333-333333333333';

function historyRow(overrides: Partial<DriverPaymentHistoryRow> = {}): DriverPaymentHistoryRow {
  return {
    paymentId: PAYMENT_A,
    paymentMethod: 'card',
    paymentCurrency: 'BDT',
    paymentGrossAmount: 4500,
    paymentStatus: BookingPaymentStatus.CAPTURED,
    paymentAuthorizedAt: new Date('2026-09-01T10:00:00.000Z'),
    paymentCapturedAt: new Date('2026-09-01T11:00:00.000Z'),
    paymentFailedAt: null,
    paymentRefundedAt: null,
    paymentFailureCode: null,
    paymentFailureMessage: null,
    paymentCreatedAt: new Date('2026-09-01T09:00:00.000Z'),
    catalogPaymentMethodCode: 'card',
    bookingId: BOOKING_A,
    bookingNumber: 'RYD-1001',
    bookingStatus: 'completed',
    bookingCompletedAt: new Date('2026-09-01T10:55:00.000Z'),
    pickupAddress: 'Airport Rd',
    pickupLatitude: '23.81030000',
    pickupLongitude: '90.41250000',
    pickupSpotLabel: 'Gate 2',
    dropoffAddress: 'Gulshan 1',
    dropoffLatitude: '23.78080000',
    dropoffLongitude: '90.41690000',
    serviceName: 'Sedan',
    serviceCode: 'sedan',
    settlementId: null,
    settlementStatus: null,
    settlementGrossAmount: null,
    settlementDriverAmount: null,
    settlementPlatformAmount: null,
    settlementAirportFee: null,
    settlementCurrency: null,
    settlementCreatedAt: null,
    settlementUpdatedAt: null,
    ...overrides,
  };
}

describe('driver payment history normalization', () => {
  it.each([
    BookingPaymentStatus.PENDING,
    BookingPaymentStatus.REQUIRES_PAYMENT_METHOD,
    BookingPaymentStatus.REQUIRES_ACTION,
    BookingPaymentStatus.AUTHORIZED,
    BookingPaymentStatus.CAPTURE_PENDING,
    BookingPaymentStatus.CAPTURED,
    BookingPaymentStatus.FAILED,
    BookingPaymentStatus.CANCELLED,
    BookingPaymentStatus.REFUND_PENDING,
    BookingPaymentStatus.REFUNDED,
  ])('preserves ledger status %s', (status) => {
    expect(normalizePassengerPaymentStatus(status)).toBe(status);
  });

  it('maps missing payment row to not_recorded', () => {
    expect(normalizePassengerPaymentStatus(null)).toBe(DriverPaymentRecordStatus.NOT_RECORDED);
  });

  it.each([
    SettlementStatus.UNRESOLVED,
    SettlementStatus.PENDING,
    SettlementStatus.PROCESSING,
    SettlementStatus.SETTLED,
    SettlementStatus.FAILED,
    SettlementStatus.SKIPPED_CASH,
  ])('preserves settlement status %s', (status) => {
    expect(normalizeSettlementStatus(status)).toBe(status);
  });

  it('maps missing settlement row to not_created', () => {
    expect(normalizeSettlementStatus(null)).toBe(DriverSettlementRecordStatus.NOT_CREATED);
  });
});

describe('driver payment history item mapping', () => {
  it('A. completed card ride + captured payment does not claim driver pay', () => {
    const item = formatDriverPaymentHistoryItem(historyRow());
    expect(item.ride.status).toBe('completed');
    expect(item.passengerPayment.status).toBe(BookingPaymentStatus.CAPTURED);
    expect(item.passengerPayment.amount).toEqual({
      minor: 4500,
      formatted: '45.00',
      currency: 'BDT',
    });
    expect(item.settlement.status).toBe(DriverSettlementRecordStatus.NOT_CREATED);
    expect(item.settlement.driverAmount).toBeNull();
    expect(item.settlement.platformAmount).toBeNull();
    expect(item.settlement.airportFee).toBeNull();
    expect(item.settlement.settledAt).toBeNull();
    expect(item.transfer.status).toBe(DriverTransferRecordStatus.NOT_STARTED);
    expect(item.transfer.transferredAt).toBeNull();
    expect(JSON.stringify(item)).not.toMatch(/driver earnings|totalEarnings|paidToDriver/i);
  });

  it('B. authorized but not captured stays authorized', () => {
    const item = formatDriverPaymentHistoryItem(
      historyRow({
        paymentStatus: BookingPaymentStatus.AUTHORIZED,
        paymentCapturedAt: null,
        bookingStatus: 'in_progress',
        bookingCompletedAt: null,
      })
    );
    expect(item.passengerPayment.status).toBe(BookingPaymentStatus.AUTHORIZED);
    expect(item.passengerPayment.capturedAt).toBeNull();
    expect(item.transfer.status).toBe(DriverTransferRecordStatus.NOT_STARTED);
  });

  it('C. capture_pending is not collapsed to captured', () => {
    const item = formatDriverPaymentHistoryItem(
      historyRow({
        paymentStatus: BookingPaymentStatus.CAPTURE_PENDING,
        paymentCapturedAt: null,
      })
    );
    expect(item.passengerPayment.status).toBe(BookingPaymentStatus.CAPTURE_PENDING);
  });

  it('D. failed and cancelled stay distinct', () => {
    expect(
      formatDriverPaymentHistoryItem(
        historyRow({
          paymentStatus: BookingPaymentStatus.FAILED,
          paymentFailureCode: 'card_declined',
          paymentFailureMessage: 'Your card was declined',
        })
      ).passengerPayment.status
    ).toBe(BookingPaymentStatus.FAILED);
    expect(
      formatDriverPaymentHistoryItem(historyRow({ paymentStatus: BookingPaymentStatus.CANCELLED }))
        .passengerPayment.status
    ).toBe(BookingPaymentStatus.CANCELLED);
  });

  it('E. refunded and refund_pending stay distinct', () => {
    expect(
      formatDriverPaymentHistoryItem(historyRow({ paymentStatus: BookingPaymentStatus.REFUNDED }))
        .passengerPayment.status
    ).toBe(BookingPaymentStatus.REFUNDED);
    expect(
      formatDriverPaymentHistoryItem(
        historyRow({ paymentStatus: BookingPaymentStatus.REFUND_PENDING })
      ).passengerPayment.status
    ).toBe(BookingPaymentStatus.REFUND_PENDING);
  });

  it('F. cash ride uses cash method and does not invent Stripe capture', () => {
    const item = formatDriverPaymentHistoryItem(
      historyRow({
        paymentId: null,
        paymentMethod: null,
        paymentCurrency: null,
        paymentGrossAmount: null,
        paymentStatus: null,
        paymentCapturedAt: null,
        catalogPaymentMethodCode: 'cash',
      })
    );
    expect(item.id).toBe(BOOKING_A);
    expect(item.paymentRecordId).toBeNull();
    expect(item.passengerPayment.methodCode).toBe('cash');
    expect(item.passengerPayment.status).toBe(DriverPaymentRecordStatus.NOT_RECORDED);
    expect(item.passengerPayment.amount).toBeNull();
    expect(item.passengerPayment.capturedAt).toBeNull();
  });

  it('cancelled cash without ledger stays not_recorded with null amount', () => {
    const item = formatDriverPaymentHistoryItem(
      historyRow({
        paymentId: null,
        paymentMethod: null,
        paymentCurrency: null,
        paymentGrossAmount: null,
        paymentStatus: null,
        paymentCapturedAt: null,
        catalogPaymentMethodCode: 'cash',
        bookingStatus: 'cancelled',
        bookingCompletedAt: null,
      })
    );
    expect(item.passengerPayment.methodCode).toBe('cash');
    expect(item.passengerPayment.status).toBe(DriverPaymentRecordStatus.NOT_RECORDED);
    expect(item.passengerPayment.amount).toBeNull();
    expect(item.ride.status).toBe('cancelled');
  });

  it('new completed cash ledger row returns authoritative amount', () => {
    const item = formatDriverPaymentHistoryItem(
      historyRow({
        paymentId: PAYMENT_A,
        paymentMethod: 'cash',
        catalogPaymentMethodCode: 'cash',
        paymentCurrency: 'BDT',
        paymentGrossAmount: 24937,
        paymentStatus: BookingPaymentStatus.CAPTURED,
        paymentCapturedAt: new Date('2026-09-01T17:25:16.511Z'),
      })
    );
    expect(item.id).toBe(PAYMENT_A);
    expect(item.paymentRecordId).toBe(PAYMENT_A);
    expect(item.passengerPayment.methodCode).toBe('cash');
    expect(item.passengerPayment.status).toBe(BookingPaymentStatus.CAPTURED);
    expect(item.passengerPayment.amount).toEqual({
      minor: 24937,
      formatted: '249.37',
      currency: 'BDT',
    });
    expect(item.settlement.status).toBe(DriverSettlementRecordStatus.NOT_CREATED);
    expect(item.transfer.status).toBe(DriverTransferRecordStatus.NOT_STARTED);
  });

  it('F. cash ledger row with skipped_cash settlement is preserved', () => {
    const item = formatDriverPaymentHistoryItem(
      historyRow({
        paymentMethod: 'cash',
        catalogPaymentMethodCode: 'cash',
        paymentStatus: BookingPaymentStatus.PENDING,
        paymentCapturedAt: null,
        settlementId: '55555555-5555-5555-5555-555555555555',
        settlementStatus: SettlementStatus.SKIPPED_CASH,
        settlementCurrency: 'BDT',
        settlementGrossAmount: 4500,
        settlementDriverAmount: null,
        settlementPlatformAmount: null,
      })
    );
    expect(item.passengerPayment.methodCode).toBe('cash');
    expect(item.settlement.status).toBe(SettlementStatus.SKIPPED_CASH);
    expect(item.transfer.status).toBe(DriverTransferRecordStatus.NOT_STARTED);
  });

  it('G. missing settlement is not_created, not settled', () => {
    const item = formatDriverPaymentHistoryItem(historyRow({ settlementId: null, settlementStatus: null }));
    expect(item.settlement.status).toBe(DriverSettlementRecordStatus.NOT_CREATED);
    expect(item.settlement.status).not.toBe(SettlementStatus.SETTLED);
  });

  it('H. unresolved settlement is exposed as unresolved', () => {
    const item = formatDriverPaymentHistoryItem(
      historyRow({
        settlementId: '55555555-5555-5555-5555-555555555555',
        settlementStatus: SettlementStatus.UNRESOLVED,
        settlementCurrency: 'BDT',
        settlementGrossAmount: 4500,
        settlementDriverAmount: null,
        settlementPlatformAmount: null,
        settlementAirportFee: null,
      })
    );
    expect(item.settlement.status).toBe(SettlementStatus.UNRESOLVED);
  });

  it('O. settlement amounts appear on history once a settlement row exists', () => {
    const item = formatDriverPaymentHistoryItem(
      historyRow({
        settlementId: '55555555-5555-5555-5555-555555555555',
        settlementStatus: SettlementStatus.PENDING,
        settlementCurrency: 'BDT',
        settlementGrossAmount: 100000,
        settlementDriverAmount: 25000,
        settlementPlatformAmount: 75000,
        settlementAirportFee: 0,
      })
    );
    expect(item.settlement.status).toBe(SettlementStatus.PENDING);
    expect(item.settlement.driverAmount).toEqual({
      minor: 25000,
      formatted: '250.00',
      currency: 'BDT',
    });
    expect(item.settlement.platformAmount).toEqual({
      minor: 75000,
      formatted: '750.00',
      currency: 'BDT',
    });
    expect(item.settlement.airportFee).toEqual({
      minor: 0,
      formatted: '0.00',
      currency: 'BDT',
    });
    expect(item.transfer.status).toBe(DriverTransferRecordStatus.NOT_STARTED);
  });

  it('I. null driver/platform/airport amounts stay null', () => {
    const item = formatDriverPaymentHistoryItem(
      historyRow({
        settlementId: '55555555-5555-5555-5555-555555555555',
        settlementStatus: SettlementStatus.UNRESOLVED,
        settlementCurrency: 'BDT',
        settlementDriverAmount: null,
        settlementPlatformAmount: null,
        settlementAirportFee: null,
      })
    );
    expect(item.settlement.driverAmount).toBeNull();
    expect(item.settlement.platformAmount).toBeNull();
    expect(item.settlement.airportFee).toBeNull();
  });

  it('P. mapped payloads never include Stripe secrets or client_secret', () => {
    const detail = formatDriverPaymentHistoryDetail(
      historyRow({
        paymentFailureMessage: 'card_declined',
      })
    );
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain('client_secret');
    expect(serialized).not.toContain('clientSecret');
    expect(serialized).not.toContain('sk_test');
    expect(serialized).not.toContain('sk_live');
    expect(serialized).not.toContain('providerPaymentIntentId');
    expect(serialized).not.toContain('providerChargeId');
    expect(serialized).not.toContain('providerTransferId');
    assertNoSensitivePaymentFields(detail);
  });
});

describe('driver payment history service queries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockList.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
    mockFindItem.mockResolvedValue(null);
    mockSumCaptured.mockResolvedValue([]);
    mockSumDriverEarnings.mockResolvedValue([]);
    mockCountSettlements.mockResolvedValue([]);
    mockCountNotCreated.mockResolvedValue(0);
  });

  it('J. pagination uses offset = (page-1)*limit for the authenticated driver only', async () => {
    mockList.mockResolvedValue([historyRow()]);
    mockCount.mockResolvedValue(21);
    const result = await listDriverPayments(DRIVER_A, 2, 10);
    expect(mockList).toHaveBeenCalledWith(DRIVER_A, 10, 10);
    expect(mockCount).toHaveBeenCalledWith(DRIVER_A);
    expect(result.total).toBe(21);
    expect(result.items).toHaveLength(1);
  });

  it('K. newest-first ordering is delegated to the repository query', async () => {
    const newer = historyRow({
      paymentId: PAYMENT_A,
      bookingCompletedAt: new Date('2026-09-08T12:00:00.000Z'),
    });
    const older = historyRow({
      paymentId: PAYMENT_B,
      bookingId: '44444444-4444-4444-4444-444444444444',
      bookingCompletedAt: new Date('2026-09-01T12:00:00.000Z'),
    });
    mockList.mockResolvedValue([newer, older]);
    mockCount.mockResolvedValue(2);
    const result = await listDriverPayments(DRIVER_A, 1, 20);
    expect(result.items[0].id).toBe(PAYMENT_A);
    expect(result.items[1].id).toBe(PAYMENT_B);
    expect(mockList).toHaveBeenCalledWith(DRIVER_A, 20, 0);
  });

  it('L. another driver cannot read a payment', async () => {
    mockFindItem.mockResolvedValue(null);
    const result = await getDriverPaymentDetail(DRIVER_B, PAYMENT_A);
    expect(result).toBeNull();
    expect(mockFindItem).toHaveBeenCalledWith(DRIVER_B, PAYMENT_A);
  });

  it('N. summary never labels captured gross or calculated share as paid earnings', async () => {
    mockSumCaptured.mockResolvedValue([{ currency: 'BDT', amountMinor: '100000', count: 1 }]);
    mockSumDriverEarnings.mockResolvedValue([{ currency: 'BDT', amountMinor: '25000', count: 1 }]);
    mockCountSettlements.mockResolvedValue([{ status: 'pending', count: 1 }]);
    mockCountNotCreated.mockResolvedValue(0);
    const summary = await getDriverPaymentSummary(DRIVER_A);
    expect(summary.driverEarningsAvailable).toBe(false);
    expect(summary).not.toHaveProperty('totalEarnings');
    expect(summary).not.toHaveProperty('paidToDriver');
    expect(summary).not.toHaveProperty('availableBalance');
    expect(summary.capturedPassengerPayments).toEqual([
      { minor: 100000, formatted: '1000.00', currency: 'BDT', count: 1 },
    ]);
    expect(summary.calculatedDriverEarnings).toEqual([
      { minor: 25000, formatted: '250.00', currency: 'BDT', count: 1 },
    ]);
    expect(summary.calculatedDriverEarnings[0].minor).not.toBe(100000);
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toMatch(/paidToDriver|paid-to-bank|availableBalance/i);
  });

  it('O. multiple currencies are not summed together', async () => {
    const summary = formatDriverPaymentSummary({
      capturedByCurrency: [
        { currency: 'BDT', amountMinor: '4500', count: 1 },
        { currency: 'USD', amountMinor: '1200', count: 1 },
      ],
      settlementByStatus: [],
      notCreatedCount: 2,
    });
    expect(summary.capturedPassengerPayments).toHaveLength(2);
    expect(summary.capturedPassengerPayments.find((row) => row.currency === 'BDT')?.minor).toBe(4500);
    expect(summary.capturedPassengerPayments.find((row) => row.currency === 'USD')?.minor).toBe(1200);
    const combined = summary.capturedPassengerPayments.reduce((sum, row) => sum + row.minor, 0);
    expect(combined).toBe(5700);
    expect(summary.capturedPassengerPayments.some((row) => row.minor === 5700)).toBe(false);
    expect(summary.calculatedDriverEarnings).toEqual([]);
    expect(summary.driverEarningsAvailable).toBe(false);
  });
});

describe('money formatting helpers', () => {
  it('returns null for missing minor amounts', () => {
    expect(formatMoneyAmount(null, 'BDT')).toBeNull();
    expect(formatMoneyAmount(4500, null)).toBeNull();
  });
});

describe('driver payment history repository query contract', () => {
  it('scopes list/count/detail to assignedDriverId and newest-first sort keys', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'src/repositories/driverPaymentHistory.repository.ts'),
      'utf8'
    );
    expect(src).toContain('eq(bookings.assignedDriverId, driverId)');
    expect(src).toContain('COALESCE(${bookings.completedAt}, ${bookingPayments.capturedAt}, ${bookingPayments.createdAt}, ${bookings.createdAt})');
    expect(src).toContain('COALESCE(${bookingPayments.id}, ${bookings.id})');
    expect(src).toContain('.limit(limit)');
    expect(src).toContain('.offset(offset)');
    expect(src).not.toContain('getStripeClient');
    expect(src).not.toContain('providerPaymentIntentId');
    expect(src).not.toContain('providerChargeId');
    expect(src).not.toContain('providerTransferId');
  });
});
