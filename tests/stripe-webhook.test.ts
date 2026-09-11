import express from 'express';
import request from 'supertest';
import Stripe from 'stripe';
import stripeWebhookRoutes from '../src/routes/v1/webhooks/stripe';
import { errorHandler } from '../src/middleware/error-handler';
import { setStripeWebhookProcessHookForTests } from '../src/services/stripeWebhook.service';

const claimStripeWebhookEvent = jest.fn();
const markStripeWebhookEventProcessed = jest.fn();
const markStripeWebhookEventFailed = jest.fn();

jest.mock('../src/repositories/stripeWebhookEvent.repository', () => ({
  claimStripeWebhookEvent: (...args: unknown[]) => claimStripeWebhookEvent(...args),
  markStripeWebhookEventProcessed: (...args: unknown[]) => markStripeWebhookEventProcessed(...args),
  markStripeWebhookEventFailed: (...args: unknown[]) => markStripeWebhookEventFailed(...args),
  findStripeWebhookEventByStripeId: jest.fn(),
}));

const findDriverByStripeAccountId = jest.fn();
const persistDriverStripeAccountSync = jest.fn();

jest.mock('../src/repositories/driverStripe.repository', () => ({
  findDriverByStripeAccountId: (...args: unknown[]) => findDriverByStripeAccountId(...args),
  findDriverById: jest.fn(),
  claimDriverStripeAccountId: jest.fn(),
  persistDriverStripeAccountSync: (...args: unknown[]) => persistDriverStripeAccountSync(...args),
}));

jest.mock('../src/services/stripePaymentIntent.service', () => ({
  handleStripePaymentIntentEvent: jest.fn().mockResolvedValue({ bookingId: null, status: null }),
  isPaymentAuthorized: (status: string) => status === 'authorized' || status === 'captured',
}));

jest.mock('../src/services/cardBookingActivation.service', () => ({
  activateAuthorizedCardBooking: jest.fn().mockResolvedValue({
    dispatched: false,
    alreadyActive: false,
    bookingStatus: 'quoted',
  }),
  shouldStartDispatchOnBookingCreate: jest.fn(),
}));

jest.mock('../src/services/stripeCapture.service', () => ({
  markBookingPaidIfCaptured: jest.fn().mockResolvedValue(undefined),
  captureAuthorizedBookingPayment: jest.fn(),
  releaseCardPaymentAuthorization: jest.fn(),
}));

const WEBHOOK_SECRET = 'whsec_phase_a_test_secret';

function signedPayload(eventId: string, type: string) {
  const payload = JSON.stringify({
    id: eventId,
    object: 'event',
    api_version: '2026-08-26.dahlia',
    created: 1_700_000_000,
    type,
    data: { object: { id: 'obj_1', object: 'payment_intent' } },
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

describe('Stripe Phase A webhook', () => {
  const savedWebhook = process.env.STRIPE_WEBHOOK_SECRET;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    claimStripeWebhookEvent.mockReset();
    markStripeWebhookEventProcessed.mockReset();
    markStripeWebhookEventFailed.mockReset();
    claimStripeWebhookEvent.mockResolvedValue({ action: 'process' });
    markStripeWebhookEventProcessed.mockResolvedValue(undefined);
    markStripeWebhookEventFailed.mockResolvedValue(undefined);
    findDriverByStripeAccountId.mockReset();
    persistDriverStripeAccountSync.mockReset();
    findDriverByStripeAccountId.mockResolvedValue(null);
    persistDriverStripeAccountSync.mockResolvedValue(undefined);
    setStripeWebhookProcessHookForTests(null);
  });

  afterEach(() => {
    setStripeWebhookProcessHookForTests(null);
    if (savedWebhook === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = savedWebhook;
  });

  it('rejects missing signature', async () => {
    const { payload } = signedPayload('evt_missing', 'payment_intent.succeeded');
    const res = await request(createApp())
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(payload);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('STRIPE_WEBHOOK_SIGNATURE_MISSING');
    expect(claimStripeWebhookEvent).not.toHaveBeenCalled();
  });

  it('rejects invalid signature', async () => {
    const { payload } = signedPayload('evt_bad', 'payment_intent.succeeded');
    const res = await request(createApp())
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 't=1,v1=deadbeef')
      .send(payload);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('STRIPE_WEBHOOK_SIGNATURE_INVALID');
    expect(claimStripeWebhookEvent).not.toHaveBeenCalled();
  });

  it('fails clearly when webhook secret is not configured', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const { payload, signature } = signedPayload('evt_noconfig', 'payment_intent.succeeded');
    const res = await request(createApp())
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('STRIPE_WEBHOOK_NOT_CONFIGURED');
  });

  it('accepts a valid signed webhook', async () => {
    const { payload, signature } = signedPayload('evt_ok', 'payment_intent.succeeded');
    const res = await request(createApp())
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.eventId).toBe('evt_ok');
    expect(res.body.data.duplicate).toBe(false);
    expect(claimStripeWebhookEvent).toHaveBeenCalledWith('evt_ok', 'payment_intent.succeeded');
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledWith('evt_ok');
  });

  it('processes the same stripe_event_id only once', async () => {
    const { payload, signature } = signedPayload('evt_dup', 'charge.refunded');
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
    expect(second.status).toBe(200);
    expect(second.body.data.duplicate).toBe(true);
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1);
  });

  it('acknowledges unknown valid Stripe events', async () => {
    const { payload, signature } = signedPayload('evt_unknown', 'radar.early_fraud_warning.created');
    const res = await request(createApp())
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body.data.eventType).toBe('radar.early_fraud_warning.created');
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledWith('evt_unknown');
  });

  it('returns non-2xx on processing failure so Stripe can retry', async () => {
    setStripeWebhookProcessHookForTests(async () => {
      throw new Error('forced processing failure');
    });
    const { payload, signature } = signedPayload('evt_fail', 'transfer.created');
    const res = await request(createApp())
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('STRIPE_WEBHOOK_PROCESSING_FAILED');
    expect(markStripeWebhookEventFailed).toHaveBeenCalledWith(
      'evt_fail',
      expect.any(Error)
    );
  });

  it('retries a previously failed event', async () => {
    const { payload, signature } = signedPayload('evt_retry', 'account.updated');
    claimStripeWebhookEvent.mockResolvedValue({ action: 'process' });
    setStripeWebhookProcessHookForTests(async () => {
      throw new Error('first fail');
    });
    const app = createApp();
    const failed = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload);
    expect(failed.status).toBe(500);

    setStripeWebhookProcessHookForTests(null);
    const retried = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload);
    expect(retried.status).toBe(200);
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledWith('evt_retry');
  });

  it('N. duplicate account.updated is handled once via Phase A idempotency', async () => {
    const payload = JSON.stringify({
      id: 'evt_acct_dup',
      object: 'event',
      api_version: '2026-08-26.dahlia',
      created: 1_700_000_000,
      type: 'account.updated',
      data: {
        object: {
          id: 'acct_known',
          object: 'account',
          details_submitted: true,
          payouts_enabled: true,
          charges_enabled: false,
          requirements: { currently_due: [], eventually_due: [], disabled_reason: null },
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
    expect(second.status).toBe(200);
    expect(second.body.data.duplicate).toBe(true);
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1);
    expect(findDriverByStripeAccountId).toHaveBeenCalledTimes(1);
    expect(persistDriverStripeAccountSync).not.toHaveBeenCalled();
  });
});
