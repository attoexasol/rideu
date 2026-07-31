import 'dotenv/config';
import { db } from '../src/db/connection';
import { driverVehicleAssignments } from '../src/db/schema/driver_vehicle_assignments';
import { dutySessions } from '../src/db/schema/duty_sessions';
import { fleetAuditEvents } from '../src/db/schema/fleet_audit_events';
import { eq } from 'drizzle-orm';
import { startDuty, DutyError } from '../src/services/duty.service';
import { findActiveDutySessionByDriverId } from '../src/repositories/dutySession.repository';
import {
  createMigratedDutyStartFixture,
  cleanupMigratedDutyStartFixture,
  countActiveAssignmentsForDriver,
  type MigratedDutyStartFixture,
} from './helpers/dutyStart.fixtures';

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

const { emitDutyStarted } = jest.requireMock('../src/services/dutyNotify.service');
const { realtimeCache } = jest.requireMock('../src/config/redis');

const hasDatabase = Boolean(process.env.DATABASE_URL);

(hasDatabase ? describe : describe.skip)('duty start with migrated assignments', () => {
  jest.setTimeout(60_000);

  let fixture: MigratedDutyStartFixture;

  beforeEach(async () => {
    jest.clearAllMocks();
    fixture = await createMigratedDutyStartFixture();
  });

  afterEach(async () => {
    if (fixture) {
      await cleanupMigratedDutyStartFixture(fixture);
    }
  });

  it('starts duty when same driver has migrated assignment and no active duty', async () => {
    const result = await startDuty({
      driverId: fixture.driverId,
      vehicleQrToken: fixture.qrToken,
    });

    expect(result.dutySessionId).toBeTruthy();
    expect(result.assignmentId).toBe(fixture.assignmentId);
    expect(result.resumed).toBe(true);
    expect(result.status).toBe('online');

    const assignment = await db
      .select()
      .from(driverVehicleAssignments)
      .where(eq(driverVehicleAssignments.id, fixture.assignmentId))
      .limit(1);
    expect(assignment[0]?.dutySessionId).toBe(result.dutySessionId);
    expect(assignment[0]?.assignmentReason).toBe('legacy_migration_resume');
    expect(assignment[0]?.isActive).toBe(true);

    const duty = await findActiveDutySessionByDriverId(fixture.driverId);
    expect(duty?.id).toBe(result.dutySessionId);

    expect(await countActiveAssignmentsForDriver(fixture.driverId)).toBe(1);

    const audits = await db
      .select()
      .from(fleetAuditEvents)
      .where(eq(fleetAuditEvents.driverId, fixture.driverId));
    expect(audits.some((event) => event.eventType === 'duty_started')).toBe(true);
    expect(audits.some((event) => event.eventType === 'assignment_started')).toBe(true);

    expect(realtimeCache.setDriverStatus).toHaveBeenCalledWith(fixture.driverId, 'online');
    expect(emitDutyStarted).toHaveBeenCalledWith(
      fixture.driverId,
      expect.objectContaining({ dutySessionId: result.dutySessionId, resumed: true })
    );
  });

  it('returns current duty idempotently when driver is already on duty for same vehicle', async () => {
    const first = await startDuty({
      driverId: fixture.driverId,
      vehicleQrToken: fixture.qrToken,
    });
    fixture.ids.dutyIds.push(first.dutySessionId);

    jest.clearAllMocks();

    const second = await startDuty({
      driverId: fixture.driverId,
      vehicleQrToken: fixture.qrToken,
    });

    expect(second.idempotent).toBe(true);
    expect(second.dutySessionId).toBe(first.dutySessionId);
    expect(second.assignmentId).toBe(first.assignmentId);
    expect(await countActiveAssignmentsForDriver(fixture.driverId)).toBe(1);
    expect(emitDutyStarted).not.toHaveBeenCalled();
  });

  it('rejects when vehicle is assigned to another driver', async () => {
    await expect(
      startDuty({
        driverId: fixture.otherDriverId,
        vehicleQrToken: fixture.qrToken,
      })
    ).rejects.toMatchObject({
      code: 'VEHICLE_ALREADY_ASSIGNED',
      details: {
        currentAssignment: {
          vehicleId: fixture.vehicleId,
          status: 'active',
        },
      },
    });
  });

  it('rejects when driver is assigned to another vehicle', async () => {
    await expect(
      startDuty({
        driverId: fixture.driverId,
        vehicleQrToken: fixture.otherQrToken,
      })
    ).rejects.toMatchObject({
      code: 'DRIVER_ALREADY_ASSIGNED_TO_ANOTHER_VEHICLE',
    });
  });

  it('does not create duplicate active assignments on resume', async () => {
    const before = await db
      .select()
      .from(driverVehicleAssignments)
      .where(eq(driverVehicleAssignments.driverId, fixture.driverId));
    expect(before).toHaveLength(1);

    await startDuty({
      driverId: fixture.driverId,
      vehicleQrToken: fixture.qrToken,
    });

    const after = await db
      .select()
      .from(driverVehicleAssignments)
      .where(eq(driverVehicleAssignments.driverId, fixture.driverId));
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(fixture.assignmentId);
  });

  it('preserves assignment history by updating the existing row', async () => {
    const originalAssignedAt = (
      await db
        .select()
        .from(driverVehicleAssignments)
        .where(eq(driverVehicleAssignments.id, fixture.assignmentId))
        .limit(1)
    )[0]!.assignedAt;

    await startDuty({
      driverId: fixture.driverId,
      vehicleQrToken: fixture.qrToken,
    });

    const updated = (
      await db
        .select()
        .from(driverVehicleAssignments)
        .where(eq(driverVehicleAssignments.id, fixture.assignmentId))
        .limit(1)
    )[0]!;

    expect(updated.assignedAt.getTime()).toBe(originalAssignedAt.getTime());
    expect(updated.dutySessionId).toBeTruthy();
  });

  it('links duty session to the existing migrated assignment', async () => {
    const result = await startDuty({
      driverId: fixture.driverId,
      vehicleQrToken: fixture.qrToken,
    });
    fixture.ids.dutyIds.push(result.dutySessionId);

    const duty = await db
      .select()
      .from(dutySessions)
      .where(eq(dutySessions.id, result.dutySessionId))
      .limit(1);
    expect(duty[0]?.startVehicleId).toBe(fixture.vehicleId);
    expect(duty[0]?.status).toBe('active');
  });
});

describe('DutyError conflict payloads', () => {
  it('supports DRIVER_ALREADY_ASSIGNED_TO_ANOTHER_VEHICLE', () => {
    const err = new DutyError(
      'DRIVER_ALREADY_ASSIGNED_TO_ANOTHER_VEHICLE',
      'blocked',
      409,
      { currentAssignment: { vehicleId: 'v1', status: 'active' } }
    );
    expect(err.code).toBe('DRIVER_ALREADY_ASSIGNED_TO_ANOTHER_VEHICLE');
    expect(err.details).toEqual({
      currentAssignment: { vehicleId: 'v1', status: 'active' },
    });
  });
});
