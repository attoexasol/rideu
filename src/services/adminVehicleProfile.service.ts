import type { Vehicle } from '../db/schema/vehicles';
import type { LegacyVehicleHint } from '../repositories/adminVehicleEnrichment.repository';

export interface ResolvedVehicleProfile {
  make: string | null;
  model: string | null;
  plateNumber: string | null;
  year: number | null;
  color: string | null;
  displayName: string | null;
}

function coalesceString(primary: string | null | undefined, fallback: string | null): string | null {
  if (primary?.trim()) return primary.trim();
  return fallback;
}

function coalesceYear(primary: number | null | undefined, fallback: number | null): number | null {
  if (primary != null && Number.isFinite(primary)) return primary;
  return fallback;
}

export function resolveVehicleProfile(
  vehicle: Vehicle,
  hint?: LegacyVehicleHint | null
): ResolvedVehicleProfile {
  const make = coalesceString(vehicle.make, hint?.make ?? null);
  const model = coalesceString(vehicle.model, hint?.model ?? null);
  const plateNumber = coalesceString(vehicle.plateNumber, hint?.plateNumber ?? null);
  const color = coalesceString(vehicle.color, hint?.color ?? null);
  const year = coalesceYear(vehicle.year, hint?.year ?? null);

  const displayName =
    [make, model].filter(Boolean).join(' ').trim() ||
    plateNumber ||
    vehicle.bodyNumber?.trim() ||
    null;

  return { make, model, plateNumber, year, color, displayName };
}

export interface VehicleProfileValidation {
  valid: boolean;
  missing: string[];
}

export function validateVehicleProfileForQr(profile: ResolvedVehicleProfile, hasServiceCategory: boolean): VehicleProfileValidation {
  const missing: string[] = [];
  if (!profile.make) missing.push('make');
  if (!profile.model) missing.push('model');
  if (!profile.plateNumber) missing.push('plateNumber');
  if (!hasServiceCategory) missing.push('serviceCategory');
  return { valid: missing.length === 0, missing };
}
