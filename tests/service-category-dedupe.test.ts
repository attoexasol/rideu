import {
  normalizeServiceCategoryBase,
  cleanServiceDisplayName,
  toPublicServiceCode,
  isCanonicalExactCode,
  isSuffixedCategoryCode,
  CANONICAL_SORT_ORDER,
} from '../src/utils/serviceCategoryNormalize';
import { assertNoDuplicateServiceCategoryCode } from '../src/repositories/serviceCategory.repository';

describe('service category normalization', () => {
  it('detects normalized duplicates across code/name variants', () => {
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
  });

  it('never adds UUID fragments to public display names', () => {
    expect(cleanServiceDisplayName('Bike f1eadf32', 'BIKE-f1eadf32')).toBe('Bike');
    expect(cleanServiceDisplayName('Bike ad9d4698', 'BIKE-ad9d4698')).toBe('Bike');
    expect(cleanServiceDisplayName('Ride 3db90f70', 'ride-3db90f70')).toBe('Ride');
    expect(cleanServiceDisplayName('Bike', 'bike')).toBe('Bike');
  });

  it('exposes uppercase public codes for API payloads', () => {
    expect(toPublicServiceCode('bike')).toBe('BIKE');
    expect(toPublicServiceCode('BIKE-xxxx')).toBe('BIKE');
    expect(toPublicServiceCode('ride')).toBe('RIDE');
  });

  it('rejects duplicate category creation for suffixed codes', () => {
    expect(() => assertNoDuplicateServiceCategoryCode('BIKE-deadbeef', 'Bike deadbeef')).toThrow(
      /Duplicate service category/
    );
    expect(() => assertNoDuplicateServiceCategoryCode('bike', 'Bike')).not.toThrow();
    expect(isCanonicalExactCode('bike')).toBe(true);
    expect(isCanonicalExactCode('BIKE-deadbeef')).toBe(false);
    expect(isSuffixedCategoryCode('BIKE-deadbeef')).toBe(true);
  });

  it('orders canonical categories consistently for admin UI', () => {
    expect(CANONICAL_SORT_ORDER).toEqual([
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
    // Pure contract: duplicate BIKE-* codes must not be treated as canonical exact codes
    const fakeActive = [
      { id: '1', code: 'bike', isActive: true },
      { id: '2', code: 'BIKE-aaaa', isActive: true },
      { id: '3', code: 'ride', isActive: true },
    ];
    const canonical = fakeActive.filter((c) => isCanonicalExactCode(c.code));
    expect(canonical.map((c) => c.code)).toEqual(['bike', 'ride']);
    expect(canonical).toHaveLength(2);
  });
});
