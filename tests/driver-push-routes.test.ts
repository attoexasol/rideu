import express from 'express';
import request from 'supertest';

const mockRegister = jest.fn();
const mockUnregister = jest.fn();
const mockFindByAuth0Id = jest.fn();

let testRole = 'driver';
let testAuth0Id = 'auth0|driver-1';
let testSessionId = 'sess-active';
let requireAuthEnabled = true;

jest.mock('../src/services/driverPushToken.service', () => {
  class DriverPushTokenError extends Error {
    constructor(
      public code: string,
      message: string,
      public statusCode: number = 400
    ) {
      super(message);
    }
  }
  return {
    DriverPushTokenError,
    registerDriverPushToken: (...args: unknown[]) => mockRegister(...args),
    unregisterDriverPushToken: (...args: unknown[]) => mockUnregister(...args),
  };
});

jest.mock('../src/db/utils', () => ({
  driverUtils: {
    findByAuth0Id: (...args: unknown[]) => mockFindByAuth0Id(...args),
  },
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
      userId: 'driver-1',
    };
    r.auth = {
      sessionId: testSessionId,
      auth0Id: testAuth0Id,
      userId: 'driver-1',
      role: testRole,
    };
    next();
  },
}));

jest.mock('../src/middleware/rbac', () => ({
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
  requireDriver: [
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const user = (req as express.Request & { user?: { role?: string } }).user;
      if (!user || user.role !== 'driver') {
        res.status(403).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Access denied. Required role(s): driver' },
        });
        return;
      }
      next();
    },
    (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  ],
}));

describe('driver push-token routes', () => {
  let app: express.Express;

  beforeAll(async () => {
    const routes = (await import('../src/routes/v1/driver/push')).default;
    app = express();
    app.use(express.json());
    app.use('/api/v1/driver/push-token', routes);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    testRole = 'driver';
    testAuth0Id = 'auth0|driver-1';
    testSessionId = 'sess-active';
    requireAuthEnabled = true;
    mockFindByAuth0Id.mockResolvedValue({
      id: 'driver-1',
      auth0Id: 'auth0|driver-1',
      activeDeviceId: 'device-active',
      activeSessionId: 'sess-active',
    });
    mockRegister.mockResolvedValue({
      deviceId: 'device-active',
      registeredAt: '2026-08-18T00:00:00.000Z',
    });
    mockUnregister.mockResolvedValue({ removed: true });
  });

  it('registers a token for the authenticated driver', async () => {
    const res = await request(app)
      .put('/api/v1/driver/push-token')
      .set('X-Device-ID', 'device-active')
      .send({ token: 'fcm-token-value', driverId: 'attacker-driver' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockRegister).toHaveBeenCalledTimes(1);
    const args = mockRegister.mock.calls[0][0];
    expect(args.driver.id).toBe('driver-1');
    expect(args.fcmToken).toBe('fcm-token-value');
    expect(args.driver.id).not.toBe('attacker-driver');
  });

  it('rejects unauthenticated register', async () => {
    requireAuthEnabled = false;
    const res = await request(app)
      .put('/api/v1/driver/push-token')
      .send({ token: 'fcm-token-value' });
    expect(res.status).toBe(401);
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('rejects non-driver register', async () => {
    testRole = 'customer';
    const res = await request(app)
      .put('/api/v1/driver/push-token')
      .send({ token: 'fcm-token-value' });
    expect(res.status).toBe(403);
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('unregisters the active device token', async () => {
    const res = await request(app).delete('/api/v1/driver/push-token');
    expect(res.status).toBe(200);
    expect(res.body.data.removed).toBe(true);
    expect(mockUnregister).toHaveBeenCalled();
  });
});
