/**
 * Download the official Coronado incorporated-place boundary from the
 * U.S. Census Bureau TIGERweb and validate it with the service-area checker.
 *
 * Does not insert coordinates, activate enforcement, or substitute another source.
 *
 * Usage: npx tsx src/scripts/fetch-coronado-boundary.ts
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import {
  ServiceAreaGeometryError,
  validateServiceAreaGeometry,
} from '../services/serviceArea.service';

const TIGER_LAYER_URL =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4';

/**
 * The Incorporated Places layer stores the legal name "Coronado city".
 * NAME='Coronado' on this same layer returns zero features.
 */
const where = encodeURIComponent("STATE='06' AND NAME='Coronado city'").replace(/'/g, '%27');

export const CORONADO_SOURCE_URL =
  `${TIGER_LAYER_URL}/query?where=${where}` +
  '&outFields=*&returnGeometry=true&outSR=4326&f=geojson';

export const CORONADO_SOURCE_LABEL = 'U.S. Census Bureau TIGERweb — Incorporated Places';

const OUTPUT_DIR = join(process.cwd(), 'data', 'service-areas');
const GEOJSON_PATH = join(OUTPUT_DIR, 'coronado.geojson');
const METADATA_PATH = join(OUTPUT_DIR, 'coronado.source.json');

type Position = number[];

function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const value = contentType.toLowerCase();
  return (
    value.includes('application/json') ||
    value.includes('application/geo+json') ||
    value.includes('application/vnd.geo+json') ||
    value.includes('text/plain')
  );
}

function propertyString(properties: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = properties[key];
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function walkRings(geometry: { type: string; coordinates: unknown }): {
  polygonCount: number;
  holeCount: number;
  vertexCount: number;
  bbox: [number, number, number, number] | null;
} {
  const polygons: Position[][][] =
    geometry.type === 'Polygon'
      ? [geometry.coordinates as Position[][]]
      : (geometry.coordinates as Position[][][]);
  let holeCount = 0;
  let vertexCount = 0;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0) {
      throw new ServiceAreaGeometryError('A polygon has no rings');
    }
    holeCount += Math.max(0, polygon.length - 1);
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length === 0) {
        throw new ServiceAreaGeometryError('A ring is empty');
      }
      for (const position of ring) {
        vertexCount += 1;
        const longitude = position[0];
        const latitude = position[1];
        minLng = Math.min(minLng, longitude);
        minLat = Math.min(minLat, latitude);
        maxLng = Math.max(maxLng, longitude);
        maxLat = Math.max(maxLat, latitude);
      }
    }
  }
  return {
    polygonCount: polygons.length,
    holeCount,
    vertexCount,
    bbox: vertexCount ? [minLng, minLat, maxLng, maxLat] : null,
  };
}

async function main(): Promise<void> {
  const response = await fetch(CORONADO_SOURCE_URL, {
    headers: { Accept: 'application/geo+json, application/json' },
  });
  const contentType = response.headers.get('content-type');
  if (!response.ok) {
    throw new Error(`Census request failed with HTTP ${response.status}`);
  }
  if (!isJsonContentType(contentType)) {
    throw new Error(`Unexpected content type: ${contentType ?? 'missing'}`);
  }

  const body = (await response.json()) as {
    type?: string;
    features?: Array<{ type?: string; properties?: Record<string, unknown>; geometry?: unknown }>;
    error?: { message?: string };
  };
  if (body.error) {
    throw new Error(body.error.message ?? 'Census query returned an error');
  }
  if (body.type !== 'FeatureCollection' || !Array.isArray(body.features)) {
    throw new Error('Response is not a GeoJSON FeatureCollection');
  }
  if (body.features.length !== 1) {
    throw new Error(`Expected exactly one Coronado feature, received ${body.features.length}`);
  }

  const feature = body.features[0];
  if (feature.type !== 'Feature' || !feature.properties || !feature.geometry) {
    throw new Error('The Coronado record is not a GeoJSON Feature with properties and geometry');
  }
  const state = propertyString(feature.properties, 'STATE', 'state');
  const name = propertyString(feature.properties, 'NAME', 'name');
  const basename = propertyString(feature.properties, 'BASENAME', 'basename');
  if (state !== '06') {
    throw new Error(`Expected STATE 06, received ${state || 'none'}`);
  }
  if (basename.toLowerCase() !== 'coronado' && !name.toLowerCase().startsWith('coronado')) {
    throw new Error(`Feature does not identify Coronado (NAME=${name || 'none'})`);
  }

  const geometry = feature.geometry as { type?: string; coordinates?: unknown };
  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') {
    throw new Error(`Expected Polygon or MultiPolygon, received ${geometry.type ?? 'none'}`);
  }
  const structure = walkRings(geometry as { type: string; coordinates: unknown });
  if (!structure.bbox || structure.vertexCount === 0 || structure.polygonCount === 0) {
    throw new Error('Official geometry is empty');
  }

  mkdirSync(dirname(GEOJSON_PATH), { recursive: true });
  writeFileSync(GEOJSON_PATH, `${JSON.stringify(feature)}\n`);

  let validation: { ok: true; type: string } | { ok: false; message: string };
  try {
    const validated = validateServiceAreaGeometry(feature);
    validation = { ok: true, type: validated.type };
  } catch (error) {
    validation = {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const metadata = {
    sourceLabel: CORONADO_SOURCE_LABEL,
    sourceUrl: CORONADO_SOURCE_URL,
    literalNameQueryReturnedZero: true,
    literalNameQuery:
      "Layer 4 query STATE='06' AND NAME='Coronado' returns 0 features. The stored NAME is the legal name.",
    layerUrl: TIGER_LAYER_URL,
    retrievedAt: new Date().toISOString(),
    httpStatus: response.status,
    contentType,
    featureCount: 1,
    state,
    name,
    basename,
    geoid: propertyString(feature.properties, 'GEOID', 'geoid'),
    place: propertyString(feature.properties, 'PLACE', 'place'),
    areaLand: propertyString(feature.properties, 'AREALAND', 'arealand'),
    areaWater: propertyString(feature.properties, 'AREAWATER', 'areawater'),
    geometryType: geometry.type,
    polygonCount: structure.polygonCount,
    holeCount: structure.holeCount,
    vertexCount: structure.vertexCount,
    bbox: structure.bbox,
    geometryFile: 'data/service-areas/coronado.geojson',
    validation,
  };
  writeFileSync(METADATA_PATH, `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(JSON.stringify(metadata, null, 2));
  process.exit(validation.ok ? 0 : 2);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
