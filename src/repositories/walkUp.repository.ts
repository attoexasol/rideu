import { and, desc, eq, inArray } from 'drizzle-orm';
import { OPEN_WALK_UP_STATUSES } from '../constants/softMeter';
import { db } from '../db/connection';
import { vehicles } from '../db/schema/vehicles';
import { walkUpTrips, type NewWalkUpTrip } from '../db/schema/walk_up_trips';

export async function findWalkUpById(id: string) {
  const [row] = await db.select().from(walkUpTrips).where(eq(walkUpTrips.id, id)).limit(1);
  return row ?? null;
}

export async function findWalkUpByIdempotency(key: string) {
  const [row] = await db
    .select()
    .from(walkUpTrips)
    .where(eq(walkUpTrips.idempotencyKey, key))
    .limit(1);
  return row ?? null;
}

export async function findOpenWalkUpByDriver(driverId: string) {
  const [row] = await db
    .select()
    .from(walkUpTrips)
    .where(
      and(eq(walkUpTrips.driverId, driverId), inArray(walkUpTrips.status, OPEN_WALK_UP_STATUSES))
    )
    .limit(1);
  return row ?? null;
}

export async function driverHasOpenWalkUp(driverId: string): Promise<boolean> {
  try {
    const row = await findOpenWalkUpByDriver(driverId);
    return Boolean(row);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('walk_up_trips') && message.includes('does not exist')) {
      return false;
    }
    throw error;
  }
}

export async function insertWalkUp(values: NewWalkUpTrip) {
  const [row] = await db.insert(walkUpTrips).values(values).returning();
  return row;
}

export async function updateWalkUp(id: string, patch: Partial<NewWalkUpTrip>) {
  const [row] = await db
    .update(walkUpTrips)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(walkUpTrips.id, id))
    .returning();
  return row ?? null;
}

export async function listWalkUpsForDriver(driverId: string, limit = 20) {
  return db
    .select()
    .from(walkUpTrips)
    .where(eq(walkUpTrips.driverId, driverId))
    .orderBy(desc(walkUpTrips.createdAt))
    .limit(limit);
}

export async function findVehicleForMeter(vehicleId: string) {
  const [row] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
  return row ?? null;
}
