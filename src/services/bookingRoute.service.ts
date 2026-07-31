/**
 * Shared driver/passenger-safe booking route DTO.
 *
 * Bounds strategy (Option A): derive southwest/northeast from the stored
 * Google encoded polyline via decode. Bounds are not persisted as separate
 * columns; this keeps geometry authoritative in route_encoded_polyline.
 */
import { logger } from '../middleware/logger';
import { redis } from '../config/redis';
import { updateBooking } from '../repositories/booking.repository';
import { previewRoute } from './route.service';
import { boundsFromEncodedPolyline } from '../utils/polyline';
import type { RouteBounds } from './googleMaps/types';

const ROUTE_FILL_TIMEOUT_MS = parseInt(process.env.BOOKING_ROUTE_FILL_TIMEOUT_MS || '8000', 10);
const ROUTE_FILL_LOCK_TTL_SECONDS = 30;

export interface BookingRouteDto {
  encodedPolyline: string | null;
  distanceMeters: number | null;
  durationSeconds: number | null;
  /** Legacy compatibility */
  distanceKm: number | null;
  /** Legacy compatibility */
  durationMin: number | null;
  bounds: RouteBounds | null;
}

export interface BookingRouteSource {
  id: string;
  routeEncodedPolyline?: string | null;
  estimatedDistanceKm?: string | number | null;
  estimatedDurationMin?: number | null;
  pickupLatitude: string | number;
  pickupLongitude: string | number;
  pickupAddress?: string | null;
  dropoffLatitude: string | number;
  dropoffLongitude: string | number;
  dropoffAddress?: string | null;
}

function parseKm(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

export function kmToMeters(distanceKm: number | null | undefined): number | null {
  if (distanceKm == null || !Number.isFinite(distanceKm)) return null;
  return Math.round(distanceKm * 1000);
}

export function minutesToSeconds(durationMin: number | null | undefined): number | null {
  if (durationMin == null || !Number.isFinite(durationMin)) return null;
  return Math.round(durationMin * 60);
}

export function serializeBookingRoute(source: {
  encodedPolyline?: string | null;
  distanceKm?: number | null;
  durationMin?: number | null;
  distanceMeters?: number | null;
  durationSeconds?: number | null;
  bounds?: RouteBounds | null;
}): BookingRouteDto | null {
  const encodedPolyline = source.encodedPolyline?.length ? source.encodedPolyline : null;
  const distanceKm =
    source.distanceKm ??
    (source.distanceMeters != null ? source.distanceMeters / 1000 : null);
  const durationMin =
    source.durationMin ??
    (source.durationSeconds != null ? Math.round(source.durationSeconds / 60) : null);

  const distanceMeters =
    source.distanceMeters ?? kmToMeters(distanceKm);
  const durationSeconds =
    source.durationSeconds ?? minutesToSeconds(durationMin);

  const hasGeometry = Boolean(encodedPolyline);
  const hasMetrics = distanceMeters != null || durationSeconds != null;
  if (!hasGeometry && !hasMetrics) {
    return null;
  }

  const bounds =
    source.bounds ?? (encodedPolyline ? boundsFromEncodedPolyline(encodedPolyline) : null);

  return {
    encodedPolyline,
    distanceMeters,
    durationSeconds,
    distanceKm: distanceKm != null ? Math.round(distanceKm * 1000) / 1000 : null,
    durationMin: durationMin != null ? Math.round(durationMin) : null,
    bounds,
  };
}

function routeFromBookingRow(booking: BookingRouteSource): BookingRouteDto | null {
  return serializeBookingRoute({
    encodedPolyline: booking.routeEncodedPolyline,
    distanceKm: parseKm(booking.estimatedDistanceKm),
    durationMin: booking.estimatedDurationMin ?? null,
  });
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Prefer stored geometry. If polyline is missing, generate once via Google Routes,
 * persist, and return. Failures yield null without throwing to callers.
 */
export async function resolveBookingRoute(
  booking: BookingRouteSource,
  options: { allowGenerate?: boolean } = {}
): Promise<BookingRouteDto | null> {
  const allowGenerate = options.allowGenerate !== false;
  const existing = routeFromBookingRow(booking);

  if (existing?.encodedPolyline) {
    logger.info({
      event: 'booking.route.resolve',
      bookingId: booking.id,
      routePresent: true,
      source: 'stored',
    });
    return existing;
  }

  if (!allowGenerate) {
    logger.info({
      event: 'booking.route.resolve',
      bookingId: booking.id,
      routePresent: Boolean(existing),
      source: 'stored_metrics_only',
    });
    return existing;
  }

  const lockKey = `booking:route:fill:${booking.id}`;
  let locked = false;
  try {
    const lock = await redis.set(lockKey, '1', 'EX', ROUTE_FILL_LOCK_TTL_SECONDS, 'NX');
    locked = lock === 'OK';
    if (!locked) {
      // Another request is filling — return whatever we have (metrics-only ok)
      return existing;
    }

    const route = await withTimeout(
      previewRoute({
        pickup: {
          latitude: parseFloat(String(booking.pickupLatitude)),
          longitude: parseFloat(String(booking.pickupLongitude)),
          address: booking.pickupAddress ?? undefined,
        },
        dropoff: {
          latitude: parseFloat(String(booking.dropoffLatitude)),
          longitude: parseFloat(String(booking.dropoffLongitude)),
          address: booking.dropoffAddress ?? undefined,
        },
      }),
      ROUTE_FILL_TIMEOUT_MS,
      'booking_route_fill'
    );

    await updateBooking(booking.id, {
      routeEncodedPolyline: route.encodedPolyline,
      estimatedDistanceKm: String(route.distanceKm),
      estimatedDurationMin: route.durationMin,
    });

    const dto = serializeBookingRoute({
      encodedPolyline: route.encodedPolyline,
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      distanceKm: route.distanceKm,
      durationMin: route.durationMin,
      bounds: route.routeBounds,
    });

    logger.info({
      event: 'booking.route.resolve',
      bookingId: booking.id,
      routePresent: Boolean(dto?.encodedPolyline),
      source: 'generated_once',
    });

    return dto;
  } catch (err) {
    logger.warn({
      event: 'booking.route.resolve',
      bookingId: booking.id,
      routePresent: Boolean(existing),
      source: 'fallback_failed',
      error: err instanceof Error ? err.message : String(err),
    });
    return existing;
  } finally {
    if (locked) {
      await redis.del(lockKey).catch(() => undefined);
    }
  }
}
