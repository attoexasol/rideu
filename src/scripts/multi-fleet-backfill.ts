/**
 * Multi-fleet foundation backfill and pre-constraint validation.
 *
 * Usage:
 *   tsx src/scripts/multi-fleet-backfill.ts --report-only
 *   tsx src/scripts/multi-fleet-backfill.ts --apply
 *
 * Run after migration 0014 and BEFORE migration 0015.
 */
import 'dotenv/config';
import { db } from '../db/connection';
import { drivers } from '../db/schema/drivers';
import { vehicles } from '../db/schema/vehicles';
import { driverServiceCategories } from '../db/schema/driver_service_categories';
import { eq } from 'drizzle-orm';
import {
  ensurePlatformOrganizationAndFleet,
} from '../repositories/organization.repository';
import {
  findDuplicateVehicleAssignments,
  findDuplicateDriverVehicleIds,
  findDuplicateActiveDutySessions,
  findActiveAssignmentByDriverId,
  findActiveAssignmentByVehicleId,
} from '../repositories/driverVehicleAssignment.repository';
import { assignDriverToFleet } from '../repositories/driverFleetMembership.repository';
import { dutySessions } from '../db/schema/duty_sessions';
import { driverVehicleAssignments } from '../db/schema/driver_vehicle_assignments';
import { vehicleQrTokens } from '../db/schema/vehicle_qr_tokens';
import { vehicleServiceCategories } from '../db/schema/vehicle_service_categories';
import { insertFleetAuditEvent } from '../repositories/fleetAudit.repository';
import { generateOpaqueVehicleQrToken } from '../utils/vehicleQrToken';
import { writeFileSync } from 'fs';
import { join } from 'path';

const args = new Set(process.argv.slice(2));
const reportOnly = args.has('--report-only');
const apply = args.has('--apply');

if (!reportOnly && !apply) {
  console.error('Usage: tsx src/scripts/multi-fleet-backfill.ts [--report-only | --apply]');
  process.exit(1);
}

interface BackfillReport {
  generatedAt: string;
  duplicateDriverVehicleIds: Awaited<ReturnType<typeof findDuplicateDriverVehicleIds>>;
  duplicateActiveAssignments: Awaited<ReturnType<typeof findDuplicateVehicleAssignments>>;
  duplicateActiveDutySessions: Awaited<ReturnType<typeof findDuplicateActiveDutySessions>>;
  ambiguousServiceCategoryMappings: { driverId: string; vehicleId: string; note: string }[];
  actions: string[];
  errors: string[];
}

async function main() {
  const report: BackfillReport = {
    generatedAt: new Date().toISOString(),
    duplicateDriverVehicleIds: [],
    duplicateActiveAssignments: [],
    duplicateActiveDutySessions: [],
    ambiguousServiceCategoryMappings: [],
    actions: [],
    errors: [],
  };

  report.duplicateDriverVehicleIds = await findDuplicateDriverVehicleIds();
  report.duplicateActiveAssignments = await findDuplicateVehicleAssignments();
  report.duplicateActiveDutySessions = await findDuplicateActiveDutySessions();

  const reportPath = join(process.cwd(), 'multi-fleet-backfill-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`📄 Report written: ${reportPath}`);

  if (report.duplicateDriverVehicleIds.length > 0) {
    console.warn('⚠️  Duplicate drivers.vehicle_id detected — resolve manually before constraints:');
    console.warn(JSON.stringify(report.duplicateDriverVehicleIds, null, 2));
  }
  if (report.duplicateActiveAssignments.length > 0) {
    console.warn('⚠️  Duplicate active assignments detected:');
    console.warn(JSON.stringify(report.duplicateActiveAssignments, null, 2));
  }

  if (reportOnly) {
    console.log('Report-only mode complete.');
    process.exit(
      report.duplicateDriverVehicleIds.length > 0 || report.duplicateActiveAssignments.length > 0
        ? 2
        : 0
    );
  }

  if (
    report.duplicateDriverVehicleIds.length > 0 ||
    report.duplicateActiveAssignments.length > 0
  ) {
    console.error('❌ Cannot apply backfill while duplicates exist. Fix data first.');
    process.exit(2);
  }

  const { organizationId, fleetId } = await ensurePlatformOrganizationAndFleet();
  report.actions.push(`Ensured platform org ${organizationId} and fleet ${fleetId}`);

  const allVehicles = await db.select().from(vehicles);
  for (const vehicle of allVehicles) {
    if (!vehicle.fleetId) {
      await db.update(vehicles).set({ fleetId, updatedAt: new Date() }).where(eq(vehicles.id, vehicle.id));
      report.actions.push(`Assigned vehicle ${vehicle.id} to platform fleet`);
    }
  }

  const allDrivers = await db.select().from(drivers);
  for (const driver of allDrivers) {
    await assignDriverToFleet(driver.id, fleetId);
    report.actions.push(`Fleet membership for driver ${driver.id}`);
  }

  for (const driver of allDrivers) {
    if (!driver.vehicleId) continue;

    const existingAssignment = await findActiveAssignmentByDriverId(driver.id);
    if (existingAssignment) {
      report.actions.push(`Skipped assignment for driver ${driver.id} — already active`);
      continue;
    }

    const vehicleTaken = await findActiveAssignmentByVehicleId(driver.vehicleId);
    if (vehicleTaken && vehicleTaken.driver_id !== driver.id) {
      report.ambiguousServiceCategoryMappings.push({
        driverId: driver.id,
        vehicleId: driver.vehicleId,
        note: 'vehicle already assigned to another driver — skipped synthetic assignment',
      });
      continue;
    }

    let dutySessionId: string | null = null;
    if (driver.status === 'online' || driver.status === 'busy') {
      const [duty] = await db
        .insert(dutySessions)
        .values({
          driverId: driver.id,
          fleetId,
          organizationId,
          status: 'active',
          startVehicleId: driver.vehicleId,
        })
        .returning();
      dutySessionId = duty.id;
      report.actions.push(`Synthetic duty session for online driver ${driver.id}`);
    }

    const [assignment] = await db
      .insert(driverVehicleAssignments)
      .values({
        driverId: driver.id,
        vehicleId: driver.vehicleId,
        fleetId,
        dutySessionId,
        isActive: true,
        assignedBy: 'system',
        assignmentReason: 'migration_backfill',
      })
      .returning();

    await insertFleetAuditEvent({
      eventType: 'migration_backfill',
      actorType: 'system',
      entityType: 'driver_vehicle_assignment',
      entityId: assignment.id,
      driverId: driver.id,
      vehicleId: driver.vehicleId,
      fleetId,
      payload: { source: 'drivers.vehicle_id', dutySessionId },
    });

    report.actions.push(`Synthetic assignment ${assignment.id} for driver ${driver.id}`);
  }

  for (const vehicle of allVehicles) {
    const existingTokens = await db
      .select()
      .from(vehicleQrTokens)
      .where(eq(vehicleQrTokens.vehicleId, vehicle.id));

    if (existingTokens.length > 0) continue;

    if (vehicle.qrCode) {
      await db.insert(vehicleQrTokens).values({
        vehicleId: vehicle.id,
        fleetId: vehicle.fleetId ?? fleetId,
        token: vehicle.qrCode,
        status: 'active',
        legacySource: 'vehicles_qr_code',
      });
      report.actions.push(`Migrated vehicles.qr_code for vehicle ${vehicle.id}`);
    }

    const opaque = generateOpaqueVehicleQrToken();
    await db.insert(vehicleQrTokens).values({
      vehicleId: vehicle.id,
      fleetId: vehicle.fleetId ?? fleetId,
      token: opaque,
      status: 'active',
      legacySource: 'issued',
    });
    report.actions.push(`Issued opaque QR for vehicle ${vehicle.id}`);
  }

  const driverCategories = await db.select().from(driverServiceCategories);
  const vehicleDriverMap = new Map<string, string>();
  for (const driver of allDrivers) {
    if (driver.vehicleId) vehicleDriverMap.set(driver.vehicleId, driver.id);
  }

  for (const dc of driverCategories) {
    const driver = allDrivers.find((d) => d.id === dc.driverId);
    if (!driver?.vehicleId) {
      report.ambiguousServiceCategoryMappings.push({
        driverId: dc.driverId,
        vehicleId: 'none',
        note: 'driver has service categories but no vehicle_id — admin review required',
      });
      continue;
    }

    const otherDriver = vehicleDriverMap.get(driver.vehicleId);
    if (otherDriver && otherDriver !== driver.id) {
      report.ambiguousServiceCategoryMappings.push({
        driverId: driver.id,
        vehicleId: driver.vehicleId,
        note: 'multiple drivers share vehicle_id — category copy skipped',
      });
      continue;
    }

    await db
      .insert(vehicleServiceCategories)
      .values({
        vehicleId: driver.vehicleId,
        serviceCategoryId: dc.serviceCategoryId,
        isPrimary: dc.isPrimary,
        verifiedAt: dc.verifiedAt,
        source: 'migration_from_driver',
      })
      .onConflictDoNothing();
  }

  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log('✅ Backfill complete.');
  console.log(`Actions: ${report.actions.length}`);
  if (report.ambiguousServiceCategoryMappings.length > 0) {
    console.warn('⚠️  Ambiguous service category mappings require admin review:');
    console.warn(JSON.stringify(report.ambiguousServiceCategoryMappings, null, 2));
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
