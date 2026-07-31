import { db } from '../db/connection';
import { vehicles } from '../db/schema/vehicles';
import { fleets } from '../db/schema/fleets';
import { serviceCategories } from '../db/schema/service_categories';
import { vehicleServiceCategories } from '../db/schema/vehicle_service_categories';
import { fleetAuditEvents } from '../db/schema/fleet_audit_events';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { APPROVED_VEHICLE_STATUSES } from '../config/duty';
import { vehicleHasActiveRide } from '../repositories/booking.repository';
import { findActiveAssignmentByVehicleId } from '../repositories/driverVehicleAssignment.repository';
import { findFleetById } from '../repositories/organization.repository';
import {
  type VehicleServiceCategoryDetail,
} from '../repositories/adminFleetVehicle.repository';
import {
  assertFleetAccess,
  type AdminFleetScope,
} from './adminFleetAccess.service';
import { resolveVehicleProfile } from './adminVehicleProfile.service';

export interface PatchAdminFleetVehicleInput {
  make?: string;
  model?: string;
  year?: number;
  color?: string;
  plateNumber?: string;
  capacity?: number;
  fleetId?: string;
  status?: string;
  approvalStatus?: string;
  serviceCategoryIds?: string[];
}

export class AdminFleetVehicleUpdateError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400
  ) {
    super(message);
    this.name = 'AdminFleetVehicleUpdateError';
  }
}

const BLOCKED_STATUS_WHEN_ASSIGNED = new Set(['inactive', 'maintenance', 'rejected', 'pending']);

function mapApprovalStatus(status: string): string {
  if (APPROVED_VEHICLE_STATUSES.has(status)) return 'approved';
  return status;
}

function resolveCapacity(categories: VehicleServiceCategoryDetail[]): number | null {
  if (!categories.length) return null;
  const primary = categories.find((c) => c.isPrimary);
  return primary?.capacity ?? categories[0].capacity;
}

async function loadVehicleServiceCategories(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  vehicleId: string
): Promise<VehicleServiceCategoryDetail[]> {
  const rows = await tx
    .select({
      id: serviceCategories.id,
      code: serviceCategories.code,
      name: serviceCategories.name,
      isPrimary: vehicleServiceCategories.isPrimary,
      capacity: serviceCategories.capacity,
    })
    .from(vehicleServiceCategories)
    .innerJoin(
      serviceCategories,
      eq(serviceCategories.id, vehicleServiceCategories.serviceCategoryId)
    )
    .where(eq(vehicleServiceCategories.vehicleId, vehicleId));

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    isPrimary: row.isPrimary,
    capacity: row.capacity,
  }));
}

function resolveStoredStatus(input: PatchAdminFleetVehicleInput, currentStatus: string): string | undefined {
  if (input.status) return input.status;
  if (!input.approvalStatus) return undefined;

  switch (input.approvalStatus) {
    case 'approved':
      return APPROVED_VEHICLE_STATUSES.has(currentStatus) ? currentStatus : 'approved';
    case 'pending':
      return 'pending';
    case 'rejected':
      return 'rejected';
    default:
      return undefined;
  }
}

function buildVehiclePatch(
  input: PatchAdminFleetVehicleInput,
  currentStatus: string
): Partial<typeof vehicles.$inferInsert> {
  const patch: Partial<typeof vehicles.$inferInsert> = { updatedAt: new Date() };

  if (input.make !== undefined) patch.make = input.make;
  if (input.model !== undefined) patch.model = input.model;
  if (input.year !== undefined) patch.year = input.year;
  if (input.color !== undefined) patch.color = input.color;
  if (input.plateNumber !== undefined) patch.plateNumber = input.plateNumber.trim();
  if (input.fleetId !== undefined) patch.fleetId = input.fleetId;

  const nextStatus = resolveStoredStatus(input, currentStatus);
  if (nextStatus !== undefined) patch.status = nextStatus;
  else if (input.status !== undefined) patch.status = input.status;

  return patch;
}

async function assertServiceCategoriesExist(categoryIds: string[]) {
  if (!categoryIds.length) return;

  const rows = await db
    .select({ id: serviceCategories.id })
    .from(serviceCategories)
    .where(inArray(serviceCategories.id, categoryIds));

  if (rows.length !== categoryIds.length) {
    throw new AdminFleetVehicleUpdateError(
      'SERVICE_CATEGORY_NOT_FOUND',
      'One or more service categories were not found',
      404
    );
  }
}

async function assertPlateAvailable(vehicleId: string, plateNumber: string) {
  const rows = await db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(and(eq(vehicles.plateNumber, plateNumber), ne(vehicles.id, vehicleId)))
    .limit(1);

  if (rows.length) {
    throw new AdminFleetVehicleUpdateError(
      'PLATE_NUMBER_ALREADY_EXISTS',
      'Plate number is already assigned to another vehicle',
      409
    );
  }
}

export async function updateAdminFleetVehicle(
  scope: AdminFleetScope,
  vehicleId: string,
  input: PatchAdminFleetVehicleInput,
  actorId?: string | null
) {
  return db.transaction(async (tx) => {
    const lockedRows = await tx
      .select()
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))
      .for('update');

    const vehicle = lockedRows[0];
    if (!vehicle) {
      throw new AdminFleetVehicleUpdateError('VEHICLE_NOT_FOUND', 'Vehicle not found', 404);
    }

    assertFleetAccess(scope, vehicle.fleetId);

    if (input.fleetId && input.fleetId !== vehicle.fleetId) {
      const activeAssignment = await findActiveAssignmentByVehicleId(vehicleId);
      if (activeAssignment) {
        throw new AdminFleetVehicleUpdateError(
          'FLEET_CHANGE_NOT_ALLOWED',
          'Cannot change fleet while vehicle has an active assignment',
          409
        );
      }

      const targetFleet = await findFleetById(input.fleetId);
      if (!targetFleet) {
        throw new AdminFleetVehicleUpdateError('VEHICLE_UPDATE_INVALID', 'Target fleet not found', 400);
      }
      assertFleetAccess(scope, input.fleetId);
    } else if (input.fleetId) {
      const targetFleet = await findFleetById(input.fleetId);
      if (!targetFleet) {
        throw new AdminFleetVehicleUpdateError('VEHICLE_UPDATE_INVALID', 'Target fleet not found', 400);
      }
    }

    const nextStatus = resolveStoredStatus(input, vehicle.status) ?? input.status;
    if (nextStatus && BLOCKED_STATUS_WHEN_ASSIGNED.has(nextStatus)) {
      const activeAssignment = await findActiveAssignmentByVehicleId(vehicleId);
      if (activeAssignment) {
        throw new AdminFleetVehicleUpdateError(
          'ACTIVE_ASSIGNMENT_BLOCKS_UPDATE',
          'Cannot change vehicle status while it has an active assignment',
          409
        );
      }
    }

    if (nextStatus && ['inactive', 'maintenance'].includes(nextStatus)) {
      if (await vehicleHasActiveRide(vehicleId)) {
        throw new AdminFleetVehicleUpdateError(
          'ACTIVE_RIDE_BLOCKS_VEHICLE_STATUS_CHANGE',
          'Cannot change vehicle status while it has an active ride',
          409
        );
      }
    }

    if (input.plateNumber !== undefined) {
      const plate = input.plateNumber.trim();
      if (!plate) {
        throw new AdminFleetVehicleUpdateError(
          'VEHICLE_UPDATE_INVALID',
          'Plate number cannot be empty',
          400
        );
      }
      if (plate !== vehicle.plateNumber) {
        await assertPlateAvailable(vehicleId, plate);
      }
    }

    if (input.serviceCategoryIds !== undefined) {
      const uniqueCategoryIds = [...new Set(input.serviceCategoryIds)];
      await assertServiceCategoriesExist(uniqueCategoryIds);

      const existingRows = await tx
        .select()
        .from(vehicleServiceCategories)
        .where(eq(vehicleServiceCategories.vehicleId, vehicleId));

      const existingIds = existingRows.map((row) => row.serviceCategoryId);
      const toRemove = existingIds.filter((id) => !uniqueCategoryIds.includes(id));
      const toAdd = uniqueCategoryIds.filter((id) => !existingIds.includes(id));

      if (toRemove.length) {
        await tx
          .delete(vehicleServiceCategories)
          .where(
            and(
              eq(vehicleServiceCategories.vehicleId, vehicleId),
              inArray(vehicleServiceCategories.serviceCategoryId, toRemove)
            )
          );
      }

      for (let index = 0; index < toAdd.length; index++) {
        const serviceCategoryId = toAdd[index];
        await tx.insert(vehicleServiceCategories).values({
          vehicleId,
          serviceCategoryId,
          isPrimary: existingIds.length === 0 && index === 0,
          source: 'admin_update',
        });
      }

      if (uniqueCategoryIds.length && existingIds.length) {
        const hasPrimary = existingRows.some((row) => row.isPrimary && uniqueCategoryIds.includes(row.serviceCategoryId));
        if (!hasPrimary) {
          await tx
            .update(vehicleServiceCategories)
            .set({ isPrimary: false, updatedAt: new Date() })
            .where(eq(vehicleServiceCategories.vehicleId, vehicleId));
          await tx
            .update(vehicleServiceCategories)
            .set({ isPrimary: true, updatedAt: new Date() })
            .where(
              and(
                eq(vehicleServiceCategories.vehicleId, vehicleId),
                eq(vehicleServiceCategories.serviceCategoryId, uniqueCategoryIds[0])
              )
            );
        }
      }
    }

    const patch = buildVehiclePatch(input, vehicle.status);
    const fieldKeys = Object.keys(patch).filter((key) => key !== 'updatedAt');
    if (!fieldKeys.length && input.serviceCategoryIds === undefined) {
      throw new AdminFleetVehicleUpdateError(
        'VEHICLE_UPDATE_INVALID',
        'No valid vehicle fields to update',
        400
      );
    }

    let updatedVehicle = vehicle;
    if (fieldKeys.length) {
      const [row] = await tx
        .update(vehicles)
        .set(patch)
        .where(eq(vehicles.id, vehicleId))
        .returning();
      if (!row) {
        throw new AdminFleetVehicleUpdateError('VEHICLE_NOT_FOUND', 'Vehicle not found', 404);
      }
      updatedVehicle = row;
    }

    const fleet = updatedVehicle.fleetId
      ? (await tx.select().from(fleets).where(eq(fleets.id, updatedVehicle.fleetId)).limit(1))[0] ?? null
      : null;

    const categoriesMap = await loadVehicleServiceCategories(tx, vehicleId);
    const serviceCategoriesForVehicle = categoriesMap;
    const profile = resolveVehicleProfile(updatedVehicle);

    await tx.insert(fleetAuditEvents).values({
      eventType: 'vehicle_updated',
      actorType: 'admin',
      actorId: actorId ?? null,
      entityType: 'vehicle',
      entityId: vehicleId,
      vehicleId,
      fleetId: updatedVehicle.fleetId,
      payload: {
        updatedFields: [
          ...fieldKeys,
          ...(input.serviceCategoryIds !== undefined ? ['serviceCategoryIds'] : []),
        ],
      },
    });

    return {
      id: updatedVehicle.id,
      make: profile.make,
      model: profile.model,
      displayName: profile.displayName,
      year: profile.year,
      color: profile.color,
      plateNumber: profile.plateNumber,
      capacity: resolveCapacity(serviceCategoriesForVehicle),
      status: updatedVehicle.status,
      approvalStatus: mapApprovalStatus(updatedVehicle.status),
      fleet: fleet ? { id: fleet.id, name: fleet.name } : null,
      serviceCategories: serviceCategoriesForVehicle.map((category) => ({
        id: category.id,
        code: category.code,
        name: category.name,
      })),
    };
  });
}

export function isVehicleQrEligible(
  vehicle: typeof vehicles.$inferSelect,
  categories: VehicleServiceCategoryDetail[]
): boolean {
  const profile = resolveVehicleProfile(vehicle);
  return Boolean(
    vehicle.fleetId &&
      APPROVED_VEHICLE_STATUSES.has(vehicle.status) &&
      profile.make &&
      profile.model &&
      profile.plateNumber &&
      categories.length > 0
  );
}
