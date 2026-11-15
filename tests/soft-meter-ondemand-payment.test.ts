import fs from 'fs';
import path from 'path';
import {
  DRAFT_SOFT_METER_RATES,
  METERED_CHARGING_RELEASED,
  MeterPaymentStatus,
  unconfiguredMeterRules,
} from '../src/constants/softMeter';
import { previewFare } from '../src/services/softMeter/fare';
import {
  browserReturnLeavesPaymentUnchanged,
  evaluateOnDemandStripeTestConfig,
  onDemandCompletionSettlement,
  openOnDemandTestCheckout,
  pickLatestUnpaidMeterPayment,
  readOnDemandStripeTestConfig,
  toOnDemandMeterPaymentView,
} from '../src/services/softMeter/onDemandMeterPayment';
import { applyPaymentSignal } from '../src/services/softMeter/paymentState';
import type { RateSnapshot } from '../src/services/softMeter/rules';
import {
  readWalkUpStripeTestConfig,
  verifyTestCheckoutWebhook,
  type StoredTestPayment,
  type TestFareInput,
  type TestPaymentStore,
} from '../src/services/softMeter/testPayment';
import { onDemandMeterCheckoutSchema } from '../src/validators/softMeter';

const ONE_MILE_MM = 1_609_344;
const CUSTOMER = 'customer-1';
const OTHER = 'customer-2';

function draftSnapshot(): RateSnapshot {
  return {
    scheduleId: 'rate-1',
    code: 'coronado_soft_meter',
    version: 1,
    status: 'active',
    currency: 'USD',
    flagDropCents: DRAFT_SOFT_METER_RATES.flagDropCents,
    distanceRateCentsPerMile: DRAFT_SOFT_METER_RATES.distanceRateCentsPerMile,
    distanceIncrementMicroMiles: DRAFT_SOFT_METER_RATES.distanceIncrementMicroMiles,
    distanceIncrementCents: DRAFT_SOFT_METER_RATES.distanceIncrementCents,
    waitingCentsPerHour: DRAFT_SOFT_METER_RATES.waitingCentsPerHour,
    waitingCentsPerMinute: DRAFT_SOFT_METER_RATES.waitingCentsPerMinute,
    chargingEnabled: false,
    rules: unconfiguredMeterRules(),
    capturedAt: '2026-11-02T00:00:00.000Z',
  };
}

function fareFor(waitingSeconds = 0): TestFareInput {
  const preview = previewFare(draftSnapshot(), ONE_MILE_MM, waitingSeconds);
  return {
    id: 'fare-1',
    sessionId: 'session-1',
    totalCents: preview.totalCents,
    currency: 'USD',
    billable: false,
    chargingEnabled: false,
    acceptedDistanceMillimeters: ONE_MILE_MM,
    waitingSeconds,
    waitingChargeCents: preview.waitingChargeCents,
    rateSnapshot: draftSnapshot(),
  };
}

function pendingPayment(amountCents: number): StoredTestPayment {
  return {
    id: 'pay-1',
    status: MeterPaymentStatus.PENDING,
    hostedUrl: null,
    stripeCheckoutSessionId: null,
    stripePaymentIntentId: null,
    receiptUrl: null,
    amountCents,
    currency: 'USD',
    settlementMode: 'stripe_test',
    testOnly: true,
    fareClassification: 'test_only_unapproved_tariff',
    expiresAtMs: null,
    fareRecordId: 'fare-1',
    idempotencyKey: 'meter_checkout:fare-1',
    failureCode: null,
    paidAtMs: null,
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

function memoryStore(seed: StoredTestPayment): TestPaymentStore & { current: () => StoredTestPayment } {
  let row = seed;
  return {
    current: () => row,
    findByFare: async () => row,
    insert: async (next) => {
      row = next;
      return row;
    },
    update: async (_id, patch) => {
      row = { ...row, ...patch, id: row.id };
      return row;
    },
  };
}

function readyConfig() {
  return {
    paymentsFlag: 'true',
    sandboxFlag: undefined,
    nodeEnv: 'test',
    secretMode: 'test' as const,
    publishableMode: 'test' as const,
    webhookConfigured: true,
    successUrl: 'https://example.com/meter/ok',
    cancelUrl: 'https://example.com/meter/cancel',
  };
}

describe('on-demand metered payment', () => {
  it('keeps booking creation free of a quote capture and settles a meter ride without capturing the quote', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/services/booking.service.ts'), 'utf8');
    const confirm = src.slice(
      src.indexOf('export async function confirmBooking'),
      src.indexOf('export async function updateBookingStatusByDriver')
    );
    expect(confirm).toContain('prepareCardPaymentForBooking');
    expect(confirm).not.toContain('captureAuthorizedBookingPayment');
    expect(confirm).not.toContain('paymentIntents.capture');

    const complete = src.slice(src.indexOf('export async function updateBookingStatusByDriver'));
    expect(complete).toContain('ensureOnDemandMeterSettlement');
    expect(complete).toContain('isCard && !metered');
    expect(complete).toContain('!isCard && !metered');
    expect(onDemandCompletionSettlement({
      hasMeterSession: false,
      meterVoided: false,
      quoteAlreadyCaptured: false,
    })).toBe('capture_quote');
    expect(onDemandCompletionSettlement({
      hasMeterSession: true,
      meterVoided: false,
      quoteAlreadyCaptured: false,
    })).toBe('release_quote_and_meter_test');
    expect(onDemandCompletionSettlement({
      hasMeterSession: true,
      meterVoided: false,
      quoteAlreadyCaptured: true,
    })).toBe('leave_historical_quote');
  });

  it('opens Stripe test Checkout for the finalized meter total and reuses the open session', async () => {
    const fare = fareFor(90);
    expect(fare.totalCents).toBe(940);
    expect(fare.waitingChargeCents).toBe(60);
    const seen: { amountCents?: number; purpose?: string } = {};
    const store = memoryStore(pendingPayment(fare.totalCents));
    const opened = await openOnDemandTestCheckout({
      actorCustomerId: CUSTOMER,
      booking: { id: 'booking-1', customerId: CUSTOMER, status: 'completed' },
      session: { id: 'session-1', status: 'finalized' },
      fare,
      existing: store.current(),
      config: readyConfig(),
      nowMs: Date.parse('2026-11-02T12:00:00.000Z'),
      store,
      createCheckout: async (request) => {
        seen.amountCents = request.amountCents;
        seen.purpose = request.metadata.purpose;
        return { id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' };
      },
      expireCheckout: async () => 'expired',
    });
    expect(seen.amountCents).toBe(940);
    expect(seen.purpose).toBe('on_demand_meter_test');
    expect(opened.status).toBe('checkout_open');
    expect(opened.amountCents).toBe(940);

    const again = await openOnDemandTestCheckout({
      actorCustomerId: CUSTOMER,
      booking: { id: 'booking-1', customerId: CUSTOMER, status: 'completed' },
      session: { id: 'session-1', status: 'finalized' },
      fare,
      existing: store.current(),
      config: readyConfig(),
      nowMs: Date.parse('2026-11-02T12:05:00.000Z'),
      store,
      createCheckout: async () => {
        throw new Error('second session');
      },
      expireCheckout: async () => 'expired',
    });
    expect(again.stripeCheckoutSessionId).toBe('cs_test_1');
    expect(again.hostedUrl).toBe('https://checkout.stripe.com/c/pay/cs_test_1');
  });

  it('replaces an expired Checkout, retries a failed payment, and refuses a second charge after payment or refund', async () => {
    const fare = fareFor(0);
    const store = memoryStore({
      ...pendingPayment(880),
      status: MeterPaymentStatus.CHECKOUT_OPEN,
      hostedUrl: 'https://checkout.stripe.com/old',
      stripeCheckoutSessionId: 'cs_old',
      expiresAtMs: Date.parse('2026-11-02T11:00:00.000Z'),
    });
    const replaced = await openOnDemandTestCheckout({
      actorCustomerId: CUSTOMER,
      booking: { id: 'booking-1', customerId: CUSTOMER, status: 'completed' },
      session: { id: 'session-1', status: 'finalized' },
      fare,
      existing: store.current(),
      config: readyConfig(),
      nowMs: Date.parse('2026-11-02T12:00:00.000Z'),
      store,
      createCheckout: async (request) => {
        expect(request.amountCents).toBe(880);
        return { id: 'cs_new', url: 'https://checkout.stripe.com/new' };
      },
      expireCheckout: async () => 'expired',
    });
    expect(replaced.stripeCheckoutSessionId).toBe('cs_new');

    store.current().status = MeterPaymentStatus.FAILED;
    store.current().hostedUrl = null;
    const retried = await openOnDemandTestCheckout({
      actorCustomerId: CUSTOMER,
      booking: { id: 'booking-1', customerId: CUSTOMER, status: 'completed' },
      session: { id: 'session-1', status: 'finalized' },
      fare,
      existing: store.current(),
      config: readyConfig(),
      nowMs: Date.parse('2026-11-02T13:00:00.000Z'),
      store,
      createCheckout: async (request) => {
        expect(request.amountCents).toBe(880);
        return { id: 'cs_retry', url: 'https://checkout.stripe.com/retry' };
      },
      expireCheckout: async () => 'expired',
    });
    expect(retried.status).toBe('checkout_open');

    const paid = { ...store.current(), status: MeterPaymentStatus.PAID, hostedUrl: null, paidAtMs: 5 };
    const paidStore = memoryStore(paid);
    let charged = false;
    const second = await openOnDemandTestCheckout({
      actorCustomerId: CUSTOMER,
      booking: { id: 'booking-1', customerId: CUSTOMER, status: 'completed' },
      session: { id: 'session-1', status: 'finalized' },
      fare,
      existing: paid,
      config: readyConfig(),
      nowMs: Date.parse('2026-11-02T14:00:00.000Z'),
      store: paidStore,
      createCheckout: async () => {
        charged = true;
        return { id: 'cs_no', url: 'https://checkout.stripe.com/no' };
      },
      expireCheckout: async () => 'expired',
    });
    expect(charged).toBe(false);
    expect(second.status).toBe('paid');

    const refunded = applyPaymentSignal(MeterPaymentStatus.PAID, { type: 'webhook_refunded' });
    expect(refunded.status).toBe('refunded');
    const refundStore = memoryStore({ ...paid, status: MeterPaymentStatus.REFUNDED });
    const afterRefund = await openOnDemandTestCheckout({
      actorCustomerId: CUSTOMER,
      booking: { id: 'booking-1', customerId: CUSTOMER, status: 'completed' },
      session: { id: 'session-1', status: 'finalized' },
      fare,
      existing: refundStore.current(),
      config: readyConfig(),
      nowMs: Date.parse('2026-11-02T15:00:00.000Z'),
      store: refundStore,
      createCheckout: async () => {
        charged = true;
        return { id: 'cs_refund', url: 'https://checkout.stripe.com/refund' };
      },
      expireCheckout: async () => 'expired',
    });
    expect(afterRefund.status).toBe('refunded');
    expect(charged).toBe(false);
  });

  it('rejects a mismatched amount, the wrong currency, a live event, a browser return, and another passenger', async () => {
    const fare = fareFor(0);
    expect(verifyTestCheckoutWebhook({
      livemode: false,
      action: 'paid',
      amountTotal: 880,
      currency: 'usd',
      expectedAmountCents: 880,
      expectedCurrency: 'USD',
      currentStatus: 'checkout_open',
      testPayment: true,
    }).acceptPaid).toBe(true);
    expect(verifyTestCheckoutWebhook({
      livemode: false,
      action: 'paid',
      amountTotal: 2500,
      currency: 'usd',
      expectedAmountCents: 880,
      expectedCurrency: 'USD',
      currentStatus: 'checkout_open',
      testPayment: true,
    }).failureCode).toBe('AMOUNT_MISMATCH');
    expect(verifyTestCheckoutWebhook({
      livemode: false,
      action: 'paid',
      amountTotal: 880,
      currency: 'bdt',
      expectedAmountCents: 880,
      expectedCurrency: 'USD',
      currentStatus: 'checkout_open',
      testPayment: true,
    }).failureCode).toBe('CURRENCY_MISMATCH');
    expect(verifyTestCheckoutWebhook({
      livemode: true,
      action: 'paid',
      amountTotal: 880,
      currency: 'usd',
      expectedAmountCents: 880,
      expectedCurrency: 'USD',
      currentStatus: 'checkout_open',
      testPayment: true,
    }).failureCode).toBe('LIVE_MODE_REJECTED');
    expect(browserReturnLeavesPaymentUnchanged(MeterPaymentStatus.CHECKOUT_OPEN)).toBe('checkout_open');
    expect(browserReturnLeavesPaymentUnchanged(MeterPaymentStatus.PENDING)).toBe('pending');

    await expect(
      openOnDemandTestCheckout({
        actorCustomerId: OTHER,
        booking: { id: 'booking-1', customerId: CUSTOMER, status: 'completed' },
        session: { id: 'session-1', status: 'finalized' },
        fare,
        existing: pendingPayment(880),
        config: readyConfig(),
        nowMs: Date.now(),
        store: memoryStore(pendingPayment(880)),
        createCheckout: async () => ({ id: 'cs', url: 'https://checkout.stripe.com/x' }),
        expireCheckout: async () => 'expired',
      })
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });

    await expect(
      openOnDemandTestCheckout({
        actorCustomerId: CUSTOMER,
        booking: { id: 'booking-1', customerId: CUSTOMER, status: 'completed' },
        session: { id: 'session-1', status: 'finalized' },
        fare,
        existing: pendingPayment(2500),
        config: readyConfig(),
        nowMs: Date.now(),
        store: memoryStore(pendingPayment(2500)),
        createCheckout: async () => ({ id: 'cs', url: 'https://checkout.stripe.com/x' }),
        expireCheckout: async () => 'expired',
      })
    ).rejects.toMatchObject({ code: 'FARE_EVIDENCE_MISMATCH' });
  });

  it('keeps an unpaid completed ride recoverable and ignores the original quote', () => {
    const fare = fareFor(90);
    const view = toOnDemandMeterPaymentView({
      bookingId: 'booking-1',
      rideStatus: 'completed',
      completedAt: '2026-11-02T12:00:00.000Z',
      meterSessionId: 'session-1',
      payment: pendingPayment(fare.totalCents),
    });
    expect(view.rideStatus).toBe('completed');
    expect(view.paymentStatus).toBe('payment_pending');
    expect(view.paymentRequired).toBe(true);
    expect(view.paymentMode).toBe('stripe_test');
    expect(view.finalFareCents).toBe(940);
    expect(view.currency).toBe('USD');
    expect(view.finalFareCents).not.toBe(2500);
    expect(view.testMode).toBe(true);
    expect(view.receiptAvailable).toBe(false);
    expect(view.productionCharge).toBe(false);
    const latest = pickLatestUnpaidMeterPayment([
      { id: 'old', completedAtMs: 10, status: 'pending' },
      { id: 'paid', completedAtMs: 30, status: 'paid' },
      { id: 'newest', completedAtMs: 20, status: 'failed' },
    ]);
    expect(latest?.id).toBe('newest');
    expect(onDemandMeterCheckoutSchema.safeParse({ amount: 940, testMode: true, currency: 'USD' }).success).toBe(
      false
    );
    expect(onDemandMeterCheckoutSchema.safeParse({}).success).toBe(true);
  });

  it('leaves walk-up test Checkout and production charging unchanged', () => {
    expect(METERED_CHARGING_RELEASED).toBe(false);
    expect(evaluateOnDemandStripeTestConfig({ ...readyConfig(), secretMode: 'live' })).toMatchObject({
      action: 'reject',
      code: 'STRIPE_LIVE_CREDENTIALS_REJECTED',
    });
    expect(evaluateOnDemandStripeTestConfig({ ...readyConfig(), paymentsFlag: undefined })).toMatchObject({
      action: 'disabled',
    });
    const walkUp = readWalkUpStripeTestConfig({
      ONDEMAND_STRIPE_TEST_PAYMENTS: 'true',
      STRIPE_SECRET_KEY: 'sk_test_123',
    } as NodeJS.ProcessEnv);
    expect(walkUp.paymentsFlag).toBeUndefined();
    expect(readOnDemandStripeTestConfig({ WALKUP_STRIPE_TEST_PAYMENTS: 'true' } as NodeJS.ProcessEnv).paymentsFlag).toBeUndefined();
    const purposes = fs.readFileSync(path.join(__dirname, '../src/constants/softMeter.ts'), 'utf8');
    expect(purposes).toContain("WALK_UP_TEST: 'walk_up_meter_test'");
    expect(purposes).toContain('METERED_CHARGING_RELEASED = false');
    const meterPayment = fs.readFileSync(
      path.join(__dirname, '../src/services/softMeter/meterPayment.service.ts'),
      'utf8'
    );
    expect(meterPayment).not.toContain('paymentIntents.capture');
    expect(meterPayment).not.toContain('captureAuthorizedBookingPayment');
    const onDemand = fs.readFileSync(
      path.join(__dirname, '../src/services/softMeter/onDemandMeterPayment.service.ts'),
      'utf8'
    );
    expect(onDemand).toContain('releaseCardPaymentAuthorization');
    expect(onDemand).not.toContain('paymentIntents.capture');
    expect(onDemand).not.toContain('captureAuthorizedBookingPayment');
  });
});
