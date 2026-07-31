import { db } from '../db/connection';
import { drivers } from '../db/schema/drivers';
import { vehicleServiceCategories } from '../db/schema/vehicle_service_categories';
import { eq, inArray } from 'drizzle-orm';

export interface LegacyVehicleHint {
  make: string | null;
  model: string | null;
  plateNumber: string | null;
  color: string | null;
  year: number | null;
  sourceDriverIds: string[];
  ambiguous: string[];
}

function pickConsistent(
  values: (string | null | undefined)[],
  field: string,
  ambiguous: string[]
): string | null {
  const normalized = [...new Set(values.map((v) => (v?.trim() ? v.trim() : null)).filter(Boolean))];
  if (normalized.length === 0) return null;
  if (normalized.length === 1) return normalized[0]!;
  ambiguous.push(field);
  return null;
}

function pickConsistentYear(
  values: (string | null | undefined)[],
  ambiguous: string[]
): number | null {
  const parsed = [
    ...new Set(
      values
        .map((v) => (v?.trim() ? Number.parseInt(v.trim(), 10) : NaN))
        .filter((n) => Number.isFinite(n))
    ),
  ];
  if (parsed.length === 0) return null;
  if (parsed.length === 1) return parsed[0]!;
  ambiguous.push('year');
  return null;
}

export async function loadLegacyDriverHintsForVehicles(
  vehicleIds: string[]
): Promise<Map<string, LegacyVehicleHint>> {
  if (!vehicleIds.length) return new Map();

  const rows = await db
    .select({
      vehicleId: drivers.vehicleId,
      driverId: drivers.id,
      vehicleMake: drivers.vehicleMake,
      vehicleModel: drivers.vehicleModel,
      vehicleColor: drivers.vehicleColor,
      vehicleYear: drivers.vehicleYear,
      cabNumber: drivers.cabNumber,
      cabName: drivers.cabName,
    })
    .from(drivers)
    .where(inArray(drivers.vehicleId, vehicleIds));

  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.vehicleId) continue;
    const list = grouped.get(row.vehicleId) ?? [];
    list.push(row);
    grouped.set(row.vehicleId, list);
  }

  const result = new Map<string, LegacyVehicleHint>();
  for (const vehicleId of vehicleIds) {
    const linked = grouped.get(vehicleId) ?? [];
    if (!linked.length) continue;

    const ambiguous: string[] = [];
    const hint: LegacyVehicleHint = {
      make: pickConsistent(
        linked.map((r) => r.vehicleMake),
        'make',
        ambiguous
      ),
      model: pickConsistent(
        linked.map((r) => r.vehicleModel),
        'model',
        ambiguous
      ),
      plateNumber: pickConsistent(
        linked.map((r) => r.cabNumber?.trim() || r.cabName?.trim() || null),
        'plateNumber',
        ambiguous
      ),
      color: pickConsistent(
        linked.map((r) => r.vehicleColor),
        'color',
        ambiguous
      ),
      year: pickConsistentYear(
        linked.map((r) => r.vehicleYear),
        ambiguous
      ),
      sourceDriverIds: linked.map((r) => r.driverId),
      ambiguous,
    };
    result.set(vehicleId, hint);
  }

  return result;
}

export async function vehicleHasServiceCategory(vehicleId: string): Promise<boolean> {
  const rows = await db
    .select({ id: vehicleServiceCategories.id })
    .from(vehicleServiceCategories)
    .where(eq(vehicleServiceCategories.vehicleId, vehicleId))
    .limit(1);
  return rows.length > 0;
}
