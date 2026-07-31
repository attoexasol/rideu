import { listVehicleServiceCategoryIds } from '../repositories/vehicleServiceCategory.repository';
import { listDriverServiceCategoryIds } from '../repositories/serviceCategory.repository';
import { findActiveAssignmentByDriverId } from '../repositories/driverVehicleAssignment.repository';
import { db } from '../db/connection';
import { drivers } from '../db/schema/drivers';
import { eq } from 'drizzle-orm';

export type ServiceCategorySource = 'active_assignment' | 'legacy_driver_vehicle';

export interface ResolvedServiceCategories {
  categoryIds: string[];
  source: ServiceCategorySource;
  vehicleId: string | null;
}

export async function resolveDriverServiceCategories(
  driverId: string
): Promise<ResolvedServiceCategories> {
  const activeAssignment = await findActiveAssignmentByDriverId(driverId);
  if (activeAssignment) {
    const categoryIds = await listVehicleServiceCategoryIds(activeAssignment.vehicle_id);
    if (categoryIds.length > 0) {
      return {
        categoryIds,
        source: 'active_assignment',
        vehicleId: activeAssignment.vehicle_id,
      };
    }
  }

  const driverRows = await db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1);
  const driver = driverRows[0];
  const vehicleId = activeAssignment?.vehicle_id ?? driver?.vehicleId ?? null;

  if (vehicleId) {
    const vehicleCategories = await listVehicleServiceCategoryIds(vehicleId);
    if (vehicleCategories.length > 0) {
      return {
        categoryIds: vehicleCategories,
        source: 'active_assignment',
        vehicleId,
      };
    }
  }

  const driverCategories = await listDriverServiceCategoryIds(driverId);
  return {
    categoryIds: driverCategories,
    source: 'legacy_driver_vehicle',
    vehicleId: driver?.vehicleId ?? null,
  };
}

export async function driverServesCategory(
  driverId: string,
  serviceCategoryId: string
): Promise<{ matches: boolean; source: ServiceCategorySource }> {
  const resolved = await resolveDriverServiceCategories(driverId);
  return {
    matches: resolved.categoryIds.includes(serviceCategoryId),
    source: resolved.source,
  };
}
