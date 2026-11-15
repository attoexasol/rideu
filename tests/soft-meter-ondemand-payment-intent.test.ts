import fs from 'fs';
import path from 'path';
import {
  DRAFT_SOFT_METER_RATES,
  METERED_CHARGING_RELEASED,
  MeterPaymentStatus,
  unconfiguredMeterRules,
} from '../src/constants/softMeter';
import { previewFare } from '../src/services/softMeter/fare';
import { UNPAID_ON_DEMAND_METER_STATUSES } from '../src/repositories/meterPayment.repository';
import {
  assessLegacyCheckout,
  browserReturnLeavesPaymentUnchanged,
  evaluateOnDemandPaymentIntentConfig,
  meterPaymentRequired,
  openOnDemandTestPaymentIntent,
  PAYMENT_INTENT_RECONCILE_MIN_INTERVAL_MS,
  pickLatestUnpaidMeterPayment,
  reconcileStoredOnDemandPaymentIntent,
  toOnDemandMeterPaymentView,
  type LegacyCheckoutSnapshot,
  type PaymentIntentReconcileState,
} from '../src/services/softMeter/onDemandMeterPayment';
import {
  applyPaymentSignal,
  assessStoredOnDemandPaymentIntent,
  interpretOnDemandPaymentIntentEvent,
  meterPaymentIntentWebhookDecision,
  type StoredPaymentIntentSnapshot,
} from '../src/services/softMeter/paymentState';
import type { RateSnapshot } from '../src/services/softMeter/rules';
import type { StoredTestPayment, TestFareInput, TestPaymentStore } from '../src/services/softMeter/testPayment';

const ONE_MILE_MM = 1_609_344;

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

function fareFor(): TestFareInput {
  const preview = previewFare(draftSnapshot(), ONE_MILE_MM, 90);
  return {
    id: 'fare-1',
    sessionId: 'session-1',
    totalCents: preview.totalCents,
    currency: 'USD',
    billable: false,
    chargingEnabled: false,
    acceptedDistanceMillimeters: ONE_MILE_MM,
    waitingSeconds: 90,
    waitingChargeCents: preview.waitingChargeCents,
    rateSnapshot: draftSnapshot(),
  };
}

function pendingPayment(amountCents: number, patch: Partial<StoredTestPayment> = {}): StoredTestPayment {
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
    ...patch,
  };
}

function memoryStore(seed: StoredTestPayment) {
  let row = seed;
  const store: TestPaymentStore = {
    findByFare: async () => row,
    insert: async (next) => {
      row = next;
      return row;
    },
    update: async (_id, patch) => {
      row = { ...row, ...patch, id: row.id, updatedAtMs: 2 };
      return row;
    },
  };
  return { store, current: () => row };
}

function readyConfig() {
  return {
    paymentsFlag: 'true',
    sandboxFlag: undefined,
    nodeEnv: 'test',
    secretMode: 'test' as const,
    publishableMode: 'test' as const,
    webhookConfigured: true,
    successUrl: undefined,
    cancelUrl: undefined,
  };
}

function intent(patch: Partial<{
  id: string;
  clientSecret: string | null;
  amount: number;
  currency: string;
  status: string;
  livemode: boolean;
}> = {}) {
  return {
    id: 'pi_test_meter',
    clientSecret: 'pi_test_meter_secret',
    amount: 940,
    currency: 'usd',
    status: 'requires_payment_method',
    livemode: false,
    ...patch,
  };
}

describe('on-demand PaymentSheet PaymentIntent', () => {
  it('creates one test PaymentIntent for the finalized meter fare and reuses it', async () => {
    const fare = fareFor();
    expect(fare.totalCents).toBe(940);
    const memory = memoryStore(pendingPayment(fare.totalCents));
    let creates = 0;
    const open = () =>
      openOnDemandTestPaymentIntent({
        actorCustomerId: 'customer-1',
        booking: { id: 'booking-1', customerId: 'customer-1', status: 'completed' },
        session: { id: 'session-1', status: 'finalized' },
        fare,
        existing: memory.current(),
        config: readyConfig(),
        publishableKey: 'pk_test_123',
        store: memory.store,
        retrievePaymentIntent: async (id) => intent({ id, clientSecret: 'pi_test_meter_secret' }),
        createPaymentIntent: async (request) => {
          creates += 1;
          expect(request.amountCents).toBe(940);
          expect(request.currency).toBe('usd');
          expect(request.metadata.purpose).toBe('on_demand_meter_test');
          expect(request.idempotencyKey).toBe('ondemand_meter_pi:fare-1');
          return intent();
        },
      });

    const first = await open();
    const second = await open();
    expect(creates).toBe(1);
    expect(first.paymentIntentClientSecret).toBe('pi_test_meter_secret');
    expect(second.paymentIntentId).toBe('pi_test_meter');
    expect(second.paymentIntentClientSecret).toBe('pi_test_meter_secret');
    expect(first.finalFareCents).toBe(940);
    expect(first.currency).toBe('USD');
    expect(first.testMode).toBe(true);
    expect(first.paymentStatus).toBe('payment_pending');
    expect(memory.current().status).toBe(MeterPaymentStatus.PENDING);
  });

  it('rejects another passenger and does not mark paid when the sheet returns', async () => {
    const fare = fareFor();
    const memory = memoryStore(pendingPayment(fare.totalCents));
    await expect(
      openOnDemandTestPaymentIntent({
        actorCustomerId: 'customer-2',
        booking: { id: 'booking-1', customerId: 'customer-1', status: 'completed' },
        session: { id: 'session-1', status: 'finalized' },
        fare,
        existing: memory.current(),
        config: readyConfig(),
        publishableKey: 'pk_test_123',
        store: memory.store,
        retrievePaymentIntent: async () => intent(),
        createPaymentIntent: async () => intent(),
      })
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
    expect(browserReturnLeavesPaymentUnchanged(MeterPaymentStatus.PENDING)).toBe(
      MeterPaymentStatus.PENDING
    );
    expect(applyPaymentSignal(MeterPaymentStatus.PENDING, { type: 'customer_returned' }).markPaid).toBe(
      false
    );
  });

  it('serializes concurrent requests onto one PaymentIntent', async () => {
    const fare = fareFor();
    const memory = memoryStore(pendingPayment(fare.totalCents));
    let creates = 0;
    const call = () =>
      openOnDemandTestPaymentIntent({
        actorCustomerId: 'customer-1',
        booking: { id: 'booking-1', customerId: 'customer-1', status: 'completed' },
        session: { id: 'session-1', status: 'finalized' },
        fare,
        existing: memory.current(),
        config: readyConfig(),
        publishableKey: 'pk_test_123',
        store: memory.store,
        retrievePaymentIntent: async (id) => intent({ id }),
        createPaymentIntent: async () => {
          creates += 1;
          await new Promise((resolve) => setTimeout(resolve, 20));
          return intent();
        },
      });
    const [a, b] = await Promise.all([call(), call()]);
    expect(creates).toBe(1);
    expect(a.paymentIntentId).toBe(b.paymentIntentId);
  });

  it('does not create another charge after payment or refund, and replaces a canceled intent', async () => {
    const fare = fareFor();
    const paid = memoryStore(
      pendingPayment(fare.totalCents, {
        status: MeterPaymentStatus.PAID,
        stripePaymentIntentId: 'pi_paid',
      })
    );
    let creates = 0;
    const paidResult = await openOnDemandTestPaymentIntent({
      actorCustomerId: 'customer-1',
      booking: { id: 'booking-1', customerId: 'customer-1', status: 'completed' },
      session: { id: 'session-1', status: 'finalized' },
      fare,
      existing: paid.current(),
      config: readyConfig(),
      publishableKey: 'pk_test_123',
      store: paid.store,
      retrievePaymentIntent: async () => intent(),
      createPaymentIntent: async () => {
        creates += 1;
        return intent();
      },
    });
    expect(creates).toBe(0);
    expect(paidResult.paymentIntentClientSecret).toBeNull();

    const canceled = memoryStore(
      pendingPayment(fare.totalCents, {
        status: MeterPaymentStatus.CANCELLED,
        stripePaymentIntentId: 'pi_old',
      })
    );
    const keys: string[] = [];
    const replaced = await openOnDemandTestPaymentIntent({
      actorCustomerId: 'customer-1',
      booking: { id: 'booking-1', customerId: 'customer-1', status: 'completed' },
      session: { id: 'session-1', status: 'finalized' },
      fare,
      existing: canceled.current(),
      config: readyConfig(),
      publishableKey: 'pk_test_123',
      store: canceled.store,
      retrievePaymentIntent: async () => intent({ id: 'pi_old', status: 'canceled', clientSecret: null }),
      createPaymentIntent: async (request) => {
        keys.push(request.idempotencyKey);
        return intent({ id: 'pi_new' });
      },
    });
    expect(keys).toEqual(['ondemand_meter_pi:fare-1:pi_old']);
    expect(replaced.paymentIntentId).toBe('pi_new');
    expect(replaced.paymentStatus).toBe('payment_pending');
  });

  it('rejects a mismatched or live PaymentIntent and a hosted Checkout that is already open', async () => {
    const fare = fareFor();
    const memory = memoryStore(
      pendingPayment(fare.totalCents, { stripePaymentIntentId: 'pi_bad' })
    );
    await expect(
      openOnDemandTestPaymentIntent({
        actorCustomerId: 'customer-1',
        booking: { id: 'booking-1', customerId: 'customer-1', status: 'completed' },
        session: { id: 'session-1', status: 'finalized' },
        fare,
        existing: memory.current(),
        config: readyConfig(),
        publishableKey: 'pk_test_123',
        store: memory.store,
        retrievePaymentIntent: async () => intent({ amount: 100 }),
        createPaymentIntent: async () => intent(),
      })
    ).rejects.toMatchObject({ code: 'FARE_EVIDENCE_MISMATCH' });

    await expect(
      openOnDemandTestPaymentIntent({
        actorCustomerId: 'customer-1',
        booking: { id: 'booking-1', customerId: 'customer-1', status: 'completed' },
        session: { id: 'session-1', status: 'finalized' },
        fare,
        existing: memory.current(),
        config: readyConfig(),
        publishableKey: 'pk_test_123',
        store: memory.store,
        retrievePaymentIntent: async () => intent({ livemode: true }),
        createPaymentIntent: async () => intent(),
      })
    ).rejects.toMatchObject({ code: 'STRIPE_LIVE_MODE_REJECTED' });

    const checkout = memoryStore(
      pendingPayment(fare.totalCents, {
        status: MeterPaymentStatus.CHECKOUT_OPEN,
        stripeCheckoutSessionId: 'cs_test_existing',
      })
    );
    await expect(
      openOnDemandTestPaymentIntent({
        actorCustomerId: 'customer-1',
        booking: { id: 'booking-1', customerId: 'customer-1', status: 'completed' },
        session: { id: 'session-1', status: 'finalized' },
        fare,
        existing: checkout.current(),
        config: readyConfig(),
        publishableKey: 'pk_test_123',
        store: checkout.store,
        retrievePaymentIntent: async () => intent(),
        createPaymentIntent: async () => intent(),
      })
    ).rejects.toMatchObject({ code: 'ONDEMAND_CHECKOUT_RETIRED' });
    expect(evaluateOnDemandPaymentIntentConfig({ ...readyConfig(), secretMode: 'live' })).toMatchObject({
      action: 'reject',
      code: 'STRIPE_LIVE_CREDENTIALS_REJECTED',
    });
  });

  it('marks paid only from a verified PaymentIntent webhook and keeps recovery unpaid until then', () => {
    const paid = interpretOnDemandPaymentIntentEvent({
      type: 'payment_intent.succeeded',
      livemode: false,
      data: {
        object: {
          id: 'pi_test_meter',
          object: 'payment_intent',
          amount: 940,
          currency: 'usd',
          metadata: { purpose: 'on_demand_meter_test' },
          charges: { data: [{ receipt_url: 'https://pay.stripe.com/receipts/test' }] },
        },
      },
    });
    expect(paid.action).toBe('paid');
    expect(paid.receiptUrl).toBe('https://pay.stripe.com/receipts/test');
    expect(
      meterPaymentIntentWebhookDecision({
        action: 'paid',
        amount: 940,
        currency: 'usd',
        expectedAmountCents: 940,
        expectedCurrency: 'USD',
        currentStatus: MeterPaymentStatus.PENDING,
      })
    ).toMatchObject({ accept: true, status: MeterPaymentStatus.PAID, markPaid: true });
    expect(
      meterPaymentIntentWebhookDecision({
        action: 'paid',
        amount: 880,
        currency: 'usd',
        expectedAmountCents: 940,
        expectedCurrency: 'USD',
        currentStatus: MeterPaymentStatus.PENDING,
      })
    ).toMatchObject({ accept: false, failureCode: 'amount_mismatch', markPaid: false });
    expect(
      meterPaymentIntentWebhookDecision({
        action: 'failed',
        amount: 940,
        currency: 'usd',
        expectedAmountCents: 940,
        expectedCurrency: 'USD',
        currentStatus: MeterPaymentStatus.PENDING,
      }).status
    ).toBe(MeterPaymentStatus.FAILED);
    expect(
      meterPaymentIntentWebhookDecision({
        action: 'canceled',
        amount: 940,
        currency: 'usd',
        expectedAmountCents: 940,
        expectedCurrency: 'USD',
        currentStatus: MeterPaymentStatus.PENDING,
      }).status
    ).toBe(MeterPaymentStatus.CANCELLED);
    expect(
      applyPaymentSignal(MeterPaymentStatus.PAID, { type: 'webhook_refunded' }).status
    ).toBe(MeterPaymentStatus.REFUNDED);
    expect(
      meterPaymentIntentWebhookDecision({
        action: 'paid',
        amount: 940,
        currency: 'usd',
        expectedAmountCents: 940,
        expectedCurrency: 'USD',
        currentStatus: MeterPaymentStatus.PENDING,
      }).markPaid
    ).toBe(true);
    expect(
      interpretOnDemandPaymentIntentEvent({
        type: 'payment_intent.succeeded',
        livemode: true,
        data: { object: { id: 'pi_live', metadata: { purpose: 'on_demand_meter_test' } } },
      }).action
    ).toBe('ignore');
    expect(
      interpretOnDemandPaymentIntentEvent({
        type: 'payment_intent.succeeded',
        livemode: false,
        data: { object: { id: 'pi_walk', metadata: { purpose: 'walk_up_meter_test' } } },
      }).reason
    ).toBe('not_on_demand_meter_payment_intent');
    expect(applyPaymentSignal(MeterPaymentStatus.FAILED, { type: 'retry_requested' }).status).toBe(
      MeterPaymentStatus.PENDING
    );
  });

  it('reconciles a paid legacy Checkout without a second PaymentIntent and retires an unpaid one', async () => {
    const fare = fareFor();
    const paidSnap = (status: LegacyCheckoutSnapshot['status']): LegacyCheckoutSnapshot => ({
      status,
      paymentStatus: status === 'complete' ? 'paid' : 'unpaid',
      livemode: false,
      amountTotal: 940,
      currency: 'usd',
      purpose: 'on_demand_meter_test',
      bookingId: 'booking-1',
      paymentIntent: {
        id: 'pi_legacy',
        status: status === 'complete' ? 'succeeded' : 'requires_payment_method',
        livemode: false,
        amount: 940,
        currency: 'usd',
        receiptUrl: 'https://pay.stripe.com/receipts/legacy',
      },
    });
    expect(
      assessLegacyCheckout({
        expectedBookingId: 'booking-1',
        expectedAmountCents: 940,
        snapshot: paidSnap('complete'),
      })
    ).toBe('paid');
    expect(
      assessLegacyCheckout({
        expectedBookingId: 'booking-1',
        expectedAmountCents: 940,
        snapshot: { ...paidSnap('open'), paymentStatus: 'unpaid' },
      })
    ).toBe('retire');
    expect(
      assessLegacyCheckout({
        expectedBookingId: 'booking-1',
        expectedAmountCents: 940,
        snapshot: {
          ...paidSnap('open'),
          paymentStatus: 'unpaid',
          paymentIntent: { ...paidSnap('open').paymentIntent!, status: 'processing' },
        },
      })
    ).toBe('processing');
    expect(
      assessLegacyCheckout({
        expectedBookingId: 'other',
        expectedAmountCents: 940,
        snapshot: paidSnap('complete'),
      })
    ).toBe('blocked_identity');
    expect(
      assessLegacyCheckout({
        expectedBookingId: 'booking-1',
        expectedAmountCents: 100,
        snapshot: paidSnap('complete'),
      })
    ).toBe('blocked_amount');

    const paid = memoryStore(
      pendingPayment(fare.totalCents, {
        status: MeterPaymentStatus.CHECKOUT_OPEN,
        stripeCheckoutSessionId: 'cs_paid',
      })
    );
    let creates = 0;
    const reconciled = await openOnDemandTestPaymentIntent({
      actorCustomerId: 'customer-1',
      booking: { id: 'booking-1', customerId: 'customer-1', status: 'completed' },
      session: { id: 'session-1', status: 'finalized' },
      fare,
      existing: paid.current(),
      config: readyConfig(),
      publishableKey: 'pk_test_123',
      store: paid.store,
      retrieveCheckout: async () => paidSnap('complete'),
      expireCheckout: async () => {
        throw new Error('must not expire a paid session');
      },
      retrievePaymentIntent: async () => intent(),
      createPaymentIntent: async () => {
        creates += 1;
        return intent();
      },
    });
    expect(creates).toBe(0);
    expect(reconciled.paymentIntentClientSecret).toBeNull();
    expect(reconciled.paymentStatus).toBe('paid');
    expect(paid.current().stripePaymentIntentId).toBe('pi_legacy');
    expect(paid.current().stripeCheckoutSessionId).toBe('cs_paid');
    const again = await openOnDemandTestPaymentIntent({
      actorCustomerId: 'customer-1',
      booking: { id: 'booking-1', customerId: 'customer-1', status: 'completed' },
      session: { id: 'session-1', status: 'finalized' },
      fare,
      existing: paid.current(),
      config: readyConfig(),
      publishableKey: 'pk_test_123',
      store: paid.store,
      retrieveCheckout: async () => paidSnap('complete'),
      expireCheckout: async () => paidSnap('expired'),
      retrievePaymentIntent: async () => intent(),
      createPaymentIntent: async () => {
        creates += 1;
        return intent();
      },
    });
    expect(creates).toBe(0);
    expect(again.paymentStatus).toBe('paid');

    const open = memoryStore(
      pendingPayment(fare.totalCents, {
        status: MeterPaymentStatus.CHECKOUT_OPEN,
        stripeCheckoutSessionId: 'cs_open',
      })
    );
    let expired = 0;
    const replaced = await openOnDemandTestPaymentIntent({
      actorCustomerId: 'customer-1',
      booking: { id: 'booking-1', customerId: 'customer-1', status: 'completed' },
      session: { id: 'session-1', status: 'finalized' },
      fare,
      existing: open.current(),
      config: readyConfig(),
      publishableKey: 'pk_test_123',
      store: open.store,
      retrieveCheckout: async () => ({ ...paidSnap('open'), paymentStatus: 'unpaid', paymentIntent: null }),
      expireCheckout: async () => {
        expired += 1;
        return { ...paidSnap('expired'), paymentStatus: 'unpaid', paymentIntent: null };
      },
      retrievePaymentIntent: async (id) => intent({ id }),
      createPaymentIntent: async () => intent({ id: 'pi_new_sheet' }),
    });
    expect(expired).toBe(1);
    expect(replaced.paymentIntentId).toBe('pi_new_sheet');
    expect(open.current().stripeCheckoutSessionId).toBe('cs_open');

    const processing = memoryStore(
      pendingPayment(fare.totalCents, {
        status: MeterPaymentStatus.CHECKOUT_OPEN,
        stripeCheckoutSessionId: 'cs_processing',
      })
    );
    await expect(
      openOnDemandTestPaymentIntent({
        actorCustomerId: 'customer-1',
        booking: { id: 'booking-1', customerId: 'customer-1', status: 'completed' },
        session: { id: 'session-1', status: 'finalized' },
        fare,
        existing: processing.current(),
        config: readyConfig(),
        publishableKey: 'pk_test_123',
        store: processing.store,
        retrieveCheckout: async () => ({
          ...paidSnap('complete'),
          paymentStatus: 'unpaid',
          paymentIntent: { ...paidSnap('complete').paymentIntent!, status: 'processing' },
        }),
        expireCheckout: async () => {
          throw new Error('must not expire a processing payment');
        },
        retrievePaymentIntent: async () => intent(),
        createPaymentIntent: async () => intent(),
      })
    ).rejects.toMatchObject({ code: 'PAYMENT_PROCESSING' });
  });

  it('reconciles a succeeded PaymentIntent on read without a second charge', async () => {
    const fare = fareFor();
    const base = (): StoredPaymentIntentSnapshot => ({
      id: 'pi_sheet',
      status: 'succeeded',
      livemode: false,
      amount: fare.totalCents,
      currency: 'usd',
      receiptUrl: 'https://pay.stripe.com/receipts/sheet',
      purpose: 'on_demand_meter_test',
      bookingId: 'booking-1',
      meterPaymentId: 'pay-1',
      fareRecordId: 'fare-1',
      lastPaymentError: false,
    });
    const pending = pendingPayment(fare.totalCents, { stripePaymentIntentId: 'pi_sheet' });
    expect(
      assessStoredOnDemandPaymentIntent({
        expectedBookingId: 'booking-1',
        expectedPaymentId: 'pay-1',
        expectedFareRecordId: 'fare-1',
        expectedAmountCents: fare.totalCents,
        expectedCurrency: 'USD',
        storedPaymentIntentId: 'pi_sheet',
        snapshot: base(),
      })
    ).toBe('paid');
    expect(
      assessStoredOnDemandPaymentIntent({
        expectedBookingId: 'booking-1',
        expectedPaymentId: 'pay-1',
        expectedFareRecordId: 'fare-1',
        expectedAmountCents: fare.totalCents,
        expectedCurrency: 'USD',
        storedPaymentIntentId: 'pi_sheet',
        snapshot: { ...base(), status: 'processing' },
      })
    ).toBe('pending');
    expect(
      assessStoredOnDemandPaymentIntent({
        expectedBookingId: 'booking-1',
        expectedPaymentId: 'pay-1',
        expectedFareRecordId: 'fare-1',
        expectedAmountCents: fare.totalCents,
        expectedCurrency: 'USD',
        storedPaymentIntentId: 'pi_sheet',
        snapshot: { ...base(), status: 'requires_payment_method', lastPaymentError: true },
      })
    ).toBe('failed');
    expect(
      assessStoredOnDemandPaymentIntent({
        expectedBookingId: 'other',
        expectedPaymentId: 'pay-1',
        expectedFareRecordId: 'fare-1',
        expectedAmountCents: fare.totalCents,
        expectedCurrency: 'USD',
        storedPaymentIntentId: 'pi_sheet',
        snapshot: base(),
      })
    ).toBe('blocked_identity');
    expect(
      assessStoredOnDemandPaymentIntent({
        expectedBookingId: 'booking-1',
        expectedPaymentId: 'pay-1',
        expectedFareRecordId: 'fare-1',
        expectedAmountCents: fare.totalCents,
        expectedCurrency: 'USD',
        storedPaymentIntentId: 'pi_sheet',
        snapshot: { ...base(), amount: 100 },
      })
    ).toBe('blocked_amount');

    const memory = memoryStore(pending);
    const state: PaymentIntentReconcileState = { lastAttemptMs: null };
    let retrieves = 0;
    let commits = 0;
    const reconciled = await reconcileStoredOnDemandPaymentIntent({
      payment: memory.current(),
      bookingId: 'booking-1',
      expectedFareCents: fare.totalCents,
      nowMs: 1_000,
      state,
      retrievePaymentIntent: async () => {
        retrieves += 1;
        return base();
      },
      commit: async (verdict) => {
        commits += 1;
        const decision = meterPaymentIntentWebhookDecision({
          action: verdict.action,
          amount: verdict.amount,
          currency: verdict.currency,
          expectedAmountCents: fare.totalCents,
          expectedCurrency: 'USD',
          currentStatus: memory.current().status,
        });
        return memory.store.update(memory.current().id, {
          status: decision.status,
          receiptUrl: verdict.receiptUrl,
          paidAtMs: decision.markPaid ? 2_000 : null,
          stripePaymentIntentId: verdict.paymentIntentId,
        });
      },
    });
    expect(retrieves).toBe(1);
    expect(commits).toBe(1);
    expect(reconciled.status).toBe(MeterPaymentStatus.PAID);
    expect(reconciled.receiptUrl).toContain('receipts/sheet');
    const view = {
      bookingId: 'booking-1',
      rideStatus: 'completed',
      completedAt: null,
      meterSessionId: 'session-1',
      payment: reconciled,
    };
    const shown = toOnDemandMeterPaymentView(view);
    expect(shown.paymentStatus).toBe('paid');
    expect(shown.paymentRequired).toBe(false);
    expect(shown.finalFareCents).toBe(fare.totalCents);
    expect(shown.receiptAvailable).toBe(true);
    expect(shown.paymentVersion).toBe(2);

    const again = await reconcileStoredOnDemandPaymentIntent({
      payment: memory.current(),
      bookingId: 'booking-1',
      expectedFareCents: fare.totalCents,
      nowMs: 1_500,
      state,
      retrievePaymentIntent: async () => {
        retrieves += 1;
        return base();
      },
      commit: async () => {
        commits += 1;
        return memory.current();
      },
    });
    expect(again.status).toBe(MeterPaymentStatus.PAID);
    expect(retrieves).toBe(1);
    expect(commits).toBe(1);

    const duplicate = meterPaymentIntentWebhookDecision({
      action: 'paid',
      amount: fare.totalCents,
      currency: 'usd',
      expectedAmountCents: fare.totalCents,
      expectedCurrency: 'USD',
      currentStatus: MeterPaymentStatus.PAID,
    });
    expect(duplicate.markPaid).toBe(false);
    expect(duplicate.status).toBe(MeterPaymentStatus.PAID);

    const waiting = memoryStore(pendingPayment(fare.totalCents, { stripePaymentIntentId: 'pi_wait' }));
    const waitingState: PaymentIntentReconcileState = { lastAttemptMs: null };
    let waitingReads = 0;
    const readWaiting = (nowMs: number) =>
      reconcileStoredOnDemandPaymentIntent({
        payment: waiting.current(),
        bookingId: 'booking-1',
        expectedFareCents: fare.totalCents,
        nowMs,
        state: waitingState,
        retrievePaymentIntent: async () => {
          waitingReads += 1;
          return { ...base(), id: 'pi_wait', status: 'processing' };
        },
        commit: async () => {
          throw new Error('processing payment must not settle');
        },
      });
    expect((await readWaiting(5_000)).status).toBe(MeterPaymentStatus.PENDING);
    expect((await readWaiting(5_000 + PAYMENT_INTENT_RECONCILE_MIN_INTERVAL_MS - 1)).status).toBe(
      MeterPaymentStatus.PENDING
    );
    expect(waitingReads).toBe(1);

    const failed = memoryStore(pendingPayment(fare.totalCents, { stripePaymentIntentId: 'pi_fail' }));
    const failedRow = await reconcileStoredOnDemandPaymentIntent({
      payment: failed.current(),
      bookingId: 'booking-1',
      expectedFareCents: fare.totalCents,
      nowMs: 9_000,
      state: { lastAttemptMs: null },
      retrievePaymentIntent: async () => ({
        ...base(),
        id: 'pi_fail',
        status: 'requires_payment_method',
        lastPaymentError: true,
      }),
      commit: async (verdict) =>
        failed.store.update(failed.current().id, {
          status: verdict.action === 'failed' ? MeterPaymentStatus.FAILED : failed.current().status,
          failureCode: 'payment_intent_failed',
        }),
    });
    expect(failedRow.status).toBe(MeterPaymentStatus.FAILED);
    expect(applyPaymentSignal(failedRow.status, { type: 'retry_requested' }).status).toBe(
      MeterPaymentStatus.PENDING
    );

    const mismatched = memoryStore(pendingPayment(fare.totalCents, { stripePaymentIntentId: 'pi_bad' }));
    let blockedCommits = 0;
    const blocked = await reconcileStoredOnDemandPaymentIntent({
      payment: mismatched.current(),
      bookingId: 'booking-1',
      expectedFareCents: fare.totalCents,
      nowMs: 11_000,
      state: { lastAttemptMs: null },
      retrievePaymentIntent: async () => ({ ...base(), id: 'pi_bad', currency: 'eur' }),
      commit: async () => {
        blockedCommits += 1;
        return mismatched.current();
      },
    });
    expect(blocked.status).toBe(MeterPaymentStatus.PENDING);
    expect(blockedCommits).toBe(0);

    const legacy = memoryStore(
      pendingPayment(fare.totalCents, {
        status: MeterPaymentStatus.CHECKOUT_OPEN,
        stripeCheckoutSessionId: 'cs_legacy',
        stripePaymentIntentId: 'pi_legacy',
      })
    );
    let legacyReads = 0;
    const left = await reconcileStoredOnDemandPaymentIntent({
      payment: legacy.current(),
      bookingId: 'booking-1',
      expectedFareCents: fare.totalCents,
      nowMs: 12_000,
      state: { lastAttemptMs: null },
      retrievePaymentIntent: async () => {
        legacyReads += 1;
        return base();
      },
      commit: async () => legacy.current(),
    });
    expect(left.status).toBe(MeterPaymentStatus.CHECKOUT_OPEN);
    expect(legacyReads).toBe(0);

    expect(meterPaymentRequired(MeterPaymentStatus.PAID)).toBe(false);
    expect(UNPAID_ON_DEMAND_METER_STATUSES).not.toContain(MeterPaymentStatus.PAID);
    expect(
      pickLatestUnpaidMeterPayment([
        { completedAtMs: 2, status: MeterPaymentStatus.PAID },
        { completedAtMs: 1, status: MeterPaymentStatus.PENDING },
      ])?.status
    ).toBe(MeterPaymentStatus.PENDING);
    const reader = fs.readFileSync(
      path.join(__dirname, '../src/services/softMeter/onDemandMeterPayment.ts'),
      'utf8'
    );
    const reconciler = reader.slice(reader.indexOf('export async function reconcileStoredOnDemandPaymentIntent'));
    expect(reconciler.slice(0, reconciler.indexOf('export async function openOnDemandTestPaymentIntent'))).not.toContain(
      'createPaymentIntent'
    );
    expect(reconciler).not.toContain('paymentIntents.capture');
  });

  it('disables on-demand hosted Checkout and leaves walk-up, quotes, and production charging alone', () => {
    expect(METERED_CHARGING_RELEASED).toBe(false);
    const controller = fs.readFileSync(
      path.join(__dirname, '../src/controllers/passengerBooking.controller.ts'),
      'utf8'
    );
    const checkout = controller.slice(controller.indexOf('export async function passengerMeterCheckoutHandler'));
    expect(checkout).toContain('ONDEMAND_CHECKOUT_DISABLED');
    expect(checkout.slice(0, checkout.indexOf('export async function passengerMeterPaymentIntentHandler'))).not.toContain(
      'openPassengerOnDemandMeterCheckout'
    );
    const routes = fs.readFileSync(
      path.join(__dirname, '../src/routes/v1/passenger/index.ts'),
      'utf8'
    );
    expect(routes).toContain("'/bookings/:bookingId/meter-payment/payment-intent'");
    const walkUp = fs.readFileSync(
      path.join(__dirname, '../src/services/softMeter/testPayment.ts'),
      'utf8'
    );
    expect(walkUp).toContain('openWalkUpTestCheckout');
    const booking = fs.readFileSync(path.join(__dirname, '../src/services/booking.service.ts'), 'utf8');
    expect(booking).toContain('plan.createQuotePaymentIntent');
    expect(booking).not.toContain('paymentIntents.capture');
    const onDemand = fs.readFileSync(
      path.join(__dirname, '../src/services/softMeter/onDemandMeterPayment.service.ts'),
      'utf8'
    );
    expect(onDemand).toContain('paymentIntents.create');
    expect(onDemand).not.toContain('paymentIntents.capture');
    expect(onDemand).toContain("capture_method: 'automatic'");
  });
});
