/**
 * Default Platform Fleet assignment for new drivers and vehicles, the narrow
 * membership backfill, and the duty-start fleet check that depends on both.
 * Runs only against a disposable migrated PostgreSQL (never the local ryd_u).
 */
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'crypto';

type MockUser = { role?: string; permissions: string[]; fleetIds: string[]; userId?: string };

let mockUser: MockUser = { role: 'admin', permissions: [], fleetIds: [] };
const mockCreateUser = jest.fn();

jest.mock('../src/middleware/auth', () => {
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return {
    verifyJWT: pass,
    requireAuth: pass,
    requireSuperAdmin: pass,
    extractUserInfo: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      (req as express.Request & { user?: MockUser }).user = mockUser;
      next();
    },
  };
});

jest.mock('uuid', () => ({
  v4: () => jest.requireActual<typeof import('crypto')>('crypto').randomUUID(),
}));

jest.mock('../src/middleware/device-tracking', () => ({
  trackDriverDevice: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../src/services/auth0Management', () => ({
  auth0Management: {
    isConfigured: () => true,
    findUserByEmail: async () => null,
    createUser: (...args: unknown[]) => mockCreateUser(...args),
    deleteUser: async () => undefined,
    sendPasswordResetEmail: async () => ({ delivered: true }),
  },
}));

jest.mock('../src/services/dutyNotify.service', () => ({
  emitDutyStarted: jest.fn().mockResolvedValue(undefined),
  emitDutyEnded: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/config/redis', () => {
  const store = new Map<string, string>();
  return {
    redis: {
      setex: jest.fn(async (key: string, _ttl: number, val: string) => {
        store.set(key, val);
      }),
      get: jest.fn(async (key: string) => store.get(key) ?? null),
      del: jest.fn(async (key: string) => {
        store.delete(key);
      }),
    },
    realtimeCache: {
      setDriverStatus: jest.fn().mockResolvedValue(undefined),
      getDriverStatus: jest.fn().mockResolvedValue(null),
    },
    redisPub: { publish: jest.fn().mockResolvedValue(undefined) },
    PubSubChannels: {},
  };
});

const TARGET_URL = process.env.DATABASE_URL;
const targetDbName = TARGET_URL ? new URL(TARGET_URL).pathname.replace(/^\//, '') : '';
const runDbTests = Boolean(TARGET_URL) && targetDbName !== 'ryd_u';

(runDbTests ? describe : describe.skip)('default Platform Fleet assignment — live PostgreSQL', () => {
  jest.setTimeout(60_000);

  let conn: typeof import('../src/db/connection');
  let schema: typeof import('../src/db/schema');
  let orm: typeof import('drizzle-orm');
  let app: express.Express;
  let platformFleetId: string;
  let concurrentEnsureResults: { organizationId: string; fleetId: string }[];
  let otherOrgId: string;
  let otherFleetId: string;
  const driverIds: string[] = [];
  const vehicleIds: string[] = [];

  beforeAll(async () => {
    conn = await import('../src/db/connection');
    schema = await import('../src/db/schema');
    orm = await import('drizzle-orm');
    const adminUsersRoutes = (await import('../src/routes/admin/users')).default;
    const driverRoutes = (await import('../src/routes/drivers')).default;
    app = express();
    app.use(express.json());
    app.use('/api/admin/users', adminUsersRoutes);
    app.use('/api/drivers', driverRoutes);

    const { ensurePlatformOrganizationAndFleet } = await import(
      '../src/repositories/organization.repository'
    );
    concurrentEnsureResults = await Promise.all(
      Array.from({ length: 6 }, () => ensurePlatformOrganizationAndFleet())
    );
    platformFleetId = concurrentEnsureResults[0].fleetId;

    const runId = randomUUID().slice(0, 8);
    const [org] = await conn.db
      .insert(schema.organizations)
      .values({ name: `Other Org ${runId}`, type: 'company', status: 'active' })
      .returning();
    const [fleet] = await conn.db
      .insert(schema.fleets)
      .values({ organizationId: org.id, name: `Other Fleet ${runId}`, status: 'active' })
      .returning();
    otherOrgId = org.id;
    otherFleetId = fleet.id;
  });

  beforeEach(() => {
    mockUser = { role: 'admin', permissions: [], fleetIds: [] };
    mockCreateUser.mockReset();
    mockCreateUser.mockImplementation(async () => ({ user_id: `auth0|test-${randomUUID()}` }));
  });

  afterAll(async () => {
    const { inArray, eq } = orm;
    if (driverIds.length) {
      await conn.db.delete(schema.dutySessions).where(inArray(schema.dutySessions.driverId, driverIds));
      await conn.db
        .delete(schema.driverVehicleAssignments)
        .where(inArray(schema.driverVehicleAssignments.driverId, driverIds));
      await conn.db
        .delete(schema.fleetAuditEvents)
        .where(inArray(schema.fleetAuditEvents.driverId, driverIds));
    }
    if (vehicleIds.length) {
      await conn.db
        .delete(schema.fleetAuditEvents)
        .where(inArray(schema.fleetAuditEvents.vehicleId, vehicleIds));
      await conn.db
        .delete(schema.vehicleQrTokens)
        .where(inArray(schema.vehicleQrTokens.vehicleId, vehicleIds));
    }
    if (driverIds.length) {
      await conn.db.delete(schema.drivers).where(inArray(schema.drivers.id, driverIds));
    }
    if (vehicleIds.length) {
      await conn.db.delete(schema.vehicles).where(inArray(schema.vehicles.id, vehicleIds));
    }
    await conn.db.delete(schema.fleets).where(eq(schema.fleets.id, otherFleetId));
    await conn.db.delete(schema.organizations).where(eq(schema.organizations.id, otherOrgId));
    await conn.closeConnection();
  });

  function driverBody(overrides: Record<string, unknown> = {}) {
    const suffix = randomUUID().slice(0, 8);
    return {
      email: `fleet-default-${suffix}@example.test`,
      password: 'ExamplePassword123!',
      name: `Fleet Default ${suffix}`,
      phone: `+1555${Math.floor(Math.random() * 1e7)}`,
      ...overrides,
    };
  }

  async function membershipsFor(driverId: string) {
    const { eq } = orm;
    return conn.db
      .select()
      .from(schema.driverFleetMemberships)
      .where(eq(schema.driverFleetMemberships.driverId, driverId));
  }

  async function insertDriverRow() {
    const suffix = randomUUID().slice(0, 8);
    const [row] = await conn.db
      .insert(schema.drivers)
      .values({
        auth0Id: `auth0|seed-${suffix}`,
        email: `seed-${suffix}@example.test`,
        name: `Seed ${suffix}`,
        status: 'offline',
      })
      .returning();
    driverIds.push(row.id);
    return row;
  }

  async function insertVehicle(fleetId: string, status = 'active') {
    const [row] = await conn.db
      .insert(schema.vehicles)
      .values({
        make: 'Toyota',
        model: 'Prius',
        plateNumber: `PF-${randomUUID().slice(0, 10)}`,
        status,
        fleetId,
      })
      .returning();
    vehicleIds.push(row.id);
    return row;
  }

  async function issueQr(vehicleId: string, fleetId: string) {
    const { insertVehicleQrToken } = await import('../src/repositories/vehicleQrToken.repository');
    const { generateOpaqueVehicleQrToken } = await import('../src/utils/vehicleQrToken');
    const row = await insertVehicleQrToken({
      vehicleId,
      fleetId,
      token: generateOpaqueVehicleQrToken(),
      status: 'active',
      legacySource: 'issued',
      issuedByAdminId: null,
    });
    return row.token;
  }

  describe('platform provisioning', () => {
    it('concurrent ensure calls converge on a single platform org and fleet', async () => {
      const { PLATFORM_FLEET_NAME } = await import('../src/config/duty');
      const { resolvePlatformFleetId } = await import('../src/services/defaultFleet.service');
      expect(new Set(concurrentEnsureResults.map((r) => r.fleetId)).size).toBe(1);
      expect(new Set(concurrentEnsureResults.map((r) => r.organizationId)).size).toBe(1);
      expect(await resolvePlatformFleetId()).toBe(platformFleetId);

      const { eq } = orm;
      const platformFleets = await conn.db
        .select()
        .from(schema.fleets)
        .where(eq(schema.fleets.name, PLATFORM_FLEET_NAME));
      expect(platformFleets).toHaveLength(1);
      const platformOrgs = await conn.db
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.type, 'platform'));
      expect(platformOrgs).toHaveLength(1);
    });

    it('a restricted scope cannot place a new record in a fleet it does not manage', async () => {
      const { resolveFleetForNewRecord } = await import('../src/services/defaultFleet.service');
      await expect(
        resolveFleetForNewRecord(otherFleetId, { mode: 'restricted', fleetIds: [platformFleetId] })
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        resolveFleetForNewRecord(otherFleetId, { mode: 'restricted', fleetIds: [otherFleetId] })
      ).resolves.toBe(otherFleetId);
    });
  });

  describe('POST /api/admin/users (role driver)', () => {
    it.each(['admin', 'super_admin'])(
      '%s creates a driver with one active Platform Fleet membership',
      async (role) => {
        mockUser = { role, permissions: [], fleetIds: [] };
        const res = await request(app)
          .post('/api/admin/users')
          .send(driverBody({ role: 'driver' }));
        expect(res.status).toBe(201);
        driverIds.push(res.body.data.id);

        const memberships = await membershipsFor(res.body.data.id);
        expect(memberships).toHaveLength(1);
        expect(memberships[0]).toMatchObject({ fleetId: platformFleetId, status: 'active' });

        const { eq } = orm;
        const [driver] = await conn.db
          .select()
          .from(schema.drivers)
          .where(eq(schema.drivers.id, res.body.data.id));
        expect(driver.qrCode).toBeTruthy();
      }
    );

    it('respects an explicitly selected fleet', async () => {
      const res = await request(app)
        .post('/api/admin/users')
        .send(driverBody({ role: 'driver', fleetId: otherFleetId }));
      expect(res.status).toBe(201);
      driverIds.push(res.body.data.id);

      const memberships = await membershipsFor(res.body.data.id);
      expect(memberships).toHaveLength(1);
      expect(memberships[0]).toMatchObject({ fleetId: otherFleetId, status: 'active' });
    });

    it('rejects an unknown fleet before creating the Auth0 user', async () => {
      const body = driverBody({ role: 'driver', fleetId: randomUUID() });
      const res = await request(app).post('/api/admin/users').send(body);
      expect(res.status).toBe(400);
      expect(mockCreateUser).not.toHaveBeenCalled();

      const { eq } = orm;
      const rows = await conn.db
        .select()
        .from(schema.drivers)
        .where(eq(schema.drivers.email, body.email));
      expect(rows).toHaveLength(0);
    });

    it('rejects a malformed fleet id before creating the Auth0 user', async () => {
      const res = await request(app)
        .post('/api/admin/users')
        .send(driverBody({ role: 'driver', fleetId: 'not-a-uuid' }));
      expect(res.status).toBe(400);
      expect(mockCreateUser).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/drivers', () => {
    it('creates a driver with an active Platform Fleet membership by default', async () => {
      const res = await request(app).post('/api/drivers').send(driverBody());
      expect(res.status).toBe(201);
      driverIds.push(res.body.data.id);

      const memberships = await membershipsFor(res.body.data.id);
      expect(memberships).toHaveLength(1);
      expect(memberships[0]).toMatchObject({ fleetId: platformFleetId, status: 'active' });
    });

    it('respects an explicitly selected fleet', async () => {
      mockUser = { role: 'super_admin', permissions: [], fleetIds: [] };
      const res = await request(app).post('/api/drivers').send(driverBody({ fleetId: otherFleetId }));
      expect(res.status).toBe(201);
      driverIds.push(res.body.data.id);

      const memberships = await membershipsFor(res.body.data.id);
      expect(memberships.map((m) => m.fleetId)).toEqual([otherFleetId]);
    });

    it('rejects an unknown fleet with 400 before creating the Auth0 user', async () => {
      const res = await request(app).post('/api/drivers').send(driverBody({ fleetId: randomUUID() }));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('FLEET_NOT_FOUND');
      expect(mockCreateUser).not.toHaveBeenCalled();
    });
  });

  describe('driver self-registration', () => {
    it('registers a driver into Platform Fleet', async () => {
      const { registerDriver } = await import('../src/services/driverRegistration.service');
      const body = driverBody();
      const result = await registerDriver({
        name: body.name,
        email: body.email,
        phone: body.phone,
        password: body.password,
      });
      driverIds.push(result.id);

      const memberships = await membershipsFor(result.id);
      expect(memberships).toHaveLength(1);
      expect(memberships[0]).toMatchObject({ fleetId: platformFleetId, status: 'active' });
    });
  });

  describe('duty start with default fleets', () => {
    it('admin-created driver can start duty on an approved Platform Fleet vehicle created without fleetId', async () => {
      const res = await request(app)
        .post('/api/admin/users')
        .send(driverBody({ role: 'driver' }));
      expect(res.status).toBe(201);
      const driverId = res.body.data.id as string;
      driverIds.push(driverId);

      const { createAdminFleetVehicle } = await import(
        '../src/services/adminFleetVehicleCreate.service'
      );
      const vehicle = await createAdminFleetVehicle(
        { mode: 'all', fleetIds: [] },
        {
          make: 'Toyota',
          model: 'Corolla',
          year: 2024,
          color: 'Silver',
          plateNumber: `PFD-${randomUUID().slice(0, 8)}`,
          status: 'pending',
        },
        null
      );
      vehicleIds.push(vehicle.id);
      expect(vehicle).toMatchObject({ fleetId: platformFleetId, status: 'pending' });

      const qrToken = await issueQr(vehicle.id, platformFleetId);
      const { startDuty } = await import('../src/services/duty.service');

      await expect(startDuty({ driverId, vehicleQrToken: qrToken })).rejects.toMatchObject({
        code: 'VEHICLE_NOT_APPROVED',
      });

      const { eq } = orm;
      await conn.db
        .update(schema.vehicles)
        .set({ status: 'active' })
        .where(eq(schema.vehicles.id, vehicle.id));

      const duty = await startDuty({ driverId, vehicleQrToken: qrToken });
      expect(duty.dutySessionId).toBeTruthy();
      expect(duty.status).toBe('online');
    });

    it('still rejects a Platform Fleet driver scanning a vehicle from another fleet', async () => {
      const res = await request(app)
        .post('/api/admin/users')
        .send(driverBody({ role: 'driver' }));
      expect(res.status).toBe(201);
      driverIds.push(res.body.data.id);

      const vehicle = await insertVehicle(otherFleetId);
      const qrToken = await issueQr(vehicle.id, otherFleetId);
      const { startDuty } = await import('../src/services/duty.service');
      await expect(
        startDuty({ driverId: res.body.data.id, vehicleQrToken: qrToken })
      ).rejects.toMatchObject({ code: 'FLEET_MISMATCH', statusCode: 403 });
    });

    it('still rejects a driver with no fleet membership', async () => {
      const driver = await insertDriverRow();
      const vehicle = await insertVehicle(platformFleetId);
      const qrToken = await issueQr(vehicle.id, platformFleetId);
      const { startDuty } = await import('../src/services/duty.service');
      await expect(startDuty({ driverId: driver.id, vehicleQrToken: qrToken })).rejects.toMatchObject({
        code: 'FLEET_MISMATCH',
        message: 'Driver has no active fleet membership',
      });
    });
  });

  describe('backfill-driver-platform-fleet-memberships', () => {
    it('adds Platform Fleet only to drivers without any membership, and is idempotent', async () => {
      const { eq, inArray } = orm;
      const {
        backfillPlatformFleetMemberships,
        findDriversWithOnlyEndedMemberships,
        findDriversWithoutAnyMembership,
      } = await import('../src/scripts/backfill-driver-platform-fleet-memberships');

      const vehicle = await insertVehicle(otherFleetId);
      const missing = await insertDriverRow();
      await conn.db
        .update(schema.drivers)
        .set({ vehicleId: vehicle.id })
        .where(eq(schema.drivers.id, missing.id));

      const otherFleetDriver = await insertDriverRow();
      await conn.db
        .insert(schema.driverFleetMemberships)
        .values({ driverId: otherFleetDriver.id, fleetId: otherFleetId, status: 'active' });

      const endedDriver = await insertDriverRow();
      await conn.db.insert(schema.driverFleetMemberships).values({
        driverId: endedDriver.id,
        fleetId: otherFleetId,
        status: 'inactive',
        leftAt: new Date(),
      });

      const missingIds = (await findDriversWithoutAnyMembership()).map((d) => d.id);
      expect(missingIds).toContain(missing.id);
      expect(missingIds).not.toContain(otherFleetDriver.id);
      expect(missingIds).not.toContain(endedDriver.id);
      expect((await findDriversWithOnlyEndedMemberships()).map((d) => d.id)).toContain(
        endedDriver.id
      );

      const first = await backfillPlatformFleetMemberships(platformFleetId);
      expect(first.map((r) => r.driverId)).toContain(missing.id);
      expect(first.map((r) => r.driverId)).not.toContain(otherFleetDriver.id);
      expect(first.map((r) => r.driverId)).not.toContain(endedDriver.id);

      expect(await membershipsFor(missing.id)).toEqual([
        expect.objectContaining({ fleetId: platformFleetId, status: 'active' }),
      ]);
      expect(await membershipsFor(otherFleetDriver.id)).toEqual([
        expect.objectContaining({ fleetId: otherFleetId, status: 'active' }),
      ]);
      expect(await membershipsFor(endedDriver.id)).toEqual([
        expect.objectContaining({ fleetId: otherFleetId, status: 'inactive' }),
      ]);

      const audit = await conn.db
        .select()
        .from(schema.fleetAuditEvents)
        .where(eq(schema.fleetAuditEvents.driverId, missing.id));
      expect(audit).toEqual([
        expect.objectContaining({
          eventType: 'driver_fleet_membership_backfilled',
          actorType: 'system',
          fleetId: platformFleetId,
        }),
      ]);

      const [vehicleAfter] = await conn.db
        .select()
        .from(schema.vehicles)
        .where(eq(schema.vehicles.id, vehicle.id));
      expect(vehicleAfter.fleetId).toBe(otherFleetId);
      const [driverAfter] = await conn.db
        .select()
        .from(schema.drivers)
        .where(eq(schema.drivers.id, missing.id));
      expect(driverAfter.vehicleId).toBe(vehicle.id);
      const assignments = await conn.db
        .select()
        .from(schema.driverVehicleAssignments)
        .where(inArray(schema.driverVehicleAssignments.driverId, [missing.id]));
      expect(assignments).toHaveLength(0);

      const second = await backfillPlatformFleetMemberships(platformFleetId);
      expect(second.map((r) => r.driverId)).not.toContain(missing.id);
      expect(await membershipsFor(missing.id)).toHaveLength(1);
    });
  });
});
