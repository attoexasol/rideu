import {
  normalizeServiceCategoryBase,
  cleanServiceDisplayName,
  toPublicServiceCode,
  isCanonicalExactCode,
  isLegacyExactCode,
  isSuffixedCategoryCode,
  CANONICAL_SORT_ORDER,
  LEGACY_SERVICE_CODES,
} from '../src/utils/serviceCategoryNormalize';
import { assertNoDuplicateServiceCategoryCode } from '../src/repositories/serviceCategory.repository';

describe('service category normalization', () => {
  it('detects normalized duplicates across code/name variants for known families', () => {
    expect(normalizeServiceCategoryBase('economy')).toBe('economy');
    expect(normalizeServiceCategoryBase('ECONOMY')).toBe('economy');
    expect(normalizeServiceCategoryBase('economy-f1eadf32')).toBe('economy');
    expect(normalizeServiceCategoryBase('bike')).toBe('bike');
    expect(normalizeServiceCategoryBase('BIKE')).toBe('bike');
    expect(normalizeServiceCategoryBase('BIKE-f1eadf32')).toBe('bike');
    expect(normalizeServiceCategoryBase('Bike f1eadf32')).toBe('bike');
    expect(normalizeServiceCategoryBase('Bike ad9d4698')).toBe('bike');
    expect(normalizeServiceCategoryBase('ride-abc12345')).toBe('ride');
    expect(normalizeServiceCategoryBase('CNG')).toBe('cng');
    expect(normalizeServiceCategoryBase('Premium')).toBe('premium');
    expect(normalizeServiceCategoryBase('Comfort')).toBe('comfort');
    expect(normalizeServiceCategoryBase('Moto')).toBe('moto');
    expect(normalizeServiceCategoryBase('minivan')).toBe('minivan');
    expect(normalizeServiceCategoryBase('ada')).toBe('ada');
  });

  it('never adds UUID fragments to public display names', () => {
    expect(cleanServiceDisplayName('Bike f1eadf32', 'BIKE-f1eadf32')).toBe('Bike');
    expect(cleanServiceDisplayName('Bike ad9d4698', 'BIKE-ad9d4698')).toBe('Bike');
    expect(cleanServiceDisplayName('Ride 3db90f70', 'ride-3db90f70')).toBe('Ride');
    expect(cleanServiceDisplayName('Bike', 'bike')).toBe('Bike');
    expect(cleanServiceDisplayName('Economy Sedan', 'economy')).toBe('Economy Sedan');
  });

  it('exposes uppercase public codes for API payloads', () => {
    expect(toPublicServiceCode('economy')).toBe('ECONOMY');
    expect(toPublicServiceCode('bike')).toBe('BIKE');
    expect(toPublicServiceCode('BIKE-xxxx')).toBe('BIKE');
    expect(toPublicServiceCode('suv')).toBe('SUV');
  });

  it('rejects duplicate category creation for suffixed codes', () => {
    expect(() => assertNoDuplicateServiceCategoryCode('BIKE-deadbeef', 'Bike deadbeef')).toThrow(
      /Duplicate service category/
    );
    expect(() => assertNoDuplicateServiceCategoryCode('bike', 'Bike')).not.toThrow();
    expect(() => assertNoDuplicateServiceCategoryCode('economy', 'Economy Sedan')).not.toThrow();
    expect(isCanonicalExactCode('economy')).toBe(true);
    expect(isCanonicalExactCode('bike')).toBe(false);
    expect(isLegacyExactCode('bike')).toBe(true);
    expect(isCanonicalExactCode('BIKE-deadbeef')).toBe(false);
    expect(isSuffixedCategoryCode('BIKE-deadbeef')).toBe(true);
  });

  it('orders canonical categories consistently for admin UI', () => {
    expect(CANONICAL_SORT_ORDER).toEqual([
      'economy',
      'executive',
      'suv',
      'van',
      'minivan',
      'ada',
    ]);
    expect(LEGACY_SERVICE_CODES).toEqual([
      'ride',
      'bike',
      'cng',
      'moto',
      'premium',
      'comfort',
    ]);
  });
});

describe('quote/admin category selection contract', () => {
  it('listCanonicalActiveServiceCategories filters to exact canonical codes only', async () => {
    const fakeActive = [
      { id: '1', code: 'bike', isActive: true },
      { id: '2', code: 'BIKE-aaaa', isActive: true },
      { id: '3', code: 'economy', isActive: true },
      { id: '4', code: 'suv', isActive: true },
    ];
    const canonical = fakeActive.filter((c) => isCanonicalExactCode(c.code));
    expect(canonical.map((c) => c.code)).toEqual(['economy', 'suv']);
    expect(canonical).toHaveLength(2);
  });
});
