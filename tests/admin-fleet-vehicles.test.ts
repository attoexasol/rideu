import 'dotenv/config';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'crypto';
import {
  resolveAdminFleetScope,
  fleetIdsForQuery,
  extractFleetIdsFromUser,
  AdminFleetAccessError,
} from '../src/services/adminFleetAccess.service';
import { ADMIN_FLEET_VEHICLE_LIST_MAX_LIMIT } from '../src/config/adminFleet';
import {
  createPairedDriversFixture,
  cleanupExchangeFixture,
  type PairedDriversFixture,
} from './helpers/vehicleExchange.fixtures';
import { listAdminFleetVehiclesForAdmin } from '../src/services/adminFleetVehicle.service';
import { loadLegacyDriverHintsForVehicles } from '../src/repositories/adminVehicleEnrichment.repository';

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
  extractUserInfo: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { user?: { role: string; permissions: string[]; fleetIds: string[] } }).user = {
      role: 'super_admin',
      permissions: [],
      fleetIds: [],
    };
    next();
  },
}));

jest.mock('../src/middleware/rbac', () => ({
  requireAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
}));

describe('admin fleet access scope', () => {
  it('grants all fleets to super_admin', () => {
    const scope = resolveAdminFleetScope({ role: 'super_admin' });
    expect(scope.mode).toBe('all');
    expect(fleetIdsForQuery(scope)).toBeNull();
  });

  it('grants all fleets to platform admin', () => {
    const scope = resolveAdminFleetScope({ role: 'admin' });
    expect(scope.mode).toBe('all');
  });

  it('restricts fleet_manager to authorized fleet IDs from permissions', () => {
    const fleetId = randomUUID();
    const scope = resolveAdminFleetScope({
      role: 'fleet_manager',
      permissions: [`fleet:${fleetId}`],
    });
    expect(scope.mode).toBe('restricted');
    expect(extractFleetIdsFromUser({ permissions: [`fleet:${fleetId}`] })).toEqual([fleetId]);
    expect(fleetIdsForQuery(scope)).toEqual([fleetId]);
  });

  it('denies fleet_manager without authorized fleets', () => {
    const scope = resolveAdminFleetScope({ role: 'fleet_manager', permissions: [] });
    expect(() => fleetIdsForQuery(scope)).toThrow(AdminFleetAccessError);
  });

  it('denies fleet_manager access to unauthorized fleet filter', () => {
    const fleetId = randomUUID();
    const otherFleet = randomUUID();
    const scope = resolveAdminFleetScope({
      role: 'fleet_manager',
      permissions: [`fleet:${fleetId}`],
    });
    expect(() => fleetIdsForQuery(scope, otherFleet)).toThrow(AdminFleetAccessError);
  });
});

describe('admin fleet vehicle list limits', () => {
  it('caps limit at configured maximum (supports frontend limit=1000)', () => {
    expect(ADMIN_FLEET_VEHICLE_LIST_MAX_LIMIT).toBeGreaterThanOrEqual(1000);
  });
});

describe('GET /api/v1/admin/fleet/vehicles route', () => {
  let app: express.Express;

  beforeAll(async () => {
    jest.resetModules();
    const fleetRoutes = (await import('../src/routes/v1/admin/fleet')).default;
    app = express();
    app.use(express.json());
    app.use('/api/v1/admin/fleet', fleetRoutes);
  });

  it('keeps QR issue route mounted', async () => {
    const fleetRoutes = (await import('../src/routes/v1/admin/fleet')).default;
    const paths: string[] = [];
    for (const layer of (fleetRoutes as express.Router).stack) {
      const route = (layer as { route?: { path: string } }).route;
      if (route?.path) paths.push(route.path);
    }

    expect(paths).toEqual(
      expect.arrayContaining([
        '/vehicles',
        '/vehicles/:vehicleId',
        '/vehicles/:vehicleId/qr/issue',
        '/vehicles/:vehicleId/qr/rotate',
        '/vehicles/:vehicleId/qr/tokens',
        '/vehicle-qr-tokens/:tokenId/revoke',
      ])
    );
  });

  it('returns 400 for invalid vehicleId on QR token route', async () => {
    const res = await request(app).get('/api/v1/admin/fleet/vehicles/not-a-uuid/qr/tokens');
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_ERROR');
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

(hasDatabase ? describe : describe.skip)('admin fleet vehicles integration', () => {
  let fixture: PairedDriversFixture;

  beforeEach(async () => {
    fixture = await createPairedDriversFixture();
  });

  afterEach(async () => {
    await cleanupExchangeFixture(fixture);
  });

  it('returns vehicle list with assignment, duty, and QR summary without raw token', async () => {
    const result = await listAdminFleetVehiclesForAdmin(
      { role: 'super_admin' },
      resolveAdminFleetScope({ role: 'super_admin' }),
      { fleetId: fixture.fleetId, limit: 1000 }
    );

    expect(result.vehicles.length).toBeGreaterThanOrEqual(2);
    const vehicleA = result.vehicles.find((v) => v.id === fixture.vehicleAId);
    expect(vehicleA).toBeDefined();
    expect(vehicleA!.fleet).toEqual({ id: fixture.fleetId, name: expect.any(String) });
    expect(vehicleA!.organization).toEqual({ id: fixture.orgId, name: expect.any(String) });
    expect(vehicleA!.qr.hasActiveToken).toBe(true);
    expect(vehicleA!.qr.tokenId).toBeTruthy();
    expect(vehicleA).not.toHaveProperty('token');
    expect(JSON.stringify(vehicleA)).not.toMatch(/VQR_/);
    expect(vehicleA!.currentAssignment).toEqual({
      driverId: fixture.driverAId,
      driverName: expect.any(String),
      assignmentId: fixture.assignmentAId,
    });
    expect(vehicleA!.currentDuty).toEqual({
      status: 'active',
      dutySessionId: fixture.dutyAId,
    });
    expect(vehicleA!.displayName).toBeTruthy();
    expect(vehicleA!.fleetId).toBe(fixture.fleetId);
    expect(vehicleA!.plateNumber).toBeTruthy();
    expect(result.pagination.limit).toBeLessThanOrEqual(1000);
  });

  it('returns QR token list with 200 and no raw token values', async () => {
    const fleetRoutes = (await import('../src/routes/v1/admin/fleet')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/v1/admin/fleet', fleetRoutes);

    const res = await request(app).get(
      `/api/v1/admin/fleet/vehicles/${fixture.vehicleAId}/qr/tokens`
    );
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.vehicleId).toBe(fixture.vehicleAId);
    expect(Array.isArray(res.body.data.tokens)).toBe(true);
    expect(JSON.stringify(res.body.data)).not.toMatch(/VQR_/);
  });

  it('returns 404 for missing vehicle on QR token list', async () => {
    const fleetRoutes = (await import('../src/routes/v1/admin/fleet')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/v1/admin/fleet', fleetRoutes);

    const res = await request(app).get(
      `/api/v1/admin/fleet/vehicles/${randomUUID()}/qr/tokens`
    );
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('NOT_FOUND');
  });

  it('filters by fleetId and paginates', async () => {
    const page1 = await listAdminFleetVehiclesForAdmin(
      { role: 'super_admin' },
      resolveAdminFleetScope({ role: 'super_admin' }),
      { fleetId: fixture.fleetId, page: 1, limit: 1 }
    );
    expect(page1.vehicles).toHaveLength(1);
    expect(page1.pagination.total).toBeGreaterThanOrEqual(2);
    expect(page1.pagination.totalPages).toBeGreaterThanOrEqual(2);
  });

  it('scopes fleet_manager to authorized fleet only', async () => {
    const scoped = await listAdminFleetVehiclesForAdmin(
      { role: 'fleet_manager', permissions: [`fleet:${fixture.fleetId}`] },
      resolveAdminFleetScope({
        role: 'fleet_manager',
        permissions: [`fleet:${fixture.fleetId}`],
      }),
      { limit: 100 }
    );
    expect(scoped.vehicles.every((v) => v.fleet?.id === fixture.fleetId)).toBe(true);
  });

  it('does not auto-apply conflicting legacy hints', async () => {
    const hints = await loadLegacyDriverHintsForVehicles([fixture.vehicleAId]);
    const hint = hints.get(fixture.vehicleAId);
    expect(hint?.ambiguous ?? []).toEqual([]);
  });
});
