/**
 * Real Stripe TEST-mode USD PaymentIntent via the production PaymentService path.
 *
 * Does not print secrets. Skips when no sk_test_ key is available.
 * Refuses live mode. Does not invent a throwaway Stripe client.
 */

import fs from 'fs';
import path from 'path';
import { classifyStripeSecretMode } from '../src/config/stripe';
import { PaymentError } from '../src/services/payment.errors';
import {
  prepareCardPaymentForBooking,
  resetPaymentIntentLocksForTests,
} from '../src/services/stripePaymentIntent.service';
import { resetStripeClientForTests } from '../src/services/stripe.service';

const mockFindBookingPaymentByBookingId = jest.fn();
const mockClaimPendingCardPayment = jest.fn();
const mockUpdateBookingPayment = jest.fn();

jest.mock('../src/repositories/bookingPayment.repository', () => ({
  findBookingPaymentByBookingId: (...args: unknown[]) => mockFindBookingPaymentByBookingId(...args),
  findBookingPaymentByProviderPaymentIntentId: jest.fn(),
  claimPendingCardPayment: (...args: unknown[]) => mockClaimPendingCardPayment(...args),
  claimCompletedCashPayment: jest.fn(),
  updateBookingPayment: (...args: unknown[]) => mockUpdateBookingPayment(...args),
  insertBookingPayment: jest.fn(),
  findBookingSettlementByBookingId: jest.fn(),
  insertBookingSettlement: jest.fn(),
  claimBookingSettlement: jest.fn(),
}));

jest.mock('../src/middleware/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const BOOKING_ID = 'aaaaaaaa-1111-4111-8111-ffffffffffff';
const PASSENGER_ID = 'bbbbbbbb-2222-4222-8222-ffffffffffff';

function readEnvFileValue(key: string): string | undefined {
  const envPath = path.join(__dirname, '..', '.env');
  let fromFile: string | undefined;
  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      if (trimmed.slice(0, eq).trim() !== key) continue;
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      fromFile = value || undefined;
      break;
    }
  }
  return fromFile ?? process.env[key]?.trim() ?? undefined;
}

const sandboxSecret = readEnvFileValue('STRIPE_SECRET_KEY');
const sandboxMode = classifyStripeSecretMode(sandboxSecret);

describe('USD Stripe sandbox capability (real PaymentService path)', () => {
  const previousSecret = process.env.STRIPE_SECRET_KEY;

  beforeEach(() => {
    resetPaymentIntentLocksForTests();
    mockFindBookingPaymentByBookingId.mockReset();
    mockClaimPendingCardPayment.mockReset();
    mockUpdateBookingPayment.mockReset();
    mockFindBookingPaymentByBookingId.mockResolvedValue(null);
    mockClaimPendingCardPayment.mockImplementation(async (values: Record<string, unknown>) => ({
      id: 'payment-sandbox',
      ...values,
    }));
    mockUpdateBookingPayment.mockResolvedValue({});
  });

  afterEach(() => {
    resetPaymentIntentLocksForTests();
    resetStripeClientForTests();
  });

  afterAll(() => {
    if (previousSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousSecret;
    resetStripeClientForTests();
  });

  it('records Stripe secret mode without exposing the key', () => {
    expect(['test', 'live', 'unknown', 'not_configured']).toContain(sandboxMode);
    expect(sandboxSecret ? 'SET' : 'NOT SET').toMatch(/^(SET|NOT SET)$/);
  });

  it('refuses to call live Stripe for this USD QA', () => {
    expect(sandboxMode).not.toBe('live');
  });

  (sandboxMode === 'test' ? it : it.skip)(
    'G/H. create a USD manual-capture PaymentIntent for $45.00 through prepareCardPaymentForBooking',
    async () => {
      process.env.STRIPE_SECRET_KEY = sandboxSecret;
      resetStripeClientForTests();

      let paymentIntentId: string | null = null;
      try {
        const view = await prepareCardPaymentForBooking({
          bookingId: BOOKING_ID,
          passengerId: PASSENGER_ID,
          finalFare: '45.00',
          currency: 'USD',
        });
        paymentIntentId = view.paymentIntentId;
        expect(view.currency).toBe('USD');
        expect(view.amount).toBe(4500);
        expect(view.paymentIntentId).toMatch(/^pi_/);
        expect(mockClaimPendingCardPayment).toHaveBeenCalledWith(
          expect.objectContaining({
            currency: 'USD',
            grossAmount: 4500,
          })
        );
      } catch (error) {
        const code = error instanceof PaymentError ? error.code : 'UNEXPECTED';
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Stripe TEST platform rejected USD PaymentIntent via PaymentService. code=${code} message=${message}`
        );
      } finally {
        if (paymentIntentId) {
          const { getStripeClient } = await import('../src/services/stripe.service');
          await getStripeClient()
            .paymentIntents.cancel(paymentIntentId)
            .catch(() => undefined);
        }
      }
    },
    30000
  );
});
