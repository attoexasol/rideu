import { readFileSync } from 'fs';
import { join } from 'path';
import { listServiceAreasForMarket } from '../src/repositories/serviceArea.repository';
import {
  activeRideStatusAfterServiceAreaExit,
  assertRidePermitted,
  clearServiceAreaCache,
  evaluateDriverServiceArea,
  getPassengerServiceAreaConfig,
  pointInsideGeometry,
  validateServiceAreaGeometry,
} from '../src/services/serviceArea.service';

jest.mock('../src/repositories/serviceArea.repository', () => ({
  listServiceAreasForMarket: jest.fn(),
  findServiceAreaById: jest.fn(),
  nextServiceAreaVersion: jest.fn(),
  insertServiceArea: jest.fn(),
  activateServiceAreaRecord: jest.fn(),
}));

const feature = JSON.parse(
  readFileSync(join(__dirname, '../data/service-areas/coronado.geojson'), 'utf8')
) as {
  properties: Record<string, string>;
  geometry: { type: string };
};

const geometry = validateServiceAreaGeometry(feature);
const interior = {
  latitude: Number(feature.properties.INTPTLAT),
  longitude: Number(feature.properties.INTPTLON),
};
const outside = {
  latitude: interior.latitude,
  longitude: interior.longitude - 2,
};

describe('official Coronado boundary file', () => {
  beforeEach(() => {
    clearServiceAreaCache();
    (listServiceAreasForMarket as jest.Mock).mockResolvedValue([
      {
        id: 'official-test-only',
        marketCode: 'US',
        code: 'coronado',
        name: 'Coronado',
        version: 1,
        status: 'active',
        geometry,
        policy: 'pickup_and_dropoff',
        enforcementEnabled: true,
        sourceLabel: 'U.S. Census Bureau TIGERweb — Incorporated Places',
        sourceUrl: null,
        approvedAt: new Date('2026-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
  });

  it('validates the downloaded Census polygon', () => {
    expect(feature.properties.STATE).toBe('06');
    expect(feature.properties.BASENAME).toBe('Coronado');
    expect(feature.properties.NAME).toBe('Coronado city');
    expect(geometry.type).toBe('Polygon');
    expect(pointInsideGeometry(interior.latitude, interior.longitude, geometry)).toBe(true);
    expect(pointInsideGeometry(outside.latitude, outside.longitude, geometry)).toBe(false);
  });

  it('permits an interior US ride and rejects points outside the official polygon', async () => {
    await expect(assertRidePermitted('US', interior, interior, [interior])).resolves.toBeUndefined();
    await expect(assertRidePermitted('US', outside, interior, [])).rejects.toMatchObject({
      details: { failedPoints: ['pickup'] },
    });
    await expect(assertRidePermitted('US', interior, outside, [])).rejects.toMatchObject({
      details: { failedPoints: ['dropoff'] },
    });
    await expect(assertRidePermitted('US', interior, interior, [outside])).rejects.toMatchObject({
      details: { failedPoints: ['stop'] },
    });
  });

  it('keeps Bangladesh unrestricted and withholds US offers outside the polygon', async () => {
    await expect(assertRidePermitted('BD', outside, outside, [outside])).resolves.toBeUndefined();
    await expect(
      evaluateDriverServiceArea('US', outside.latitude, outside.longitude)
    ).resolves.toMatchObject({ code: 'OUTSIDE_SERVICE_AREA' });
    await expect(
      evaluateDriverServiceArea('US', interior.latitude, interior.longitude)
    ).resolves.toMatchObject({ applies: true, inside: true });
    expect(activeRideStatusAfterServiceAreaExit('in_progress')).toBe('in_progress');
  });

  it('returns the official geometry from the passenger config only when enforcement is enabled', async () => {
    const view = await getPassengerServiceAreaConfig('US');
    expect(view.enforcementEnabled).toBe(true);
    expect(view.areas[0].geometry.type).toBe('Polygon');
    expect(view.areas[0].code).toBe('coronado');
  });
});
