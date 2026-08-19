import express from 'express';
import request from 'supertest';

const mockRegister = jest.fn();
const mockUnregister = jest.fn();
const mockFindCustomer = jest.fn();

let testRole = 'customer';
let testAuth0Id = 'auth0|passenger-1';
let testSessionId = 'sess-active';
let testUserId = 'cus-1';
let requireAuthEnabled = true;

jest.mock('../src/services/passengerPushToken.service', () => {
  class PassengerPushTokenError extends Error {
    constructor(
      public code: string,
      message: string,
      public statusCode: number = 400
    ) {
      super(message);
    }
  }
  return {
    PassengerPushTokenError,
    registerPassengerPushToken: (...args: unknown[]) => mockRegister(...args),
    unregisterPassengerPushToken: (...args: unknown[]) => mockUnregister(...args),
  };
});

jest.mock('../src/repositories/customer.repository', () => ({
  findCustomerById: (...args: unknown[]) => mockFindCustomer(...args),
}));

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!requireAuthEnabled) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_FAILED', message: 'No token provided' },
      });
      return;
    }
    next();
  },
  extractUserInfo: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const r = req as any;
    r.user = {
      auth0Id: testAuth0Id,
      role: testRole,
      userId: testUserId,
      sessionId: testSessionId,
    };
    r.auth = {
      sessionId: testSessionId,
      auth0Id: testAuth0Id,
      userId: testUserId,
      role: testRole,
    };
    next();
  },
}));

jest.mock('../src/middleware/rbac', () => ({
  requireCustomer: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = (req as express.Request & { user?: { role?: string } }).user;
    if (!user || user.role !== 'customer') {
      res.status(403).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Access denied. Required role(s): customer' },
      });
      return;
    }
    next();
  },
}));

jest.mock('../src/middleware/rate-limiters', () => ({
  passengerRecoveryRateLimit: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => next(),
}));

describe('passenger push-token routes', () => {
  let app: express.Express;

  beforeAll(async () => {
    const routes = (await import('../src/routes/v1/passenger/push')).default;
    app = express();
    app.use(express.json());
    app.use('/api/v1/passenger/push-token', routes);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    testRole = 'customer';
    testAuth0Id = 'auth0|passenger-1';
    testSessionId = 'sess-active';
    testUserId = 'cus-1';
    requireAuthEnabled = true;
    mockFindCustomer.mockResolvedValue({
      id: 'cus-1',
      auth0Id: 'auth0|passenger-1',
      activeDeviceId: 'device-active',
      activeSessionId: 'sess-active',
    });
    mockRegister.mockResolvedValue({
      deviceId: 'device-active',
      registeredAt: '2026-08-19T00:00:00.000Z',
    });
    mockUnregister.mockResolvedValue({ removed: true });
  });

  it('registers a token for the authenticated customer', async () => {
    const res = await request(app)
      .put('/api/v1/passenger/push-token')
      .set('X-Device-ID', 'device-active')
      .send({ token: 'fcm-token-value', customerId: 'attacker-customer' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.deviceId).toBe('device-active');
    expect(JSON.stringify(res.body)).not.toMatch(/fcm-token-value/);
    expect(mockRegister).toHaveBeenCalledTimes(1);
    const args = mockRegister.mock.calls[0][0];
    expect(args.customer.id).toBe('cus-1');
    expect(args.fcmToken).toBe('fcm-token-value');
    expect(args.customer.id).not.toBe('attacker-customer');
    expect(args.requestDeviceId).toBe('device-active');
  });

  it('rejects unauthenticated register', async () => {
    requireAuthEnabled = false;
    const res = await request(app)
      .put('/api/v1/passenger/push-token')
      .send({ token: 'fcm-token-value' });
    expect(res.status).toBe(401);
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('rejects non-customer register', async () => {
    testRole = 'driver';
    const res = await request(app)
      .put('/api/v1/passenger/push-token')
      .set('X-Device-ID', 'device-active')
      .send({ token: 'fcm-token-value' });
    expect(res.status).toBe(403);
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('unregisters the active device token', async () => {
    const res = await request(app).delete('/api/v1/passenger/push-token');
    expect(res.status).toBe(200);
    expect(res.body.data.removed).toBe(true);
    expect(mockUnregister).toHaveBeenCalled();
  });
});
