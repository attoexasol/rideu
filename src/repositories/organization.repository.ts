import { db } from '../db/connection';
import { organizations } from '../db/schema/organizations';
import { fleets } from '../db/schema/fleets';
import { eq } from 'drizzle-orm';
import { PLATFORM_FLEET_NAME, PLATFORM_ORG_NAME } from '../config/duty';

export async function findOrganizationByName(name: string) {
  const rows = await db.select().from(organizations).where(eq(organizations.name, name)).limit(1);
  return rows[0] ?? null;
}

export async function findFleetByName(name: string) {
  const rows = await db.select().from(fleets).where(eq(fleets.name, name)).limit(1);
  return rows[0] ?? null;
}

export async function findOrganizationById(id: string) {
  const rows = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findFleetById(id: string) {
  const rows = await db.select().from(fleets).where(eq(fleets.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listOrganizations() {
  return db.select().from(organizations);
}

export async function listFleets(organizationId?: string) {
  if (organizationId) {
    return db.select().from(fleets).where(eq(fleets.organizationId, organizationId));
  }
  return db.select().from(fleets);
}

export async function ensurePlatformOrganizationAndFleet(): Promise<{
  organizationId: string;
  fleetId: string;
}> {
  let org = await findOrganizationByName(PLATFORM_ORG_NAME);
  if (!org) {
    const [created] = await db
      .insert(organizations)
      .values({ name: PLATFORM_ORG_NAME, type: 'platform', status: 'active' })
      .returning();
    org = created;
  }

  let fleet = await findFleetByName(PLATFORM_FLEET_NAME);
  if (!fleet) {
    const [created] = await db
      .insert(fleets)
      .values({
        organizationId: org.id,
        name: PLATFORM_FLEET_NAME,
        status: 'active',
      })
      .returning();
    fleet = created;
  }

  return { organizationId: org.id, fleetId: fleet.id };
}
