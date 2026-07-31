/**
 * Google Maps configuration for passenger app (server-side only).
 */

export interface GoogleMapsConfig {
  apiKey: string;
  region: string;
  language: string;
  defaultCountry: string;
  requestTimeoutMs: number;
  cacheTtlSeconds: number;
  autocompleteMinLength: number;
  autocompleteMaxLength: number;
  autocompleteMaxResults: number;
  maxRouteStops: number;
}

function parseEnvInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getGoogleMapsConfig(): GoogleMapsConfig {
  return {
    apiKey: process.env.GOOGLE_MAPS_API_KEY?.trim() ?? '',
    region: process.env.GOOGLE_MAPS_REGION?.trim() || 'BD',
    language: process.env.GOOGLE_MAPS_LANGUAGE?.trim() || 'en',
    defaultCountry: process.env.GOOGLE_MAPS_DEFAULT_COUNTRY?.trim() || 'BD',
    requestTimeoutMs: parseEnvInt(process.env.GOOGLE_MAPS_REQUEST_TIMEOUT_MS, 8000),
    cacheTtlSeconds: parseEnvInt(process.env.GOOGLE_MAPS_CACHE_TTL_SECONDS, 300),
    autocompleteMinLength: parseEnvInt(process.env.GOOGLE_MAPS_AUTOCOMPLETE_MIN_LENGTH, 2),
    autocompleteMaxLength: parseEnvInt(process.env.GOOGLE_MAPS_AUTOCOMPLETE_MAX_LENGTH, 200),
    autocompleteMaxResults: parseEnvInt(process.env.GOOGLE_MAPS_AUTOCOMPLETE_MAX_RESULTS, 8),
    maxRouteStops: parseEnvInt(process.env.GOOGLE_MAPS_MAX_ROUTE_STOPS, 3),
  };
}

export function isGoogleMapsConfigured(): boolean {
  return Boolean(getGoogleMapsConfig().apiKey);
}
