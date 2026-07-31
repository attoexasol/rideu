/**
 * Normalized product codes for customer-facing services.
 */
export const CANONICAL_SERVICE_CODES = [
  'ride',
  'bike',
  'cng',
  'moto',
  'premium',
  'comfort',
] as const;

export type CanonicalServiceCode = (typeof CANONICAL_SERVICE_CODES)[number];

export const CANONICAL_DISPLAY_NAMES: Record<CanonicalServiceCode, string> = {
  ride: 'Ride',
  bike: 'Bike',
  cng: 'CNG',
  moto: 'Moto',
  premium: 'Premium',
  comfort: 'Comfort',
};

/** Preferred sort for admin/passenger UIs */
export const CANONICAL_SORT_ORDER: CanonicalServiceCode[] = [
  'ride',
  'bike',
  'cng',
  'moto',
  'premium',
  'comfort',
];

/**
 * Maps a raw code or display name to a canonical product code family.
 * Examples: bike, BIKE, bike-xxxx, Bike f1eadf32 → bike
 */
export function normalizeServiceCategoryBase(
  codeOrName: string
): CanonicalServiceCode | null {
  const raw = String(codeOrName || '')
    .trim()
    .toLowerCase();
  if (!raw) return null;

  for (const base of CANONICAL_SERVICE_CODES) {
    if (raw === base) return base;
    if (raw.startsWith(`${base}-`)) return base;
    if (raw.startsWith(`${base}_`)) return base;
    // "Bike f1eadf32" / "Bike 3db90f70"
    if (new RegExp(`^${base}\\s+[0-9a-f-]{4,}$`, 'i').test(raw)) return base;
    if (raw.startsWith(`${base} `)) return base;
  }

  return null;
}

/** True when code looks like a test/orphan suffix (BIKE-abcdef12). */
export function isSuffixedCategoryCode(code: string): boolean {
  return /^[a-z]+[-_][0-9a-f-]{4,}$/i.test(String(code).trim());
}

/** Strip UUID/runId fragments from public display names. */
export function cleanServiceDisplayName(name: string, code?: string): string {
  const base = normalizeServiceCategoryBase(code || name);
  if (base) return CANONICAL_DISPLAY_NAMES[base];

  const cleaned = String(name || '')
    .replace(/\s+[0-9a-f]{6,}([0-9a-f-]*)$/i, '')
    .trim();
  return cleaned || name;
}

export function toPublicServiceCode(code: string): string {
  const base = normalizeServiceCategoryBase(code);
  return base ? base.toUpperCase() : String(code).toUpperCase();
}

export function isCanonicalExactCode(code: string): boolean {
  return (CANONICAL_SERVICE_CODES as readonly string[]).includes(
    String(code).trim().toLowerCase()
  );
}
