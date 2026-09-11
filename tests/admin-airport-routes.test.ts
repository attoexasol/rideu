import fs from 'fs';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../src/middleware/error-handler';
import { AirportConfigError } from '../src/services/airportAdmin.service';

const mockList = jest.fn();
const mockGet = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();

const authState = {
  enabled: true,
  role: 'admin',
};

jest.mock('../src/services/airportAdmin.service', () => {
  const actual = jest.requireActual('../src/services/airportAdmin.service');
  return {
    ...actual,
    listAirportsForAdmin: (...args: unknown[]) => mockList(...args),
    getAirportForAdmin: (...args: unknown[]) => mockGet(...args),
    createAirportForAdmin: (...args: unknown[]) => mockCreate(...args),
    updateAirportForAdmin: (...args: unknown[]) => mockUpdate(...args),
  };
});

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
    (req as express.Request & { user?: Record<string, unknown> }).user = {
      auth0Id: 'auth0|admin-a',
      role: authState.role,
      userId: 'admin-a',
    };
    next();
  },
}));

jest.mock('../src/middleware/rbac', () => ({
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const role = (req as express.Request & { user?: { role?: string } }).user?.role;
    if (role !== 'admin' && role !== 'super_admin') {
      res.status(403).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Admin access required' },
      });
      return;
    }
    next();
  },
}));

import adminAirportRoutes from '../src/routes/v1/admin/airports';

const AIRPORT = {
  id: '11111111-1111-1111-1111-111111111111',
  code: 'TESTA',
  name: 'Test Airport A',
  googlePlaceId: 'place-a',
  countryCode: 'US',
  currency: 'BDT',
  isActive: true,
  geofenceType: 'radius',
  latitude: 32.7338,
  longitude: -117.1933,
  radiusMeters: 2000,
  pickupFee: { minor: 500, formatted: '5.00', currency: 'BDT' },
  dropoffFee: { minor: 300, formatted: '3.00', currency: 'BDT' },
  createdAt: '2026-09-11T00:00:00.000Z',
  updatedAt: '2026-09-11T00:00:00.000Z',
};

describe('admin airport routes', () => {
  let app: express.Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/admin/airports', adminAirportRoutes);
    app.use(errorHandler);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    authState.enabled = true;
    authState.role = 'admin';
    mockList.mockResolvedValue([AIRPORT]);
    mockGet.mockResolvedValue(AIRPORT);
    mockCreate.mockResolvedValue(AIRPORT);
    mockUpdate.mockResolvedValue({
      ...AIRPORT,
      pickupFee: { minor: 900, formatted: '9.00', currency: 'BDT' },
    });
  });

  it('mounts admin airports on v1', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/routes/v1/index.ts'), 'utf8');
    expect(src).toContain("router.use('/admin/airports', adminAirportRoutes)");
  });

  it('L. Admin can list and create airports', async () => {
    const list = await request(app).get('/api/v1/admin/airports');
    expect(list.status).toBe(200);
    expect(list.body.data[0].code).toBe('TESTA');

    const created = await request(app).post('/api/v1/admin/airports').send({
      code: 'TESTA',
      name: 'Test Airport A',
      googlePlaceId: 'place-a',
      countryCode: 'US',
      currency: 'BDT',
      latitude: 32.7338,
      longitude: -117.1933,
      radiusMeters: 2000,
      pickupFee: '5.00',
      dropoffFee: '3.00',
    });
    expect(created.status).toBe(201);
    expect(mockCreate).toHaveBeenCalled();
  });

  it('M. Admin can update airport fees', async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/airports/${AIRPORT.id}`)
      .send({ pickupFee: '9.00', dropoffFee: '7.00' });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(AIRPORT.id, {
      pickupFee: '9.00',
      dropoffFee: '7.00',
    });
  });

  it('rejects duplicate airport codes', async () => {
    mockCreate.mockRejectedValue(
      new AirportConfigError('DUPLICATE_AIRPORT_CODE', 'Airport code already exists', 409)
    );
    const res = await request(app).post('/api/v1/admin/airports').send({
      code: 'TESTA',
      name: 'Test Airport A',
      countryCode: 'US',
      currency: 'BDT',
      latitude: 32.7338,
      longitude: -117.1933,
      radiusMeters: 2000,
      pickupFee: '5.00',
      dropoffFee: '3.00',
    });
    expect(res.status).toBe(409);
  });

  it('rejects non-admin callers', async () => {
    authState.role = 'driver';
    const res = await request(app).get('/api/v1/admin/airports');
    expect(res.status).toBe(403);
  });
});
