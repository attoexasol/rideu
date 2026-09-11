import fs from 'fs';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../src/middleware/error-handler';
import { SettlementSettingsError } from '../src/services/payment.errors';

const mockGetSettings = jest.fn();
const mockUpdateSettings = jest.fn();

const authState = {
  enabled: true,
  role: 'admin',
};

jest.mock('../src/services/settlementSettings.service', () => ({
  getSettlementSettingsForAdmin: (...args: unknown[]) => mockGetSettings(...args),
  updateActiveSettlementSettings: (...args: unknown[]) => mockUpdateSettings(...args),
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

import adminSettingsRoutes from '../src/routes/v1/admin/settings';

describe('admin settlement settings routes', () => {
  let app: express.Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/admin/settings', adminSettingsRoutes);
    app.use(errorHandler);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    authState.enabled = true;
    authState.role = 'admin';
    mockGetSettings.mockResolvedValue({
      driverPercentage: '25.00',
      companyPercentage: '75.00',
      version: 1,
      updatedAt: '2026-09-11T00:00:00.000Z',
    });
    mockUpdateSettings.mockResolvedValue({
      driverPercentage: '30.00',
      companyPercentage: '70.00',
      version: 2,
      updatedAt: '2026-09-11T01:00:00.000Z',
    });
  });

  it('mounts admin settings on v1', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/routes/v1/index.ts'), 'utf8');
    expect(src).toContain("router.use('/admin/settings', adminSettingsRoutes)");
  });

  it('K. Admin can read settlement settings', async () => {
    const res = await request(app).get('/api/v1/admin/settings/settlement');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      driverPercentage: '25.00',
      companyPercentage: '75.00',
      version: 1,
      updatedAt: '2026-09-11T00:00:00.000Z',
    });
    expect(res.body.data).not.toHaveProperty('airportFeePercentage');
  });

  it('L/M. Admin can update 25/75 → 30/70 and version increments', async () => {
    const res = await request(app).patch('/api/v1/admin/settings/settlement').send({
      driverPercentage: 30,
      companyPercentage: 70,
    });
    expect(res.status).toBe(200);
    expect(mockUpdateSettings).toHaveBeenCalledWith({
      driverPercentage: 30,
      companyPercentage: 70,
    });
    expect(res.body.data.driverPercentage).toBe('30.00');
    expect(res.body.data.companyPercentage).toBe('70.00');
    expect(res.body.data.version).toBe(2);
  });

  it('rejects invalid percentage totals from Admin', async () => {
    mockUpdateSettings.mockRejectedValue(
      new SettlementSettingsError('driverPercentage + companyPercentage must equal 100')
    );
    const res = await request(app).patch('/api/v1/admin/settings/settlement').send({
      driverPercentage: 25,
      companyPercentage: 80,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_SETTLEMENT_SETTINGS');
  });

  it('rejects non-admin callers', async () => {
    authState.role = 'driver';
    const res = await request(app).get('/api/v1/admin/settings/settlement');
    expect(res.status).toBe(403);
    expect(mockGetSettings).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated callers', async () => {
    authState.enabled = false;
    const res = await request(app).get('/api/v1/admin/settings/settlement');
    expect(res.status).toBe(401);
  });
});
