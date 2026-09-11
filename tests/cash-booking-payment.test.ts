import fs from 'fs';
import path from 'path';
import {
  BookingPaymentStatus,
  PaymentMethodCode,
  PaymentProvider,
} from '../src/constants/payment';
import { majorToMinorUnits } from '../src/utils/money';

const mockFindBookingPaymentByBookingId = jest.fn();
const mockClaimCompletedCashPayment = jest.fn();

jest.mock('../src/repositories/bookingPayment.repository', () => ({
  findBookingPaymentByBookingId: (...args: unknown[]) => mockFindBookingPaymentByBookingId(...args),
  claimCompletedCashPayment: (...args: unknown[]) => mockClaimCompletedCashPayment(...args),
}));

const mockEnsureSettlement = jest.fn();

jest.mock('../src/services/settlement.service', () => ({
  ensureSettlementForCapturedPayment: (...args: unknown[]) => mockEnsureSettlement(...args),
}));

jest.mock('../src/middleware/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import { recordCompletedCashBookingPayment } from '../src/services/cashPayment.service';

const BOOKING_ID = '22222222-2222-2222-2222-222222222222';
const PAYMENT_ID = '11111111-1111-1111-1111-111111111111';
const COMPLETED_AT = new Date('2026-09-01T17:25:16.511Z');

describe('recordCompletedCashBookingPayment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindBookingPaymentByBookingId.mockResolvedValue(null);
    mockEnsureSettlement.mockResolvedValue(null);
    mockClaimCompletedCashPayment.mockImplementation(async (values: Record<string, unknown>) => ({
      id: PAYMENT_ID,
      ...values,
    }));
  });

  it('I. completed cash ledger creates a settlement (no Stripe)', async () => {
    await recordCompletedCashBookingPayment({
      bookingId: BOOKING_ID,
      finalFare: '249.37',
      completedAt: COMPLETED_AT,
    });
    expect(mockEnsureSettlement).toHaveBeenCalledWith(BOOKING_ID);
  });

  it('creates a cash ledger row from bookings.final_fare in minor units', async () => {
    const row = await recordCompletedCashBookingPayment({
      bookingId: BOOKING_ID,
      finalFare: '249.37',
      completedAt: COMPLETED_AT,
    });

    expect(mockClaimCompletedCashPayment).toHaveBeenCalledTimes(1);
    expect(mockClaimCompletedCashPayment).toHaveBeenCalledWith({
      bookingId: BOOKING_ID,
      paymentMethod: PaymentMethodCode.CASH,
      currency: 'BDT',
      grossAmount: majorToMinorUnits('249.37'),
      provider: PaymentProvider.CASH,
      status: BookingPaymentStatus.CAPTURED,
      capturedAt: COMPLETED_AT,
    });
    expect(row?.paymentMethod).toBe(PaymentMethodCode.CASH);
    expect(row?.provider).toBe(PaymentProvider.CASH);
    expect(row?.status).toBe(BookingPaymentStatus.CAPTURED);
    expect(row?.grossAmount).toBe(24937);
    expect(row?.currency).toBe('BDT');
  });

  it('O. U.S. cash ledger uses the booking currency USD', async () => {
    const row = await recordCompletedCashBookingPayment({
      bookingId: BOOKING_ID,
      finalFare: '45.00',
      currency: 'USD',
      completedAt: COMPLETED_AT,
    });
    expect(mockClaimCompletedCashPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: 'USD',
        grossAmount: 4500,
      })
    );
    expect(row?.currency).toBe('USD');
  });

  it('does not insert a second row when a cash ledger already exists', async () => {
    const existing = {
      id: PAYMENT_ID,
      bookingId: BOOKING_ID,
      paymentMethod: PaymentMethodCode.CASH,
      provider: PaymentProvider.CASH,
      status: BookingPaymentStatus.CAPTURED,
      grossAmount: 24937,
      currency: 'BDT',
    };
    mockFindBookingPaymentByBookingId.mockResolvedValue(existing);

    const row = await recordCompletedCashBookingPayment({
      bookingId: BOOKING_ID,
      finalFare: '999.00',
      completedAt: COMPLETED_AT,
    });

    expect(row).toEqual(existing);
    expect(mockClaimCompletedCashPayment).not.toHaveBeenCalled();
  });

  it('does not overwrite an existing card ledger row', async () => {
    const card = {
      id: PAYMENT_ID,
      bookingId: BOOKING_ID,
      paymentMethod: PaymentMethodCode.CARD,
      provider: PaymentProvider.STRIPE,
      status: BookingPaymentStatus.CAPTURED,
      grossAmount: 144235,
      currency: 'BDT',
    };
    mockFindBookingPaymentByBookingId.mockResolvedValue(card);

    const row = await recordCompletedCashBookingPayment({
      bookingId: BOOKING_ID,
      finalFare: '1442.35',
      completedAt: COMPLETED_AT,
    });

    expect(row).toEqual(card);
    expect(row?.paymentMethod).toBe(PaymentMethodCode.CARD);
    expect(mockClaimCompletedCashPayment).not.toHaveBeenCalled();
  });

  it('skips ledger insert when final_fare is missing or invalid so ride completion still succeeds', async () => {
    const missing = await recordCompletedCashBookingPayment({
      bookingId: BOOKING_ID,
      finalFare: null,
    });
    const invalid = await recordCompletedCashBookingPayment({
      bookingId: BOOKING_ID,
      finalFare: 'not-a-fare',
    });
    const zero = await recordCompletedCashBookingPayment({
      bookingId: BOOKING_ID,
      finalFare: '0.00',
    });

    expect(missing).toBeNull();
    expect(invalid).toBeNull();
    expect(zero).toBeNull();
    expect(mockClaimCompletedCashPayment).not.toHaveBeenCalled();
  });
});

describe('cash completion wiring', () => {
  it('records cash ledger after booking complete and never calls Stripe for cash', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/services/booking.service.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export async function updateBookingStatusByDriver'));
    expect(fn).toContain('recordCompletedCashBookingPayment');
    expect(fn).toMatch(/if \(!isCard\) \{\s*patch\.paymentStatus = 'paid'/);
    expect(fn).toMatch(
      /if \(newStatus === BookingStatus\.COMPLETED && !isCard\) \{\s*await recordCompletedCashBookingPayment/
    );
    expect(fn).not.toMatch(/getStripeClient/);
  });

  it('repository claim uses booking_id conflict so duplicates are impossible', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/repositories/bookingPayment.repository.ts'),
      'utf8'
    );
    expect(src).toContain('export async function claimCompletedCashPayment');
    expect(src).toContain('onConflictDoNothing({ target: bookingPayments.bookingId })');
  });

  it('does not invent a new booking_payments status', () => {
    const schema = fs.readFileSync(
      path.join(__dirname, '../src/db/schema/booking_payments.ts'),
      'utf8'
    );
    expect(schema).toContain(
      "'pending', 'requires_payment_method', 'requires_action', 'authorized', 'capture_pending', 'captured', 'failed', 'cancelled', 'refund_pending', 'refunded'"
    );
    expect(schema).not.toContain('collected');
    expect(schema).not.toContain('paid_cash');
  });
});
