import { db } from '../db/connection';
import { drivers } from '../db/schema/drivers';
import { driverFleetMemberships } from '../db/schema/driver_fleet_memberships';
import { PLATFORM_FLEET_NAME } from '../config/duty';
import {
  ensurePlatformOrganizationAndFleet,
  findFleetById,
  findFleetByName,
} from '../repositories/organization.repository';
import {
  AdminFleetAccessError,
  assertFleetAccess,
  type AdminFleetScope,
} from './adminFleetAccess.service';

export class DefaultFleetError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = 'DefaultFleetError';
  }
}

/**
 * Platform Fleet id. Reads first so the common path never writes; provisioning only
 * runs (under the platform advisory lock) when the fleet does not exist yet.
 */
export async function resolvePlatformFleetId(): Promise<string> {
  const existing = await findFleetByName(PLATFORM_FLEET_NAME);
  if (existing) return existing.id;
  const { fleetId } = await ensurePlatformOrganizationAndFleet();
  return fleetId;
}

/**
 * Fleet for a newly created driver or vehicle: the explicitly selected fleet when the
 * caller is authorized for it, otherwise Platform Fleet.
 */
export async function resolveFleetForNewRecord(
  explicitFleetId: string | null | undefined,
  scope?: AdminFleetScope
): Promise<string> {
  if (!explicitFleetId) {
    return resolvePlatformFleetId();
  }

  const fleet = await findFleetById(explicitFleetId);
  if (!fleet) {
    throw new DefaultFleetError('FLEET_NOT_FOUND', 'Fleet not found', 400);
  }
  if (scope) {
    assertFleetAccess(scope, fleet.id);
  }
  return fleet.id;
}

export function isFleetSelectionError(
  error: unknown
): error is DefaultFleetError | AdminFleetAccessError {
  return error instanceof DefaultFleetError || error instanceof AdminFleetAccessError;
}

type DriverInsert = typeof drivers.$inferInsert;
type DriverRow = typeof drivers.$inferSelect;

/** Driver row and its active fleet membership are committed together or not at all. */
export async function insertDriverWithFleetMembership(
  values: DriverInsert,
  fleetId: string
): Promise<DriverRow> {
  return db.transaction(async (tx) => {
    const [driver] = await tx.insert(drivers).values(values).returning();
    if (!driver) {
      throw new Error('Driver insert returned no row');
    }
    await tx
      .insert(driverFleetMemberships)
      .values({ driverId: driver.id, fleetId, status: 'active' })
      .onConflictDoNothing();
    return driver;
  });
}
