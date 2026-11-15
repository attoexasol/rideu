import fs from 'fs';
import path from 'path';
import { BookingPaymentStatus, FinancialIdempotencyKey, PaymentMethodCode } from '../src/constants/payment';
import {
  capturePayment,
  refundPayment,
  settleCompletedBooking,
} from '../src/services/payment.service';
import { calculateSettlement } from '../src/services/settlement.service';
import { getBookingPaymentView, handleStripePaymentIntentEvent } from '../src/services/stripePaymentIntent.service';

const mockGetStripeClient = jest.fn();
const mockFindBookingPaymentByBookingId = jest.fn();
const mockFindBookingPaymentByPi = jest.fn();
const mockUpdateBookingPayment = jest.fn();
const mockFindBookingById = jest.fn();
const mockUpdateBooking = jest.fn();

jest.mock('../src/services/stripe.service', () => {
  const actual = jest.requireActual('../src/services/stripe.service');
  return {
    ...actual,
    getStripeClient: () => mockGetStripeClient(),
    isStripeReady: () => true,
  };
});

jest.mock('../src/repositories/bookingPayment.repository', () => ({
  findBookingPaymentByBookingId: (id: string) => mockFindBookingPaymentByBookingId(id),
  findBookingPaymentByProviderPaymentIntentId: (id: string) => mockFindBookingPaymentByPi(id),
  updateBookingPayment: (bookingId: string, patch: unknown) =>
    mockUpdateBookingPayment(bookingId, patch),
  claimPendingCardPayment: jest.fn(),
  claimCompletedCashPayment: jest.fn(),
  insertBookingPayment: jest.fn(),
  findBookingSettlementByBookingId: jest.fn(),
  insertBookingSettlement: jest.fn(),
  claimBookingSettlement: jest.fn(),
}));

jest.mock('../src/repositories/booking.repository', () => ({
  findBookingById: (id: string) => mockFindBookingById(id),
  updateBooking: (id: string, patch: unknown) => mockUpdateBooking(id, patch),
}));

const mockEnsureSettlement = jest.fn();
jest.mock('../src/services/settlement.service', () => ({
  calculateSettlement: (...args: unknown[]) =>
    jest.requireActual('../src/services/settlement.service').calculateSettlement(...args),
  ensureSettlementForCapturedPayment: (...args: unknown[]) => mockEnsureSettlement(...args),
  unresolvedSettlementPlaceholder: (...args: unknown[]) =>
    jest.requireActual('../src/services/settlement.service').unresolvedSettlementPlaceholder(
      ...args
    ),
}));

import {
  captureAuthorizedBookingPayment,
  markBookingPaidIfCaptured,
  releaseCardPaymentAuthorization,
  resetCaptureLocksForTests,
} from '../src/services/stripeCapture.service';

const BOOKING_ID = '22222222-2222-2222-2222-222222222222';

type PaymentRow = {
  bookingId: string;
  paymentMethod: string;
  status: string;
  providerPaymentIntentId: string | null;
  providerChargeId?: string | null;
  authorizedAt?: Date | null;
  capturedAt?: Date | null;
  grossAmount?: number;
  currency?: string;
};

function makeIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pi_d_1',
    object: 'payment_intent',
    amount: 12050,
    currency: 'bdt',
    status: 'requires_capture',
    capture_method: 'manual',
    client_secret: 'pi_d_1_secret_abc',
    amount_capturable: 12050,
    metadata: { bookingId: BOOKING_ID, passengerId: 'passenger-a' },
    latest_charge: 'ch_d_1',
    last_payment_error: null,
    ...overrides,
  };
}

describe('Stripe Phase D — capture and authorization release', () => {
  const mockCapture = jest.fn();
  const mockCancel = jest.fn();
  const mockRetrieve = jest.fn();
  const mockTransfersCreate = jest.fn();
  let paymentRow: PaymentRow;
  let bookingRow: { id: string; paymentStatus: string; status: string };

  beforeEach(() => {
    resetCaptureLocksForTests();
    process.env.STRIPE_SECRET_KEY = 'sk_test_valid';
    mockCapture.mockReset();
    mockCancel.mockReset();
    mockRetrieve.mockReset();
    mockTransfersCreate.mockReset();
    mockFindBookingPaymentByBookingId.mockReset();
    mockFindBookingPaymentByPi.mockReset();
    mockUpdateBookingPayment.mockReset();
    mockFindBookingById.mockReset();
    mockUpdateBooking.mockReset();
    mockEnsureSettlement.mockReset();
    mockEnsureSettlement.mockResolvedValue(null);

    paymentRow = {
      bookingId: BOOKING_ID,
      paymentMethod: 'card',
      status: BookingPaymentStatus.AUTHORIZED,
      providerPaymentIntentId: 'pi_d_1',
      grossAmount: 12050,
      currency: 'BDT',
    };
    bookingRow = { id: BOOKING_ID, paymentStatus: 'pending', status: 'completed' };

    mockFindBookingPaymentByBookingId.mockImplementation(async () => ({ ...paymentRow }));
    mockFindBookingPaymentByPi.mockImplementation(async () => ({ ...paymentRow }));
    mockUpdateBookingPayment.mockImplementation(async (_id: string, patch: Partial<PaymentRow>) => {
      paymentRow = { ...paymentRow, ...patch };
      return { ...paymentRow };
    });
    mockFindBookingById.mockImplementation(async () => ({ ...bookingRow }));
    mockUpdateBooking.mockImplementation(async (_id: string, patch: Partial<typeof bookingRow>) => {
      bookingRow = { ...bookingRow, ...patch };
      return { ...bookingRow };
    });

    mockGetStripeClient.mockReturnValue({
      paymentIntents: {
        retrieve: mockRetrieve,
        capture: mockCapture,
        cancel: mockCancel,
        create: jest.fn(),
      },
      transfers: { create: mockTransfersCreate },
    });
  });

  afterEach(() => {
    resetCaptureLocksForTests();
  });

  it('A. authorized card completion captures once and marks paid', async () => {
    mockRetrieve.mockResolvedValue(makeIntent());
    mockCapture.mockResolvedValue(makeIntent({ status: 'succeeded', amount_capturable: 0 }));

    const result = await captureAuthorizedBookingPayment(BOOKING_ID);

    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture.mock.calls[0][0]).toBe('pi_d_1');
    expect(mockCapture.mock.calls[0][2]).toEqual({
      idempotencyKey: FinancialIdempotencyKey.capture(BOOKING_ID),
    });
    expect(result.status).toBe(BookingPaymentStatus.CAPTURED);
    expect(paymentRow.status).toBe(BookingPaymentStatus.CAPTURED);
    expect(bookingRow.paymentStatus).toBe('paid');
    expect(mockTransfersCreate).not.toHaveBeenCalled();
    expect(mockEnsureSettlement).toHaveBeenCalledWith(BOOKING_ID);
  });

  it('B. duplicate completion does not capture twice', async () => {
    mockRetrieve.mockResolvedValue(makeIntent());
    mockCapture.mockResolvedValue(makeIntent({ status: 'succeeded', amount_capturable: 0 }));

    await captureAuthorizedBookingPayment(BOOKING_ID);
    const second = await captureAuthorizedBookingPayment(BOOKING_ID);

    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(second.alreadyCaptured).toBe(true);
    expect(second.status).toBe(BookingPaymentStatus.CAPTURED);
    expect(bookingRow.paymentStatus).toBe('paid');
  });

  it('C. Stripe already succeeded reconciles to captured/paid without a second capture', async () => {
    mockRetrieve.mockResolvedValue(makeIntent({ status: 'succeeded', amount_capturable: 0 }));

    const result = await captureAuthorizedBookingPayment(BOOKING_ID);

    expect(mockCapture).not.toHaveBeenCalled();
    expect(result.alreadyCaptured).toBe(true);
    expect(paymentRow.status).toBe(BookingPaymentStatus.CAPTURED);
    expect(bookingRow.paymentStatus).toBe('paid');
  });

  it('D. cash completion does not call Stripe', async () => {
    paymentRow.paymentMethod = PaymentMethodCode.CASH;
    paymentRow.providerPaymentIntentId = null;
    paymentRow.status = 'pending';

    const result = await captureAuthorizedBookingPayment(BOOKING_ID);

    expect(result.skipped).toBe(true);
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
    expect(bookingRow.paymentStatus).toBe('pending');
  });

  it('E. authorized card passenger cancel releases PaymentIntent and does not capture', async () => {
    mockRetrieve.mockResolvedValue(makeIntent());
    mockCancel.mockResolvedValue(makeIntent({ status: 'canceled', amount_capturable: 0 }));

    const result = await releaseCardPaymentAuthorization(BOOKING_ID);

    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockCancel.mock.calls[0][2]).toEqual({
      idempotencyKey: FinancialIdempotencyKey.paymentCancel(BOOKING_ID),
    });
    expect(mockCapture).not.toHaveBeenCalled();
    expect(result.released).toBe(true);
    expect(paymentRow.status).toBe(BookingPaymentStatus.CANCELLED);
    expect(bookingRow.paymentStatus).toBe('pending');
  });

  it('F. driver terminal cancel uses the same authorization release', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/services/booking.service.ts'),
      'utf8'
    );
    const driverCancel = src.slice(src.indexOf('export async function cancelBookingByDriver'));
    expect(driverCancel).toMatch(/releaseCardPaymentAuthorization/);
    const passengerCancel = src.slice(
      src.indexOf('export async function cancelBookingByCustomer'),
      src.indexOf('export async function consentRecording')
    );
    expect(passengerCancel).toMatch(/releaseCardPaymentAuthorization/);
  });

  it('G. duplicate cancellation is idempotent', async () => {
    mockRetrieve.mockResolvedValue(makeIntent());
    mockCancel.mockResolvedValue(makeIntent({ status: 'canceled', amount_capturable: 0 }));

    await releaseCardPaymentAuthorization(BOOKING_ID);
    const second = await releaseCardPaymentAuthorization(BOOKING_ID);

    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(second.alreadyReleased).toBe(true);
    expect(second.status).toBe(BookingPaymentStatus.CANCELLED);
  });

  it('H. offer expiry / continued search does not cancel the PaymentIntent', () => {
    const dispatchSrc = fs.readFileSync(
      path.join(__dirname, '../src/services/dispatch.service.ts'),
      'utf8'
    );
    const expireBlock = dispatchSrc.slice(
      dispatchSrc.indexOf('export async function processExpiredOffers'),
      dispatchSrc.indexOf('export function shouldRevertBookingToSearching')
    );
    expect(expireBlock).not.toMatch(/releaseCardPaymentAuthorization/);
    expect(expireBlock).not.toMatch(/paymentIntents\.cancel/);
    expect(dispatchSrc).toMatch(/releaseCardAuthorizationForTerminalBooking/);
  });

  it('I. already captured cancellation does not refund', async () => {
    paymentRow.status = BookingPaymentStatus.CAPTURED;
    const refundSpy = jest.fn();
    mockGetStripeClient.mockReturnValue({
      paymentIntents: { retrieve: mockRetrieve, capture: mockCapture, cancel: mockCancel },
      refunds: { create: refundSpy },
      transfers: { create: mockTransfersCreate },
    });

    const result = await releaseCardPaymentAuthorization(BOOKING_ID);

    expect(result.alreadyCaptured).toBe(true);
    expect(mockCancel).not.toHaveBeenCalled();
    expect(refundSpy).not.toHaveBeenCalled();
    await expect(refundPayment()).rejects.toMatchObject({ code: 'PAYMENT_NOT_IMPLEMENTED' });
  });

  it('J. capture API temporary failure stays capture_pending and is retryable', async () => {
    mockRetrieve.mockResolvedValue(makeIntent());
    mockCapture.mockRejectedValue({ type: 'api_error', code: 'lock_timeout', message: 'try again' });

    await expect(captureAuthorizedBookingPayment(BOOKING_ID)).rejects.toMatchObject({
      code: 'STRIPE_CAPTURE_FAILED',
    });
    expect(paymentRow.status).toBe(BookingPaymentStatus.CAPTURE_PENDING);
    expect(bookingRow.paymentStatus).toBe('pending');
    expect(bookingRow.status).toBe('completed');

    mockCapture.mockResolvedValue(makeIntent({ status: 'succeeded', amount_capturable: 0 }));
    const retried = await captureAuthorizedBookingPayment(BOOKING_ID);
    expect(retried.status).toBe(BookingPaymentStatus.CAPTURED);
    expect(bookingRow.paymentStatus).toBe('paid');
  });

  it('K. webhook payment_intent.succeeded marks captured and paid', async () => {
    const result = await handleStripePaymentIntentEvent({
      id: 'evt_succeeded',
      type: 'payment_intent.succeeded',
      data: { object: makeIntent({ status: 'succeeded', amount_capturable: 0 }) },
    } as any);
    expect(result.status).toBe(BookingPaymentStatus.CAPTURED);
    await markBookingPaidIfCaptured(BOOKING_ID);
    expect(bookingRow.paymentStatus).toBe('paid');
  });

  it('L. webhook payment_intent.canceled marks local cancelled and not paid', async () => {
    const result = await handleStripePaymentIntentEvent({
      id: 'evt_canceled',
      type: 'payment_intent.canceled',
      data: { object: makeIntent({ status: 'canceled', amount_capturable: 0 }) },
    } as any);
    expect(result.status).toBe(BookingPaymentStatus.CANCELLED);
    expect(bookingRow.paymentStatus).toBe('pending');
  });

  it('M. passenger payment status endpoint normalizes authorized / captured / cancelled', async () => {
    mockRetrieve.mockResolvedValue(makeIntent());
    let view = await getBookingPaymentView(BOOKING_ID, { reconcile: true });
    expect(view.status).toBe(BookingPaymentStatus.AUTHORIZED);
    expect(view.paymentIntentId).toBe('pi_d_1');

    paymentRow.status = BookingPaymentStatus.CAPTURED;
    mockRetrieve.mockResolvedValue(makeIntent({ status: 'succeeded', amount_capturable: 0 }));
    view = await getBookingPaymentView(BOOKING_ID, { reconcile: true });
    expect(view.status).toBe(BookingPaymentStatus.CAPTURED);
    expect(view.clientSecret).toBeFalsy();

    paymentRow.status = BookingPaymentStatus.CANCELLED;
    mockRetrieve.mockResolvedValue(makeIntent({ status: 'canceled', amount_capturable: 0 }));
    view = await getBookingPaymentView(BOOKING_ID, { reconcile: true });
    expect(view.status).toBe(BookingPaymentStatus.CANCELLED);
    expect(JSON.stringify(view)).not.toContain('sk_test');
  });

  it('does not transfer or settle in Phase D', async () => {
    expect(() =>
      calculateSettlement({ bookingId: BOOKING_ID, grossAmountMinor: 12050, currency: 'BDT' })
    ).toThrow(/COMMISSION BUSINESS RULES NOT YET CONFIGURED/);
    await expect(settleCompletedBooking()).rejects.toMatchObject({
      code: 'PAYMENT_NOT_IMPLEMENTED',
    });
    await expect(capturePayment()).rejects.toMatchObject({ code: 'PAYMENT_NOT_IMPLEMENTED' });
    const captureSrc = fs.readFileSync(
      path.join(__dirname, '../src/services/stripeCapture.service.ts'),
      'utf8'
    );
    expect(captureSrc).not.toMatch(/transfers\.create/);
    expect(captureSrc).not.toMatch(/transfer_data/);
    expect(captureSrc).not.toMatch(/application_fee_amount/);
    expect(captureSrc).toMatch(/paymentIntents\.capture/);
    expect(captureSrc).toMatch(/paymentIntents\.cancel/);
  });

  it('J. ride completion records the booking before capture', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/services/booking.service.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export async function updateBookingStatusByDriver'));
    const updateIdx = fn.indexOf('const updated = await updateBooking');
    const captureIdx = fn.lastIndexOf('await captureAuthorizedBookingPayment');
    expect(updateIdx).toBeGreaterThan(-1);
    expect(captureIdx).toBeGreaterThan(updateIdx);
    expect(fn).toMatch(/if \(!isCard && !metered\) \{\s*patch\.paymentStatus = 'paid'/);
  });
});
