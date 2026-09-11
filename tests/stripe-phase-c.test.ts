import fs from 'fs';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { PaymentMethodCode, FinancialIdempotencyKey } from '../src/constants/payment';
import { BookingStatus, CANCELLABLE_BY_PASSENGER, PASSENGER_ONGOING_BOOKING_STATUSES } from '../src/constants/bookingStatus';
import { createBookingSchema } from '../src/validators';
import { majorToMinorUnits } from '../src/utils/money';
import { PaymentError } from '../src/services/payment.errors';
import { calculateSettlement } from '../src/services/settlement.service';
import {
  assertCardPaymentAllowed,
  capturePayment,
  getPassengerPaymentsConfig,
  listPassengerPaymentMethods,
  refundPayment,
  settleCompletedBooking,
} from '../src/services/payment.service';
import { shouldStartDispatchOnBookingCreate } from '../src/services/cardBookingActivation.service';
import { errorHandler } from '../src/middleware/error-handler';
import { logger } from '../src/middleware/logger';
import { extractUserInfo } from '../src/middleware/auth';
import { validateEnvironment } from '../src/config/env-validator';
import { dispatchStripeWebhookEvent } from '../src/services/stripeWebhook.service';

const mockIsStripeReady = jest.fn(() => true);
const mockGetStripeClient = jest.fn();
const mockFindBookingPaymentByBookingId = jest.fn();
const mockFindBookingPaymentByPi = jest.fn();
const mockClaimPendingCardPayment = jest.fn();
const mockUpdateBookingPayment = jest.fn();
const mockFindBookingById = jest.fn();
const mockListPaymentMethods = jest.fn();
const mockFindPaymentMethodByCode = jest.fn();
const mockStartDispatch = jest.fn();

const authState = { userId: 'passenger-a', role: 'customer' };

jest.mock('../src/db/connection', () => ({
  db: {
    transaction: jest.fn(),
    select: jest.fn(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
          for: () => ({
            limit: async () => [],
          }),
        }),
      }),
    })),
    insert: jest.fn(),
    update: jest.fn(),
  },
}));

jest.mock('../src/services/stripe.service', () => {
  const actual = jest.requireActual('../src/services/stripe.service');
  return {
    ...actual,
    isStripeReady: () => mockIsStripeReady(),
    getStripeClient: () => mockGetStripeClient(),
  };
});

jest.mock('../src/repositories/bookingPayment.repository', () => ({
  findBookingPaymentByBookingId: (id: string) => mockFindBookingPaymentByBookingId(id),
  findBookingPaymentByProviderPaymentIntentId: (id: string) => mockFindBookingPaymentByPi(id),
  claimPendingCardPayment: (values: unknown) => mockClaimPendingCardPayment(values),
  claimCompletedCashPayment: jest.fn(),
  updateBookingPayment: (bookingId: string, patch: unknown) =>
    mockUpdateBookingPayment(bookingId, patch),
  insertBookingPayment: jest.fn(),
  findBookingSettlementByBookingId: jest.fn(),
  insertBookingSettlement: jest.fn(),
  claimBookingSettlement: jest.fn(),
}));

jest.mock('../src/repositories/booking.repository', () => ({
  findBookingById: (id: string) => mockFindBookingById(id),
}));

jest.mock('../src/repositories/serviceCategory.repository', () => ({
  listPaymentMethods: () => mockListPaymentMethods(),
  findPaymentMethodByCode: (code: string) => mockFindPaymentMethodByCode(code),
}));

jest.mock('../src/services/dispatch.service', () => ({
  startDispatch: (id: string) => mockStartDispatch(id),
  clearDispatchTimer: jest.fn(),
}));

jest.mock('../src/db/utils', () => ({
  driverUtils: { findByAuth0Id: jest.fn() },
}));

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  extractUserInfo: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { userId: authState.userId, role: authState.role, auth0Id: 'auth0|a' };
    next();
  },
}));

jest.mock('../src/middleware/rbac', () => ({
  requireCustomer: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireDriver: [(_req: unknown, _res: unknown, next: () => void) => next()],
}));

jest.mock('../src/middleware/rate-limiters', () => ({
  passengerBookingRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
  passengerRecoveryRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import {
  buildPlatformPaymentIntentParams,
  handleStripePaymentIntentEvent,
  normalizePaymentIntentStatus,
  prepareCardPaymentForBooking,
  reconcileBookingPaymentFromStripe,
  resetPaymentIntentLocksForTests,
} from '../src/services/stripePaymentIntent.service';
import { activateAuthorizedCardBooking } from '../src/services/cardBookingActivation.service';
import { getBookingPaymentHandler } from '../src/controllers/passengerBooking.controller';

const BOOKING_ID = '11111111-1111-1111-1111-111111111111';
const PASSENGER_A = 'passenger-a';
const PASSENGER_B = 'passenger-b';

function makeIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pi_test_1',
    object: 'payment_intent',
    amount: 12050,
    currency: 'bdt',
    status: 'requires_payment_method',
    capture_method: 'manual',
    client_secret: 'pi_test_1_secret_abc',
    amount_capturable: 0,
    metadata: { bookingId: BOOKING_ID, passengerId: PASSENGER_A },
    latest_charge: null,
    last_payment_error: null,
    ...overrides,
  };
}

describe('Stripe Phase C — card enablement and config', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env.STRIPE_SECRET_KEY = saved.STRIPE_SECRET_KEY;
    process.env.STRIPE_PUBLISHABLE_KEY = saved.STRIPE_PUBLISHABLE_KEY;
    if (saved.STRIPE_SECRET_KEY === undefined) delete process.env.STRIPE_SECRET_KEY;
    if (saved.STRIPE_PUBLISHABLE_KEY === undefined) delete process.env.STRIPE_PUBLISHABLE_KEY;
  });

  it('B. card unavailable when Stripe config absent', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    mockListPaymentMethods.mockResolvedValue([{ code: 'cash', name: 'Cash', isActive: true }]);
    const methods = await listPassengerPaymentMethods();
    expect(methods.map((m: { code: string }) => m.code)).toEqual(['cash']);
    expect(() => assertCardPaymentAllowed(PaymentMethodCode.CARD)).toThrow(PaymentError);
  });

  it('C. card visible when Stripe config valid', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_valid';
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_valid';
    mockListPaymentMethods.mockResolvedValue([{ code: 'cash', name: 'Cash', isActive: true }]);
    mockFindPaymentMethodByCode.mockResolvedValue({
      code: 'card',
      name: 'Card',
      isActive: false,
    });
    const methods = await listPassengerPaymentMethods();
    expect(methods.map((m: { code: string }) => m.code)).toEqual(['cash', 'card']);
    expect(() => assertCardPaymentAllowed(PaymentMethodCode.CARD)).not.toThrow();
    const config = getPassengerPaymentsConfig();
    expect(config.cardEnabled).toBe(true);
    expect(config.publishableKey).toBe('pk_test_valid');
    expect(JSON.stringify(config)).not.toContain('sk_test');
  });

  it('V. Stripe key mode mismatch is detected', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_valid';
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_live_oops';
    try {
      getPassengerPaymentsConfig();
      throw new Error('expected throw');
    } catch (error) {
      expect((error as PaymentError).code).toBe('STRIPE_MODE_MISMATCH');
    }
    try {
      assertCardPaymentAllowed(PaymentMethodCode.CARD);
      throw new Error('expected throw');
    } catch (error) {
      expect((error as PaymentError).code).toBe('STRIPE_MODE_MISMATCH');
    }
    process.env.NODE_ENV = 'test';
    expect(() => validateEnvironment()).toThrow(/STRIPE_MODE_MISMATCH/);
  });
});

describe('Stripe Phase C — PaymentIntent authorization', () => {
  const mockCreate = jest.fn();
  const mockRetrieve = jest.fn();
  const mockCapture = jest.fn();
  const mockTransfersCreate = jest.fn();

  beforeEach(() => {
    resetPaymentIntentLocksForTests();
    process.env.STRIPE_SECRET_KEY = 'sk_test_valid';
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_valid';
    mockIsStripeReady.mockReturnValue(true);
    mockCreate.mockReset();
    mockRetrieve.mockReset();
    mockCapture.mockReset();
    mockTransfersCreate.mockReset();
    mockFindBookingPaymentByBookingId.mockReset();
    mockFindBookingPaymentByPi.mockReset();
    mockClaimPendingCardPayment.mockReset();
    mockUpdateBookingPayment.mockReset();
    mockFindBookingById.mockReset();
    mockStartDispatch.mockReset();
    mockGetStripeClient.mockReturnValue({
      paymentIntents: { create: mockCreate, retrieve: mockRetrieve, capture: mockCapture },
      transfers: { create: mockTransfersCreate },
      charges: { create: jest.fn() },
    });
    mockFindBookingPaymentByBookingId.mockResolvedValue(null);
    mockClaimPendingCardPayment.mockImplementation(async (values: { bookingId: string; grossAmount: number }) => ({
      ...values,
      providerPaymentIntentId: null,
      status: 'pending',
    }));
    mockUpdateBookingPayment.mockImplementation(async (bookingId: string, patch: Record<string, unknown>) => ({
      bookingId,
      ...patch,
    }));
    mockCreate.mockResolvedValue(makeIntent());
    mockRetrieve.mockResolvedValue(makeIntent());
  });

  afterEach(() => {
    resetPaymentIntentLocksForTests();
  });

  it('D. card amount uses server fare and ignores client amount', () => {
    const parsed = createBookingSchema.parse({
      serviceCategoryId: BOOKING_ID,
      pickup: { latitude: 23.81, longitude: 90.41, address: 'A' },
      dropoff: { latitude: 23.75, longitude: 90.38, address: 'B' },
      paymentMethodCode: 'card',
      amount: 1,
      finalFare: '1.00',
    });
    expect((parsed as { amount?: unknown }).amount).toBeUndefined();
    expect(majorToMinorUnits('120.50')).toBe(12050);
  });

  it('E/F/G. creates one platform PaymentIntent with manual capture and no destination', async () => {
    const view = await prepareCardPaymentForBooking({
      bookingId: BOOKING_ID,
      passengerId: PASSENGER_A,
      finalFare: '120.50',
      currency: 'BDT',
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const params = mockCreate.mock.calls[0][0];
    expect(params).toMatchObject({
      amount: 12050,
      currency: 'bdt',
      capture_method: 'manual',
      payment_method_types: ['card'],
      metadata: { bookingId: BOOKING_ID, passengerId: PASSENGER_A },
    });
    expect(params.transfer_data).toBeUndefined();
    expect(params.on_behalf_of).toBeUndefined();
    expect(params.application_fee_amount).toBeUndefined();
    expect(mockCreate.mock.calls[0][1]).toEqual({
      idempotencyKey: FinancialIdempotencyKey.payment(BOOKING_ID),
    });
    expect(view.clientSecret).toBe('pi_test_1_secret_abc');
    expect(view.paymentIntentId).toBe('pi_test_1');
    expect(buildPlatformPaymentIntentParams({
      amountMinor: 1,
      currency: 'BDT',
      bookingId: BOOKING_ID,
      passengerId: PASSENGER_A,
    }).capture_method).toBe('manual');
  });

  it('H/I/U. no transfer, commission, or capture call', async () => {
    await prepareCardPaymentForBooking({
      bookingId: BOOKING_ID,
      passengerId: PASSENGER_A,
      finalFare: '80.00',
      currency: 'BDT',
    });
    expect(mockTransfersCreate).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
    expect(() =>
      calculateSettlement({ bookingId: BOOKING_ID, grossAmountMinor: 8000, currency: 'BDT' })
    ).toThrow(/COMMISSION BUSINESS RULES NOT YET CONFIGURED/);
    await expect(capturePayment()).rejects.toMatchObject({ code: 'PAYMENT_NOT_IMPLEMENTED' });
    await expect(refundPayment()).rejects.toMatchObject({ code: 'PAYMENT_NOT_IMPLEMENTED' });
    await expect(settleCompletedBooking()).rejects.toMatchObject({
      code: 'PAYMENT_NOT_IMPLEMENTED',
    });
  });

  it('K. duplicate payment request reuses the same PaymentIntent', async () => {
    mockFindBookingPaymentByBookingId.mockResolvedValue({
      bookingId: BOOKING_ID,
      providerPaymentIntentId: 'pi_test_1',
      paymentMethod: 'card',
      status: 'requires_payment_method',
    });
    mockRetrieve.mockResolvedValue(makeIntent());
    const first = await prepareCardPaymentForBooking({
      bookingId: BOOKING_ID,
      passengerId: PASSENGER_A,
      finalFare: '120.50',
      currency: 'BDT',
    });
    const second = await prepareCardPaymentForBooking({
      bookingId: BOOKING_ID,
      passengerId: PASSENGER_A,
      finalFare: '999.00',
      currency: 'BDT',
    });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(first.paymentIntentId).toBe('pi_test_1');
    expect(second.paymentIntentId).toBe('pi_test_1');
    expect(second.amount).toBe(12050);
  });

  it('J. does not log the client secret', async () => {
    const logs: string[] = [];
    const spy = jest.spyOn(logger, 'info').mockImplementation((obj: unknown) => {
      logs.push(JSON.stringify(obj));
      return logger;
    });
    const view = await prepareCardPaymentForBooking({
      bookingId: BOOKING_ID,
      passengerId: PASSENGER_A,
      finalFare: '120.50',
      currency: 'BDT',
    });
    expect(view.clientSecret).toContain('secret');
    expect(logs.join('\n')).not.toContain('pi_test_1_secret_abc');
    spy.mockRestore();
  });

  it('L. card booking does not dispatch before authorization', () => {
    expect(
      shouldStartDispatchOnBookingCreate({ isScheduled: false, paymentMethodCode: 'card' })
    ).toBe(false);
    expect(
      shouldStartDispatchOnBookingCreate({ isScheduled: false, paymentMethodCode: 'cash' })
    ).toBe(true);
  });

  it('I/J/K mapping: requires_action and failed do not count as authorized', () => {
    expect(
      normalizePaymentIntentStatus({ status: 'requires_action', amount_capturable: 0 })
    ).toBe('requires_action');
    expect(
      normalizePaymentIntentStatus({ status: 'requires_payment_method', amount_capturable: 0 })
    ).toBe('requires_payment_method');
  });

  it('O. amount_capturable_updated / requires_capture maps to authorized', () => {
    expect(
      normalizePaymentIntentStatus({ status: 'requires_capture', amount_capturable: 12050 })
    ).toBe('authorized');
  });

  it('T. bookings.payment_status is not part of PaymentIntent create', async () => {
    await prepareCardPaymentForBooking({
      bookingId: BOOKING_ID,
      passengerId: PASSENGER_A,
      finalFare: '120.50',
      currency: 'BDT',
    });
    const persistCalls = mockUpdateBookingPayment.mock.calls;
    expect(JSON.stringify(persistCalls)).not.toContain('"paid"');
  });
});

describe('Stripe Phase C — webhook reconcile and dispatch activation', () => {
  const mockRetrieve = jest.fn();

  beforeEach(() => {
    mockRetrieve.mockReset();
    mockFindBookingPaymentByBookingId.mockReset();
    mockFindBookingPaymentByPi.mockReset();
    mockUpdateBookingPayment.mockReset();
    mockFindBookingById.mockReset();
    mockStartDispatch.mockReset();
    mockGetStripeClient.mockReturnValue({
      paymentIntents: { retrieve: mockRetrieve, create: jest.fn(), capture: jest.fn() },
    });
    mockUpdateBookingPayment.mockResolvedValue({});
    mockFindBookingById.mockResolvedValue({
      id: BOOKING_ID,
      status: BookingStatus.QUOTED,
      customerId: PASSENGER_A,
      paymentStatus: 'pending',
    });
  });

  it('M. requires_action does not dispatch', async () => {
    mockFindBookingPaymentByPi.mockResolvedValue({
      bookingId: BOOKING_ID,
      paymentMethod: 'card',
      status: 'pending',
    });
    const result = await handleStripePaymentIntentEvent({
      id: 'evt_action',
      type: 'payment_intent.requires_action',
      data: { object: makeIntent({ status: 'requires_action' }) },
    } as any);
    expect(result.status).toBe('requires_action');
    expect(mockStartDispatch).not.toHaveBeenCalled();
  });

  it('N. payment_failed does not dispatch', async () => {
    mockFindBookingPaymentByBookingId.mockResolvedValue({
      bookingId: BOOKING_ID,
      paymentMethod: 'card',
      status: 'requires_payment_method',
    });
    mockFindBookingPaymentByPi.mockResolvedValue({
      bookingId: BOOKING_ID,
      paymentMethod: 'card',
      status: 'requires_payment_method',
    });
    const result = await handleStripePaymentIntentEvent({
      id: 'evt_fail',
      type: 'payment_intent.payment_failed',
      data: {
        object: makeIntent({
          status: 'requires_payment_method',
          last_payment_error: { code: 'card_declined', message: 'declined' },
        }),
      },
    } as any);
    expect(result.status).toBe('failed');
    expect(mockStartDispatch).not.toHaveBeenCalled();
  });

  it('O. amount_capturable_updated marks authorized', async () => {
    mockFindBookingPaymentByPi.mockResolvedValue({
      bookingId: BOOKING_ID,
      paymentMethod: 'card',
      status: 'requires_payment_method',
    });
    mockFindBookingPaymentByBookingId.mockResolvedValue({
      bookingId: BOOKING_ID,
      paymentMethod: 'card',
      status: 'requires_payment_method',
    });
    const result = await handleStripePaymentIntentEvent({
      id: 'evt_cap',
      type: 'payment_intent.amount_capturable_updated',
      data: {
        object: makeIntent({ status: 'requires_capture', amount_capturable: 12050 }),
      },
    } as any);
    expect(result.status).toBe('authorized');
    expect(mockUpdateBookingPayment).toHaveBeenCalledWith(
      BOOKING_ID,
      expect.objectContaining({ status: 'authorized' })
    );
  });

  it('canceled PaymentIntent syncs ledger and does not dispatch', async () => {
    mockFindBookingPaymentByPi.mockResolvedValue({
      bookingId: BOOKING_ID,
      paymentMethod: 'card',
      status: 'requires_payment_method',
    });
    mockFindBookingPaymentByBookingId.mockResolvedValue({
      bookingId: BOOKING_ID,
      paymentMethod: 'card',
      status: 'requires_payment_method',
    });
    const result = await handleStripePaymentIntentEvent({
      id: 'evt_cancel',
      type: 'payment_intent.canceled',
      data: { object: makeIntent({ status: 'canceled' }) },
    } as any);
    expect(result.status).toBe('cancelled');
    expect(mockStartDispatch).not.toHaveBeenCalled();
  });

  it('R. status reconciliation can authorize if webhook is delayed', async () => {
    mockFindBookingPaymentByBookingId.mockResolvedValue({
      bookingId: BOOKING_ID,
      providerPaymentIntentId: 'pi_test_1',
      paymentMethod: 'card',
      status: 'requires_payment_method',
      grossAmount: 12050,
      currency: 'BDT',
    });
    mockRetrieve.mockResolvedValue(
      makeIntent({ status: 'requires_capture', amount_capturable: 12050 })
    );
    const view = await reconcileBookingPaymentFromStripe(BOOKING_ID);
    expect(view.status).toBe('authorized');
    expect(view.clientSecret).toBeNull();
  });
});

describe('Stripe Phase C — activateAuthorizedCardBooking', () => {
  const quotedBooking = { id: BOOKING_ID, status: BookingStatus.QUOTED };

  function mockTx(status: string) {
    const row = { id: BOOKING_ID, status };
    return {
      select: () => ({
        from: () => ({
          where: () => ({
            for: () => ({
              limit: async () => [row],
            }),
            limit: async () => [row],
          }),
        }),
      }),
      update: () => ({
        set: (patch: { status?: string }) => ({
          where: async () => {
            if (patch.status) row.status = patch.status;
            return [];
          },
        }),
      }),
      insert: () => ({
        values: async () => [],
      }),
    };
  }

  beforeEach(() => {
    mockStartDispatch.mockReset();
    mockFindBookingPaymentByBookingId.mockReset();
    const { db } = jest.requireMock('../src/db/connection') as {
      db: { transaction: jest.Mock; select: jest.Mock };
    };
    db.transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockTx(BookingStatus.QUOTED)));
    db.select = jest.fn(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [quotedBooking],
        }),
      }),
    }));
  });

  it('P. authorized card booking dispatches exactly once', async () => {
    mockFindBookingPaymentByBookingId.mockResolvedValue({
      bookingId: BOOKING_ID,
      paymentMethod: 'card',
      status: 'authorized',
    });
    const { db } = jest.requireMock('../src/db/connection') as { db: { transaction: jest.Mock } };
    const first = await activateAuthorizedCardBooking(BOOKING_ID);
    expect(first.dispatched).toBe(true);
    expect(mockStartDispatch).toHaveBeenCalledTimes(1);

    db.transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(mockTx(BookingStatus.SEARCHING))
    );
    const second = await activateAuthorizedCardBooking(BOOKING_ID);
    expect(second.alreadyActive).toBe(true);
    expect(second.dispatched).toBe(false);
    expect(mockStartDispatch).toHaveBeenCalledTimes(1);
  });

  it('P/Q. authorized webhook activates dispatch exactly once', async () => {
    mockFindBookingPaymentByPi.mockResolvedValue({
      bookingId: BOOKING_ID,
      paymentMethod: 'card',
      status: 'requires_payment_method',
    });
    mockFindBookingPaymentByBookingId.mockResolvedValue({
      bookingId: BOOKING_ID,
      paymentMethod: 'card',
      status: 'authorized',
    });
    mockFindBookingById.mockResolvedValue({
      id: BOOKING_ID,
      status: BookingStatus.QUOTED,
      customerId: PASSENGER_A,
    });
    await dispatchStripeWebhookEvent({
      id: 'evt_auth',
      type: 'payment_intent.amount_capturable_updated',
      data: {
        object: makeIntent({ status: 'requires_capture', amount_capturable: 12050 }),
      },
    } as any);
    expect(mockStartDispatch).toHaveBeenCalledTimes(1);

    const { db } = jest.requireMock('../src/db/connection') as { db: { transaction: jest.Mock } };
    db.transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(mockTx(BookingStatus.SEARCHING))
    );
    await dispatchStripeWebhookEvent({
      id: 'evt_auth_dup',
      type: 'payment_intent.amount_capturable_updated',
      data: {
        object: makeIntent({ status: 'requires_capture', amount_capturable: 12050 }),
      },
    } as any);
    expect(mockStartDispatch).toHaveBeenCalledTimes(1);
  });

  it('Q. duplicate activation does not dispatch twice', async () => {
    mockFindBookingPaymentByBookingId.mockResolvedValue({
      bookingId: BOOKING_ID,
      paymentMethod: 'card',
      status: 'authorized',
    });
    const { db } = jest.requireMock('../src/db/connection') as { db: { transaction: jest.Mock } };
    db.transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(mockTx(BookingStatus.SEARCHING))
    );
    await activateAuthorizedCardBooking(BOOKING_ID);
    await activateAuthorizedCardBooking(BOOKING_ID);
    expect(mockStartDispatch).not.toHaveBeenCalled();
  });

  it('L. pending/failed payments do not dispatch', async () => {
    mockFindBookingPaymentByBookingId.mockResolvedValue({
      bookingId: BOOKING_ID,
      paymentMethod: 'card',
      status: 'requires_action',
    });
    const result = await activateAuthorizedCardBooking(BOOKING_ID);
    expect(result.dispatched).toBe(false);
    expect(mockStartDispatch).not.toHaveBeenCalled();
  });
});

describe('Stripe Phase C — passenger payment status ownership', () => {
  function createApp() {
    const app = express();
    app.use(express.json());
    app.get(
      '/api/v1/passenger/bookings/:bookingId/payment',
      extractUserInfo,
      getBookingPaymentHandler
    );
    app.use(errorHandler);
    return app;
  }

  beforeEach(() => {
    authState.userId = PASSENGER_A;
    mockFindBookingById.mockReset();
    mockFindBookingPaymentByBookingId.mockReset();
    mockRetrieveSafe();
  });

  function mockRetrieveSafe() {
    mockGetStripeClient.mockReturnValue({
      paymentIntents: {
        retrieve: jest.fn().mockResolvedValue(makeIntent({ status: 'requires_payment_method' })),
        create: jest.fn(),
        capture: jest.fn(),
      },
    });
  }

  it('S. passenger cannot read another passenger payment', async () => {
    mockFindBookingById.mockResolvedValue({
      id: BOOKING_ID,
      customerId: PASSENGER_B,
    });
    const res = await request(createApp()).get(`/api/v1/passenger/bookings/${BOOKING_ID}/payment`);
    expect(res.status).toBe(404);
    expect(mockFindBookingPaymentByBookingId).not.toHaveBeenCalled();
  });

  it('J. owning passenger can read payment intent id', async () => {
    mockFindBookingById.mockResolvedValue({
      id: BOOKING_ID,
      customerId: PASSENGER_A,
    });
    mockFindBookingPaymentByBookingId.mockResolvedValue({
      bookingId: BOOKING_ID,
      providerPaymentIntentId: 'pi_test_1',
      paymentMethod: 'card',
      status: 'requires_payment_method',
      grossAmount: 12050,
      currency: 'BDT',
    });
    const res = await request(createApp()).get(`/api/v1/passenger/bookings/${BOOKING_ID}/payment`);
    expect(res.status).toBe(200);
    expect(res.body.data.paymentIntentId).toBe('pi_test_1');
    expect(JSON.stringify(res.body)).not.toContain('sk_test');
    expect(JSON.stringify(res.body)).not.toContain('whsec_');
  });
});

describe('Stripe Phase C — cash, quoted status, source guards', () => {
  it('A. cash still allowed and still dispatches on create', () => {
    expect(() => assertCardPaymentAllowed(PaymentMethodCode.CASH)).not.toThrow();
    expect(
      shouldStartDispatchOnBookingCreate({ isScheduled: false, paymentMethodCode: 'cash' })
    ).toBe(true);
  });

  it('uses quoted for pending card bookings and allows passenger resume/cancel', () => {
    expect(PASSENGER_ONGOING_BOOKING_STATUSES).toContain(BookingStatus.QUOTED);
    expect(CANCELLABLE_BY_PASSENGER).toContain(BookingStatus.QUOTED);
  });

  it('U. Phase C authorization source does not capture or transfer', () => {
    const paymentSrc = fs.readFileSync(
      path.join(__dirname, '../src/services/stripePaymentIntent.service.ts'),
      'utf8'
    );
    expect(paymentSrc).not.toMatch(/paymentIntents\.capture/);
    expect(paymentSrc).not.toMatch(/transfers\.create/);
    expect(paymentSrc).not.toMatch(/transfer_data/);
  });
});
