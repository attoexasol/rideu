import fs from 'fs';
import path from 'path';
import {
  DRAFT_SOFT_METER_RATES,
  METERED_CHARGING_RELEASED,
  MeterPaymentStatus,
  MeterSessionStatus,
  MeterSettlementMode,
  TEST_ONLY_UNAPPROVED_TARIFF,
  unconfiguredMeterRules,
} from '../src/constants/softMeter';
import { previewFare } from '../src/services/softMeter/fare';
import { emptyTrackState, type GpsPointInput } from '../src/services/softMeter/gps';
import { applyPaymentSignal, interpretCheckoutEvent, interpretRefundEvent, onDemandSettlementView } from '../src/services/softMeter/paymentState';
import { applyGpsBatch, pauseSoftMeter, resumeSoftMeter, type SoftMeterClockState } from '../src/services/softMeter/pause';
import type { RateSnapshot } from '../src/services/softMeter/rules';
import {
  assertWalkUpTestFare,
  evaluateWalkUpStripeTestConfig,
  openWalkUpTestCheckout,
  toAdminMeterPayment,
  toWalkUpPaymentStatus,
  verifyTestCheckoutWebhook,
  type StoredTestPayment,
  type TestFareInput,
  type TestPaymentStore,
  type WalkUpStripeTestConfig,
} from '../src/services/softMeter/testPayment';
import { walkUpPaymentLinkSchema } from '../src/validators/softMeter';

const findMeterPaymentByIdempotency = jest.fn();
const insertMeterPayment = jest.fn();
const findMeterPaymentByCheckout = jest.fn();
const updateMeterPayment = jest.fn();
const findMeterPaymentByPaymentIntent = jest.fn();
const updateWalkUp = jest.fn();
const findWalkUpById = jest.fn();

jest.mock('../src/repositories/meterPayment.repository', () => ({
  findMeterPaymentByIdempotency: (...args: unknown[]) => findMeterPaymentByIdempotency(...args),
  findMeterPaymentByFare: jest.fn(),
  findMeterPaymentByCheckout: (...args: unknown[]) => findMeterPaymentByCheckout(...args),
  findMeterPaymentByPaymentIntent: (...args: unknown[]) => findMeterPaymentByPaymentIntent(...args),
  insertMeterPayment: (...args: unknown[]) => insertMeterPayment(...args),
  updateMeterPayment: (...args: unknown[]) => updateMeterPayment(...args),
  findMeterPaymentById: jest.fn(),
  listMeterPayments: jest.fn(),
}));

jest.mock('../src/repositories/walkUp.repository', () => ({
  updateWalkUp: (...args: unknown[]) => updateWalkUp(...args),
  findWalkUpById: (...args: unknown[]) => findWalkUpById(...args),
}));

jest.mock('../src/repositories/meterSession.repository', () => ({
  findFareBySession: jest.fn(),
  findMeterByWalkUp: jest.fn(),
}));

jest.mock('../src/services/softMeter/meterNotify.service', () => ({
  emitWalkUpPayment: jest.fn(),
  emitMeterUpdate: jest.fn(),
}));

import { handleMeterCheckoutWebhook, requestHostedMeterPayment } from '../src/services/softMeter/meterPayment.service';

const ROOT = path.resolve(__dirname, '..');
const DRIVER = 'driver-1';
const NOW = Date.parse('2026-10-31T12:00:00.000Z');

function errorCode(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

async function errorCodeAsync(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

function draftSnapshot(): RateSnapshot {
  return {
    scheduleId: 'sched-1',
    code: 'coronado_soft_meter',
    version: 1,
    status: 'draft',
    currency: 'USD',
    flagDropCents: DRAFT_SOFT_METER_RATES.flagDropCents,
    distanceRateCentsPerMile: DRAFT_SOFT_METER_RATES.distanceRateCentsPerMile,
    distanceIncrementMicroMiles: DRAFT_SOFT_METER_RATES.distanceIncrementMicroMiles,
    distanceIncrementCents: DRAFT_SOFT_METER_RATES.distanceIncrementCents,
    waitingCentsPerHour: DRAFT_SOFT_METER_RATES.waitingCentsPerHour,
    waitingCentsPerMinute: DRAFT_SOFT_METER_RATES.waitingCentsPerMinute,
    chargingEnabled: false,
    rules: unconfiguredMeterRules(),
    capturedAt: '2026-10-31T00:00:00.000Z',
  };
}

function readyConfig(overrides: Partial<WalkUpStripeTestConfig> = {}): WalkUpStripeTestConfig {
  return {
    paymentsFlag: 'true',
    sandboxFlag: undefined,
    nodeEnv: 'test',
    secretMode: 'test',
    publishableMode: 'test',
    webhookConfigured: true,
    successUrl: 'https://example.com/meter/ok',
    cancelUrl: 'https://example.com/meter/cancel',
    ...overrides,
  };
}

function fareFor(distanceMillimeters: number, waitingSeconds = 0): TestFareInput {
  const preview = previewFare(draftSnapshot(), distanceMillimeters, waitingSeconds);
  return {
    id: 'fare-1',
    sessionId: 'session-1',
    totalCents: preview.totalCents,
    currency: 'USD',
    billable: false,
    chargingEnabled: false,
    acceptedDistanceMillimeters: distanceMillimeters,
    waitingSeconds,
    waitingChargeCents: preview.waitingChargeCents,
    rateSnapshot: draftSnapshot(),
  };
}

function memoryStore(seed?: StoredTestPayment): TestPaymentStore & { current: () => StoredTestPayment | null } {
  let row = seed ?? null;
  return {
    current: () => row,
    findByFare: async () => row,
    insert: async (next) => {
      row = { ...next, id: next.id || 'pay-1' };
      return row;
    },
    update: async (id, patch) => {
      row = { ...(row as StoredTestPayment), ...patch, id };
      return row;
    },
  };
}

function point(id: string, latitude: number, recordedAtMs: number): GpsPointInput {
  return {
    clientPointId: id,
    latitude,
    longitude: -117.1831,
    accuracyMeters: 5,
    speedMps: 8,
    recordedAtMs,
  };
}

describe('walk-up Stripe test mode', () => {
  it('keeps test Checkout disabled unless the server flag and test credentials are set', () => {
    expect(evaluateWalkUpStripeTestConfig(readyConfig({ paymentsFlag: undefined })).action).toBe('disabled');
    expect(evaluateWalkUpStripeTestConfig(readyConfig({ paymentsFlag: 'false' })).action).toBe('disabled');
    expect(evaluateWalkUpStripeTestConfig(readyConfig({ paymentsFlag: 'TRUE' })).action).toBe('disabled');
    const live = evaluateWalkUpStripeTestConfig(readyConfig({ secretMode: 'live' }));
    expect(live).toMatchObject({ action: 'reject', code: 'STRIPE_LIVE_CREDENTIALS_REJECTED' });
    const livePublishable = evaluateWalkUpStripeTestConfig(readyConfig({ publishableMode: 'live' }));
    expect(livePublishable).toMatchObject({ action: 'reject', code: 'STRIPE_LIVE_CREDENTIALS_REJECTED' });
    const production = evaluateWalkUpStripeTestConfig(readyConfig({ nodeEnv: 'production' }));
    expect(production).toMatchObject({ action: 'reject', code: 'WALKUP_TEST_SANDBOX_NOT_AUTHORIZED' });
    const sandbox = evaluateWalkUpStripeTestConfig(
      readyConfig({ nodeEnv: 'production', sandboxFlag: 'authorized' })
    );
    expect(sandbox.action).toBe('ready');
    expect(evaluateWalkUpStripeTestConfig(readyConfig({ webhookConfigured: false }))).toMatchObject({
      action: 'reject',
      code: 'WALKUP_STRIPE_TEST_NOT_CONFIGURED',
    });
    expect(evaluateWalkUpStripeTestConfig(readyConfig({ successUrl: undefined })).action).toBe('reject');
    expect(walkUpPaymentLinkSchema.safeParse({ testMode: true }).success).toBe(false);
    expect(walkUpPaymentLinkSchema.safeParse({}).success).toBe(true);
    expect(walkUpPaymentLinkSchema.safeParse(undefined).success).toBe(true);
  });

  it('uses the server meter amount, including flag drop and completed miles, and excludes a pause', () => {
    const snapshot = draftSnapshot();
    const oneMile = 1_609_344;
    const priced = previewFare(snapshot, oneMile, 90);
    expect(priced.flagDropCents).toBe(420);
    expect(priced.distanceChargeCents).toBe(460);
    expect(priced.waitingChargeCents).toBe(60);
    expect(priced.unbilledStoppedRemainderSeconds).toBe(30);
    expect(priced.totalCents).toBe(940);
    expect(priced.billable).toBe(false);
    expect(assertWalkUpTestFare(fareFor(oneMile, 90))).toBeUndefined();

    let state: SoftMeterClockState = {
      status: MeterSessionStatus.RUNNING,
      driverId: DRIVER,
      tripKind: 'walk_up',
      startedAtMs: NOW - 100_000,
      stoppedAtMs: null,
      acceptedDistanceMillimeters: 0,
      waitingSeconds: 0,
      provisionalTotalCents: 420,
      totalPausedSeconds: 0,
      pausedAtMs: null,
      pauseReason: null,
      needsNewAnchor: false,
      stateVersion: 1,
      pauses: [],
      billable: false,
      track: {
        ...emptyTrackState(),
        lastAcceptedRecordedAtMs: NOW - 100_000,
        lastAcceptedLat: 32.6859,
        lastAcceptedLng: -117.1831,
        lastSequence: 1,
      },
    };
    state = pauseSoftMeter(state, NOW, DRIVER).state;
    const duringPause = applyGpsBatch(state, [point('pause-move', 32.7, NOW + 5_000)], NOW + 8_000);
    expect(duringPause.state.acceptedDistanceMillimeters).toBe(0);
    expect(previewFare(snapshot, duringPause.state.acceptedDistanceMillimeters, 0).totalCents).toBe(420);
    state = resumeSoftMeter(duringPause.state, NOW + 60_000, DRIVER).state;
    const after = applyGpsBatch(
      state,
      [
        point('anchor', 32.6864, NOW + 61_000),
        point('billable', 32.6882, NOW + 71_000),
      ],
      NOW + 80_000
    );
    expect(after.results[0].distanceDeltaMillimeters).toBe(0);
    expect(after.state.acceptedDistanceMillimeters).toBeGreaterThan(0);
    const continued = previewFare(snapshot, after.state.acceptedDistanceMillimeters, 0);
    expect(continued.totalCents).toBeGreaterThan(420);
    expect(continued.waitingChargeCents).toBe(0);
    expect(continued.billable).toBe(false);
    expect(
      errorCode(() =>
        assertWalkUpTestFare({
          ...fareFor(0),
          totalCents: 0,
        })
      )
    ).toBe('WALKUP_TEST_FARE_INVALID');
    expect(
      errorCode(() =>
        assertWalkUpTestFare({
          ...fareFor(oneMile),
          totalCents: 999,
        })
      )
    ).toBe('FARE_EVIDENCE_MISMATCH');
  });

  it('creates one test Checkout URL and replays it without a second session', async () => {
    const store = memoryStore();
    const seen: { amountCents: number; purpose: string; testOnly: string } = {
      amountCents: 0,
      purpose: '',
      testOnly: '',
    };
    const createCheckout = jest.fn(async (request: { amountCents: number; metadata: Record<string, string> }) => {
      seen.amountCents = request.amountCents;
      seen.purpose = request.metadata.purpose;
      seen.testOnly = request.metadata.testOnly;
      return {
        id: 'cs_test_1',
        url: 'https://checkout.stripe.com/c/pay/cs_test_1',
      };
    });
    const first = await openWalkUpTestCheckout({
      actorDriverId: DRIVER,
      trip: { id: 'trip-1', driverId: DRIVER, currency: 'USD', status: 'finalized' },
      session: { id: 'session-1', status: 'finalized' },
      fare: fareFor(1_609_344),
      config: readyConfig(),
      nowMs: NOW,
      store,
      createCheckout,
      expireCheckout: async () => 'expired',
    });
    const second = await openWalkUpTestCheckout({
      actorDriverId: DRIVER,
      trip: { id: 'trip-1', driverId: DRIVER, currency: 'USD', status: 'finalized' },
      session: { id: 'session-1', status: 'finalized' },
      fare: fareFor(1_609_344),
      config: readyConfig(),
      nowMs: NOW,
      store,
      createCheckout,
      expireCheckout: async () => 'expired',
    });
    expect(first.hostedUrl).toBe('https://checkout.stripe.com/c/pay/cs_test_1');
    expect(first.qrPayload).toBe(first.hostedUrl);
    expect(first.amountCents).toBe(880);
    expect(first.currency).toBe('USD');
    expect(first.testMode).toBe(true);
    expect(first.billable).toBe(false);
    expect(first.productionCharge).toBe(false);
    expect(first.fareClassification).toBe(TEST_ONLY_UNAPPROVED_TARIFF);
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.hostedUrl).toBe(first.hostedUrl);
    expect(createCheckout).toHaveBeenCalledTimes(1);
    expect(seen.amountCents).toBe(880);
    expect(seen.purpose).toBe('walk_up_meter_test');
    expect(seen.testOnly).toBe('true');
    expect(store.current()?.settlementMode).toBe(MeterSettlementMode.STRIPE_TEST);
    expect(store.current()?.testOnly).toBe(true);
  });

  it('does not create a second Checkout for a paid trip, another driver, or an expired session that was paid', async () => {
    const paid = memoryStore({
      id: 'pay-1',
      status: MeterPaymentStatus.PAID,
      hostedUrl: null,
      stripeCheckoutSessionId: 'cs_test_1',
      stripePaymentIntentId: 'pi_1',
      receiptUrl: 'https://pay.stripe.com/receipts/1',
      amountCents: 880,
      currency: 'USD',
      settlementMode: MeterSettlementMode.STRIPE_TEST,
      testOnly: true,
      fareClassification: TEST_ONLY_UNAPPROVED_TARIFF,
      expiresAtMs: NOW + 60_000,
      fareRecordId: 'fare-1',
      idempotencyKey: 'meter_checkout:fare-1',
      failureCode: null,
      paidAtMs: NOW,
      createdAtMs: NOW,
      updatedAtMs: NOW,
    });
    const createCheckout = jest.fn();
    const again = await openWalkUpTestCheckout({
      actorDriverId: DRIVER,
      trip: { id: 'trip-1', driverId: DRIVER, currency: 'USD', status: 'finalized' },
      session: { id: 'session-1', status: 'finalized' },
      fare: fareFor(1_609_344),
      config: readyConfig(),
      nowMs: NOW,
      store: paid,
      createCheckout,
      expireCheckout: async () => 'expired',
    });
    expect(again.idempotent).toBe(true);
    expect(again.paymentStatus).toBe('paid');
    expect(again.qrPayload).toBeNull();
    expect(createCheckout).not.toHaveBeenCalled();

    expect(
      await errorCodeAsync(() =>
        openWalkUpTestCheckout({
          actorDriverId: 'other-driver',
          trip: { id: 'trip-1', driverId: DRIVER, currency: 'USD', status: 'finalized' },
          session: { id: 'session-1', status: 'finalized' },
          fare: fareFor(1_609_344),
          config: readyConfig(),
          nowMs: NOW,
          store: memoryStore(),
          createCheckout,
          expireCheckout: async () => 'expired',
        })
      )
    ).toBe('WALK_UP_NOT_FOUND');

    const expired = memoryStore({
      id: 'pay-1',
      status: MeterPaymentStatus.CHECKOUT_OPEN,
      hostedUrl: 'https://checkout.stripe.com/c/pay/cs_old',
      stripeCheckoutSessionId: 'cs_old',
      stripePaymentIntentId: null,
      receiptUrl: null,
      amountCents: 880,
      currency: 'USD',
      settlementMode: MeterSettlementMode.STRIPE_TEST,
      testOnly: true,
      fareClassification: TEST_ONLY_UNAPPROVED_TARIFF,
      expiresAtMs: NOW - 1_000,
      fareRecordId: 'fare-1',
      idempotencyKey: 'meter_checkout:fare-1',
      failureCode: null,
      paidAtMs: null,
      createdAtMs: NOW - 60_000,
      updatedAtMs: NOW - 60_000,
    });
    const expireCheckout = jest.fn(async () => 'paid' as const);
    const recovered = await openWalkUpTestCheckout({
      actorDriverId: DRIVER,
      trip: { id: 'trip-1', driverId: DRIVER, currency: 'USD', status: 'finalized' },
      session: { id: 'session-1', status: 'finalized' },
      fare: fareFor(1_609_344),
      config: readyConfig(),
      nowMs: NOW,
      store: expired,
      createCheckout,
      expireCheckout,
    });
    expect(expireCheckout).toHaveBeenCalledWith('cs_old');
    expect(recovered.paymentStatus).toBe('paid');
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it('replaces an expired unpaid Checkout and confirms payment only from a matching test webhook', async () => {
    const store = memoryStore({
      id: 'pay-1',
      status: MeterPaymentStatus.CHECKOUT_OPEN,
      hostedUrl: 'https://checkout.stripe.com/c/pay/cs_old',
      stripeCheckoutSessionId: 'cs_old',
      stripePaymentIntentId: null,
      receiptUrl: null,
      amountCents: 880,
      currency: 'USD',
      settlementMode: MeterSettlementMode.STRIPE_TEST,
      testOnly: true,
      fareClassification: TEST_ONLY_UNAPPROVED_TARIFF,
      expiresAtMs: NOW - 5_000,
      fareRecordId: 'fare-1',
      idempotencyKey: 'meter_checkout:fare-1',
      failureCode: null,
      paidAtMs: null,
      createdAtMs: NOW,
      updatedAtMs: NOW,
    });
    const createCheckout = jest.fn(async () => ({
      id: 'cs_new',
      url: 'https://checkout.stripe.com/c/pay/cs_new',
    }));
    const replaced = await openWalkUpTestCheckout({
      actorDriverId: DRIVER,
      trip: { id: 'trip-1', driverId: DRIVER, currency: 'USD', status: 'finalized' },
      session: { id: 'session-1', status: 'finalized' },
      fare: fareFor(1_609_344),
      config: readyConfig(),
      nowMs: NOW,
      store,
      createCheckout,
      expireCheckout: async () => 'expired',
    });
    expect(replaced.stripeCheckoutSessionId).toBe('cs_new');
    expect(replaced.qrPayload).toBe('https://checkout.stripe.com/c/pay/cs_new');
    expect(createCheckout).toHaveBeenCalledTimes(1);

    const paid = verifyTestCheckoutWebhook({
      livemode: false,
      action: 'paid',
      amountTotal: 880,
      currency: 'usd',
      expectedAmountCents: 880,
      expectedCurrency: 'USD',
      currentStatus: MeterPaymentStatus.CHECKOUT_OPEN,
      testPayment: true,
    });
    expect(paid).toMatchObject({ acceptPaid: true, status: 'paid' });
    const duplicate = verifyTestCheckoutWebhook({
      livemode: false,
      action: 'paid',
      amountTotal: 880,
      currency: 'usd',
      expectedAmountCents: 880,
      expectedCurrency: 'USD',
      currentStatus: MeterPaymentStatus.PAID,
      testPayment: true,
    });
    expect(duplicate.acceptPaid).toBe(false);
    expect(duplicate.changed).toBe(false);
    expect(
      verifyTestCheckoutWebhook({
        livemode: false,
        action: 'paid',
        amountTotal: 100,
        currency: 'usd',
        expectedAmountCents: 880,
        expectedCurrency: 'USD',
        currentStatus: MeterPaymentStatus.CHECKOUT_OPEN,
        testPayment: true,
      }).failureCode
    ).toBe('AMOUNT_MISMATCH');
    expect(
      verifyTestCheckoutWebhook({
        livemode: false,
        action: 'paid',
        amountTotal: 880,
        currency: 'bdt',
        expectedAmountCents: 880,
        expectedCurrency: 'USD',
        currentStatus: MeterPaymentStatus.CHECKOUT_OPEN,
        testPayment: true,
      }).failureCode
    ).toBe('CURRENCY_MISMATCH');
    expect(
      verifyTestCheckoutWebhook({
        livemode: true,
        action: 'paid',
        amountTotal: 880,
        currency: 'usd',
        expectedAmountCents: 880,
        expectedCurrency: 'USD',
        currentStatus: MeterPaymentStatus.CHECKOUT_OPEN,
        testPayment: true,
      }).failureCode
    ).toBe('LIVE_MODE_REJECTED');
    expect(
      interpretCheckoutEvent({
        type: 'checkout.session.completed',
        livemode: true,
        data: {
          object: {
            id: 'cs_live',
            payment_status: 'paid',
            amount_total: 880,
            currency: 'usd',
            metadata: { purpose: 'walk_up_meter_test' },
          },
        },
      }).reason
    ).toBe('live_mode_rejected');
    expect(applyPaymentSignal(MeterPaymentStatus.CHECKOUT_OPEN, { type: 'customer_returned' }).markPaid).toBe(
      false
    );
    expect(applyPaymentSignal(MeterPaymentStatus.CHECKOUT_OPEN, { type: 'webhook_expired' }).status).toBe(
      'cancelled'
    );
    expect(applyPaymentSignal(MeterPaymentStatus.PAID, { type: 'webhook_refunded' }).status).toBe('refunded');
    expect(interpretRefundEvent({ type: 'charge.refunded', livemode: true }).action).toBe('ignore');

    const status = toWalkUpPaymentStatus({
      tripId: 'trip-1',
      tripStatus: 'finalized',
      currency: 'USD',
      tripPaymentStatus: 'checkout_open',
      nowMs: NOW,
      payment: store.current(),
      fare: {
        id: 'fare-1',
        totalCents: 880,
        billable: false,
        flagDropCents: 420,
        distanceChargeCents: 460,
        waitingChargeCents: 0,
        blockedReasons: ['METERED_CHARGING_NOT_RELEASED'],
        acceptedDistanceMillimeters: 1_609_344,
        createdAt: '2026-10-31T12:00:00.000Z',
      },
    });
    expect(status.testMode).toBe(true);
    expect(status.paid).toBe(false);
    expect(status.amountCents).toBe(880);
    expect(status.stripeCheckoutSessionId).toBe('cs_new');
    expect(status.receiptAvailable).toBe(false);
    expect(status.billable).toBe(false);
    expect(status.serverTime).toBe(new Date(NOW).toISOString());
    const admin = toAdminMeterPayment({
      id: 'pay-1',
      status: 'checkout_open',
      settlementMode: 'stripe_test',
      testOnly: true,
      fareClassification: TEST_ONLY_UNAPPROVED_TARIFF,
      stripeLivemode: false,
      amountCents: 880,
    });
    expect(admin.testMode).toBe(true);
    expect(admin.productionCharge).toBe(false);
    expect(admin.stripeLivemode).toBe(false);
  });

  it('confirms a verified test webhook once and rejects a mismatched amount', async () => {
    findMeterPaymentByCheckout.mockReset();
    updateMeterPayment.mockReset();
    updateWalkUp.mockReset();
    findWalkUpById.mockReset();
    findWalkUpById.mockResolvedValue({ id: 'trip-1', driverId: DRIVER });
    updateWalkUp.mockResolvedValue(null);
    const openPayment = {
      id: 'pay-1',
      status: MeterPaymentStatus.CHECKOUT_OPEN,
      settlementMode: MeterSettlementMode.STRIPE_TEST,
      testOnly: true,
      amountCents: 880,
      currency: 'USD',
      walkUpTripId: 'trip-1',
      stripePaymentIntentId: null,
      receiptUrl: null,
      hostedUrl: 'https://checkout.stripe.com/c/pay/cs_test_1',
      failureCode: null,
      paidAt: null,
    };
    findMeterPaymentByCheckout.mockResolvedValue(openPayment);
    updateMeterPayment.mockImplementation(async (_id: string, patch: { status: string }) => ({
      ...openPayment,
      ...patch,
    }));
    const event = {
      id: 'evt_test_paid',
      object: 'event',
      type: 'checkout.session.completed',
      livemode: false,
      data: {
        object: {
          id: 'cs_test_1',
          payment_status: 'paid',
          amount_total: 880,
          currency: 'usd',
          payment_intent: 'pi_test_1',
          metadata: { purpose: 'walk_up_meter_test', walkUpTripId: 'trip-1' },
        },
      },
    };
    await handleMeterCheckoutWebhook(event as never);
    expect(updateMeterPayment.mock.calls[0][1].status).toBe('paid');
    findMeterPaymentByCheckout.mockResolvedValue({ ...openPayment, status: MeterPaymentStatus.PAID });
    await handleMeterCheckoutWebhook(event as never);
    expect(updateMeterPayment).toHaveBeenCalledTimes(1);

    updateMeterPayment.mockClear();
    findMeterPaymentByCheckout.mockResolvedValue(openPayment);
    await handleMeterCheckoutWebhook({
      ...event,
      id: 'evt_bad_amount',
      data: { object: { ...event.data.object, amount_total: 100 } },
    } as never);
    expect(updateMeterPayment.mock.calls[0][1]).toMatchObject({
      status: 'failed',
      failureCode: 'AMOUNT_MISMATCH',
    });
  });

  it('leaves production charging and on-demand settlement unchanged', async () => {
    expect(METERED_CHARGING_RELEASED).toBe(false);
    const createCheckout = jest.fn();
    findMeterPaymentByIdempotency.mockResolvedValue(null);
    insertMeterPayment.mockResolvedValue({ id: 'pay-blocked', status: MeterPaymentStatus.NOT_BILLABLE });
    await expect(
      requestHostedMeterPayment({
        subjectType: 'walk_up',
        walkUpTripId: 'trip-1',
        fare: {
          id: 'fare-1',
          sessionId: 'session-1',
          totalCents: 880,
          currency: 'USD',
          billable: true,
          blockedReasons: [],
        },
        currency: 'USD',
        deps: { createCheckout },
      })
    ).rejects.toMatchObject({ code: 'METER_CHARGING_DISABLED' });
    expect(createCheckout).not.toHaveBeenCalled();
    expect(insertMeterPayment.mock.calls[0][0].status).toBe('not_billable');
    expect(
      onDemandSettlementView({ billable: false, blockedReasons: ['METERED_CHARGING_NOT_RELEASED'] })
        .captureMeterFare
    ).toBe(false);

    const migration36 = fs.readFileSync(path.join(ROOT, 'src/db/migrations/0036_soft_meter.sql'), 'utf8');
    const migration38 = fs.readFileSync(path.join(ROOT, 'src/db/migrations/0038_walkup_stripe_test.sql'), 'utf8');
    const onDemand = fs.readFileSync(path.join(ROOT, 'src/services/softMeter/onDemandMeter.service.ts'), 'utf8');
    expect(migration36).toContain('billable" = false');
    expect(migration36).toContain('charging_enabled" = false');
    expect(migration38).toContain('stripe_livemode" = false');
    expect(migration38).toContain("settlement_mode\" = 'production_disabled'");
    expect(onDemand).not.toContain('openWalkUpTestCheckout');
    expect(onDemand).not.toContain('walk_up_meter_test');
  });
});
