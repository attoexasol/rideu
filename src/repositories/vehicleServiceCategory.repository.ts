import { db } from '../db/connection';
import { vehicleServiceCategories } from '../db/schema/vehicle_service_categories';
import { serviceCategories } from '../db/schema/service_categories';
import { eq } from 'drizzle-orm';

export async function listVehicleServiceCategoryIds(vehicleId: string): Promise<string[]> {
  const rows = await db
    .select({ serviceCategoryId: vehicleServiceCategories.serviceCategoryId })
    .from(vehicleServiceCategories)
    .where(eq(vehicleServiceCategories.vehicleId, vehicleId));
  return rows.map((r) => r.serviceCategoryId);
}

export async function insertVehicleServiceCategory(
  data: typeof vehicleServiceCategories.$inferInsert
) {
  const [row] = await db
    .insert(vehicleServiceCategories)
    .values(data)
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}

export async function listVehicleServiceCategoriesWithDetails(vehicleId: string) {
  return db
    .select()
    .from(vehicleServiceCategories)
    .where(eq(vehicleServiceCategories.vehicleId, vehicleId));
}

export interface VehicleServiceCategorySummary {
  id: string;
  code: string;
  name: string;
}

export async function loadVehicleServiceCategorySummaries(
  vehicleId: string
): Promise<VehicleServiceCategorySummary[]> {
  const rows = await db
    .select({
      id: serviceCategories.id,
      code: serviceCategories.code,
      name: serviceCategories.name,
    })
    .from(vehicleServiceCategories)
    .innerJoin(
      serviceCategories,
      eq(serviceCategories.id, vehicleServiceCategories.serviceCategoryId)
    )
    .where(eq(vehicleServiceCategories.vehicleId, vehicleId));

  return rows;
}
