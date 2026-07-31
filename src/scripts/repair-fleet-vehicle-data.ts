/**
 * Report-first repair for incomplete fleet vehicle rows using linked driver legacy fields.
 *
 * Usage:
 *   tsx src/scripts/repair-fleet-vehicle-data.ts --report-only
 *   tsx src/scripts/repair-fleet-vehicle-data.ts --apply
 */
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { db } from '../db/connection';
import { vehicles } from '../db/schema/vehicles';
import { eq } from 'drizzle-orm';
import { loadLegacyDriverHintsForVehicles } from '../repositories/adminVehicleEnrichment.repository';

const args = new Set(process.argv.slice(2));
const reportOnly = args.has('--report-only');
const apply = args.has('--apply');

if (!reportOnly && !apply) {
  console.error('Usage: tsx src/scripts/repair-fleet-vehicle-data.ts [--report-only | --apply]');
  process.exit(1);
}

interface RepairProposal {
  vehicleId: string;
  status: 'proposed' | 'ambiguous' | 'no_legacy_data' | 'complete';
  current: {
    make: string | null;
    model: string | null;
    plateNumber: string | null;
    year: number | null;
  };
  proposed: {
    make?: string | null;
    model?: string | null;
    plateNumber?: string | null;
    year?: number | null;
  };
  sourceDriverIds: string[];
  ambiguousFields: string[];
  note?: string;
}

function isIncomplete(vehicle: typeof vehicles.$inferSelect): boolean {
  return !vehicle.make || !vehicle.model || !vehicle.plateNumber || vehicle.year == null;
}

async function main() {
  const allVehicles = await db.select().from(vehicles);
  const incomplete = allVehicles.filter(isIncomplete);
  const hints = await loadLegacyDriverHintsForVehicles(incomplete.map((v) => v.id));

  const proposals: RepairProposal[] = [];

  for (const vehicle of incomplete) {
    const hint = hints.get(vehicle.id);
    const proposal: RepairProposal = {
      vehicleId: vehicle.id,
      status: 'no_legacy_data',
      current: {
        make: vehicle.make,
        model: vehicle.model,
        plateNumber: vehicle.plateNumber,
        year: vehicle.year,
      },
      proposed: {},
      sourceDriverIds: hint?.sourceDriverIds ?? [],
      ambiguousFields: hint?.ambiguous ?? [],
    };

    if (!hint || hint.sourceDriverIds.length === 0) {
      proposal.note = 'No linked driver legacy data — edit vehicle manually in admin';
      proposals.push(proposal);
      continue;
    }

    if (hint.ambiguous.length > 0) {
      proposal.status = 'ambiguous';
      proposal.note = `Conflicting legacy values for: ${hint.ambiguous.join(', ')}`;
      proposals.push(proposal);
      continue;
    }

    const proposed: RepairProposal['proposed'] = {};
    if (!vehicle.make && hint.make) proposed.make = hint.make;
    if (!vehicle.model && hint.model) proposed.model = hint.model;
    if (!vehicle.plateNumber && hint.plateNumber) proposed.plateNumber = hint.plateNumber;
    if (vehicle.year == null && hint.year != null) proposed.year = hint.year;

    if (Object.keys(proposed).length === 0) {
      proposal.status = 'complete';
      proposal.note = 'No fillable legacy values found';
    } else {
      proposal.status = 'proposed';
      proposal.proposed = proposed;
    }

    proposals.push(proposal);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    totalVehicles: allVehicles.length,
    incompleteVehicles: incomplete.length,
    proposed: proposals.filter((p) => p.status === 'proposed').length,
    ambiguous: proposals.filter((p) => p.status === 'ambiguous').length,
    noLegacyData: proposals.filter((p) => p.status === 'no_legacy_data').length,
    proposals,
  };

  const reportPath = join(process.cwd(), 'fleet-vehicle-repair-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`📄 Report written: ${reportPath}`);
  console.log(
    JSON.stringify(
      {
        incompleteVehicles: report.incompleteVehicles,
        proposed: report.proposed,
        ambiguous: report.ambiguous,
        noLegacyData: report.noLegacyData,
      },
      null,
      2
    )
  );

  if (reportOnly) {
    process.exit(report.ambiguous > 0 ? 2 : 0);
  }

  let applied = 0;
  for (const item of proposals) {
    if (item.status !== 'proposed') continue;
    const patch: Partial<typeof vehicles.$inferInsert> = { updatedAt: new Date() };
    if (!item.current.make && item.proposed.make) patch.make = item.proposed.make;
    if (!item.current.model && item.proposed.model) patch.model = item.proposed.model;
    if (!item.current.plateNumber && item.proposed.plateNumber) {
      patch.plateNumber = item.proposed.plateNumber;
    }
    if (item.current.year == null && item.proposed.year != null) patch.year = item.proposed.year;

    if (Object.keys(patch).length <= 1) continue;

    await db.update(vehicles).set(patch).where(eq(vehicles.id, item.vehicleId));
    applied++;
    console.log(`✓ Updated vehicle ${item.vehicleId}`, patch);
  }

  console.log(`Applied ${applied} vehicle repair(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
