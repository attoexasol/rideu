import { and, desc, eq } from 'drizzle-orm';
import type { MultiPolygon, Polygon } from 'geojson';
import { db } from '../db/connection';
import { serviceAreas, type NewServiceArea, type ServiceArea } from '../db/schema/service_areas';

export async function listServiceAreasForMarket(marketCode: string): Promise<ServiceArea[]> {
  return db.select().from(serviceAreas).where(eq(serviceAreas.marketCode, marketCode));
}

export async function findServiceAreaById(id: string): Promise<ServiceArea | null> {
  const rows = await db.select().from(serviceAreas).where(eq(serviceAreas.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function nextServiceAreaVersion(marketCode: string, code: string): Promise<number> {
  const rows = await db
    .select({ version: serviceAreas.version })
    .from(serviceAreas)
    .where(and(eq(serviceAreas.marketCode, marketCode), eq(serviceAreas.code, code)))
    .orderBy(desc(serviceAreas.version))
    .limit(1);
  return (rows[0]?.version ?? 0) + 1;
}

export async function insertServiceArea(values: NewServiceArea): Promise<ServiceArea> {
  const [row] = await db.insert(serviceAreas).values(values).returning();
  return row;
}

/**
 * Promotes one row to the single active version for its market and code.
 * Older active versions of that same code are retired and stop enforcing.
 */
export async function activateServiceAreaRecord(
  id: string,
  geometry: Polygon | MultiPolygon
): Promise<ServiceArea | null> {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(serviceAreas).where(eq(serviceAreas.id, id)).limit(1);
    const current = rows[0];
    if (!current) return null;

    await tx
      .update(serviceAreas)
      .set({
        status: 'retired',
        enforcementEnabled: false,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(serviceAreas.marketCode, current.marketCode),
          eq(serviceAreas.code, current.code),
          eq(serviceAreas.status, 'active')
        )
      );

    const [updated] = await tx
      .update(serviceAreas)
      .set({
        status: 'active',
        enforcementEnabled: true,
        geometry,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(serviceAreas.id, id))
      .returning();

    return updated ?? null;
  });
}
