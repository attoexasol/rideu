import fs from 'fs';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { BookingPaymentStatus, DriverTransferRecordStatus } from '../src/constants/payment';
import { errorHandler } from '../src/middleware/error-handler';

const mockListDriverPayments = jest.fn();
const mockGetDriverPaymentDetail = jest.fn();
const mockGetDriverPaymentSummary = jest.fn();
const mockFindByAuth0Id = jest.fn();

const authState = {
  enabled: true,
  role: 'driver',
  auth0Id: 'auth0|driver-a',
  sessionId: 'sess-active',
};

jest.mock('../src/services/driverPaymentHistory.service', () => ({
  listDriverPayments: (...args: unknown[]) => mockListDriverPayments(...args),
  getDriverPaymentDetail: (...args: unknown[]) => mockGetDriverPaymentDetail(...args),
  getDriverPaymentSummary: (...args: unknown[]) => mockGetDriverPaymentSummary(...args),
}));

jest.mock('../src/db/utils', () => ({
  driverUtils: {
    findByAuth0Id: (...args: unknown[]) => mockFindByAuth0Id(...args),
    updateSessionInfo: jest.fn(),
  },
}));

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!authState.enabled) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_FAILED', message: 'No token provided' },
      });
      return;
    }
    next();
  },
  extractUserInfo: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const r = req as express.Request & { user?: Record<string, unknown>; auth?: unknown };
    r.user = {
      auth0Id: authState.auth0Id,
      role: authState.role,
      userId: 'driver-a',
      sessionId: authState.sessionId,
    };
    (r as { auth?: unknown }).auth = {
      sessionId: authState.sessionId,
      payload: { sessionId: authState.sessionId, sub: authState.auth0Id },
    };
    next();
  },
}));

jest.mock('../src/middleware/rate-limiters', () => ({
  driverGeneralRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import driverPaymentRoutes from '../src/routes/v1/driver/payments';

const DRIVER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PAYMENT_A = '11111111-1111-1111-1111-111111111111';
const PAYMENT_B = '33333333-3333-3333-3333-333333333333';

function listItem() {
  return {
    id: PAYMENT_A,
    bookingId: '22222222-2222-2222-2222-222222222222',
    bookingNumber: 'RYD-1001',
    paymentRecordId: PAYMENT_A,
    ride: {
      status: 'completed',
      completedAt: '2026-09-01T10:55:00.000Z',
      pickup: { latitude: 23.81, longitude: 90.41, address: 'Airport Rd', spotLabel: null },
      dropoff: { latitude: 23.78, longitude: 90.41, address: 'Gulshan 1' },
      serviceName: 'Sedan',
      serviceCode: 'sedan',
    },
    passengerPayment: {
      amount: { minor: 4500, formatted: '45.00', currency: 'BDT' },
      status: BookingPaymentStatus.CAPTURED,
      methodCode: 'card',
      capturedAt: '2026-09-01T11:00:00.000Z',
    },
    settlement: {
      status: 'not_created',
      driverAmount: null,
      platformAmount: null,
      airportFee: null,
      settledAt: null,
    },
    transfer: {
      status: DriverTransferRecordStatus.NOT_STARTED,
      transferredAt: null,
    },
  };
}

describe('driver payment history route registration', () => {
  it('registers /summary before /:paymentId', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src/routes/v1/driver/payments.ts'), 'utf8');
    const list = src.indexOf("router.get(\n  '/',");
    const summary = src.indexOf("'/summary'");
    const detail = src.indexOf("'/:paymentId'");
    expect(list).toBeGreaterThan(-1);
    expect(summary).toBeGreaterThan(-1);
    expect(detail).toBeGreaterThan(-1);
    expect(list).toBeLessThan(summary);
    expect(summary).toBeLessThan(detail);
    expect(src).toContain('requireDriver');
    expect(src).toContain('requireAuth');
    expect(src).toContain('driverPaymentHistoryQuerySchema');
  });

  it('mounts driver payments on v1', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src/routes/v1/index.ts'), 'utf8');
    expect(src).toContain("router.use('/driver/payments', driverPaymentRoutes)");
  });
});

describe('driver payment history HTTP', () => {
  let app: express.Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/driver/payments', driverPaymentRoutes);
    app.use(errorHandler);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    authState.enabled = true;
    authState.role = 'driver';
    authState.auth0Id = 'auth0|driver-a';
    authState.sessionId = 'sess-active';
    mockFindByAuth0Id.mockResolvedValue({
      id: DRIVER_A,
      auth0Id: 'auth0|driver-a',
      accountStatus: 'active',
      activeSessionId: 'sess-active',
      activeDeviceId: 'device-a',
      lastLoginAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    mockListDriverPayments.mockResolvedValue({ items: [listItem()], total: 1, page: 1, limit: 20 });
    mockGetDriverPaymentDetail.mockResolvedValue(listItem());
    mockGetDriverPaymentSummary.mockResolvedValue({
      driverEarningsAvailable: false,
      calculatedDriverEarnings: [{ minor: 1125, formatted: '11.25', currency: 'BDT', count: 1 }],
      capturedPassengerPayments: [{ minor: 4500, formatted: '45.00', currency: 'BDT', count: 1 }],
      settlementCounts: {
        notCreated: 1,
        unresolved: 0,
        pending: 0,
        processing: 0,
        settled: 0,
        failed: 0,
        skippedCash: 0,
      },
    });
  });

  it('lists payments for the authenticated driver and ignores query driverId', async () => {
    const res = await request(app)
      .get('/api/v1/driver/payments')
      .query({ page: 1, limit: 20, driverId: DRIVER_A.replace('a', 'b') });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.metadata.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
    expect(mockListDriverPayments).toHaveBeenCalledWith(DRIVER_A, 1, 20);
    expect(JSON.stringify(res.body)).not.toContain('client_secret');
    expect(JSON.stringify(res.body)).not.toContain('totalEarnings');
  });

  it('J. paginates with the requested page and limit', async () => {
    mockListDriverPayments.mockResolvedValue({ items: [], total: 21, page: 2, limit: 10 });
    const res = await request(app).get('/api/v1/driver/payments').query({ page: 2, limit: 10 });
    expect(res.status).toBe(200);
    expect(res.body.metadata.pagination).toEqual({
      page: 2,
      limit: 10,
      total: 21,
      totalPages: 3,
    });
    expect(mockListDriverPayments).toHaveBeenCalledWith(DRIVER_A, 2, 10);
  });

  it('returns payment detail', async () => {
    const res = await request(app).get(`/api/v1/driver/payments/${PAYMENT_A}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(PAYMENT_A);
    expect(res.body.data.transfer.status).toBe('not_started');
    expect(mockGetDriverPaymentDetail).toHaveBeenCalledWith(DRIVER_A, PAYMENT_A);
    expect(JSON.stringify(res.body)).not.toContain('client_secret');
  });

  it('L. returns PAYMENT_NOT_FOUND for another driver payment', async () => {
    mockGetDriverPaymentDetail.mockResolvedValue(null);
    const res = await request(app).get(`/api/v1/driver/payments/${PAYMENT_B}`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('PAYMENT_NOT_FOUND');
    expect(mockGetDriverPaymentDetail).toHaveBeenCalledWith(DRIVER_A, PAYMENT_B);
  });

  it('returns summary without driver-earnings labels', async () => {
    const res = await request(app).get('/api/v1/driver/payments/summary');
    expect(res.status).toBe(200);
    expect(res.body.data.driverEarningsAvailable).toBe(false);
    expect(res.body.data).not.toHaveProperty('totalEarnings');
    expect(res.body.data).not.toHaveProperty('paidToDriver');
    expect(res.body.data.capturedPassengerPayments[0].currency).toBe('BDT');
  });

  it('rejects AUTH_FAILED when unauthenticated', async () => {
    authState.enabled = false;
    const res = await request(app).get('/api/v1/driver/payments');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_FAILED');
    expect(mockListDriverPayments).not.toHaveBeenCalled();
  });

  it('rejects non-driver callers', async () => {
    authState.role = 'customer';
    const res = await request(app).get('/api/v1/driver/payments');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(mockListDriverPayments).not.toHaveBeenCalled();
  });

  it('M. rejects invalidated driver sessions', async () => {
    authState.sessionId = 'sess-stale';
    mockFindByAuth0Id.mockResolvedValue({
      id: DRIVER_A,
      auth0Id: 'auth0|driver-a',
      accountStatus: 'active',
      activeSessionId: 'sess-active',
      activeDeviceId: 'device-other',
      lastLoginAt: new Date('2026-09-08T00:00:00.000Z'),
    });

    const res = await request(app)
      .get('/api/v1/driver/payments')
      .set('X-Device-ID', 'device-stale');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_INVALID');
    expect(res.body.sessionInvalidated).toBe(true);
    expect(mockListDriverPayments).not.toHaveBeenCalled();
  });
});
