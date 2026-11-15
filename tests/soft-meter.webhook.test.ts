import express from 'express';
import request from 'supertest';
import Stripe from 'stripe';
import stripeWebhookRoutes from '../src/routes/v1/webhooks/stripe';
import { errorHandler } from '../src/middleware/error-handler';
import { setStripeWebhookProcessHookForTests } from '../src/services/stripeWebhook.service';
import { MeterPaymentStatus } from '../src/constants/softMeter';

const claimStripeWebhookEvent = jest.fn();
const markStripeWebhookEventProcessed = jest.fn();
const markStripeWebhookEventFailed = jest.fn();
const findMeterPaymentByCheckout = jest.fn();
const updateMeterPayment = jest.fn();
const updateWalkUp = jest.fn();
const findWalkUpById = jest.fn();

jest.mock('../src/repositories/stripeWebhookEvent.repository', () => ({
  claimStripeWebhookEvent: (...args: unknown[]) => claimStripeWebhookEvent(...args),
  markStripeWebhookEventProcessed: (...args: unknown[]) => markStripeWebhookEventProcessed(...args),
  markStripeWebhookEventFailed: (...args: unknown[]) => markStripeWebhookEventFailed(...args),
  findStripeWebhookEventByStripeId: jest.fn(),
}));

jest.mock('../src/repositories/driverStripe.repository', () => ({
  findDriverByStripeAccountId: jest.fn().mockResolvedValue(null),
  findDriverById: jest.fn(),
  claimDriverStripeAccountId: jest.fn(),
  persistDriverStripeAccountSync: jest.fn(),
}));

jest.mock('../src/services/stripePaymentIntent.service', () => ({
  handleStripePaymentIntentEvent: jest.fn().mockResolvedValue({ bookingId: null, status: null }),
}));

jest.mock('../src/services/cardBookingActivation.service', () => ({
  activateAuthorizedCardBooking: jest.fn(),
}));

jest.mock('../src/services/stripeCapture.service', () => ({
  markBookingPaidIfCaptured: jest.fn(),
}));

jest.mock('../src/repositories/meterPayment.repository', () => ({
  findMeterPaymentByCheckout: (...args: unknown[]) => findMeterPaymentByCheckout(...args),
  updateMeterPayment: (...args: unknown[]) => updateMeterPayment(...args),
  findMeterPaymentByIdempotency: jest.fn(),
  findMeterPaymentByFare: jest.fn(),
  insertMeterPayment: jest.fn(),
  findMeterPaymentById: jest.fn(),
  listMeterPayments: jest.fn(),
}));

jest.mock('../src/repositories/walkUp.repository', () => ({
  updateWalkUp: (...args: unknown[]) => updateWalkUp(...args),
  findWalkUpById: (...args: unknown[]) => findWalkUpById(...args),
}));

jest.mock('../src/services/softMeter/meterNotify.service', () => ({
  emitWalkUpPayment: jest.fn(),
  emitMeterUpdate: jest.fn(),
}));

const WEBHOOK_SECRET = 'whsec_soft_meter_test_secret';

function signedCheckout(eventId: string, paymentStatus: string) {
  const payload = JSON.stringify({
    id: eventId,
    object: 'event',
    api_version: '2026-08-26.dahlia',
    created: 1_700_000_000,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_meter_1',
        object: 'checkout.session',
        payment_status: paymentStatus,
        payment_intent: 'pi_meter_1',
        metadata: {
          purpose: 'walk_up_meter',
          walkUpTripId: '11111111-1111-1111-1111-111111111111',
          fareRecordId: '22222222-2222-2222-2222-222222222222',
          meterSessionId: '33333333-3333-3333-3333-333333333333',
        },
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
  });
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return { payload, signature };
}

function createApp() {
  const app = express();
  app.use('/api/v1/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookRoutes);
  app.use(express.json());
  app.use(errorHandler);
  return app;
}

describe('soft meter Stripe webhook verification', () => {
  const savedWebhook = process.env.STRIPE_WEBHOOK_SECRET;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    claimStripeWebhookEvent.mockReset();
    markStripeWebhookEventProcessed.mockReset();
    markStripeWebhookEventFailed.mockReset();
    findMeterPaymentByCheckout.mockReset();
    updateMeterPayment.mockReset();
    updateWalkUp.mockReset();
    findWalkUpById.mockReset();
    claimStripeWebhookEvent.mockResolvedValue({ action: 'process' });
    markStripeWebhookEventProcessed.mockResolvedValue(undefined);
    updateWalkUp.mockResolvedValue(null);
    findWalkUpById.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      driverId: 'driver-1',
    });
    setStripeWebhookProcessHookForTests(null);
  });

  afterEach(() => {
    setStripeWebhookProcessHookForTests(null);
    if (savedWebhook === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = savedWebhook;
  });

  it('rejects a Checkout webhook with a bad signature', async () => {
    const { payload } = signedCheckout('evt_bad_meter', 'paid');
    const res = await request(createApp())
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 't=1,v1=deadbeef')
      .send(payload);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('STRIPE_WEBHOOK_SIGNATURE_INVALID');
    expect(updateMeterPayment).not.toHaveBeenCalled();
  });

  it('does not mark a trip paid when Checkout completes unpaid', async () => {
    const { payload, signature } = signedCheckout('evt_unpaid', 'unpaid');
    const res = await request(createApp())
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload);
    expect(res.status).toBe(200);
    expect(findMeterPaymentByCheckout).not.toHaveBeenCalled();
    expect(updateMeterPayment).not.toHaveBeenCalled();
  });

  it('marks paid from a verified webhook and ignores the duplicate event', async () => {
    findMeterPaymentByCheckout.mockResolvedValue({
      id: 'pay-1',
      status: MeterPaymentStatus.CHECKOUT_OPEN,
      walkUpTripId: '11111111-1111-1111-1111-111111111111',
      stripePaymentIntentId: null,
      receiptUrl: null,
      hostedUrl: 'https://checkout.stripe.com/c/pay/cs_meter_1',
      failureCode: null,
      paidAt: null,
    });
    updateMeterPayment.mockResolvedValue({
      id: 'pay-1',
      status: MeterPaymentStatus.PAID,
      hostedUrl: 'https://checkout.stripe.com/c/pay/cs_meter_1',
      receiptUrl: null,
    });
    const { payload, signature } = signedCheckout('evt_paid_once', 'paid');
    claimStripeWebhookEvent
      .mockResolvedValueOnce({ action: 'process' })
      .mockResolvedValueOnce({ action: 'skip_processed' });
    const app = createApp();
    const first = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload);
    const second = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload);
    expect(first.status).toBe(200);
    expect(first.body.data.duplicate).toBe(false);
    expect(second.body.data.duplicate).toBe(true);
    expect(updateMeterPayment).toHaveBeenCalledTimes(1);
    expect(updateMeterPayment.mock.calls[0][1].status).toBe(MeterPaymentStatus.PAID);
    expect(updateWalkUp).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
      expect.objectContaining({ paymentStatus: MeterPaymentStatus.PAID })
    );
  });
});
