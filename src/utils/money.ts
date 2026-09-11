/**
 * Integer minor-unit money helpers.
 * Do not use floating-point arithmetic for financial amounts.
 *
 * BDT (and typical Stripe two-decimal currencies) use 100 minor units per major.
 */

export const DEFAULT_CURRENCY = 'BDT';
export const MINOR_UNITS_PER_MAJOR = 100;

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer`);
  }
}

/**
 * Convert a major-unit amount (decimal string or integer major) to minor units.
 * "120.50" BDT → 12050. Rejects more than two fractional digits.
 */
export function majorToMinorUnits(value: string | number): number {
  const raw = typeof value === 'number' ? formatMajorFromNumber(value) : String(value).trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) {
    throw new Error('Invalid monetary amount');
  }
  const frac = match[3] ?? '';
  if (frac.length > 2) {
    throw new Error('Monetary amount cannot have more than 2 decimal places');
  }
  const sign = match[1] === '-' ? -1 : 1;
  const whole = parseInt(match[2], 10);
  const fracPadded = frac.padEnd(2, '0');
  const minor = sign * (whole * MINOR_UNITS_PER_MAJOR + parseInt(fracPadded, 10));
  assertSafeInteger(minor, 'minor units');
  return minor;
}

function formatMajorFromNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error('Invalid monetary amount');
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  throw new Error('Numeric major amounts must be integers; pass a decimal string instead');
}

/** Format minor units as a two-decimal major string, e.g. 12050 → "120.50". */
export function minorToMajorString(minorUnits: number): string {
  assertSafeInteger(minorUnits, 'minor units');
  const sign = minorUnits < 0 ? '-' : '';
  const abs = Math.abs(minorUnits);
  const whole = Math.trunc(abs / MINOR_UNITS_PER_MAJOR);
  const frac = abs % MINOR_UNITS_PER_MAJOR;
  return `${sign}${whole}.${String(frac).padStart(2, '0')}`;
}

export function isMinorUnitAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && Number.isSafeInteger(value);
}

/** Two decimal places for Admin percentages (25.50). */
export const PERCENTAGE_SCALE = 100;
export const PERCENTAGE_TOTAL_SCALED = 100 * PERCENTAGE_SCALE;

/**
 * Convert a percentage (0–100, max two decimals) to a scaled integer.
 * 25 → 2500, "25.50" → 2550, 100 → 10000.
 */
export function percentageToScaled(value: string | number): number {
  const raw = typeof value === 'number' ? formatPercentageFromNumber(value) : String(value).trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) {
    throw new Error('Invalid percentage');
  }
  const frac = match[3] ?? '';
  if (frac.length > 2) {
    throw new Error('Percentage cannot have more than 2 decimal places');
  }
  const sign = match[1] === '-' ? -1 : 1;
  const whole = parseInt(match[2], 10);
  const fracPadded = frac.padEnd(2, '0');
  const scaled = sign * (whole * PERCENTAGE_SCALE + parseInt(fracPadded, 10));
  assertSafeInteger(scaled, 'percentage');
  return scaled;
}

function formatPercentageFromNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error('Invalid percentage');
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  const asString = String(value);
  if (!/^-?\d+\.\d{1,2}$/.test(asString)) {
    throw new Error('Numeric percentages must have at most 2 decimal places');
  }
  return asString;
}

export function scaledToPercentageString(scaled: number): string {
  assertSafeInteger(scaled, 'percentage');
  const sign = scaled < 0 ? '-' : '';
  const abs = Math.abs(scaled);
  const whole = Math.trunc(abs / PERCENTAGE_SCALE);
  const frac = abs % PERCENTAGE_SCALE;
  return `${sign}${whole}.${String(frac).padStart(2, '0')}`;
}

export interface CommissionPercentageSplit {
  driverPercentage: string;
  companyPercentage: string;
}

export interface CommissionMinorAllocation {
  driverAmount: number;
  platformAmount: number;
}

/**
 * Allocate commissionable fare (excludes airport fee) by driver/company %.
 * Driver uses integer floor; company receives the remainder.
 */
export function allocateCommissionableByPercentages(
  commissionableMinor: number,
  split: CommissionPercentageSplit
): CommissionMinorAllocation {
  if (!isMinorUnitAmount(commissionableMinor) || commissionableMinor < 0) {
    throw new Error('Commissionable amount must be a non-negative safe integer');
  }
  const driverScaled = percentageToScaled(split.driverPercentage);
  const companyScaled = percentageToScaled(split.companyPercentage);
  if (driverScaled < 0 || companyScaled < 0) {
    throw new Error('Percentages must not be negative');
  }
  if (driverScaled + companyScaled !== PERCENTAGE_TOTAL_SCALED) {
    throw new Error('Driver and company percentages must total 100');
  }

  const base = BigInt(commissionableMinor);
  const total = BigInt(PERCENTAGE_TOTAL_SCALED);
  const driverAmount = Number((base * BigInt(driverScaled)) / total);
  const platformAmount = commissionableMinor - driverAmount;
  return { driverAmount, platformAmount };
}
