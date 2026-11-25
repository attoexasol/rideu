import { db } from '../db/connection';
import { organizations } from '../db/schema/organizations';
import { fleets } from '../db/schema/fleets';
import { and, eq, sql } from 'drizzle-orm';
import {
  PLATFORM_FLEET_NAME,
  PLATFORM_ORG_LEGACY_NAMES,
  PLATFORM_ORG_NAME,
} from '../config/duty';

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbExecutor = typeof db | DbTransaction;

/**
 * Organization and fleet names carry no unique constraint, so concurrent first-time
 * provisioning is serialized with a transaction-scoped advisory lock.
 */
const PLATFORM_PROVISIONING_LOCK_KEY = 'drivewize:platform_org_fleet';

export async function findOrganizationByName(name: string) {
  const rows = await db.select().from(organizations).where(eq(organizations.name, name)).limit(1);
  return rows[0] ?? null;
}

async function findOrganizationByTypeAndName(
  executor: DbExecutor,
  type: 'platform' | 'company' | 'agency' | 'owner',
  name: string
) {
  const rows = await executor
    .select()
    .from(organizations)
    .where(and(eq(organizations.type, type), eq(organizations.name, name)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Locate the platform organization without treating display name as the only identity.
 * Order: current brand name, legacy brand names, then any `type = 'platform'` row.
 */
async function findPlatformOrganization(executor: DbExecutor) {
  const current = await findOrganizationByTypeAndName(executor, 'platform', PLATFORM_ORG_NAME);
  if (current) return current;

  for (const legacyName of PLATFORM_ORG_LEGACY_NAMES) {
    const legacy = await findOrganizationByTypeAndName(executor, 'platform', legacyName);
    if (legacy) return legacy;
  }

  const anyPlatform = await executor
    .select()
    .from(organizations)
    .where(eq(organizations.type, 'platform'))
    .limit(1);
  return anyPlatform[0] ?? null;
}

function isLegacyPlatformOrgName(name: string): boolean {
  return (PLATFORM_ORG_LEGACY_NAMES as readonly string[]).includes(name);
}

export async function findFleetByName(name: string, executor: DbExecutor = db) {
  const rows = await executor.select().from(fleets).where(eq(fleets.name, name)).limit(1);
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
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${PLATFORM_PROVISIONING_LOCK_KEY}))`);

    let org = await findPlatformOrganization(tx);
    if (!org) {
      const [created] = await tx
        .insert(organizations)
        .values({ name: PLATFORM_ORG_NAME, type: 'platform', status: 'active' })
        .returning();
      org = created;
    } else if (isLegacyPlatformOrgName(org.name) && org.name !== PLATFORM_ORG_NAME) {
      const [updated] = await tx
        .update(organizations)
        .set({ name: PLATFORM_ORG_NAME, updatedAt: new Date() })
        .where(eq(organizations.id, org.id))
        .returning();
      if (updated) org = updated;
    }

    let fleet = await findFleetByName(PLATFORM_FLEET_NAME, tx);
    if (!fleet) {
      const [created] = await tx
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
  });
}
