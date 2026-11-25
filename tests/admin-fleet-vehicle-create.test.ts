/**
 * POST /api/v1/admin/fleet/vehicles — authorization (real rbac middleware),
 * validation, and persistence against a disposable migrated PostgreSQL.
 * The DB block runs only when DATABASE_URL is set and is not the local ryd_u.
 */
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'crypto';

type MockUser = { role?: string; permissions: string[]; fleetIds: string[]; userId?: string };

let mockUser: MockUser = { role: 'admin', permissions: [], fleetIds: [] };

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.headers.authorization) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTH_FAILED', message: 'Authentication required' },
      });
      return;
    }
    next();
  },
  extractUserInfo: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { user?: MockUser }).user = mockUser;
    next();
  },
}));

jest.mock('../src/middleware/device-tracking', () => ({
  trackDriverDevice: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const TARGET_URL = process.env.DATABASE_URL;
const targetDbName = TARGET_URL ? new URL(TARGET_URL).pathname.replace(/^\//, '') : '';
const runDbTests = Boolean(TARGET_URL) && targetDbName !== 'ryd_u';

const AUTH = { Authorization: 'Bearer test' };

function validBody(fleetId: string, overrides: Record<string, unknown> = {}) {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  return {
    make: 'Toyota',
    model: 'Camry',
    year: 2022,
    color: 'White',
    plateNumber: `TST-${suffix}`,
    fleetId,
    ...overrides,
  };
}

async function buildApp() {
  const fleetRoutes = (await import('../src/routes/v1/admin/fleet')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/v1/admin/fleet', fleetRoutes);
  return app;
}

describe('POST /api/v1/admin/fleet/vehicles — authorization and validation', () => {
  let app: express.Express;
  const fleetId = randomUUID();

  beforeAll(async () => {
    app = await buildApp();
  });

  beforeEach(() => {
    mockUser = { role: 'admin', permissions: [], fleetIds: [] };
  });

  it('defaults an omitted status to pending and keeps explicit statuses', async () => {
    const { createVehicleSchema, VEHICLE_STATUSES } = await import('../src/validators');
    expect(createVehicleSchema.parse(validBody(fleetId)).status).toBe('pending');
    for (const status of VEHICLE_STATUSES) {
      expect(createVehicleSchema.parse(validBody(fleetId, { status })).status).toBe(status);
    }
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).post('/api/v1/admin/fleet/vehicles').send(validBody(fleetId));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_FAILED');
  });

  it('rejects fleet_manager with 403, even for its own fleet', async () => {
    mockUser = { role: 'fleet_manager', permissions: [], fleetIds: [fleetId] };
    const res = await request(app)
      .post('/api/v1/admin/fleet/vehicles')
      .set(AUTH)
      .send(validBody(fleetId));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it.each(['driver', 'customer'])('rejects %s with 403', async (role) => {
    mockUser = { role, permissions: [], fleetIds: [] };
    const res = await request(app)
      .post('/api/v1/admin/fleet/vehicles')
      .set(AUTH)
      .send(validBody(fleetId));
    expect(res.status).toBe(403);
  });

  it('rejects a token without a role with 401', async () => {
    mockUser = { permissions: [], fleetIds: [] };
    const res = await request(app)
      .post('/api/v1/admin/fleet/vehicles')
      .set(AUTH)
      .send(validBody(fleetId));
    expect(res.status).toBe(401);
  });

  it('requires make, model, year, color and plate number, but not fleet', async () => {
    const res = await request(app).post('/api/v1/admin/fleet/vehicles').set(AUTH).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const fields = (res.body.error.details as { path: string[] }[]).map((d) => d.path.join('.'));
    expect(fields).toEqual(
      expect.arrayContaining(['make', 'model', 'year', 'color', 'plateNumber'])
    );
    expect(fields).not.toContain('fleetId');
  });

  it('treats an omitted, empty or null fleetId as unset in validation', async () => {
    const { createVehicleSchema } = await import('../src/validators');
    const { fleetId: _omit, ...withoutFleet } = validBody(fleetId);
    expect(createVehicleSchema.parse(withoutFleet).fleetId).toBeUndefined();
    expect(createVehicleSchema.parse(validBody('')).fleetId).toBeUndefined();
    expect(createVehicleSchema.parse({ ...withoutFleet, fleetId: null }).fleetId).toBeUndefined();
    expect(createVehicleSchema.parse(validBody(fleetId)).fleetId).toBe(fleetId);
  });

  it.each([
    ['blank make', { make: '   ' }],
    ['make too long', { make: 'x'.repeat(101) }],
    ['plate too long', { plateNumber: 'P'.repeat(51) }],
    ['color too long', { color: 'c'.repeat(51) }],
    ['year too old', { year: 1899 }],
    ['year in far future', { year: new Date().getFullYear() + 2 }],
    ['non-integer year', { year: 2020.5 }],
    ['invalid VIN length', { vin: 'ABC123' }],
    ['VIN with forbidden letter', { vin: '1HGCM82633A00435O' }],
    ['body number too long', { bodyNumber: 'b'.repeat(101) }],
    ['unknown status', { status: 'retired' }],
    ['invalid fleet id', { fleetId: 'not-a-uuid' }],
    ['unknown field', { qrCode: 'VEH-123' }],
  ])('rejects %s with 400', async (_label, overrides) => {
    const res = await request(app)
      .post('/api/v1/admin/fleet/vehicles')
      .set(AUTH)
      .send(validBody(fleetId, overrides));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

(runDbTests ? describe : describe.skip)('POST /api/v1/admin/fleet/vehicles — live PostgreSQL', () => {
  type Db = typeof import('../src/db/connection');
  let app: express.Express;
  let conn: Db;
  let schema: typeof import('../src/db/schema');
  let orm: typeof import('drizzle-orm');
  let orgId: string;
  let fleetId: string;
  const createdVehicleIds: string[] = [];

  beforeAll(async () => {
    conn = await import('../src/db/connection');
    schema = await import('../src/db/schema');
    orm = await import('drizzle-orm');
    app = await buildApp();
    const runId = randomUUID().slice(0, 8);
    const [org] = await conn.db
      .insert(schema.organizations)
      .values({ name: `Vehicle Create Org ${runId}`, type: 'company', status: 'active' })
      .returning();
    const [fleet] = await conn.db
      .insert(schema.fleets)
      .values({ organizationId: org.id, name: `Vehicle Create Fleet ${runId}`, status: 'active' })
      .returning();
    orgId = org.id;
    fleetId = fleet.id;
  });

  afterAll(async () => {
    const { inArray, eq } = orm;
    if (createdVehicleIds.length) {
      await conn.db
        .delete(schema.fleetAuditEvents)
        .where(inArray(schema.fleetAuditEvents.vehicleId, createdVehicleIds));
      await conn.db.delete(schema.vehicles).where(inArray(schema.vehicles.id, createdVehicleIds));
    }
    await conn.db.delete(schema.fleets).where(eq(schema.fleets.id, fleetId));
    await conn.db.delete(schema.organizations).where(eq(schema.organizations.id, orgId));
    await conn.closeConnection();
  });

  async function create(role: string, body: Record<string, unknown>) {
    mockUser = { role, permissions: [], fleetIds: [] };
    const res = await request(app).post('/api/v1/admin/fleet/vehicles').set(AUTH).send(body);
    if (res.status === 201) createdVehicleIds.push(res.body.data.id);
    return res;
  }

  it('admin creates a vehicle (201) defaulting to pending, with audit and no QR token', async () => {
    const body = validBody(fleetId, {
      vin: '1hgcm82633a004352',
      bodyNumber: 'B-77',
      plateNumber: `  ADM-${randomUUID().slice(0, 6)}  `,
    });
    const res = await create('admin', body);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const v = res.body.data;
    expect(v).toMatchObject({
      make: 'Toyota',
      model: 'Camry',
      year: 2022,
      color: 'White',
      plateNumber: (body.plateNumber as string).trim(),
      vin: '1HGCM82633A004352',
      bodyNumber: 'B-77',
      fleetId,
      status: 'pending',
      approvalStatus: 'pending',
      fleet: { id: fleetId },
      organization: { id: orgId },
      serviceCategories: [],
      qr: { hasActiveToken: false, status: 'not_issued', tokenId: null },
    });

    const { eq } = orm;
    const audit = await conn.db
      .select()
      .from(schema.fleetAuditEvents)
      .where(eq(schema.fleetAuditEvents.vehicleId, v.id));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      eventType: 'vehicle_created',
      actorType: 'admin',
      entityType: 'vehicle',
      fleetId,
    });

    const tokens = await conn.db
      .select()
      .from(schema.vehicleQrTokens)
      .where(eq(schema.vehicleQrTokens.vehicleId, v.id));
    expect(tokens).toHaveLength(0);

    const [row] = await conn.db.select().from(schema.vehicles).where(eq(schema.vehicles.id, v.id));
    expect(row.qrCode).toBeNull();
  });

  it('super_admin creates a vehicle with an explicit supported status', async () => {
    const res = await create('super_admin', validBody(fleetId, { status: 'maintenance' }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'maintenance', approvalStatus: 'maintenance' });
  });

  it('admin can still explicitly create an active vehicle', async () => {
    const res = await create('admin', validBody(fleetId, { status: 'active' }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'active', approvalStatus: 'approved' });
  });

  it('rejects a duplicate plate number (case-insensitive) with 409', async () => {
    const plate = `DUP-${randomUUID().slice(0, 6).toUpperCase()}`;
    expect((await create('admin', validBody(fleetId, { plateNumber: plate }))).status).toBe(201);

    const res = await create('admin', validBody(fleetId, { plateNumber: plate.toLowerCase() }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PLATE_NUMBER_ALREADY_EXISTS');
  });

  it('rejects a duplicate VIN with 409', async () => {
    const vin = '5YJ3E1EA7KF317000';
    expect((await create('admin', validBody(fleetId, { vin }))).status).toBe(201);

    const res = await create('super_admin', validBody(fleetId, { vin: vin.toLowerCase() }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VIN_ALREADY_EXISTS');
  });

  it('rejects a fleet that does not exist with 400 and writes nothing', async () => {
    const plate = `NOF-${randomUUID().slice(0, 6).toUpperCase()}`;
    const res = await create('admin', validBody(randomUUID(), { plateNumber: plate }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('FLEET_NOT_FOUND');

    const { eq } = orm;
    const rows = await conn.db
      .select()
      .from(schema.vehicles)
      .where(eq(schema.vehicles.plateNumber, plate));
    expect(rows).toHaveLength(0);
  });

  it('assigns Platform Fleet when fleetId is omitted, still defaulting to pending', async () => {
    const { PLATFORM_FLEET_NAME } = await import('../src/config/duty');
    const { fleetId: _omit, ...body } = validBody(fleetId);
    const res = await create('admin', body);

    expect(res.status).toBe(201);
    const { eq } = orm;
    const [platformFleet] = await conn.db
      .select()
      .from(schema.fleets)
      .where(eq(schema.fleets.name, PLATFORM_FLEET_NAME));
    expect(platformFleet).toBeDefined();
    expect(res.body.data).toMatchObject({
      fleetId: platformFleet.id,
      fleet: { id: platformFleet.id },
      status: 'pending',
    });
    const [row] = await conn.db
      .select()
      .from(schema.vehicles)
      .where(eq(schema.vehicles.id, res.body.data.id));
    expect(row.fleetId).toBe(platformFleet.id);

    const platformRows = await conn.db
      .select()
      .from(schema.fleets)
      .where(eq(schema.fleets.name, PLATFORM_FLEET_NAME));
    expect(platformRows).toHaveLength(1);
  });

  it('super_admin sending an empty fleetId also lands in Platform Fleet', async () => {
    const res = await create('super_admin', validBody(fleetId, { fleetId: '' }));
    expect(res.status).toBe(201);
    expect(res.body.data.fleet.name).toBe('Platform Fleet');
  });

  it('keeps an explicitly selected fleet instead of Platform Fleet', async () => {
    const res = await create('admin', validBody(fleetId));
    expect(res.status).toBe(201);
    expect(res.body.data.fleetId).toBe(fleetId);
  });

  it('new vehicle appears immediately in GET /vehicles', async () => {
    const created = await create('admin', validBody(fleetId));
    expect(created.status).toBe(201);

    mockUser = { role: 'admin', permissions: [], fleetIds: [] };
    const res = await request(app)
      .get(`/api/v1/admin/fleet/vehicles?limit=1000&fleetId=${fleetId}`)
      .set(AUTH);
    expect(res.status).toBe(200);
    const listed = (res.body.data.vehicles as { id: string; plateNumber: string }[]).find(
      (v) => v.id === created.body.data.id
    );
    expect(listed).toMatchObject({
      plateNumber: created.body.data.plateNumber,
      fleet: { id: fleetId },
      qr: { status: 'not_issued' },
    });
  });
});
