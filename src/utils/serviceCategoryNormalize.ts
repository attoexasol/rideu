/**
 * Normalized product codes for customer-facing services.
 *
 * Bookable catalog = CANONICAL_SERVICE_CODES only.
 * LEGACY_* codes remain known for historical display / orphan cleanup,
 * but are not returned by listCanonicalActiveServiceCategories.
 */

/** Current DriveWize instant-bookable passenger products. */
export const CANONICAL_SERVICE_CODES = [
  'economy',
  'executive',
  'suv',
  'van',
  'minivan',
  'ada',
] as const;

export type CanonicalServiceCode = (typeof CANONICAL_SERVICE_CODES)[number];

/**
 * Soft-retired Rydu/BD products. Kept for normalize/display of historical
 * bookings and orphan-family cleanup. Not bookable.
 */
export const LEGACY_SERVICE_CODES = [
  'ride',
  'bike',
  'cng',
  'moto',
  'premium',
  'comfort',
] as const;

export type LegacyServiceCode = (typeof LEGACY_SERVICE_CODES)[number];

export type KnownServiceCode = CanonicalServiceCode | LegacyServiceCode;

export const CANONICAL_DISPLAY_NAMES: Record<CanonicalServiceCode, string> = {
  economy: 'Economy Sedan',
  executive: 'Executive Sedan',
  suv: 'SUV',
  van: 'Passenger Van',
  minivan: 'Mini-Van',
  ada: 'ADA Accessible',
};

export const LEGACY_DISPLAY_NAMES: Record<LegacyServiceCode, string> = {
  ride: 'Ride',
  bike: 'Bike',
  cng: 'CNG',
  moto: 'Moto',
  premium: 'Premium',
  comfort: 'Comfort',
};

/** Preferred sort for admin/passenger UIs (bookable set only). */
export const CANONICAL_SORT_ORDER: CanonicalServiceCode[] = [
  'economy',
  'executive',
  'suv',
  'van',
  'minivan',
  'ada',
];

/** Seed capacities for the DriveWize catalog (authoritative in migration; mirrored for contracts). */
export const CANONICAL_CAPACITIES: Record<CanonicalServiceCode, number> = {
  economy: 3,
  executive: 3,
  suv: 6,
  van: 8,
  minivan: 5,
  ada: 4,
};

const ALL_KNOWN_CODES: readonly KnownServiceCode[] = [
  ...CANONICAL_SERVICE_CODES,
  ...LEGACY_SERVICE_CODES,
];

/**
 * Maps a raw code or display name to a known product code family
 * (current canonical or legacy).
 * Examples: bike, BIKE, bike-xxxx, Bike f1eadf32 → bike
 *           economy, ECONOMY, economy-xxxx → economy
 */
export function normalizeServiceCategoryBase(
  codeOrName: string
): KnownServiceCode | null {
  const raw = String(codeOrName || '')
    .trim()
    .toLowerCase();
  if (!raw) return null;

  for (const base of ALL_KNOWN_CODES) {
    if (raw === base) return base;
    if (raw.startsWith(`${base}-`)) return base;
    if (raw.startsWith(`${base}_`)) return base;
    // "Bike f1eadf32" / "Economy deadbeef"
    if (new RegExp(`^${base}\\s+[0-9a-f-]{4,}$`, 'i').test(raw)) return base;
    if (raw.startsWith(`${base} `)) return base;
  }

  return null;
}

/** True when code looks like a test/orphan suffix (BIKE-abcdef12). */
export function isSuffixedCategoryCode(code: string): boolean {
  return /^[a-z]+[-_][0-9a-f-]{4,}$/i.test(String(code).trim());
}

function displayNameForBase(base: KnownServiceCode): string {
  if ((CANONICAL_SERVICE_CODES as readonly string[]).includes(base)) {
    return CANONICAL_DISPLAY_NAMES[base as CanonicalServiceCode];
  }
  return LEGACY_DISPLAY_NAMES[base as LegacyServiceCode];
}

/** Strip UUID/runId fragments from public display names. */
export function cleanServiceDisplayName(name: string, code?: string): string {
  const base = normalizeServiceCategoryBase(code || name);
  if (base) return displayNameForBase(base);

  const cleaned = String(name || '')
    .replace(/\s+[0-9a-f]{6,}([0-9a-f-]*)$/i, '')
    .trim();
  return cleaned || name;
}

export function toPublicServiceCode(code: string): string {
  const base = normalizeServiceCategoryBase(code);
  return base ? base.toUpperCase() : String(code).toUpperCase();
}

/** Exact code in the current bookable allowlist. */
export function isCanonicalExactCode(code: string): boolean {
  return (CANONICAL_SERVICE_CODES as readonly string[]).includes(
    String(code).trim().toLowerCase()
  );
}

/** Exact code of a soft-retired legacy product. */
export function isLegacyExactCode(code: string): boolean {
  return (LEGACY_SERVICE_CODES as readonly string[]).includes(
    String(code).trim().toLowerCase()
  );
}

/** Exact known product code (bookable or legacy) — not a suffixed orphan. */
export function isKnownExactProductCode(code: string): boolean {
  return isCanonicalExactCode(code) || isLegacyExactCode(code);
}
