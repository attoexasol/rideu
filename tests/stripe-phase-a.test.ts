import fs from 'fs';
import path from 'path';
import { describeStripeConfig, isStripeSecretConfigured, looksLikeStripeWebhookSecret } from '../src/config/stripe';
import { validateEnvironment, printEnvironmentInfo } from '../src/config/env-validator';
import { PaymentMethodCode, FinancialIdempotencyKey, BOOKING_PAYMENT_STATUSES } from '../src/constants/payment';
import { majorToMinorUnits, minorToMajorString, isMinorUnitAmount } from '../src/utils/money';
import {
  assertCardPaymentAllowed,
  authorizePayment,
  capturePayment,
  preparePayment,
  refundPayment,
  settleCompletedBooking,
} from '../src/services/payment.service';
import { PaymentError } from '../src/services/payment.errors';
import { calculateSettlement, unresolvedSettlementPlaceholder } from '../src/services/settlement.service';
import { getStripeClient, isStripeReady, resetStripeClientForTests } from '../src/services/stripe.service';
import { createBookingSchema } from '../src/validators';
import { shouldSkipGlobalRateLimit } from '../src/middleware/rate-limit-paths';
import { bookingPayments } from '../src/db/schema/booking_payments';
import { bookingSettlements } from '../src/db/schema/booking_settlements';
import { stripeWebhookEvents } from '../src/db/schema/stripe_webhook_events';
import { getTableConfig } from 'drizzle-orm/pg-core';

describe('Stripe Phase A — cash and config', () => {
  afterEach(() => {
    resetStripeClientForTests();
  });

  it('does not require Stripe credentials to validate a test environment', () => {
    const saved = { ...process.env };
    process.env.NODE_ENV = 'test';
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(() => validateEnvironment()).not.toThrow();
    expect(isStripeSecretConfigured()).toBe(false);
    expect(isStripeReady()).toBe(false);
    process.env = saved;
  });

  it('never prints Stripe secret values', () => {
    const savedSecret = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = 'sk_test_this_must_never_appear_in_logs';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_this_must_never_appear';
    const logs: string[] = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    printEnvironmentInfo();
    const joined = logs.join('\n');
    expect(joined).not.toContain('sk_test_this_must_never_appear_in_logs');
    expect(joined).not.toContain('whsec_test_this_must_never_appear');
    expect(joined).toContain('STRIPE_SECRET_KEY: [SET]');
    expect(joined).toContain('STRIPE_WEBHOOK_SECRET: [SET]');
    expect(joined).toContain('STRIPE_MODE: test');
    spy.mockRestore();
    if (savedSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = savedSecret;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  it('describeStripeConfig redacts secrets', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
    const info = describeStripeConfig();
    expect(info.secretKey).toBe('SET');
    expect(JSON.stringify(info)).not.toContain('sk_test_abc');
    delete process.env.STRIPE_SECRET_KEY;
  });

  it('classifies webhook secrets without exposing them', () => {
    expect(looksLikeStripeWebhookSecret('whsec_abc')).toBe(true);
    expect(looksLikeStripeWebhookSecret('sk_test_abc')).toBe(false);
  });

  it('getStripeClient throws a structured error when unset', () => {
    delete process.env.STRIPE_SECRET_KEY;
    resetStripeClientForTests();
    try {
      getStripeClient();
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentError);
      expect((error as PaymentError).code).toBe('STRIPE_NOT_CONFIGURED');
      expect((error as PaymentError).statusCode).toBe(503);
    }
  });

  it('defaults passenger booking payment method to cash', () => {
    const parsed = createBookingSchema.parse({
      serviceCategoryId: '11111111-1111-1111-1111-111111111111',
      pickup: { latitude: 23.81, longitude: 90.41, address: 'A' },
      dropoff: { latitude: 23.75, longitude: 90.38, address: 'B' },
    });
    expect(parsed.paymentMethodCode).toBe('cash');
  });

  it('allows cash and blocks card when Stripe is not configured', () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    expect(() => assertCardPaymentAllowed(PaymentMethodCode.CASH)).not.toThrow();
    try {
      assertCardPaymentAllowed(PaymentMethodCode.CARD);
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentError);
      expect((error as PaymentError).code).toBe('CARD_PAYMENTS_NOT_ENABLED');
    }
  });

  it('does not perform card payment, capture, refund, or settlement', async () => {
    await expect(preparePayment()).rejects.toMatchObject({ code: 'PAYMENT_NOT_IMPLEMENTED' });
    await expect(authorizePayment()).rejects.toMatchObject({ code: 'PAYMENT_NOT_IMPLEMENTED' });
    await expect(capturePayment()).rejects.toMatchObject({ code: 'PAYMENT_NOT_IMPLEMENTED' });
    await expect(refundPayment()).rejects.toMatchObject({ code: 'PAYMENT_NOT_IMPLEMENTED' });
    await expect(settleCompletedBooking()).rejects.toMatchObject({
      code: 'PAYMENT_NOT_IMPLEMENTED',
    });
  });

  it('does not calculate commission', () => {
    expect(() =>
      calculateSettlement({ bookingId: 'b1', grossAmountMinor: 12000, currency: 'BDT' })
    ).toThrow(/COMMISSION BUSINESS RULES NOT YET CONFIGURED/);
    const placeholder = unresolvedSettlementPlaceholder({
      bookingId: 'b1',
      grossAmountMinor: 12000,
    });
    expect(placeholder.driverAmount).toBeNull();
    expect(placeholder.platformAmount).toBeNull();
    expect(placeholder.airportFee).toBeNull();
  });

  it('skips global rate limit for the Stripe webhook path', () => {
    expect(shouldSkipGlobalRateLimit('/api/v1/webhooks/stripe')).toBe(true);
    expect(shouldSkipGlobalRateLimit('/api/v1/config/payments')).toBe(true);
    expect(
      shouldSkipGlobalRateLimit(
        '/api/v1/passenger/bookings/11111111-1111-1111-1111-111111111111/payment'
      )
    ).toBe(true);
  });

  it('uses backend booking-id financial idempotency keys', () => {
    expect(FinancialIdempotencyKey.payment('abc')).toBe('booking:abc:payment');
    expect(FinancialIdempotencyKey.capture('abc')).toBe('booking:abc:capture');
    expect(FinancialIdempotencyKey.paymentCancel('abc')).toBe('booking:abc:payment-cancel');
    expect(FinancialIdempotencyKey.transfer('abc')).toBe('booking:abc:transfer');
    expect(FinancialIdempotencyKey.refund('abc', '1')).toBe('booking:abc:refund:1');
  });
});

describe('Stripe Phase A — money minor units', () => {
  it('converts major decimal strings without floating point', () => {
    expect(majorToMinorUnits('120.50')).toBe(12050);
    expect(majorToMinorUnits('80.00')).toBe(8000);
    expect(majorToMinorUnits('0.01')).toBe(1);
    expect(minorToMajorString(12050)).toBe('120.50');
    expect(isMinorUnitAmount(12050)).toBe(true);
    expect(isMinorUnitAmount(12.5)).toBe(false);
  });

  it('rejects more than two decimal places', () => {
    expect(() => majorToMinorUnits('10.123')).toThrow();
  });

  it('stores ledger amounts as integer minor units in schema', () => {
    expect(bookingPayments.grossAmount.columnType).toBe('PgBigInt53');
    expect(bookingSettlements.grossAmount.columnType).toBe('PgBigInt53');
    expect(isMinorUnitAmount(12050)).toBe(true);
    expect(BOOKING_PAYMENT_STATUSES).toContain('authorized');
    expect(BOOKING_PAYMENT_STATUSES).toContain('captured');
  });
});

describe('Stripe Phase A — uniqueness in schema and migration', () => {
  it('declares unique booking_id on payments, settlements, and stripe event id', () => {
    const paymentCfg = getTableConfig(bookingPayments);
    const settlementCfg = getTableConfig(bookingSettlements);
    const webhookCfg = getTableConfig(stripeWebhookEvents);
    const paymentNames = paymentCfg.indexes.map((idx) => idx.config.name);
    const settlementNames = settlementCfg.indexes.map((idx) => idx.config.name);
    const webhookNames = webhookCfg.indexes.map((idx) => idx.config.name);
    expect(paymentNames).toContain('uq_booking_payments_booking_id');
    expect(settlementNames).toContain('uq_booking_settlements_booking_id');
    expect(webhookNames).toContain('uq_stripe_webhook_events_stripe_event_id');
  });

  it('migration creates unique indexes and does not rewrite fare or status', () => {
    const sql = fs.readFileSync(
      path.join(__dirname, '../src/db/migrations/0027_stripe_payment_foundation.sql'),
      'utf8'
    );
    expect(sql).toContain('uq_booking_payments_booking_id');
    expect(sql).toContain('uq_booking_settlements_booking_id');
    expect(sql).toContain('uq_stripe_webhook_events_stripe_event_id');
    expect(sql).toContain('"gross_amount" bigint NOT NULL');
    expect(sql).not.toMatch(/UPDATE\s+"bookings"/i);
    expect(sql).not.toMatch(/DROP TABLE\s+"bookings"/i);
    expect(sql).not.toMatch(/ALTER TABLE "bookings"/i);
  });
});
