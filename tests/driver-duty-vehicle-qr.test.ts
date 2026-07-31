import 'dotenv/config';
import express from 'express';
import request from 'supertest';
import { db } from '../src/db/connection';
import { drivers } from '../src/db/schema/drivers';
import { driverVehicleAssignments } from '../src/db/schema/driver_vehicle_assignments';
import { vehicleQrTokens } from '../src/db/schema/vehicle_qr_tokens';
import { dutySessions } from '../src/db/schema/duty_sessions';
import { eq } from 'drizzle-orm';
import {
  getCurrentDuty,
  getCurrentVehicleQrForDriver,
  startDuty,
  DutyError,
} from '../src/services/duty.service';
import {
  createMigratedDutyStartFixture,
  cleanupMigratedDutyStartFixture,
  type MigratedDutyStartFixture,
} from './helpers/dutyStart.fixtures';
import { revokeToken } from '../src/repositories/vehicleQrToken.repository';

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
  };
});

let mockAuth0Id = 'auth0-test-driver';

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
  extractUserInfo: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { user?: { auth0Id: string; role: string } }).user = {
      auth0Id: mockAuth0Id,
      role: 'driver',
    };
    next();
  },
}));

jest.mock('../src/middleware/rbac', () => ({
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
  requireDriver: [
    (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  ],
  trackDriverDevice: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
}));

const hasDatabase = Boolean(process.env.DATABASE_URL);

(hasDatabase ? describe : describe.skip)('driver current vehicle QR', () => {
  jest.setTimeout(60_000);

  let fixture: MigratedDutyStartFixture;
  let app: express.Express;

  beforeAll(async () => {
    const dutyRoutes = (await import('../src/routes/v1/driver/duty')).default;
    app = express();
    app.use(express.json());
    app.use('/api/v1/driver/duty', dutyRoutes);
  });

  beforeEach(async () => {
    fixture = await createMigratedDutyStartFixture();
    const driver = await db
      .select()
      .from(drivers)
      .where(eq(drivers.id, fixture.driverId))
      .limit(1);
    mockAuth0Id = driver[0]!.auth0Id;
  });

  afterEach(async () => {
    if (fixture) {
      await cleanupMigratedDutyStartFixture(fixture);
    }
  });

  async function startDriverDuty() {
    return startDuty({
      driverId: fixture.driverId,
      vehicleQrToken: fixture.qrToken,
    });
  }

  it('returns active QR image for on-duty driver with assignment', async () => {
    await startDriverDuty();

    const result = await getCurrentVehicleQrForDriver(fixture.driverId);
    expect(result.qr.tokenId).toBeTruthy();
    expect(result.qr.status).toBe('active');
    expect(result.image.format).toBe('base64');
    expect(result.image.base64.length).toBeGreaterThan(100);
    expect(result.image.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.vehicle.plateNumber).toBeTruthy();
    expect(JSON.stringify(result)).not.toMatch(/VQR_/);
    expect(result).not.toHaveProperty('token');
  });

  it('GET /api/v1/driver/duty/current/vehicle-qr returns success for assigned on-duty driver', async () => {
    await startDriverDuty();

    const res = await request(app).get('/api/v1/driver/duty/current/vehicle-qr');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.qr.status).toBe('active');
    expect(res.body.data.image.base64).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/VQR_/);
  });

  it('rejects off-duty driver', async () => {
    await expect(getCurrentVehicleQrForDriver(fixture.driverId)).rejects.toMatchObject({
      code: 'DRIVER_NOT_ON_DUTY',
    });
  });

  it('rejects driver assigned to another vehicle than duty session', async () => {
    const duty = await startDriverDuty();
    fixture.ids.dutyIds.push(duty.dutySessionId);

    await db
      .update(driverVehicleAssignments)
      .set({ vehicleId: fixture.otherVehicleId })
      .where(eq(driverVehicleAssignments.id, fixture.assignmentId));

    await expect(getCurrentVehicleQrForDriver(fixture.driverId)).rejects.toMatchObject({
      code: 'ASSIGNMENT_VEHICLE_MISMATCH',
    });
  });

  it('rejects when active QR is revoked', async () => {
    await startDriverDuty();

    const active = await db
      .select()
      .from(vehicleQrTokens)
      .where(eq(vehicleQrTokens.vehicleId, fixture.vehicleId))
      .limit(1);

    await revokeToken(active[0]!.id);

    await expect(getCurrentVehicleQrForDriver(fixture.driverId)).rejects.toMatchObject({
      code: 'VEHICLE_QR_NOT_ISSUED',
    });
  });

  it('GET /api/v1/driver/duty/current includes year, color, organization, categories, and qrStatus', async () => {
    await startDriverDuty();

    const current = await getCurrentDuty(fixture.driverId);
    expect(current).not.toBeNull();
    expect(current!.vehicle?.year).toBeDefined();
    expect(current!.vehicle?.fleetName).toBeTruthy();
    expect(current!.vehicle?.organizationName).toBeTruthy();
    expect(current!.organization?.name).toBeTruthy();
    expect(current!.assignment?.status).toBe('active');
    expect(current!.qrStatus).toBe('active');
    expect(Array.isArray(current!.serviceCategories)).toBe(true);
  });

  it('rejects when assignment no longer matches active duty session', async () => {
    await startDriverDuty();

    const [otherDuty] = await db
      .insert(dutySessions)
      .values({
        driverId: fixture.otherDriverId,
        fleetId: fixture.fleetId,
        organizationId: fixture.orgId,
        status: 'active',
        startVehicleId: fixture.otherVehicleId,
      })
      .returning();

    await db
      .update(driverVehicleAssignments)
      .set({ dutySessionId: otherDuty.id })
      .where(eq(driverVehicleAssignments.id, fixture.assignmentId));

    await expect(getCurrentVehicleQrForDriver(fixture.driverId)).rejects.toMatchObject({
      code: 'ASSIGNMENT_CHANGED',
    });
  });
});

describe('driver vehicle QR error contract', () => {
  it('defines VEHICLE_QR_NOT_ISSUED', () => {
    const err = new DutyError(
      'VEHICLE_QR_NOT_ISSUED',
      'No active official QR exists for the assigned vehicle.',
      404
    );
    expect(err.statusCode).toBe(404);
  });
});
