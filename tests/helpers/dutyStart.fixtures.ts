import { randomUUID } from 'crypto';
import { db } from '../../src/db/connection';
import { organizations } from '../../src/db/schema/organizations';
import { fleets } from '../../src/db/schema/fleets';
import { drivers } from '../../src/db/schema/drivers';
import { vehicles } from '../../src/db/schema/vehicles';
import { driverFleetMemberships } from '../../src/db/schema/driver_fleet_memberships';
import { driverVehicleAssignments } from '../../src/db/schema/driver_vehicle_assignments';
import { dutySessions } from '../../src/db/schema/duty_sessions';
import { fleetAuditEvents } from '../../src/db/schema/fleet_audit_events';
import { vehicleQrTokens } from '../../src/db/schema/vehicle_qr_tokens';
import { insertVehicleQrToken } from '../../src/repositories/vehicleQrToken.repository';
import { generateOpaqueVehicleQrToken } from '../../src/utils/vehicleQrToken';
import { eq, and, inArray } from 'drizzle-orm';

export interface MigratedDutyStartFixture {
  runId: string;
  orgId: string;
  fleetId: string;
  driverId: string;
  otherDriverId: string;
  vehicleId: string;
  otherVehicleId: string;
  assignmentId: string;
  qrToken: string;
  otherQrToken: string;
  ids: {
    orgIds: string[];
    fleetIds: string[];
    driverIds: string[];
    vehicleIds: string[];
    assignmentIds: string[];
    dutyIds: string[];
  };
}

function uid(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

async function issueTestVehicleQr(vehicleId: string, fleetId: string) {
  const row = await insertVehicleQrToken({
    vehicleId,
    fleetId,
    token: generateOpaqueVehicleQrToken(),
    status: 'active',
    legacySource: 'issued',
    issuedByAdminId: null,
  });
  return row;
}

export async function createMigratedDutyStartFixture(): Promise<MigratedDutyStartFixture> {
  const runId = randomUUID().slice(0, 8);

  const [org] = await db
    .insert(organizations)
    .values({ name: `Duty Start Org ${runId}`, type: 'company', status: 'active' })
    .returning();

  const [fleet] = await db
    .insert(fleets)
    .values({ organizationId: org.id, name: `Duty Start Fleet ${runId}`, status: 'active' })
    .returning();

  const [vehicle] = await db
    .insert(vehicles)
    .values({
      make: 'Ford',
      model: 'F-160',
      year: 2026,
      plateNumber: uid('PLT'),
      status: 'active',
      fleetId: fleet.id,
    })
    .returning();

  const [otherVehicle] = await db
    .insert(vehicles)
    .values({
      make: 'Honda',
      model: 'Civic',
      plateNumber: uid('PLT-OTHER'),
      status: 'active',
      fleetId: fleet.id,
    })
    .returning();

  const [driver] = await db
    .insert(drivers)
    .values({
      auth0Id: uid('auth0'),
      email: `${uid('driver')}@duty.test`,
      name: `Driver ${runId}`,
      status: 'offline',
      vehicleId: vehicle.id,
    })
    .returning();

  const [otherDriver] = await db
    .insert(drivers)
    .values({
      auth0Id: uid('auth0-other'),
      email: `${uid('other')}@duty.test`,
      name: `Other Driver ${runId}`,
      status: 'offline',
      vehicleId: otherVehicle.id,
    })
    .returning();

  await db.insert(driverFleetMemberships).values([
    { driverId: driver.id, fleetId: fleet.id, status: 'active' },
    { driverId: otherDriver.id, fleetId: fleet.id, status: 'active' },
  ]);

  const [assignment] = await db
    .insert(driverVehicleAssignments)
    .values({
      driverId: driver.id,
      vehicleId: vehicle.id,
      fleetId: fleet.id,
      isActive: true,
      assignedBy: 'system',
      assignmentReason: 'migration_backfill',
    })
    .returning();

  const qr = await issueTestVehicleQr(vehicle.id, fleet.id);
  const otherQr = await issueTestVehicleQr(otherVehicle.id, fleet.id);

  return {
    runId,
    orgId: org.id,
    fleetId: fleet.id,
    driverId: driver.id,
    otherDriverId: otherDriver.id,
    vehicleId: vehicle.id,
    otherVehicleId: otherVehicle.id,
    assignmentId: assignment.id,
    qrToken: qr.token,
    otherQrToken: otherQr.token,
    ids: {
      orgIds: [org.id],
      fleetIds: [fleet.id],
      driverIds: [driver.id, otherDriver.id],
      vehicleIds: [vehicle.id, otherVehicle.id],
      assignmentIds: [assignment.id],
      dutyIds: [],
    },
  };
}

export async function cleanupMigratedDutyStartFixture(fixture: MigratedDutyStartFixture) {
  await db.delete(dutySessions).where(eq(dutySessions.driverId, fixture.driverId));
  await db.delete(dutySessions).where(eq(dutySessions.driverId, fixture.otherDriverId));
  if (fixture.ids.assignmentIds.length) {
    await db
      .delete(driverVehicleAssignments)
      .where(inArray(driverVehicleAssignments.id, fixture.ids.assignmentIds));
  }
  await db
    .delete(driverVehicleAssignments)
    .where(eq(driverVehicleAssignments.driverId, fixture.otherDriverId));
  await db.delete(fleetAuditEvents).where(eq(fleetAuditEvents.driverId, fixture.driverId));
  await db.delete(fleetAuditEvents).where(eq(fleetAuditEvents.driverId, fixture.otherDriverId));
  if (fixture.ids.vehicleIds.length) {
    await db
      .delete(vehicleQrTokens)
      .where(inArray(vehicleQrTokens.vehicleId, fixture.ids.vehicleIds));
  }
  if (fixture.ids.driverIds.length) {
    await db
      .delete(driverFleetMemberships)
      .where(inArray(driverFleetMemberships.driverId, fixture.ids.driverIds));
    await db.delete(drivers).where(inArray(drivers.id, fixture.ids.driverIds));
  }
  if (fixture.ids.vehicleIds.length) {
    await db.delete(vehicles).where(inArray(vehicles.id, fixture.ids.vehicleIds));
  }
  if (fixture.ids.fleetIds.length) {
    await db.delete(fleets).where(inArray(fleets.id, fixture.ids.fleetIds));
  }
  if (fixture.ids.orgIds.length) {
    await db.delete(organizations).where(inArray(organizations.id, fixture.ids.orgIds));
  }
}

export async function countActiveAssignmentsForDriver(driverId: string) {
  const rows = await db
    .select()
    .from(driverVehicleAssignments)
    .where(
      and(eq(driverVehicleAssignments.driverId, driverId), eq(driverVehicleAssignments.isActive, true))
    );
  return rows.length;
}
