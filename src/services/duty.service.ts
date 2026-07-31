import { db } from '../db/connection';
import { drivers } from '../db/schema/drivers';
import { vehicles } from '../db/schema/vehicles';
import { dutySessions } from '../db/schema/duty_sessions';
import { driverVehicleAssignments } from '../db/schema/driver_vehicle_assignments';
import { vehicleQrTokens } from '../db/schema/vehicle_qr_tokens';
import { eq, and } from 'drizzle-orm';
import { findActiveBookingByDriver } from '../repositories/booking.repository';
import { ACTIVE_BOOKING_STATUSES } from '../constants/bookingStatus';
import { findActiveFleetMembershipForDriver } from '../repositories/driverFleetMembership.repository';
import {
  findActiveAssignmentByDriverId,
  findActiveAssignmentWithVehicle,
} from '../repositories/driverVehicleAssignment.repository';
import {
  findActiveDutySessionByDriverId,
} from '../repositories/dutySession.repository';
import {
  findOrganizationById,
  findFleetById,
} from '../repositories/organization.repository';
import { resolveVehicleQrToken, VehicleQrError } from './vehicleQrToken.service';
import { insertFleetAuditEvent } from '../repositories/fleetAudit.repository';
import {
  listVehicleServiceCategoriesWithDetails,
  loadVehicleServiceCategorySummaries,
} from '../repositories/vehicleServiceCategory.repository';
import { findActiveTokenForVehicle } from '../repositories/vehicleQrToken.repository';
import { loadLegacyDriverHintsForVehicles } from '../repositories/adminVehicleEnrichment.repository';
import { resolveVehicleProfile } from './adminVehicleProfile.service';
import { generateQrImage } from '../utils/qrImage';
import { realtimeCache } from '../config/redis';
import { emitDutyEnded, emitDutyStarted } from './dutyNotify.service';
import { APPROVED_VEHICLE_STATUSES, ACTIVE_DUTY_STATUS } from '../config/duty';

export class DutyError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 409,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'DutyError';
  }
}

const LEGACY_MIGRATION_ASSIGNMENT_REASONS = new Set([
  'migration_backfill',
  'legacy_cab_migration',
]);

function isLegacyMigrationAssignmentReason(reason: string | null | undefined): boolean {
  return Boolean(reason && LEGACY_MIGRATION_ASSIGNMENT_REASONS.has(reason));
}

function resolveResumeAssignmentReason(reason: string | null | undefined): string {
  if (isLegacyMigrationAssignmentReason(reason) || !reason || reason === 'duty_start') {
    return 'legacy_migration_resume';
  }
  return reason;
}

function formatLocation(location?: { latitude: number; longitude: number } | null): string | null {
  if (!location) return null;
  return JSON.stringify({ lat: location.latitude, lng: location.longitude });
}

export async function driverHasActiveRide(driverId: string): Promise<boolean> {
  const booking = await findActiveBookingByDriver(driverId);
  if (!booking) return false;
  return ACTIVE_BOOKING_STATUSES.includes(booking.status as (typeof ACTIVE_BOOKING_STATUSES)[number]);
}

export interface DutyStartInput {
  driverId: string;
  vehicleQrToken: string;
  location?: { latitude: number; longitude: number } | null;
  deviceId?: string | null;
}

export interface DutyStartResult {
  dutySessionId: string;
  assignmentId: string;
  fleet: { id: string; name: string };
  organization: { id: string; name: string };
  vehicle: {
    id: string;
    plateNumber: string | null;
    make: string | null;
    model: string | null;
  };
  status: string;
  serviceCategories: Awaited<ReturnType<typeof listVehicleServiceCategoriesWithDetails>>;
  resumed?: boolean;
  idempotent?: boolean;
}

async function buildDutyStartPayload(
  input: {
    dutySessionId: string;
    assignmentId: string;
    fleet: { id: string; name: string };
    organization: { id: string; name: string };
    vehicle: typeof vehicles.$inferSelect;
  },
  options?: { resumed?: boolean; idempotent?: boolean }
): Promise<DutyStartResult> {
  const categories = await listVehicleServiceCategoriesWithDetails(input.vehicle.id);
  return {
    dutySessionId: input.dutySessionId,
    assignmentId: input.assignmentId,
    fleet: input.fleet,
    organization: input.organization,
    vehicle: {
      id: input.vehicle.id,
      plateNumber: input.vehicle.plateNumber,
      make: input.vehicle.make,
      model: input.vehicle.model,
    },
    status: 'online',
    serviceCategories: categories,
    resumed: options?.resumed,
    idempotent: options?.idempotent,
  };
}

export async function startDuty(input: DutyStartInput): Promise<DutyStartResult> {
  const driverRows = await db.select().from(drivers).where(eq(drivers.id, input.driverId)).limit(1);
  const driver = driverRows[0];
  if (!driver) {
    throw new DutyError('DRIVER_NOT_FOUND', 'Driver not found', 404);
  }

  const membership = await findActiveFleetMembershipForDriver(input.driverId);
  if (!membership) {
    throw new DutyError('FLEET_MISMATCH', 'Driver has no active fleet membership', 403);
  }

  const fleet = await findFleetById(membership.fleetId);
  if (!fleet) {
    throw new DutyError('FLEET_MISMATCH', 'Fleet not found', 403);
  }

  const organization = await findOrganizationById(fleet.organizationId);
  if (!organization) {
    throw new DutyError('FLEET_MISMATCH', 'Organization not found', 403);
  }

  if (await driverHasActiveRide(input.driverId)) {
    throw new DutyError('ACTIVE_RIDE_BLOCKS_DUTY', 'Active ride blocks duty start');
  }

  let resolved;
  try {
    resolved = await resolveVehicleQrToken(input.vehicleQrToken);
  } catch (err) {
    if (err instanceof VehicleQrError) {
      throw new DutyError(err.code, err.message, err.statusCode);
    }
    throw err;
  }

  if (resolved.fleetId && resolved.fleetId !== membership.fleetId) {
    throw new DutyError('FLEET_MISMATCH', 'Vehicle does not belong to driver fleet', 403);
  }

  const vehicleRows = await db
    .select()
    .from(vehicles)
    .where(eq(vehicles.id, resolved.vehicleId))
    .limit(1);
  const vehicle = vehicleRows[0];
  if (!vehicle) {
    throw new DutyError('QR_TOKEN_INVALID', 'Vehicle not found for QR token', 400);
  }

  if (vehicle.fleetId && vehicle.fleetId !== membership.fleetId) {
    throw new DutyError('FLEET_MISMATCH', 'Vehicle does not belong to driver fleet', 403);
  }

  if (!APPROVED_VEHICLE_STATUSES.has(vehicle.status)) {
    throw new DutyError('VEHICLE_NOT_APPROVED', 'Vehicle is not approved for duty');
  }

  const existingDuty = await findActiveDutySessionByDriverId(input.driverId);
  if (existingDuty) {
    const existingAssignment = await findActiveAssignmentByDriverId(input.driverId);
    if (existingAssignment?.vehicle_id === vehicle.id) {
      await realtimeCache.setDriverStatus(input.driverId, 'online');
      return buildDutyStartPayload(
        {
          dutySessionId: existingDuty.id,
          assignmentId: existingAssignment.id,
          fleet,
          organization,
          vehicle,
        },
        { idempotent: true }
      );
    }

    const currentDuty = await getCurrentDuty(input.driverId);
    throw new DutyError(
      'DRIVER_ALREADY_ON_DUTY',
      'Driver already has an active duty session',
      409,
      { currentDuty }
    );
  }

  const result = await db.transaction(async (tx) => {
    await tx.select().from(drivers).where(eq(drivers.id, input.driverId)).for('update');
    await tx.select().from(vehicles).where(eq(vehicles.id, vehicle.id)).for('update');

    const dutyRows = await tx
      .select()
      .from(dutySessions)
      .where(
        and(eq(dutySessions.driverId, input.driverId), eq(dutySessions.status, ACTIVE_DUTY_STATUS))
      )
      .limit(1);
    const activeDuty = dutyRows[0];
    if (activeDuty) {
      const assignmentRows = await tx
        .select()
        .from(driverVehicleAssignments)
        .where(
          and(
            eq(driverVehicleAssignments.driverId, input.driverId),
            eq(driverVehicleAssignments.isActive, true)
          )
        )
        .limit(1);
      const assignment = assignmentRows[0];
      if (assignment?.vehicleId === vehicle.id) {
        return {
          kind: 'idempotent' as const,
          dutySession: activeDuty,
          assignment,
        };
      }
      throw new DutyError('DRIVER_ALREADY_ON_DUTY', 'Driver already has an active duty session');
    }

    const vehicleAssignmentRows = await tx
      .select()
      .from(driverVehicleAssignments)
      .where(
        and(
          eq(driverVehicleAssignments.vehicleId, vehicle.id),
          eq(driverVehicleAssignments.isActive, true)
        )
      )
      .limit(1);
    const vehicleAssignment = vehicleAssignmentRows[0] ?? null;

    const driverAssignmentRows = await tx
      .select()
      .from(driverVehicleAssignments)
      .where(
        and(
          eq(driverVehicleAssignments.driverId, input.driverId),
          eq(driverVehicleAssignments.isActive, true)
        )
      )
      .limit(1);
    const driverAssignment = driverAssignmentRows[0] ?? null;

    if (vehicleAssignment && vehicleAssignment.driverId !== input.driverId) {
      throw new DutyError(
        'VEHICLE_ALREADY_ASSIGNED',
        'Vehicle is already assigned to another driver',
        409,
        {
          currentAssignment: {
            vehicleId: vehicle.id,
            status: 'active',
          },
        }
      );
    }

    if (driverAssignment && driverAssignment.vehicleId !== vehicle.id) {
      throw new DutyError(
        'DRIVER_ALREADY_ASSIGNED_TO_ANOTHER_VEHICLE',
        'Driver already has an active assignment to another vehicle',
        409,
        {
          currentAssignment: {
            vehicleId: driverAssignment.vehicleId,
            status: 'active',
          },
        }
      );
    }

    const [dutySession] = await tx
      .insert(dutySessions)
      .values({
        driverId: input.driverId,
        fleetId: fleet.id,
        organizationId: organization.id,
        status: 'active',
        startVehicleId: vehicle.id,
        startLocation: formatLocation(input.location),
      })
      .returning();

    let assignment;
    let resumed = false;

    if (vehicleAssignment && vehicleAssignment.driverId === input.driverId) {
      await tx
        .select()
        .from(driverVehicleAssignments)
        .where(eq(driverVehicleAssignments.id, vehicleAssignment.id))
        .for('update');

      const [linkedAssignment] = await tx
        .update(driverVehicleAssignments)
        .set({
          dutySessionId: dutySession.id,
          fleetId: fleet.id,
          assignmentReason: resolveResumeAssignmentReason(vehicleAssignment.assignmentReason),
        })
        .where(eq(driverVehicleAssignments.id, vehicleAssignment.id))
        .returning();
      assignment = linkedAssignment;
      resumed = true;
    } else {
      const [createdAssignment] = await tx
        .insert(driverVehicleAssignments)
        .values({
          driverId: input.driverId,
          vehicleId: vehicle.id,
          fleetId: fleet.id,
          dutySessionId: dutySession.id,
          isActive: true,
          assignedBy: 'driver_scan',
          assignmentReason: 'duty_start',
        })
        .returning();
      assignment = createdAssignment;
    }

    await tx
      .update(drivers)
      .set({ vehicleId: vehicle.id, status: 'online', updatedAt: new Date() })
      .where(eq(drivers.id, input.driverId));

    return {
      kind: resumed ? ('resumed' as const) : ('created' as const),
      dutySession,
      assignment,
      resumed,
    };
  });

  if (result.kind === 'idempotent') {
    await realtimeCache.setDriverStatus(input.driverId, 'online');
    return buildDutyStartPayload(
      {
        dutySessionId: result.dutySession.id,
        assignmentId: result.assignment.id,
        fleet,
        organization,
        vehicle,
      },
      { idempotent: true }
    );
  }

  await insertFleetAuditEvent({
    eventType: 'duty_started',
    actorType: 'driver',
    actorId: input.driverId,
    entityType: 'duty_session',
    entityId: result.dutySession.id,
    driverId: input.driverId,
    vehicleId: vehicle.id,
    fleetId: fleet.id,
    payload: {
      deviceId: input.deviceId ?? null,
      qrTokenId: resolved.tokenId,
      legacySource: resolved.legacySource,
      resumed: result.resumed ?? false,
    },
  });

  if (result.kind === 'created') {
    await insertFleetAuditEvent({
      eventType: 'assignment_started',
      actorType: 'driver',
      actorId: input.driverId,
      entityType: 'driver_vehicle_assignment',
      entityId: result.assignment.id,
      driverId: input.driverId,
      vehicleId: vehicle.id,
      fleetId: fleet.id,
      payload: { reason: 'duty_start', dutySessionId: result.dutySession.id },
    });
  } else if (result.kind === 'resumed') {
    await insertFleetAuditEvent({
      eventType: 'assignment_started',
      actorType: 'driver',
      actorId: input.driverId,
      entityType: 'driver_vehicle_assignment',
      entityId: result.assignment.id,
      driverId: input.driverId,
      vehicleId: vehicle.id,
      fleetId: fleet.id,
      payload: {
        reason: result.assignment.assignmentReason ?? 'legacy_migration_resume',
        dutySessionId: result.dutySession.id,
        resumed: true,
      },
    });
  }

  await realtimeCache.setDriverStatus(input.driverId, 'online');

  const payload = await buildDutyStartPayload(
    {
      dutySessionId: result.dutySession.id,
      assignmentId: result.assignment.id,
      fleet,
      organization,
      vehicle,
    },
    { resumed: result.kind === 'resumed' }
  );

  await emitDutyStarted(input.driverId, { ...payload });

  return payload;
}

export interface DutyEndInput {
  driverId: string;
  reason?: string;
  location?: { latitude: number; longitude: number } | null;
  forced?: boolean;
  adminId?: string | null;
}

export async function endDuty(input: DutyEndInput) {
  if (!input.forced && (await driverHasActiveRide(input.driverId))) {
    throw new DutyError('ACTIVE_RIDE_BLOCKS_DUTY_END', 'Active ride blocks duty end');
  }

  const dutySession = await findActiveDutySessionByDriverId(input.driverId);
  if (!dutySession) {
    throw new DutyError('DRIVER_NOT_ON_DUTY', 'No active duty session found');
  }

  const assignment = await findActiveAssignmentByDriverId(input.driverId);

  const result = await db.transaction(async (tx) => {
    if (assignment) {
      await tx
        .update(driverVehicleAssignments)
        .set({
          isActive: false,
          unassignedAt: new Date(),
          unassignedReason: input.forced ? 'admin_force_end' : 'duty_end',
        })
        .where(eq(driverVehicleAssignments.id, assignment.id));
    }

    const [endedSession] = await tx
      .update(dutySessions)
      .set({
        status: input.forced ? 'forced_end' : 'ended',
        endedAt: new Date(),
        endedReason: input.reason ?? 'shift_end',
        endLocation: formatLocation(input.location),
        updatedAt: new Date(),
      })
      .where(eq(dutySessions.id, dutySession.id))
      .returning();

    const [updatedDriver] = await tx
      .update(drivers)
      .set({ vehicleId: null, status: 'offline', updatedAt: new Date() })
      .where(eq(drivers.id, input.driverId))
      .returning();

    return { endedSession, updatedDriver, assignment };
  });

  if (assignment) {
    await insertFleetAuditEvent({
      eventType: 'assignment_ended',
      actorType: input.adminId ? 'admin' : 'driver',
      actorId: input.adminId ?? input.driverId,
      entityType: 'driver_vehicle_assignment',
      entityId: assignment.id,
      driverId: input.driverId,
      vehicleId: assignment.vehicle_id,
      fleetId: assignment.fleet_id,
      payload: { reason: input.reason ?? 'shift_end', dutySessionId: dutySession.id },
    });
  }

  await insertFleetAuditEvent({
    eventType: input.forced ? 'admin_override' : 'duty_ended',
    actorType: input.adminId ? 'admin' : 'driver',
    actorId: input.adminId ?? input.driverId,
    entityType: 'duty_session',
    entityId: dutySession.id,
    driverId: input.driverId,
    vehicleId: assignment?.vehicle_id ?? null,
    fleetId: dutySession.fleetId,
    payload: { reason: input.reason ?? 'shift_end', forced: input.forced ?? false },
  });

  await realtimeCache.setDriverStatus(input.driverId, 'offline');

  const payload = {
    dutySessionId: result.endedSession.id,
    status: 'offline',
    endedReason: input.reason ?? 'shift_end',
  };

  await emitDutyEnded(input.driverId, payload);

  return payload;
}

export async function getCurrentDuty(driverId: string) {
  const dutySession = await findActiveDutySessionByDriverId(driverId);
  if (!dutySession) {
    return null;
  }

  const assignmentRow = await findActiveAssignmentWithVehicle(driverId);
  const fleet = await findFleetById(dutySession.fleetId);
  const organization = fleet ? await findOrganizationById(fleet.organizationId) : null;

  const driverRows = await db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1);
  const driver = driverRows[0];

  const vehicleId = assignmentRow?.vehicle.id;
  const serviceCategories = vehicleId
    ? await loadVehicleServiceCategorySummaries(vehicleId)
    : [];
  const hints = vehicleId ? await loadLegacyDriverHintsForVehicles([vehicleId]) : new Map();
  const profile = assignmentRow
    ? resolveVehicleProfile(assignmentRow.vehicle, hints.get(vehicleId!))
    : null;
  const qrStatus = vehicleId ? await resolveVehicleQrStatus(vehicleId) : 'not_issued';

  return {
    dutySession: {
      id: dutySession.id,
      status: dutySession.status,
      startedAt: dutySession.startedAt,
      fleetId: dutySession.fleetId,
      organizationId: dutySession.organizationId,
    },
    assignment: assignmentRow
      ? {
          id: assignmentRow.assignment.id,
          vehicleId: assignmentRow.vehicle.id,
          assignedAt: assignmentRow.assignment.assignedAt,
          fleetId: assignmentRow.assignment.fleetId,
          status: assignmentRow.assignment.isActive ? 'active' : 'inactive',
        }
      : null,
    fleet: fleet ? { id: fleet.id, name: fleet.name, status: fleet.status } : null,
    organization: organization
      ? { id: organization.id, name: organization.name, type: organization.type }
      : null,
    vehicle: assignmentRow
      ? {
          id: assignmentRow.vehicle.id,
          plateNumber: profile?.plateNumber ?? assignmentRow.vehicle.plateNumber,
          make: profile?.make ?? assignmentRow.vehicle.make,
          model: profile?.model ?? assignmentRow.vehicle.model,
          year: profile?.year ?? assignmentRow.vehicle.year,
          color: profile?.color ?? assignmentRow.vehicle.color,
          status: assignmentRow.vehicle.status,
          fleetName: fleet?.name ?? null,
          organizationName: organization?.name ?? null,
        }
      : null,
    serviceCategories,
    qrStatus,
    status: driver?.status ?? 'offline',
  };
}

export type VehicleQrDisplayStatus = 'active' | 'not_issued' | 'revoked';

export async function resolveVehicleQrStatus(vehicleId: string): Promise<VehicleQrDisplayStatus> {
  const active = await findActiveTokenForVehicle(vehicleId);
  if (active) return 'active';

  const revokedRows = await db
    .select({ id: vehicleQrTokens.id })
    .from(vehicleQrTokens)
    .where(and(eq(vehicleQrTokens.vehicleId, vehicleId), eq(vehicleQrTokens.status, 'revoked')))
    .limit(1);
  if (revokedRows.length) return 'revoked';

  return 'not_issued';
}

export interface DriverCurrentVehicleQrResult {
  vehicle: {
    id: string;
    make: string | null;
    model: string | null;
    year: number | null;
    color: string | null;
    plateNumber: string | null;
    fleetName: string | null;
    organizationName: string | null;
    serviceCategories: Awaited<ReturnType<typeof loadVehicleServiceCategorySummaries>>;
  };
  qr: {
    tokenId: string;
    status: string;
    issuedAt: Date;
  };
  image: {
    format: 'base64';
    base64: string;
    dataUrl: string;
  };
}

export async function getCurrentVehicleQrForDriver(
  driverId: string
): Promise<DriverCurrentVehicleQrResult> {
  const locked = await db.transaction(async (tx) => {
    await tx.select().from(drivers).where(eq(drivers.id, driverId)).for('update');

    const dutyRows = await tx
      .select()
      .from(dutySessions)
      .where(
        and(eq(dutySessions.driverId, driverId), eq(dutySessions.status, ACTIVE_DUTY_STATUS))
      )
      .limit(1);
    const dutySession = dutyRows[0];
    if (!dutySession) {
      throw new DutyError('DRIVER_NOT_ON_DUTY', 'Driver is not on duty', 409);
    }

    const assignmentRows = await tx
      .select()
      .from(driverVehicleAssignments)
      .where(
        and(
          eq(driverVehicleAssignments.driverId, driverId),
          eq(driverVehicleAssignments.isActive, true)
        )
      )
      .for('update')
      .limit(1);
    const assignment = assignmentRows[0];
    if (!assignment) {
      throw new DutyError('NO_ACTIVE_ASSIGNMENT', 'Driver has no active vehicle assignment', 409);
    }

    if (assignment.vehicleId !== dutySession.startVehicleId) {
      throw new DutyError(
        'ASSIGNMENT_VEHICLE_MISMATCH',
        'Active assignment does not match the duty session vehicle',
        409
      );
    }

    if (assignment.dutySessionId && assignment.dutySessionId !== dutySession.id) {
      throw new DutyError(
        'ASSIGNMENT_CHANGED',
        'Vehicle assignment changed during request',
        409
      );
    }

    const vehicleRows = await tx
      .select()
      .from(vehicles)
      .where(eq(vehicles.id, assignment.vehicleId))
      .for('update');
    const vehicle = vehicleRows[0];
    if (!vehicle) {
      throw new DutyError('VEHICLE_NOT_FOUND', 'Assigned vehicle not found', 404);
    }

    if (vehicle.fleetId && vehicle.fleetId !== dutySession.fleetId) {
      throw new DutyError('FLEET_MISMATCH', 'Vehicle does not belong to the active duty fleet', 403);
    }

    const membership = await findActiveFleetMembershipForDriver(driverId);
    if (!membership || membership.fleetId !== dutySession.fleetId) {
      throw new DutyError('FLEET_MISMATCH', 'Driver fleet membership does not match active duty', 403);
    }

    const tokenRows = await tx
      .select()
      .from(vehicleQrTokens)
      .where(
        and(
          eq(vehicleQrTokens.vehicleId, vehicle.id),
          eq(vehicleQrTokens.status, 'active')
        )
      )
      .limit(1);
    const qrToken = tokenRows[0];
    if (!qrToken) {
      throw new DutyError(
        'VEHICLE_QR_NOT_ISSUED',
        'No active official QR exists for the assigned vehicle.',
        404
      );
    }

    const recheckRows = await tx
      .select()
      .from(driverVehicleAssignments)
      .where(eq(driverVehicleAssignments.id, assignment.id))
      .limit(1);
    const recheck = recheckRows[0];
    if (
      !recheck?.isActive ||
      recheck.driverId !== driverId ||
      recheck.vehicleId !== vehicle.id
    ) {
      throw new DutyError(
        'ASSIGNMENT_CHANGED',
        'Vehicle assignment changed during request',
        409
      );
    }

    return { dutySession, assignment: recheck, vehicle, qrToken };
  });

  const fleet = await findFleetById(locked.dutySession.fleetId);
  const organization = fleet ? await findOrganizationById(fleet.organizationId) : null;
  const hints = await loadLegacyDriverHintsForVehicles([locked.vehicle.id]);
  const profile = resolveVehicleProfile(locked.vehicle, hints.get(locked.vehicle.id));
  const serviceCategories = await loadVehicleServiceCategorySummaries(locked.vehicle.id);

  const image = await generateQrImage(locked.qrToken.token, 'base64');

  return {
    vehicle: {
      id: locked.vehicle.id,
      make: profile.make,
      model: profile.model,
      year: profile.year,
      color: profile.color,
      plateNumber: profile.plateNumber,
      fleetName: fleet?.name ?? null,
      organizationName: organization?.name ?? null,
      serviceCategories,
    },
    qr: {
      tokenId: locked.qrToken.id,
      status: locked.qrToken.status,
      issuedAt: locked.qrToken.issuedAt,
    },
    image: {
      format: 'base64',
      base64: image.base64 ?? '',
      dataUrl: image.dataUrl ?? '',
    },
  };
}

export async function assertDriverCanGoOnline(driverId: string): Promise<void> {
  const duty = await findActiveDutySessionByDriverId(driverId);
  const assignment = await findActiveAssignmentByDriverId(driverId);
  if (!duty || !assignment) {
    throw new DutyError(
      'DRIVER_NOT_ON_DUTY',
      'Active duty session and vehicle assignment required to go online'
    );
  }
}

export async function shouldAllowGpsOnlineTransition(driverId: string): Promise<boolean> {
  const duty = await findActiveDutySessionByDriverId(driverId);
  return duty !== null;
}
