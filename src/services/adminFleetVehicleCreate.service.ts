import { db } from '../db/connection';
import { vehicles } from '../db/schema/vehicles';
import { organizations } from '../db/schema/organizations';
import { fleetAuditEvents } from '../db/schema/fleet_audit_events';
import { eq, sql } from 'drizzle-orm';
import { APPROVED_VEHICLE_STATUSES } from '../config/duty';
import { findFleetById } from '../repositories/organization.repository';
import { assertFleetAccess, type AdminFleetScope } from './adminFleetAccess.service';
import { resolveVehicleProfile } from './adminVehicleProfile.service';
import { resolvePlatformFleetId } from './defaultFleet.service';

export interface CreateAdminFleetVehicleInput {
  make: string;
  model: string;
  year: number;
  color: string;
  plateNumber: string;
  vin?: string;
  bodyNumber?: string;
  fleetId?: string;
  status: string;
}

export class AdminFleetVehicleCreateError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400
  ) {
    super(message);
    this.name = 'AdminFleetVehicleCreateError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function plateExistsError() {
  return new AdminFleetVehicleCreateError(
    'PLATE_NUMBER_ALREADY_EXISTS',
    'Plate number is already assigned to another vehicle',
    409
  );
}

function vinExistsError() {
  return new AdminFleetVehicleCreateError(
    'VIN_ALREADY_EXISTS',
    'VIN is already assigned to another vehicle',
    409
  );
}

/** Maps a PostgreSQL unique violation (possibly wrapped by Drizzle) to a 409. */
function uniqueViolationToError(error: unknown): AdminFleetVehicleCreateError | null {
  const candidates = [error, (error as { cause?: unknown })?.cause];
  for (const candidate of candidates) {
    const pg = candidate as { code?: string; constraint?: string; constraint_name?: string };
    if (pg?.code !== '23505') continue;
    const constraint = pg.constraint ?? pg.constraint_name ?? '';
    if (constraint.includes('vin')) return vinExistsError();
    return plateExistsError();
  }
  return null;
}

export async function createAdminFleetVehicle(
  scope: AdminFleetScope,
  input: CreateAdminFleetVehicleInput,
  actorId?: string | null
) {
  const fleetId = input.fleetId ?? (await resolvePlatformFleetId());
  const fleet = await findFleetById(fleetId);
  if (!fleet) {
    throw new AdminFleetVehicleCreateError('FLEET_NOT_FOUND', 'Selected fleet does not exist', 400);
  }
  assertFleetAccess(scope, fleet.id);

  const plateNumber = input.plateNumber.trim();
  const vin = input.vin?.trim().toUpperCase() || null;

  const [plateMatch] = await db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(sql`lower(${vehicles.plateNumber}) = lower(${plateNumber})`)
    .limit(1);
  if (plateMatch) throw plateExistsError();

  if (vin) {
    const [vinMatch] = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(sql`upper(${vehicles.vin}) = ${vin}`)
      .limit(1);
    if (vinMatch) throw vinExistsError();
  }

  let created: typeof vehicles.$inferSelect;
  try {
    created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(vehicles)
        .values({
          make: input.make.trim(),
          model: input.model.trim(),
          year: input.year,
          color: input.color.trim(),
          plateNumber,
          vin,
          bodyNumber: input.bodyNumber?.trim() || null,
          fleetId: fleet.id,
          status: input.status,
        })
        .returning();

      await tx.insert(fleetAuditEvents).values({
        eventType: 'vehicle_created',
        actorType: 'admin',
        actorId: actorId && UUID_PATTERN.test(actorId) ? actorId : null,
        entityType: 'vehicle',
        entityId: row.id,
        vehicleId: row.id,
        fleetId: fleet.id,
        payload: { plateNumber, status: row.status, source: 'admin_create' },
      });

      return row;
    });
  } catch (error) {
    const mapped = uniqueViolationToError(error);
    if (mapped) throw mapped;
    throw error;
  }

  const [organization] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, fleet.organizationId))
    .limit(1);

  const profile = resolveVehicleProfile(created);

  return {
    id: created.id,
    make: profile.make,
    model: profile.model,
    displayName: profile.displayName,
    plateNumber: profile.plateNumber,
    year: profile.year,
    color: profile.color,
    vin: created.vin,
    bodyNumber: created.bodyNumber,
    capacity: null,
    fleetId: created.fleetId,
    status: created.status,
    approvalStatus: APPROVED_VEHICLE_STATUSES.has(created.status) ? 'approved' : created.status,
    organization: organization ?? null,
    fleet: { id: fleet.id, name: fleet.name },
    serviceCategories: [],
    currentAssignment: null,
    currentDuty: null,
    qr: { hasActiveToken: false, status: 'not_issued', tokenId: null },
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  };
}
