/**
 * Report-first migration: legacy driver cab fields → vehicles table rows.
 *
 * Usage:
 *   tsx src/scripts/migrate-legacy-driver-cabs-to-vehicles.ts --report-only
 *   tsx src/scripts/migrate-legacy-driver-cabs-to-vehicles.ts --apply
 *
 * Safety:
 * - Never deletes drivers, vehicles, or bookings
 * - Never overwrites non-null vehicle fields
 * - Preserves booking assigned_vehicle_id (historical)
 * - Flags ambiguous records for manual review
 */
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { db } from '../db/connection';
import { drivers } from '../db/schema/drivers';
import { vehicles } from '../db/schema/vehicles';
import { driverVehicleAssignments } from '../db/schema/driver_vehicle_assignments';
import { vehicleServiceCategories } from '../db/schema/vehicle_service_categories';
import { driverServiceCategories } from '../db/schema/driver_service_categories';
import { eq, and } from 'drizzle-orm';
import { ensurePlatformOrganizationAndFleet } from '../repositories/organization.repository';
import { insertFleetAuditEvent } from '../repositories/fleetAudit.repository';

const args = new Set(process.argv.slice(2));
const reportOnly = args.has('--report-only');
const apply = args.has('--apply');
const isCliInvocation = require.main === module;

if (isCliInvocation && !reportOnly && !apply) {
  console.error(
    'Usage: tsx src/scripts/migrate-legacy-driver-cabs-to-vehicles.ts [--report-only | --apply]'
  );
  process.exit(1);
}

export type ProposedVehicleAction =
  | 'skip_already_linked'
  | 'link_existing_vehicle_by_plate'
  | 'share_vehicle_by_plate'
  | 'create_vehicle_and_link'
  | 'manual_review_no_legacy_data'
  | 'manual_review_ambiguous'
  | 'manual_review_plate_conflict';

export interface DriverMigrationProposal {
  driverId: string;
  driverName: string;
  cabName: string | null;
  cabNumber: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleColor: string | null;
  vehicleYear: string | null;
  existingVehicleId: string | null;
  proposedVehicleAction: ProposedVehicleAction;
  proposedVehicleId: string | null;
  proposedPlateNumber: string | null;
  proposedMake: string | null;
  proposedModel: string | null;
  proposedYear: number | null;
  shareWithDriverIds: string[];
  notes: string[];
}

function normalizePlate(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  return value.trim().toUpperCase();
}

function hasLegacyVehicleData(driver: typeof drivers.$inferSelect): boolean {
  return Boolean(
    (driver.cabNumber?.trim() || driver.cabName?.trim()) &&
      (driver.cabNumber?.trim() ||
        driver.cabName?.trim() ||
        driver.vehicleMake?.trim() ||
        driver.vehicleModel?.trim())
  );
}

function parseYear(value: string | null | undefined): number | null {
  if (!value?.trim()) return null;
  const y = Number.parseInt(value.trim(), 10);
  return Number.isFinite(y) && y >= 1900 && y <= 2100 ? y : null;
}

export function buildMigrationProposals(
  driverRows: (typeof drivers.$inferSelect)[],
  vehicleRows: (typeof vehicles.$inferSelect)[]
): DriverMigrationProposal[] {
  const vehiclesByPlate = new Map<string, typeof vehicles.$inferSelect>();
  for (const v of vehicleRows) {
    const plate = normalizePlate(v.plateNumber);
    if (plate) vehiclesByPlate.set(plate, v);
  }

  const pendingCreates = new Map<string, string>(); // plate -> first driverId
  const proposals: DriverMigrationProposal[] = [];

  for (const driver of driverRows) {
    const base: DriverMigrationProposal = {
      driverId: driver.id,
      driverName: driver.name,
      cabName: driver.cabName,
      cabNumber: driver.cabNumber,
      vehicleMake: driver.vehicleMake,
      vehicleModel: driver.vehicleModel,
      vehicleColor: driver.vehicleColor,
      vehicleYear: driver.vehicleYear,
      existingVehicleId: driver.vehicleId,
      proposedVehicleAction: 'manual_review_no_legacy_data',
      proposedVehicleId: null,
      proposedPlateNumber: null,
      proposedMake: driver.vehicleMake,
      proposedModel: driver.vehicleModel,
      proposedYear: parseYear(driver.vehicleYear),
      shareWithDriverIds: [],
      notes: [],
    };

    if (driver.vehicleId) {
      base.proposedVehicleAction = 'skip_already_linked';
      base.proposedVehicleId = driver.vehicleId;
      proposals.push(base);
      continue;
    }

    if (!hasLegacyVehicleData(driver)) {
      base.notes.push('No cab number/name or vehicle metadata — manual admin entry required');
      proposals.push(base);
      continue;
    }

    const plate = normalizePlate(driver.cabNumber) ?? normalizePlate(driver.cabName);
    if (!plate) {
      base.proposedVehicleAction = 'manual_review_ambiguous';
      base.notes.push('Cannot derive plate/cab identifier');
      proposals.push(base);
      continue;
    }

    base.proposedPlateNumber = plate;

    const existing = vehiclesByPlate.get(plate);
    if (existing) {
      const makeConflict =
        driver.vehicleMake?.trim() &&
        existing.make?.trim() &&
        driver.vehicleMake.trim().toLowerCase() !== existing.make.trim().toLowerCase();
      const modelConflict =
        driver.vehicleModel?.trim() &&
        existing.model?.trim() &&
        driver.vehicleModel.trim().toLowerCase() !== existing.model.trim().toLowerCase();

      if (makeConflict || modelConflict) {
        base.proposedVehicleAction = 'manual_review_plate_conflict';
        base.proposedVehicleId = existing.id;
        base.notes.push('Plate exists on vehicle row but make/model conflicts with driver legacy data');
      } else {
        base.proposedVehicleAction = 'link_existing_vehicle_by_plate';
        base.proposedVehicleId = existing.id;
        base.notes.push('Link driver to existing vehicle matched by plate/cab number');
      }
      proposals.push(base);
      continue;
    }

    const sharedDriverId = pendingCreates.get(plate);
    if (sharedDriverId) {
      base.proposedVehicleAction = 'share_vehicle_by_plate';
      base.shareWithDriverIds = [sharedDriverId];
      base.notes.push('Multiple drivers share same cab number — link to one new vehicle');
      proposals.push(base);
      continue;
    }

    pendingCreates.set(plate, driver.id);
    base.proposedVehicleAction = 'create_vehicle_and_link';
    base.notes.push('Create new vehicle row and link driver');
    proposals.push(base);
  }

  return proposals;
}

async function main() {
  const driverRows = await db.select().from(drivers);
  const vehicleRows = await db.select().from(vehicles);

  const proposals = buildMigrationProposals(driverRows, vehicleRows);

  const driversSharingVehicleId = driverRows
    .filter((d) => d.vehicleId)
    .reduce((acc, d) => {
      const id = d.vehicleId!;
      acc.set(id, (acc.get(id) ?? 0) + 1);
      return acc;
    }, new Map<string, number>());

  const sharedVehicleIdGroups = [...driversSharingVehicleId.entries()]
    .filter(([, count]) => count > 1)
    .map(([vehicleId, driverCount]) => ({ vehicleId, driverCount }));

  const orphanVehicleIds = vehicleRows
    .filter((v) => !driverRows.some((d) => d.vehicleId === v.id))
    .map((v) => v.id);

  const activeAssignments = await db
    .select()
    .from(driverVehicleAssignments)
    .where(eq(driverVehicleAssignments.isActive, true));

  const unlinkedActiveAssignmentVehicleIds = activeAssignments
    .filter((a) => !driverRows.some((d) => d.vehicleId === a.vehicleId))
    .map((a) => a.vehicleId);

  const actionBreakdown = {
    skip_already_linked: proposals.filter((p) => p.proposedVehicleAction === 'skip_already_linked')
      .length,
    link_existing_vehicle_by_plate: proposals.filter(
      (p) => p.proposedVehicleAction === 'link_existing_vehicle_by_plate'
    ).length,
    share_vehicle_by_plate: proposals.filter((p) => p.proposedVehicleAction === 'share_vehicle_by_plate')
      .length,
    create_vehicle_and_link: proposals.filter((p) => p.proposedVehicleAction === 'create_vehicle_and_link')
      .length,
    manual_review: proposals.filter((p) => p.proposedVehicleAction.startsWith('manual_review'))
      .length,
  };

  const counts = {
    totalDrivers: driverRows.length,
    driversWithCabNameOrNumber: driverRows.filter(
      (d) => (d.cabName?.trim() || d.cabNumber?.trim()) ?? false
    ).length,
    driversWithVehicleId: driverRows.filter((d) => d.vehicleId).length,
    totalVehicles: vehicleRows.length,
    driversLegacyCabNoVehicleId: driverRows.filter(
      (d) => !d.vehicleId && hasLegacyVehicleData(d)
    ).length,
    driversSharingSameVehicleId: sharedVehicleIdGroups.length,
    sharedVehicleIdGroups,
    orphanVehicleRows: orphanVehicleIds.length,
    orphanVehicleIds,
    unlinkedActiveAssignmentVehicles: unlinkedActiveAssignmentVehicleIds.length,
    unlinkedActiveAssignmentVehicleIds,
  };

  const summary = {
    generatedAt: new Date().toISOString(),
    counts,
    actionBreakdown,
    rootCause: {
      vehiclesDeletedByMigrations: false,
      vehiclesNeverCreatedForLegacyCabs: true,
      backfillOnlyLinkedDriversWithVehicleId: true,
      explanation:
        'Legacy cab data lives on drivers.* columns. Only 2 vehicles rows exist (pre-multi-fleet). ' +
        'multi-fleet-backfill assigned fleet memberships to all drivers but only created assignments ' +
        'for drivers with drivers.vehicle_id set (1 driver). No DELETE/TRUNCATE in migrations 0014–0016.',
    },
    missingVehiclesClassification: {
      notMigratedLegacyCabData: actionBreakdown.create_vehicle_and_link,
      actuallyDeleted: 0,
      duplicateSharedVehicles: actionBreakdown.share_vehicle_by_plate,
      incompleteRecords: actionBreakdown.manual_review + counts.orphanVehicleRows,
    },
    finalStatus:
      actionBreakdown.create_vehicle_and_link > 0 || actionBreakdown.manual_review > 0
        ? 'VEHICLE DATA MIGRATION REQUIRED'
        : 'VEHICLE DATA COMPLETE',
    proposals,
  };

  const reportPath = join(process.cwd(), 'legacy-driver-cabs-migration-report.json');
  writeFileSync(reportPath, JSON.stringify(summary, null, 2));
  console.log(`📄 Report written: ${reportPath}`);
  console.log(
    JSON.stringify(
      {
        counts: summary.counts,
        actionBreakdown: summary.actionBreakdown,
        missingVehiclesClassification: summary.missingVehiclesClassification,
        rootCause: summary.rootCause,
        finalStatus: summary.finalStatus,
      },
      null,
      2
    )
  );

  if (reportOnly || !apply) {
    const manual = actionBreakdown.manual_review;
    if (isCliInvocation) {
      process.exit(manual > 0 ? 2 : 0);
    }
    return;
  }

  const { fleetId } = await ensurePlatformOrganizationAndFleet();
  const createdVehicles = new Map<string, string>(); // plate -> vehicleId
  let applied = 0;

  for (const proposal of proposals) {
    if (
      proposal.proposedVehicleAction === 'skip_already_linked' ||
      proposal.proposedVehicleAction.startsWith('manual_review')
    ) {
      continue;
    }

    let vehicleId = proposal.proposedVehicleId;

    if (proposal.proposedVehicleAction === 'create_vehicle_and_link') {
      const plate = proposal.proposedPlateNumber!;
      if (createdVehicles.has(plate)) {
        vehicleId = createdVehicles.get(plate)!;
      } else {
        const [created] = await db
          .insert(vehicles)
          .values({
            make: proposal.proposedMake,
            model: proposal.proposedModel,
            year: proposal.proposedYear,
            plateNumber: plate,
            fleetId,
            status: 'active',
          })
          .returning();
        vehicleId = created.id;
        createdVehicles.set(plate, created.id);
      }
    }

    if (proposal.proposedVehicleAction === 'share_vehicle_by_plate') {
      const plate = proposal.proposedPlateNumber!;
      vehicleId = createdVehicles.get(plate) ?? null;
      if (!vehicleId) {
        console.warn(`Skipping share for ${proposal.driverId} — primary vehicle not created yet`);
        continue;
      }
    }

    if (!vehicleId) continue;

    await db
      .update(drivers)
      .set({ vehicleId, updatedAt: new Date() })
      .where(eq(drivers.id, proposal.driverId));

    const existingAssignment = await db
      .select()
      .from(driverVehicleAssignments)
      .where(
        and(
          eq(driverVehicleAssignments.driverId, proposal.driverId),
          eq(driverVehicleAssignments.isActive, true)
        )
      )
      .limit(1);

    if (!existingAssignment.length) {
      await db.insert(driverVehicleAssignments).values({
        driverId: proposal.driverId,
        vehicleId,
        fleetId,
        isActive: true,
        assignedBy: 'system',
        assignmentReason: 'legacy_cab_migration',
      });
    }

    const driverCats = await db
      .select()
      .from(driverServiceCategories)
      .where(eq(driverServiceCategories.driverId, proposal.driverId));

    for (const cat of driverCats) {
      await db
        .insert(vehicleServiceCategories)
        .values({
          vehicleId,
          serviceCategoryId: cat.serviceCategoryId,
          isPrimary: cat.isPrimary,
          verifiedAt: cat.verifiedAt,
          source: 'legacy_cab_migration',
        })
        .onConflictDoNothing({
          target: [
            vehicleServiceCategories.vehicleId,
            vehicleServiceCategories.serviceCategoryId,
          ],
        });
    }

    await insertFleetAuditEvent({
      eventType: 'migration_backfill',
      actorType: 'system',
      entityType: 'vehicle',
      entityId: vehicleId,
      driverId: proposal.driverId,
      vehicleId,
      fleetId,
      payload: {
        source: 'legacy_cab_migration',
        action: proposal.proposedVehicleAction,
        plate: proposal.proposedPlateNumber,
      },
    });

    applied++;
  }

  console.log(`Applied ${applied} driver→vehicle migration(s).`);
}

if (isCliInvocation) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
