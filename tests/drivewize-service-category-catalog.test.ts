import fs from 'fs';
import path from 'path';
import {
  CANONICAL_SERVICE_CODES,
  CANONICAL_SORT_ORDER,
  CANONICAL_DISPLAY_NAMES,
  CANONICAL_CAPACITIES,
  LEGACY_SERVICE_CODES,
  normalizeServiceCategoryBase,
  cleanServiceDisplayName,
  toPublicServiceCode,
  isCanonicalExactCode,
  isLegacyExactCode,
  isKnownExactProductCode,
  isSuffixedCategoryCode,
} from '../src/utils/serviceCategoryNormalize';
import {
  assertNoDuplicateServiceCategoryCode,
  toPublicCategoryPayload,
} from '../src/repositories/serviceCategory.repository';

describe('DriveWize service category catalog', () => {
  it('1. canonical catalog is exactly economy/executive/suv/van/minivan/ada', () => {
    expect([...CANONICAL_SERVICE_CODES]).toEqual([
      'economy',
      'executive',
      'suv',
      'van',
      'minivan',
      'ada',
    ]);
    expect(CANONICAL_SORT_ORDER).toEqual([...CANONICAL_SERVICE_CODES]);
  });

  it('2-5. legacy products are absent from the bookable allowlist', () => {
    for (const legacy of LEGACY_SERVICE_CODES) {
      expect(isCanonicalExactCode(legacy)).toBe(false);
      expect(CANONICAL_SERVICE_CODES).not.toContain(legacy);
    }
    expect(isCanonicalExactCode('bike')).toBe(false);
    expect(isCanonicalExactCode('cng')).toBe(false);
    expect(isCanonicalExactCode('moto')).toBe(false);
    expect(isCanonicalExactCode('ride')).toBe(false);
    expect(isCanonicalExactCode('premium')).toBe(false);
    expect(isCanonicalExactCode('comfort')).toBe(false);
  });

  it('6. legacy codes remain known for historical display but are not bookable', () => {
    expect([...LEGACY_SERVICE_CODES]).toEqual([
      'ride',
      'bike',
      'cng',
      'moto',
      'premium',
      'comfort',
    ]);
    expect(isLegacyExactCode('bike')).toBe(true);
    expect(isKnownExactProductCode('bike')).toBe(true);
    expect(normalizeServiceCategoryBase('BIKE-f1eadf32')).toBe('bike');
    expect(cleanServiceDisplayName('Bike f1eadf32', 'BIKE-f1eadf32')).toBe('Bike');
  });

  it('9. public codes uppercase correctly for DriveWize products', () => {
    expect(toPublicServiceCode('economy')).toBe('ECONOMY');
    expect(toPublicServiceCode('executive')).toBe('EXECUTIVE');
    expect(toPublicServiceCode('suv')).toBe('SUV');
    expect(toPublicServiceCode('van')).toBe('VAN');
    expect(toPublicServiceCode('minivan')).toBe('MINIVAN');
    expect(toPublicServiceCode('ada')).toBe('ADA');
  });

  it('10. capacities match client website requirements', () => {
    expect(CANONICAL_CAPACITIES).toEqual({
      economy: 3,
      executive: 3,
      suv: 6,
      van: 8,
      minivan: 5,
      ada: 4,
    });
  });

  it('11. Bus is not an instant service category', () => {
    expect(isCanonicalExactCode('bus')).toBe(false);
    expect(CANONICAL_SERVICE_CODES).not.toContain('bus');
    expect(normalizeServiceCategoryBase('bus')).toBeNull();
  });

  it('display names match DriveWize product labels', () => {
    expect(CANONICAL_DISPLAY_NAMES).toEqual({
      economy: 'Economy Sedan',
      executive: 'Executive Sedan',
      suv: 'SUV',
      van: 'Passenger Van',
      minivan: 'Mini-Van',
      ada: 'ADA Accessible',
    });
  });

  it('Passenger/Admin public payload shape remains stable', () => {
    const payload = toPublicCategoryPayload({
      id: '11111111-1111-1111-1111-111111111111',
      code: 'economy',
      name: 'Economy Sedan',
      capacity: 3,
      description: 'Comfortable, cost-effective sedan transportation for individuals and couples.',
      iconKey: 'economy',
    });
    expect(payload).toEqual({
      serviceCategoryId: '11111111-1111-1111-1111-111111111111',
      id: '11111111-1111-1111-1111-111111111111',
      code: 'ECONOMY',
      name: 'Economy Sedan',
      displayName: 'Economy Sedan',
      capacity: 3,
      description:
        'Comfortable, cost-effective sedan transportation for individuals and couples.',
      iconKey: 'economy',
    });
  });

  it('filters bookable set to exact canonical codes only', () => {
    const fakeActive = [
      { id: '1', code: 'economy', isActive: true },
      { id: '2', code: 'bike', isActive: true },
      { id: '3', code: 'BIKE-aaaa', isActive: true },
      { id: '4', code: 'suv', isActive: true },
      { id: '5', code: 'bus', isActive: true },
    ];
    const canonical = fakeActive.filter((c) => isCanonicalExactCode(c.code));
    expect(canonical.map((c) => c.code)).toEqual(['economy', 'suv']);
  });

  it('rejects suffixed orphan codes for known families', () => {
    expect(() => assertNoDuplicateServiceCategoryCode('BIKE-deadbeef', 'Bike deadbeef')).toThrow(
      /Duplicate service category/
    );
    expect(() => assertNoDuplicateServiceCategoryCode('economy', 'Economy Sedan')).not.toThrow();
    expect(() => assertNoDuplicateServiceCategoryCode('bike', 'Bike')).not.toThrow();
    expect(isSuffixedCategoryCode('BIKE-deadbeef')).toBe(true);
  });
});

describe('migration 0033 DriveWize catalog SQL', () => {
  const sqlRaw = fs.readFileSync(
    path.join(__dirname, '../src/db/migrations/0033_drivewize_service_category_catalog.sql'),
    'utf8'
  );
  /** Executable statements only — ignore header comments. */
  const sql = sqlRaw
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  it('inserts the six DriveWize products with correct capacities and soft-retires legacy', () => {
    for (const code of CANONICAL_SERVICE_CODES) {
      expect(sql).toContain(`'${code}'`);
    }
    expect(sql).toContain("'Economy Sedan'");
    expect(sql).toContain("'Executive Sedan'");
    expect(sql).toContain("'Passenger Van'");
    expect(sql).toContain("'Mini-Van'");
    expect(sql).toContain("'ADA Accessible'");
    expect(sql).toMatch(/'economy'[\s\S]*?\b3\b/);
    expect(sql).toMatch(/'executive'[\s\S]*?\b3\b/);
    expect(sql).toMatch(/'suv'[\s\S]*?\b6\b/);
    expect(sql).toMatch(/'van'[\s\S]*?\b8\b/);
    expect(sql).toMatch(/'minivan'[\s\S]*?\b5\b/);
    expect(sql).toMatch(/'ada'[\s\S]*?\b4\b/);
    expect(sql).toContain(
      `"code" IN ('ride', 'bike', 'cng', 'moto', 'premium', 'comfort')`
    );
    expect(sql).toMatch(/"is_active"\s*=\s*false/);
  });

  it('7/12. does not delete categories or remap historical bookings', () => {
    expect(sql).not.toMatch(/\bDELETE\b/i);
    expect(sql).not.toMatch(/UPDATE\s+"bookings"/i);
    expect(sql).not.toMatch(/service_category_id\s*=/i);
    expect(sql).not.toContain("'bus'");
  });

  it('does not invent market fare seed rows', () => {
    expect(sql).not.toContain('service_category_market_fares');
    expect(sql).not.toMatch(/INSERT\s+INTO\s+"?service_category_market_fares"?/i);
  });
});

describe('Passenger services catalog mapping contract', () => {
  it('7. maps repository rows like GET /passenger/services', () => {
    const services = CANONICAL_SORT_ORDER.map((code, index) => ({
      id: `id-${code}`,
      code,
      name: CANONICAL_DISPLAY_NAMES[code],
      description: `${code} description`,
      iconKey: code,
      capacity: CANONICAL_CAPACITIES[code],
      baseFare: '0.00',
      perKmRate: '0.00',
      minFare: '0.00',
      sortOrder: index + 1,
    }));

    const filtered = services.map((s) => ({
      serviceCategoryId: s.id,
      code: s.code.toUpperCase(),
      name: s.name,
      displayName: s.name,
      description: s.description,
      iconKey: s.iconKey,
      capacity: s.capacity,
      baseFare: s.baseFare,
      perKmRate: s.perKmRate,
      minFare: s.minFare,
      sortOrder: s.sortOrder,
    }));

    expect(filtered.map((s) => s.code)).toEqual([
      'ECONOMY',
      'EXECUTIVE',
      'SUV',
      'VAN',
      'MINIVAN',
      'ADA',
    ]);
    expect(filtered.map((s) => s.capacity)).toEqual([3, 3, 6, 8, 5, 4]);
    expect(filtered.map((s) => s.displayName)).toEqual([
      'Economy Sedan',
      'Executive Sedan',
      'SUV',
      'Passenger Van',
      'Mini-Van',
      'ADA Accessible',
    ]);
    expect(filtered.every((s) => typeof s.serviceCategoryId === 'string')).toBe(true);
  });
});

describe('Admin service categories catalog mapping contract', () => {
  it('8. maps repository rows like GET /admin/service-categories', () => {
    const categories = CANONICAL_SORT_ORDER.map((code) =>
      toPublicCategoryPayload({
        id: `id-${code}`,
        code,
        name: CANONICAL_DISPLAY_NAMES[code],
        capacity: CANONICAL_CAPACITIES[code],
        description: null,
        iconKey: code,
      })
    );
    expect(categories.map((c) => c.code)).toEqual([
      'ECONOMY',
      'EXECUTIVE',
      'SUV',
      'VAN',
      'MINIVAN',
      'ADA',
    ]);
    expect(categories.every((c) => c.serviceCategoryId && c.displayName)).toBe(true);
  });
});
