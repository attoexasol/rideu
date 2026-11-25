/**
 * Give Platform Fleet membership to drivers that have no fleet membership at all.
 *
 * Usage:
 *   tsx src/scripts/backfill-driver-platform-fleet-memberships.ts --report-only
 *   tsx src/scripts/backfill-driver-platform-fleet-memberships.ts --apply
 *   (production image) node dist/scripts/backfill-driver-platform-fleet-memberships.js --report-only
 *
 * Scope: inserts driver_fleet_memberships rows and their fleet_audit_events only.
 * Drivers with any membership row (active or ended) are left untouched and listed for
 * manual review. Vehicles, assignments, duty sessions, bookings and QR tokens are never
 * modified. Platform Fleet must already exist (POST /api/v1/admin/fleet/platform/ensure).
 * Re-running is a no-op once every driver has a membership.
 */
import 'dotenv/config';
import { and, eq, exists, notExists, sql } from 'drizzle-orm';
import { db } from '../db/connection';
import { drivers } from '../db/schema/drivers';
import { driverFleetMemberships } from '../db/schema/driver_fleet_memberships';
import { fleetAuditEvents } from '../db/schema/fleet_audit_events';
import { PLATFORM_FLEET_NAME } from '../config/duty';
import { findFleetByName } from '../repositories/organization.repository';

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

const args = new Set(process.argv.slice(2));
const reportOnly = args.has('--report-only');
const apply = args.has('--apply');

function anyMembership(executor: DbExecutor) {
  return executor
    .select({ one: sql`1` })
    .from(driverFleetMemberships)
    .where(eq(driverFleetMemberships.driverId, drivers.id));
}

function activeMembership(executor: DbExecutor) {
  return executor
    .select({ one: sql`1` })
    .from(driverFleetMemberships)
    .where(
      and(eq(driverFleetMemberships.driverId, drivers.id), eq(driverFleetMemberships.status, 'active'))
    );
}

export async function findDriversWithoutAnyMembership(executor: DbExecutor = db) {
  return executor
    .select({ id: drivers.id, name: drivers.name })
    .from(drivers)
    .where(notExists(anyMembership(executor)));
}

export async function findDriversWithOnlyEndedMemberships(executor: DbExecutor = db) {
  return executor
    .select({ id: drivers.id, name: drivers.name })
    .from(drivers)
    .where(and(exists(anyMembership(executor)), notExists(activeMembership(executor))));
}

export async function backfillPlatformFleetMemberships(fleetId: string) {
  return db.transaction(async (tx) => {
    const candidates = await findDriversWithoutAnyMembership(tx);
    if (candidates.length === 0) return [];

    const inserted = await tx
      .insert(driverFleetMemberships)
      .values(candidates.map((driver) => ({ driverId: driver.id, fleetId, status: 'active' })))
      .onConflictDoNothing()
      .returning({ id: driverFleetMemberships.id, driverId: driverFleetMemberships.driverId });

    if (inserted.length > 0) {
      await tx.insert(fleetAuditEvents).values(
        inserted.map((row) => ({
          eventType: 'driver_fleet_membership_backfilled',
          actorType: 'system',
          entityType: 'driver_fleet_membership',
          entityId: row.id,
          driverId: row.driverId,
          fleetId,
          payload: { source: 'backfill-driver-platform-fleet-memberships' },
        }))
      );
    }
    return inserted;
  });
}

async function main() {
  if (reportOnly === apply) {
    console.error(
      'Usage: backfill-driver-platform-fleet-memberships [--report-only | --apply] (exactly one)'
    );
    process.exit(1);
  }

  const platformFleet = await findFleetByName(PLATFORM_FLEET_NAME);
  if (!platformFleet) {
    console.error(
      `"${PLATFORM_FLEET_NAME}" does not exist. Run POST /api/v1/admin/fleet/platform/ensure first.`
    );
    process.exit(2);
  }

  const missing = await findDriversWithoutAnyMembership();
  const ended = await findDriversWithOnlyEndedMemberships();

  console.log(`Platform Fleet: ${platformFleet.id}`);
  console.log(`Drivers with no fleet membership (will be backfilled): ${missing.length}`);
  for (const driver of missing) console.log(`  - ${driver.id} ${driver.name}`);
  console.log(`Drivers with only ended memberships (skipped, review manually): ${ended.length}`);
  for (const driver of ended) console.log(`  - ${driver.id} ${driver.name}`);

  if (reportOnly) {
    console.log('Report-only mode: no changes made.');
    process.exit(0);
  }

  const inserted = await backfillPlatformFleetMemberships(platformFleet.id);
  console.log(`Inserted ${inserted.length} active Platform Fleet membership(s).`);
  for (const row of inserted) console.log(`  - driver ${row.driverId} membership ${row.id}`);
  process.exit(0);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Backfill failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
