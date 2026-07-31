import { db } from '../db/connection';
import { driverFleetMemberships } from '../db/schema/driver_fleet_memberships';
import { eq, and } from 'drizzle-orm';

export async function findActiveFleetMembershipForDriver(driverId: string) {
  const rows = await db
    .select()
    .from(driverFleetMemberships)
    .where(
      and(eq(driverFleetMemberships.driverId, driverId), eq(driverFleetMemberships.status, 'active'))
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function createDriverFleetMembership(driverId: string, fleetId: string) {
  const [row] = await db
    .insert(driverFleetMemberships)
    .values({ driverId, fleetId, status: 'active' })
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}

export async function assignDriverToFleet(driverId: string, fleetId: string) {
  const existing = await db
    .select()
    .from(driverFleetMemberships)
    .where(
      and(eq(driverFleetMemberships.driverId, driverId), eq(driverFleetMemberships.fleetId, fleetId))
    )
    .limit(1);

  if (existing[0]) {
    if (existing[0].status !== 'active') {
      const [updated] = await db
        .update(driverFleetMemberships)
        .set({ status: 'active', leftAt: null, updatedAt: new Date() })
        .where(eq(driverFleetMemberships.id, existing[0].id))
        .returning();
      return updated;
    }
    return existing[0];
  }

  const [created] = await db
    .insert(driverFleetMemberships)
    .values({ driverId, fleetId, status: 'active' })
    .returning();
  return created;
}
