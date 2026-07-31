import 'dotenv/config';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { db } from '../src/db/connection';
import { queryClient } from '../src/db/connection';
import { vehicles } from '../src/db/schema/vehicles';
import { vehicleServiceCategories } from '../src/db/schema/vehicle_service_categories';
import { fleetAuditEvents } from '../src/db/schema/fleet_audit_events';
import { serviceCategories } from '../src/db/schema/service_categories';
import { eq } from 'drizzle-orm';
import {
  isVehicleQrEligible,
  AdminFleetVehicleUpdateError,
} from '../src/services/adminFleetVehicleUpdate.service';
import {
  createPairedDriversFixture,
  cleanupExchangeFixture,
  type PairedDriversFixture,
} from './helpers/vehicleExchange.fixtures';

type MockAdminUser = {
  role: string;
  permissions: string[];
  fleetIds: string[];
  userId?: string;
};

let mockUser: MockAdminUser = {
  role: 'super_admin',
  permissions: [],
  fleetIds: [],
};

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
  extractUserInfo: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { user?: MockAdminUser }).user = mockUser;
    next();
  },
}));

jest.mock('../src/middleware/rbac', () => ({
  requireAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
}));

async function ensureVehicleColorColumn() {
  await queryClient`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS color varchar(50)`;
}

describe('PATCH /api/v1/admin/fleet/vehicles/:vehicleId route', () => {
  let app: express.Express;

  beforeAll(async () => {
    await ensureVehicleColorColumn();
    jest.resetModules();
    const fleetRoutes = (await import('../src/routes/v1/admin/fleet')).default;
    app = express();
    app.use(express.json());
    app.use('/api/v1/admin/fleet', fleetRoutes);
  });

  it('registers PATCH /vehicles/:vehicleId', async () => {
    const fleetRoutes = (await import('../src/routes/v1/admin/fleet')).default;
    const patchRoutes = (fleetRoutes as express.Router).stack
      .map((layer) => (layer as { route?: { path: string; methods: Record<string, boolean> } }).route)
      .filter(Boolean)
      .filter((route) => route!.methods.patch);

    expect(patchRoutes.some((route) => route!.path === '/vehicles/:vehicleId')).toBe(true);
  });

  it('returns 400 for invalid vehicleId', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/fleet/vehicles/not-a-uuid')
      .send({ make: 'Tesla' });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_ERROR');
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

(hasDatabase ? describe : describe.skip)('admin fleet vehicle update integration', () => {
  let fixture: PairedDriversFixture;
  let app: express.Express;
  let secondaryCategoryId: string;

  beforeAll(async () => {
    await ensureVehicleColorColumn();
    const fleetRoutes = (await import('../src/routes/v1/admin/fleet')).default;
    app = express();
    app.use(express.json());
    app.use('/api/v1/admin/fleet', fleetRoutes);
  });

  beforeEach(async () => {
    mockUser = {
      role: 'super_admin',
      permissions: [],
      fleetIds: [],
    };
    fixture = await createPairedDriversFixture();

    // Reuse canonical bike — never insert BIKE-* orphans into shared DBs
    const existingBike = await db
      .select()
      .from(serviceCategories)
      .where(eq(serviceCategories.code, 'bike'))
      .limit(1);
    if (existingBike[0]) {
      secondaryCategoryId = existingBike[0].id;
    } else {
      const [secondaryCategory] = await db
        .insert(serviceCategories)
        .values({
          code: 'bike',
          name: 'Bike',
          baseFare: '30.00',
          perKmRate: '15.00',
          minFare: '50.00',
          capacity: 1,
          isActive: true,
          sortOrder: 2,
        })
        .onConflictDoNothing()
        .returning();
      secondaryCategoryId = secondaryCategory?.id ?? fixture.serviceCategoryId;
      if (secondaryCategory?.id) {
        fixture.ids.serviceCategoryIds.push(secondaryCategory.id);
      }
    }
  });

  afterEach(async () => {
    await cleanupExchangeFixture(fixture);
  });

  it('admin can update vehicle fields partially', async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/fleet/vehicles/${fixture.vehicleBId}`)
      .send({ make: 'Tesla', model: 'Model', year: 2024, color: 'Black' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      id: fixture.vehicleBId,
      make: 'Tesla',
      model: 'Model',
      displayName: 'Tesla Model',
      year: 2024,
      color: 'Black',
    });
  });

  it('persists service categories and removes obsolete categories', async () => {
    const rideCategory = fixture.serviceCategoryId;

    const first = await request(app)
      .patch(`/api/v1/admin/fleet/vehicles/${fixture.vehicleBId}`)
      .send({ serviceCategoryIds: [rideCategory, secondaryCategoryId] });
    expect(first.status).toBe(200);
    expect(first.body.data.serviceCategories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: rideCategory }),
        expect.objectContaining({ id: secondaryCategoryId }),
      ])
    );

    const second = await request(app)
      .patch(`/api/v1/admin/fleet/vehicles/${fixture.vehicleBId}`)
      .send({ serviceCategoryIds: [secondaryCategoryId] });
    expect(second.status).toBe(200);
    expect(second.body.data.serviceCategories).toEqual([
      expect.objectContaining({ id: secondaryCategoryId }),
    ]);

    const rows = await db
      .select()
      .from(vehicleServiceCategories)
      .where(eq(vehicleServiceCategories.vehicleId, fixture.vehicleBId));
    expect(rows).toHaveLength(1);
    expect(rows[0].serviceCategoryId).toBe(secondaryCategoryId);
  });

  it('rejects invalid service category', async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/fleet/vehicles/${fixture.vehicleBId}`)
      .send({ serviceCategoryIds: [randomUUID()] });
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('SERVICE_CATEGORY_NOT_FOUND');
  });

  it('rejects plate conflict', async () => {
    const vehicleA = await db
      .select()
      .from(vehicles)
      .where(eq(vehicles.id, fixture.vehicleAId))
      .limit(1);

    const res = await request(app)
      .patch(`/api/v1/admin/fleet/vehicles/${fixture.vehicleBId}`)
      .send({ plateNumber: vehicleA[0]!.plateNumber });
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('PLATE_NUMBER_ALREADY_EXISTS');
  });

  it('blocks fleet change for actively assigned vehicle', async () => {
    const otherFleetId = randomUUID();
    const res = await request(app)
      .patch(`/api/v1/admin/fleet/vehicles/${fixture.vehicleAId}`)
      .send({ fleetId: otherFleetId });
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('FLEET_CHANGE_NOT_ALLOWED');
  });

  it('blocks inactive status while vehicle has active assignment', async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/fleet/vehicles/${fixture.vehicleAId}`)
      .send({ status: 'inactive' });
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('ACTIVE_ASSIGNMENT_BLOCKS_UPDATE');
  });

  it('scopes fleet_manager to authorized fleet', async () => {
    mockUser = {
      role: 'fleet_manager',
      permissions: [`fleet:${fixture.fleetId}`],
      fleetIds: [fixture.fleetId],
    };

    const allowed = await request(app)
      .patch(`/api/v1/admin/fleet/vehicles/${fixture.vehicleBId}`)
      .send({ color: 'Blue' });
    expect(allowed.status).toBe(200);

    mockUser = {
      role: 'fleet_manager',
      permissions: [`fleet:${randomUUID()}`],
      fleetIds: [randomUUID()],
    };

    const denied = await request(app)
      .patch(`/api/v1/admin/fleet/vehicles/${fixture.vehicleBId}`)
      .send({ color: 'Red' });
    expect(denied.status).toBe(403);
    expect(denied.body.error?.code).toBe('UNAUTHORIZED');
  });

  it('makes vehicle QR eligible and allows QR issue after category assignment', async () => {
    await db
      .delete(vehicleServiceCategories)
      .where(eq(vehicleServiceCategories.vehicleId, fixture.vehicleBId));

    const updateRes = await request(app)
      .patch(`/api/v1/admin/fleet/vehicles/${fixture.vehicleBId}`)
      .send({
        make: 'Tesla',
        model: 'Model',
        year: 2024,
        color: 'Black',
        plateNumber: `QR-${randomUUID().slice(0, 8)}`,
        status: 'active',
        approvalStatus: 'approved',
        serviceCategoryIds: [secondaryCategoryId],
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.serviceCategories).toHaveLength(1);

    const vehicle = await db
      .select()
      .from(vehicles)
      .where(eq(vehicles.id, fixture.vehicleBId))
      .limit(1);
    const categories = updateRes.body.data.serviceCategories.map((c: { id: string; code: string; name: string; capacity?: number }) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      isPrimary: true,
      capacity: 1,
    }));
    expect(isVehicleQrEligible(vehicle[0]!, categories)).toBe(true);

    const qrRes = await request(app).post(
      `/api/v1/admin/fleet/vehicles/${fixture.vehicleBId}/qr/issue`
    );
    expect(qrRes.status).toBe(201);
    expect(qrRes.body.success).toBe(true);
    expect(qrRes.body.data.token).toBeTruthy();
  });

  it('writes vehicle_updated audit event', async () => {
    const before = await db
      .select()
      .from(fleetAuditEvents)
      .where(eq(fleetAuditEvents.vehicleId, fixture.vehicleBId));

    await request(app)
      .patch(`/api/v1/admin/fleet/vehicles/${fixture.vehicleBId}`)
      .send({ make: 'Audi' });

    const after = await db
      .select()
      .from(fleetAuditEvents)
      .where(eq(fleetAuditEvents.vehicleId, fixture.vehicleBId));

    expect(after.length).toBeGreaterThan(before.length);
    expect(after.some((event) => event.eventType === 'vehicle_updated')).toBe(true);
  });

  it('returns 404 for missing vehicle', async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/fleet/vehicles/${randomUUID()}`)
      .send({ make: 'Ford' });
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('VEHICLE_NOT_FOUND');
  });
});

describe('updateAdminFleetVehicle service guards', () => {
  it('exposes typed update errors', () => {
    const err = new AdminFleetVehicleUpdateError('VEHICLE_UPDATE_INVALID', 'bad');
    expect(err.code).toBe('VEHICLE_UPDATE_INVALID');
    expect(err.statusCode).toBe(400);
  });
});
