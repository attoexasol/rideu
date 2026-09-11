import { and, eq, ne, sql } from 'drizzle-orm';
import { db } from '../db/connection';
import { airports, type NewAirport, type Airport } from '../db/schema/airports';

export async function listAirports(includeInactive = true): Promise<Airport[]> {
  const query = db.select().from(airports).orderBy(airports.code);
  if (!includeInactive) {
    return query.where(eq(airports.isActive, true));
  }
  return query;
}

export async function listActiveAirports(): Promise<Airport[]> {
  return db.select().from(airports).where(eq(airports.isActive, true)).orderBy(airports.code);
}

export async function findAirportById(id: string): Promise<Airport | null> {
  const rows = await db.select().from(airports).where(eq(airports.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findAirportByCode(code: string): Promise<Airport | null> {
  const rows = await db
    .select()
    .from(airports)
    .where(eq(airports.code, code))
    .limit(1);
  return rows[0] ?? null;
}

export async function findAirportByGooglePlaceId(
  placeId: string,
  excludeId?: string
): Promise<Airport | null> {
  const rows = await db
    .select()
    .from(airports)
    .where(
      excludeId
        ? and(eq(airports.googlePlaceId, placeId), ne(airports.id, excludeId))
        : eq(airports.googlePlaceId, placeId)
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function insertAirport(values: NewAirport): Promise<Airport> {
  const [row] = await db.insert(airports).values(values).returning();
  return row;
}

export async function updateAirport(
  id: string,
  patch: Partial<NewAirport>
): Promise<Airport | null> {
  const [row] = await db
    .update(airports)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(airports.id, id))
    .returning();
  return row ?? null;
}

export async function countAirports(): Promise<number> {
  const rows = await db.select({ count: sql<number>`count(*)::int` }).from(airports);
  return rows[0]?.count ?? 0;
}
