import axios, { AxiosError } from 'axios';
import { getGoogleMapsConfig, isGoogleMapsConfigured } from '../../config/googleMaps';
import { mapsCache } from '../../config/redis';
import { logger } from '../../middleware/logger';
import { GoogleMapsServiceError, mapGoogleStatusToError } from './errors';
import {
  mapAutocompletePrediction,
  mapGeocodeResult,
  mapGoogleViewport,
  mapPlaceDetailsResult,
  boundsFromCoordinates,
  metersToKm,
  secondsToMinutes,
  parseDurationSeconds,
  roundCoordinate,
} from './googleMaps.mapper';
import {
  AutocompletePrediction,
  ComputedRoute,
  LatLng,
  PickupSpot,
  PlaceDetailsResult,
  RouteLocation,
} from './types';

export { isGoogleMapsConfigured };

const ISO_ALPHA2 = /^[A-Za-z]{2}$/;

export function normalizePlacesCountryCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!ISO_ALPHA2.test(trimmed)) return undefined;
  return trimmed.toUpperCase();
}

export function buildAutocompleteProviderParams(
  input: string,
  options?: {
    lat?: number;
    lng?: number;
    city?: string;
    country?: string;
    sessionToken?: string;
  },
  language = 'en'
): Record<string, string> {
  const params: Record<string, string> = {
    input: input.trim(),
    types: 'establishment|geocode',
    language,
  };

  const country = normalizePlacesCountryCode(options?.country);
  if (country) {
    params.components = `country:${country}`;
  }
  if (options?.city) {
    const locality = options.city.trim();
    if (locality) {
      params.components = params.components
        ? `${params.components}|locality:${locality}`
        : `locality:${locality}`;
    }
  }
  if (options?.lat != null && options?.lng != null) {
    params.location = `${options.lat},${options.lng}`;
    params.radius = '50000';
  }
  if (options?.sessionToken) {
    params.sessiontoken = options.sessionToken;
  }

  return params;
}

function assertConfigured(): void {
  if (!isGoogleMapsConfigured()) {
    throw new GoogleMapsServiceError(
      'GOOGLE_MAPS_CONFIG_ERROR',
      'Map services are temporarily unavailable.',
      503
    );
  }
}

function getTimeout(): number {
  return getGoogleMapsConfig().requestTimeoutMs;
}

function getCacheTtl(): number {
  return getGoogleMapsConfig().cacheTtlSeconds;
}

function handleAxiosError(error: unknown, operation: string): never {
  if (error instanceof GoogleMapsServiceError) throw error;

  if (axios.isAxiosError(error)) {
    const axErr = error as AxiosError;
    if (axErr.code === 'ECONNABORTED' || axErr.code === 'ETIMEDOUT') {
      logger.warn({ operation, err: axErr.code, durationMs: axErr.config?.timeout }, 'Google Maps request timeout');
      throw new GoogleMapsServiceError(
        'GOOGLE_MAPS_TIMEOUT',
        'Map services timed out. Please try again.',
        504
      );
    }
    const status = axErr.response?.status;
    if (status === 429) {
      throw new GoogleMapsServiceError(
        'GOOGLE_MAPS_QUOTA_EXCEEDED',
        'Map services quota exceeded. Please try again later.',
        503
      );
    }
  }

  logger.error(
    { operation, err: error instanceof Error ? error.message : 'unknown' },
    'Google Maps provider error'
  );
  throw new GoogleMapsServiceError(
    'GOOGLE_MAPS_PROVIDER_ERROR',
    'Map services are temporarily unavailable.',
    503
  );
}

async function getLegacy<T>(url: string, params: Record<string, string>): Promise<T> {
  assertConfigured();
  const config = getGoogleMapsConfig();
  const startedAt = Date.now();
  try {
    const { data } = await axios.get<T>(url, {
      params: { ...params, key: config.apiKey },
      timeout: getTimeout(),
    });
    logger.info({
      event: 'google_maps.external',
      operation: url,
      durationMs: Date.now() - startedAt,
      status: 'success',
    });
    return data;
  } catch (error) {
    logger.warn({
      event: 'google_maps.external',
      operation: url,
      durationMs: Date.now() - startedAt,
      status: 'error',
    });
    handleAxiosError(error, url);
  }
}

export async function autocompletePlaces(
  input: string,
  options?: {
    lat?: number;
    lng?: number;
    city?: string;
    country?: string;
    sessionToken?: string;
  }
): Promise<AutocompletePrediction[]> {
  const config = getGoogleMapsConfig();
  const params = buildAutocompleteProviderParams(input, options, config.language);

  const data = await getLegacy<{
    status: string;
    predictions?: Array<{
      place_id: string;
      description?: string;
      structured_formatting?: { main_text?: string; secondary_text?: string };
      types?: string[];
    }>;
  }>('https://maps.googleapis.com/maps/api/place/autocomplete/json', params);

  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw mapGoogleStatusToError(data.status);
  }

  return (data.predictions ?? [])
    .slice(0, config.autocompleteMaxResults)
    .map(mapAutocompletePrediction);
}

export async function fetchPlaceDetails(
  placeId: string,
  sessionToken?: string
): Promise<PlaceDetailsResult> {
  const cacheKey = `place-details:${placeId}`;
  const cached = await mapsCache.get<PlaceDetailsResult>(cacheKey);
  if (cached) return cached;

  const config = getGoogleMapsConfig();
  const params: Record<string, string> = {
    place_id: placeId,
    fields: 'place_id,name,formatted_address,geometry,address_components,types',
    language: config.language,
  };
  if (sessionToken) {
    params.sessiontoken = sessionToken;
  }

  const data = await getLegacy<{
    status: string;
    result?: Parameters<typeof mapPlaceDetailsResult>[0];
  }>('https://maps.googleapis.com/maps/api/place/details/json', params);

  if (data.status === 'NOT_FOUND' || data.status === 'INVALID_REQUEST') {
    throw new GoogleMapsServiceError('INVALID_PLACE_ID', 'Invalid place ID.', 400);
  }
  if (data.status !== 'OK' || !data.result) {
    throw mapGoogleStatusToError(data.status);
  }

  const mapped = mapPlaceDetailsResult(data.result);
  await mapsCache.set(cacheKey, mapped, getCacheTtl());
  return mapped;
}

export async function reverseGeocode(lat: number, lng: number): Promise<PlaceDetailsResult> {
  const roundedLat = roundCoordinate(lat, 5);
  const roundedLng = roundCoordinate(lng, 5);
  const cacheKey = `reverse-geocode:${roundedLat}:${roundedLng}`;
  const cached = await mapsCache.get<PlaceDetailsResult>(cacheKey);
  if (cached) {
    return { ...cached, latitude: lat, longitude: lng };
  }

  const config = getGoogleMapsConfig();
  const data = await getLegacy<{
    status: string;
    results?: Array<Parameters<typeof mapGeocodeResult>[0]>;
  }>('https://maps.googleapis.com/maps/api/geocode/json', {
    latlng: `${lat},${lng}`,
    language: config.language,
    result_type: 'street_address|premise|subpremise|route|neighborhood|locality',
  });

  if (data.status !== 'OK' || !data.results?.length) {
    const fallback: PlaceDetailsResult = {
      placeId: '',
      label: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      latitude: lat,
      longitude: lng,
      city: null,
      district: null,
      country: null,
      countryCode: null,
      postalCode: null,
      types: [],
    };
    return fallback;
  }

  const best = mapGeocodeResult(data.results[0]);
  const result = { ...best, latitude: lat, longitude: lng };
  await mapsCache.set(cacheKey, result, getCacheTtl());
  return result;
}

function buildRouteCacheKey(
  pickup: LatLng,
  dropoff: LatLng,
  stops: LatLng[],
  travelMode: string,
  routePreference: string
): string {
  const fmt = (p: LatLng) => `${roundCoordinate(p.latitude, 5)},${roundCoordinate(p.longitude, 5)}`;
  const stopKey = stops.map(fmt).join('|');
  return `route:${fmt(pickup)}:${fmt(dropoff)}:${stopKey}:${travelMode}:${routePreference}`;
}

export async function computeRoute(input: {
  pickup: RouteLocation;
  dropoff: RouteLocation;
  stops?: RouteLocation[];
  travelMode?: 'DRIVE' | 'TWO_WHEELER';
  routePreference?: 'TRAFFIC_AWARE' | 'TRAFFIC_UNAWARE';
}): Promise<ComputedRoute> {
  assertConfigured();
  const config = getGoogleMapsConfig();
  const travelMode = input.travelMode ?? 'DRIVE';
  const routePreference = input.routePreference ?? 'TRAFFIC_AWARE';
  const stops = input.stops ?? [];

  if (stops.length > config.maxRouteStops) {
    throw new GoogleMapsServiceError(
      'GOOGLE_MAPS_PROVIDER_ERROR',
      `Maximum ${config.maxRouteStops} intermediate stops allowed.`,
      400
    );
  }

  const cacheKey = buildRouteCacheKey(
    input.pickup,
    input.dropoff,
    stops,
    travelMode,
    routePreference
  );
  const cached = await mapsCache.get<ComputedRoute>(cacheKey);
  if (cached) return cached;

  const toWaypoint = (loc: RouteLocation) => ({
    location: {
      latLng: {
        latitude: loc.latitude,
        longitude: loc.longitude,
      },
    },
  });

  const body = {
    origin: toWaypoint(input.pickup),
    destination: toWaypoint(input.dropoff),
    intermediates: stops.map(toWaypoint),
    travelMode,
    routingPreference: routePreference,
    computeAlternativeRoutes: false,
    languageCode: config.language,
    regionCode: config.region,
  };

  const fieldMask = [
    'routes.duration',
    'routes.staticDuration',
    'routes.distanceMeters',
    'routes.polyline.encodedPolyline',
    'routes.viewport',
    'routes.legs.duration',
    'routes.legs.staticDuration',
    'routes.legs.distanceMeters',
    'routes.legs.polyline.encodedPolyline',
    'routes.legs.startLocation',
    'routes.legs.endLocation',
  ].join(',');

  let data: {
    routes?: Array<{
      duration?: string;
      staticDuration?: string;
      distanceMeters?: number;
      polyline?: { encodedPolyline?: string };
      viewport?: Parameters<typeof mapGoogleViewport>[0];
      legs?: Array<{
        duration?: string;
        staticDuration?: string;
        distanceMeters?: number;
        polyline?: { encodedPolyline?: string };
        startLocation?: { latLng?: { latitude: number; longitude: number } };
        endLocation?: { latLng?: { latitude: number; longitude: number } };
      }>;
    }>;
  };

  const startedAt = Date.now();
  try {
    const response = await axios.post(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      body,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': config.apiKey,
          'X-Goog-FieldMask': fieldMask,
        },
        timeout: getTimeout(),
      }
    );
    logger.info({
      event: 'google_maps.external',
      operation: 'computeRoutes',
      durationMs: Date.now() - startedAt,
      status: 'success',
    });
    data = response.data;
  } catch (error) {
    logger.warn({
      event: 'google_maps.external',
      operation: 'computeRoutes',
      durationMs: Date.now() - startedAt,
      status: 'error',
    });
    handleAxiosError(error, 'computeRoutes');
  }

  const route = data.routes?.[0];
  if (!route?.polyline?.encodedPolyline) {
    throw new GoogleMapsServiceError(
      'NO_ROUTE_FOUND',
      'No drivable route was found between the selected locations.',
      404
    );
  }

  const durationSeconds = parseDurationSeconds(route.duration);
  const staticDurationSeconds = route.staticDuration
    ? parseDurationSeconds(route.staticDuration)
    : null;
  const trafficDelaySeconds =
    staticDurationSeconds != null ? Math.max(0, durationSeconds - staticDurationSeconds) : null;

  const allPoints: LatLng[] = [input.pickup, ...stops, input.dropoff];

  const routeBounds = mapGoogleViewport(route.viewport) ?? boundsFromCoordinates(allPoints);

  const legs =
    route.legs?.map((leg) => ({
      start: {
        latitude: leg.startLocation?.latLng?.latitude ?? input.pickup.latitude,
        longitude: leg.startLocation?.latLng?.longitude ?? input.pickup.longitude,
      },
      end: {
        latitude: leg.endLocation?.latLng?.latitude ?? input.dropoff.latitude,
        longitude: leg.endLocation?.latLng?.longitude ?? input.dropoff.longitude,
      },
      distanceMeters: leg.distanceMeters ?? 0,
      durationSeconds: parseDurationSeconds(leg.duration),
      encodedPolyline: leg.polyline?.encodedPolyline,
    })) ?? [];

  const computed: ComputedRoute = {
    pickup: {
      latitude: input.pickup.latitude,
      longitude: input.pickup.longitude,
      address: input.pickup.address,
      placeId: input.pickup.placeId,
    },
    dropoff: {
      latitude: input.dropoff.latitude,
      longitude: input.dropoff.longitude,
      address: input.dropoff.address,
      placeId: input.dropoff.placeId,
    },
    stops: stops.map((s) => ({
      latitude: s.latitude,
      longitude: s.longitude,
      address: s.address,
      placeId: s.placeId,
    })),
    distanceMeters: route.distanceMeters ?? 0,
    distanceKm: metersToKm(route.distanceMeters ?? 0),
    durationSeconds,
    durationMin: secondsToMinutes(durationSeconds),
    staticDurationSeconds,
    trafficDelaySeconds,
    encodedPolyline: route.polyline.encodedPolyline,
    routeBounds,
    legs,
    provider: 'google',
    calculatedAt: new Date().toISOString(),
  };

  await mapsCache.set(cacheKey, computed, getCacheTtl());
  return computed;
}

export async function getNearbyPickupSpots(
  lat: number,
  lng: number,
  addressLabel?: string
): Promise<PickupSpot[]> {
  const label = addressLabel?.trim() || 'Selected location';
  return [
    {
      id: null,
      label,
      address: label,
      latitude: lat,
      longitude: lng,
      distanceMeters: 0,
      source: 'selected_location',
    },
  ];
}

/** @deprecated Use computeRoute — kept for internal migration only */
export async function getDistanceMatrixKm(
  origin: LatLng,
  destination: LatLng,
  waypoints: LatLng[] = []
): Promise<{ distanceKm: number; durationMin: number }> {
  const route = await computeRoute({
    pickup: { ...origin },
    dropoff: { ...destination },
    stops: waypoints.map((w) => ({ ...w })),
  });
  return { distanceKm: route.distanceKm, durationMin: route.durationMin };
}

/** Backward-compatible alias */
export async function getPlaceDetails(placeId: string): Promise<PlaceDetailsResult | null> {
  try {
    return await fetchPlaceDetails(placeId);
  } catch (e) {
    if (e instanceof GoogleMapsServiceError && e.code === 'INVALID_PLACE_ID') {
      return null;
    }
    throw e;
  }
}
