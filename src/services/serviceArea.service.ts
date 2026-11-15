/**
 * Market service-area enforcement.
 *
 * Bangladesh is never polygon-restricted. United States uses the active
 * approved geometry only when enforcement is enabled. The passenger's device
 * location is not a market selector; callers pass the market already resolved
 * from the pickup (or, for drivers, the booking's stored market).
 */

import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import kinks from '@turf/kinks';
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';
import {
  OutOfServiceAreaError,
  ServiceAreaUnavailableError,
} from './payment.errors';
import { resolveRideMarket, type ResolvedRideMarket } from './rideMarket.service';
import {
  activateServiceAreaRecord,
  findServiceAreaById,
  insertServiceArea,
  listServiceAreasForMarket,
  nextServiceAreaVersion,
} from '../repositories/serviceArea.repository';
import type { ServiceArea } from '../db/schema/service_areas';

export const PICKUP_AND_DROPOFF_POLICY = 'pickup_and_dropoff';
export const UNRESTRICTED_MARKET_CODE = 'BD';

const CACHE_MS = 10_000;
const RING_CLOSURE_EPSILON = 1e-8;

export class ServiceAreaGeometryError extends Error {
  readonly code = 'INVALID_SERVICE_AREA_GEOMETRY';

  constructor(message: string) {
    super(message);
    this.name = 'ServiceAreaGeometryError';
  }
}

export class ServiceAreaActivationError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = 'ServiceAreaActivationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface ServiceAreaPoint {
  latitude: number;
  longitude: number;
}

export interface PassengerServiceAreaView {
  marketCode: string;
  enforcementEnabled: boolean;
  areas: Array<{
    code: string;
    name: string;
    version: number;
    policy: string;
    geometry: Polygon | MultiPolygon;
  }>;
}

interface UsableArea {
  code: string;
  name: string;
  version: number;
  policy: string;
  geometry: Polygon | MultiPolygon;
}

interface MarketEnforcement {
  enforcementRequested: boolean;
  areas: UsableArea[];
}

const enforcementCache = new Map<string, { expiresAt: number; snapshot: MarketEnforcement }>();

export function clearServiceAreaCache(): void {
  enforcementCache.clear();
}

export function normalizeMarketCode(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

/** Leaving the polygon does not cancel or rewrite an in-progress ride. */
export function activeRideStatusAfterServiceAreaExit<T extends string>(status: T): T {
  return status;
}

function positionsEqual(a: Position, b: Position): boolean {
  return (
    Math.abs(Number(a[0]) - Number(b[0])) <= RING_CLOSURE_EPSILON &&
    Math.abs(Number(a[1]) - Number(b[1])) <= RING_CLOSURE_EPSILON
  );
}

function validateRing(ring: unknown, label: string): Position[] {
  if (!Array.isArray(ring) || ring.length < 4) {
    throw new ServiceAreaGeometryError(`${label} must have at least 4 positions`);
  }
  const positions: Position[] = ring.map((position, index) => {
    if (!Array.isArray(position) || position.length < 2) {
      throw new ServiceAreaGeometryError(`${label} position ${index} must be [longitude, latitude]`);
    }
    const longitude = position[0];
    const latitude = position[1];
    if (typeof longitude !== 'number' || typeof latitude !== 'number') {
      throw new ServiceAreaGeometryError(`${label} position ${index} must be numeric`);
    }
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      throw new ServiceAreaGeometryError(`${label} position ${index} must be finite`);
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new ServiceAreaGeometryError(`${label} position ${index} is out of range`);
    }
    return [longitude, latitude];
  });
  const first = positions[0];
  const last = positions[positions.length - 1];
  if (!first || !last || !positionsEqual(first, last)) {
    throw new ServiceAreaGeometryError(`${label} must be closed`);
  }
  return positions;
}

function validatePolygonCoordinates(coordinates: unknown, label: string): Position[][] {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    throw new ServiceAreaGeometryError(`${label} has no rings`);
  }
  return coordinates.map((ring, index) =>
    validateRing(ring, index === 0 ? `${label} exterior` : `${label} hole ${index}`)
  );
}

function rejectSelfIntersections(geometry: Polygon | MultiPolygon): void {
  const intersections = kinks(geometry);
  if (intersections.features.length > 0) {
    throw new ServiceAreaGeometryError('Geometry self-intersects');
  }
}

/**
 * Accepts a Polygon, MultiPolygon, a single Feature, or a one-feature
 * FeatureCollection. Stored output is always a bare Polygon or MultiPolygon
 * in GeoJSON axis order: [longitude, latitude].
 */
export function validateServiceAreaGeometry(input: unknown): Polygon | MultiPolygon {
  const geometry = unwrapGeometry(input);
  rejectSelfIntersections(geometry);
  return geometry;
}

function unwrapGeometry(input: unknown): Polygon | MultiPolygon {
  if (!input || typeof input !== 'object') {
    throw new ServiceAreaGeometryError('Geometry is required');
  }
  const value = input as { type?: string; geometry?: unknown; features?: unknown; coordinates?: unknown };
  if (value.type === 'Feature') {
    return unwrapGeometry((value as Feature).geometry);
  }
  if (value.type === 'FeatureCollection') {
    const features = (value as FeatureCollection).features;
    if (!Array.isArray(features) || features.length !== 1) {
      throw new ServiceAreaGeometryError('FeatureCollection must contain exactly one feature');
    }
    return unwrapGeometry(features[0]);
  }
  if (value.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: validatePolygonCoordinates(value.coordinates, 'Polygon'),
    };
  }
  if (value.type === 'MultiPolygon') {
    if (!Array.isArray(value.coordinates) || value.coordinates.length === 0) {
      throw new ServiceAreaGeometryError('MultiPolygon has no polygons');
    }
    return {
      type: 'MultiPolygon',
      coordinates: value.coordinates.map((polygon, index) =>
        validatePolygonCoordinates(polygon, `MultiPolygon ${index}`)
      ),
    };
  }
  throw new ServiceAreaGeometryError('Geometry must be a Polygon or MultiPolygon');
}

export function pointInsideGeometry(
  latitude: number,
  longitude: number,
  geometry: Polygon | MultiPolygon
): boolean {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  return booleanPointInPolygon([longitude, latitude], geometry, { ignoreBoundary: false });
}

function usableAreaFromRow(row: ServiceArea): UsableArea | null {
  if (row.status !== 'active' || !row.enforcementEnabled || !row.approvedAt) return null;
  if (row.policy !== PICKUP_AND_DROPOFF_POLICY) return null;
  try {
    return {
      code: row.code,
      name: row.name,
      version: row.version,
      policy: row.policy,
      geometry: validateServiceAreaGeometry(row.geometry),
    };
  } catch {
    return null;
  }
}

async function loadMarketEnforcement(marketCode: string): Promise<MarketEnforcement> {
  const cached = enforcementCache.get(marketCode);
  if (cached && cached.expiresAt > Date.now()) return cached.snapshot;

  const rows = await listServiceAreasForMarket(marketCode);
  const enforcementRequested = rows.some((row) => row.status === 'active' && row.enforcementEnabled);
  const areas = rows
    .map(usableAreaFromRow)
    .filter((area): area is UsableArea => area !== null)
    .sort((a, b) => b.version - a.version);
  const snapshot = { enforcementRequested, areas };
  enforcementCache.set(marketCode, { expiresAt: Date.now() + CACHE_MS, snapshot });
  return snapshot;
}

function failedRoles(
  points: Array<ServiceAreaPoint & { role: 'pickup' | 'dropoff' | 'stop' }>,
  areas: UsableArea[]
): string[] {
  const failed = new Set<string>();
  for (const point of points) {
    const inside = areas.some((area) =>
      pointInsideGeometry(point.latitude, point.longitude, area.geometry)
    );
    if (!inside) failed.add(point.role);
  }
  return (['pickup', 'dropoff', 'stop'] as const).filter((role) => failed.has(role));
}

/**
 * BD skips the polygon. Other markets skip unless an active approved area
 * has enforcement enabled. US with enforcement and no usable geometry fails closed.
 */
export async function assertRidePermitted(
  marketCode: string,
  pickup: ServiceAreaPoint,
  dropoff: ServiceAreaPoint,
  stops: ServiceAreaPoint[] = []
): Promise<void> {
  const code = normalizeMarketCode(marketCode);
  if (code === UNRESTRICTED_MARKET_CODE) return;

  const enforcement = await loadMarketEnforcement(code);
  if (!enforcement.enforcementRequested) return;
  if (!enforcement.areas.length) throw new ServiceAreaUnavailableError();

  const failedPoints = failedRoles(
    [
      { role: 'pickup', ...pickup },
      { role: 'dropoff', ...dropoff },
      ...stops.map((stop) => ({ role: 'stop' as const, ...stop })),
    ],
    enforcement.areas
  );
  if (failedPoints.length) throw new OutOfServiceAreaError(failedPoints);
}

export async function assertQueryPointPermitted(
  marketCode: string,
  point: ServiceAreaPoint
): Promise<void> {
  const code = normalizeMarketCode(marketCode);
  if (code === UNRESTRICTED_MARKET_CODE) return;
  const enforcement = await loadMarketEnforcement(code);
  if (!enforcement.enforcementRequested) return;
  if (!enforcement.areas.length) throw new ServiceAreaUnavailableError();
  const inside = enforcement.areas.some((area) =>
    pointInsideGeometry(point.latitude, point.longitude, area.geometry)
  );
  if (!inside) throw new OutOfServiceAreaError(['pickup']);
}

export type DriverServiceAreaDecision =
  | { applies: false }
  | { applies: true; inside: true }
  | { applies: true; inside: false; code: 'OUTSIDE_SERVICE_AREA' | 'SERVICE_AREA_UNAVAILABLE' };

export async function evaluateDriverServiceArea(
  marketCode: string | null | undefined,
  latitude: number,
  longitude: number
): Promise<DriverServiceAreaDecision> {
  if (!marketCode) return { applies: false };
  const code = normalizeMarketCode(marketCode);
  if (code === UNRESTRICTED_MARKET_CODE) return { applies: false };

  const enforcement = await loadMarketEnforcement(code);
  if (!enforcement.enforcementRequested) return { applies: false };
  if (!enforcement.areas.length) {
    return { applies: true, inside: false, code: 'SERVICE_AREA_UNAVAILABLE' };
  }
  const inside = enforcement.areas.some((area) =>
    pointInsideGeometry(latitude, longitude, area.geometry)
  );
  if (!inside) return { applies: true, inside: false, code: 'OUTSIDE_SERVICE_AREA' };
  return { applies: true, inside: true };
}

export async function getPassengerServiceAreaConfig(
  marketCode: string
): Promise<PassengerServiceAreaView> {
  const code = normalizeMarketCode(marketCode);
  if (code === UNRESTRICTED_MARKET_CODE) {
    return { marketCode: code, enforcementEnabled: false, areas: [] };
  }
  const enforcement = await loadMarketEnforcement(code);
  if (!enforcement.enforcementRequested || !enforcement.areas.length) {
    return {
      marketCode: code,
      enforcementEnabled: enforcement.enforcementRequested && enforcement.areas.length === 0,
      areas: [],
    };
  }
  return {
    marketCode: code,
    enforcementEnabled: true,
    areas: enforcement.areas.map((area) => ({
      code: area.code,
      name: area.name,
      version: area.version,
      policy: area.policy,
      geometry: area.geometry,
    })),
  };
}

/** Resolves the pickup market from Google, then applies that market's policy. */
export async function assertResolvedRidePermitted(input: {
  pickup: ServiceAreaPoint & { placeId?: string | null; countryCode?: string | null };
  dropoff: ServiceAreaPoint;
  stops?: ServiceAreaPoint[];
}): Promise<ResolvedRideMarket> {
  const market = await resolveRideMarket({
    pickupLatitude: input.pickup.latitude,
    pickupLongitude: input.pickup.longitude,
    pickupPlaceId: input.pickup.placeId,
    pickupCountryCode: input.pickup.countryCode,
  });
  await assertRidePermitted(market.code, input.pickup, input.dropoff, input.stops ?? []);
  return market;
}

/** Nearby-driver queries resolve the market from the pin. No client country is accepted. */
export async function assertNearbyQueryPermitted(
  latitude: number,
  longitude: number
): Promise<ResolvedRideMarket> {
  const market = await resolveRideMarket({
    pickupLatitude: latitude,
    pickupLongitude: longitude,
  });
  await assertQueryPointPermitted(market.code, { latitude, longitude });
  return market;
}

export async function getServiceAreaForCoordinates(input: {
  latitude: number;
  longitude: number;
  placeId?: string | null;
}): Promise<PassengerServiceAreaView> {
  const market = await resolveRideMarket({
    pickupLatitude: input.latitude,
    pickupLongitude: input.longitude,
    pickupPlaceId: input.placeId,
  });
  return getPassengerServiceAreaConfig(market.code);
}

function normalizeAreaCode(code: string): string {
  const normalized = code.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized)) {
    throw new ServiceAreaActivationError(
      'INVALID_SERVICE_AREA_CODE',
      'Service area code must be a short slug'
    );
  }
  return normalized;
}

export async function createServiceAreaDraft(input: {
  marketCode: string;
  code: string;
  name: string;
  geometry: unknown;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
}): Promise<ServiceArea> {
  const marketCode = normalizeMarketCode(input.marketCode);
  if (!/^[A-Z]{2,8}$/.test(marketCode)) {
    throw new ServiceAreaActivationError('INVALID_MARKET_CODE', 'Market code is invalid');
  }
  const name = input.name.trim();
  if (!name || name.length > 100) {
    throw new ServiceAreaActivationError('INVALID_SERVICE_AREA_NAME', 'Service area name is invalid');
  }
  const geometry = validateServiceAreaGeometry(input.geometry);
  const code = normalizeAreaCode(input.code);
  const version = await nextServiceAreaVersion(marketCode, code);
  const row = await insertServiceArea({
    marketCode,
    code,
    name,
    version,
    status: 'draft',
    geometry,
    policy: PICKUP_AND_DROPOFF_POLICY,
    enforcementEnabled: false,
    sourceLabel: input.sourceLabel?.trim() || null,
    sourceUrl: input.sourceUrl?.trim() || null,
    approvedAt: null,
  });
  clearServiceAreaCache();
  return row;
}

export async function activateServiceArea(id: string): Promise<ServiceArea> {
  const current = await findServiceAreaById(id);
  if (!current) {
    throw new ServiceAreaActivationError('SERVICE_AREA_NOT_FOUND', 'Service area not found', 404);
  }
  if (normalizeMarketCode(current.marketCode) === UNRESTRICTED_MARKET_CODE) {
    throw new ServiceAreaActivationError(
      'MARKET_NOT_GEOFENCED',
      'Bangladesh rides are not polygon-restricted'
    );
  }
  const geometry = validateServiceAreaGeometry(current.geometry);
  const updated = await activateServiceAreaRecord(id, geometry);
  if (!updated) {
    throw new ServiceAreaActivationError('SERVICE_AREA_NOT_FOUND', 'Service area not found', 404);
  }
  clearServiceAreaCache();
  return updated;
}
