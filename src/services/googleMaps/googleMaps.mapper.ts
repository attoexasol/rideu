import { RouteBounds, LatLng, PlaceDetailsResult, AutocompletePrediction } from './types';

interface AddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

export function parseAddressComponents(components: AddressComponent[] = []): {
  city: string | null;
  district: string | null;
  country: string | null;
  countryCode: string | null;
  postalCode: string | null;
} {
  const find = (...types: string[]) =>
    components.find((c) => types.some((t) => c.types.includes(t)));

  const city =
    find('locality')?.long_name ??
    find('administrative_area_level_2')?.long_name ??
    find('sublocality', 'sublocality_level_1')?.long_name ??
    null;

  const district =
    find('administrative_area_level_2')?.long_name ??
    find('administrative_area_level_1')?.long_name ??
    null;

  const countryComp = find('country');
  const postal = find('postal_code');

  return {
    city,
    district,
    country: countryComp?.long_name ?? null,
    countryCode: countryComp?.short_name ?? null,
    postalCode: postal?.long_name ?? null,
  };
}

export function mapAutocompletePrediction(prediction: {
  place_id: string;
  structured_formatting?: { main_text?: string; secondary_text?: string };
  description?: string;
  types?: string[];
}): AutocompletePrediction {
  const label = prediction.structured_formatting?.main_text ?? prediction.description ?? '';
  const secondaryText = prediction.structured_formatting?.secondary_text ?? null;

  return {
    placeId: prediction.place_id,
    label,
    secondaryText,
    address: prediction.description ?? null,
    latitude: null,
    longitude: null,
    types: prediction.types ?? [],
    city: null,
    country: null,
    countryCode: null,
  };
}

export function mapPlaceDetailsResult(result: {
  place_id: string;
  name?: string;
  formatted_address?: string;
  geometry?: { location?: { lat: number; lng: number } };
  address_components?: AddressComponent[];
  types?: string[];
}): PlaceDetailsResult {
  const components = parseAddressComponents(result.address_components ?? []);
  const lat = result.geometry?.location?.lat ?? 0;
  const lng = result.geometry?.location?.lng ?? 0;

  return {
    placeId: result.place_id,
    label: result.name ?? result.formatted_address ?? '',
    address: result.formatted_address ?? '',
    latitude: lat,
    longitude: lng,
    city: components.city,
    district: components.district,
    country: components.country,
    countryCode: components.countryCode,
    postalCode: components.postalCode,
    types: result.types ?? [],
  };
}

export function mapGeocodeResult(result: {
  place_id: string;
  formatted_address: string;
  geometry: { location: { lat: number; lng: number } };
  address_components?: AddressComponent[];
  types?: string[];
}): PlaceDetailsResult {
  const components = parseAddressComponents(result.address_components ?? []);
  return {
    placeId: result.place_id,
    label: result.formatted_address.split(',')[0]?.trim() || result.formatted_address,
    address: result.formatted_address,
    latitude: result.geometry.location.lat,
    longitude: result.geometry.location.lng,
    city: components.city,
    district: components.district,
    country: components.country,
    countryCode: components.countryCode,
    postalCode: components.postalCode,
    types: result.types ?? [],
  };
}

export function mapGoogleViewport(viewport?: {
  northeast?: { latitude?: number; longitude?: number; lat?: number; lng?: number };
  southwest?: { latitude?: number; longitude?: number; lat?: number; lng?: number };
}): RouteBounds | null {
  if (!viewport?.northeast || !viewport?.southwest) return null;

  const ne = viewport.northeast;
  const sw = viewport.southwest;

  return {
    northeast: {
      latitude: ne.latitude ?? ne.lat ?? 0,
      longitude: ne.longitude ?? ne.lng ?? 0,
    },
    southwest: {
      latitude: sw.latitude ?? sw.lat ?? 0,
      longitude: sw.longitude ?? sw.lng ?? 0,
    },
  };
}

export function boundsFromCoordinates(points: LatLng[]): RouteBounds {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const p of points) {
    minLat = Math.min(minLat, p.latitude);
    maxLat = Math.max(maxLat, p.latitude);
    minLng = Math.min(minLng, p.longitude);
    maxLng = Math.max(maxLng, p.longitude);
  }

  return {
    northeast: { latitude: maxLat, longitude: maxLng },
    southwest: { latitude: minLat, longitude: minLng },
  };
}

export function roundCoordinate(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function roundKm(km: number): number {
  return Math.round(km * 100) / 100;
}

export function metersToKm(meters: number): number {
  return roundKm(meters / 1000);
}

export function secondsToMinutes(seconds: number): number {
  return Math.ceil(seconds / 60);
}

export function parseDurationSeconds(duration: string | undefined): number {
  if (!duration) return 0;
  const match = duration.match(/^(\d+)s$/);
  return match ? parseInt(match[1], 10) : 0;
}

export function maskPlateNumber(plate: string | null | undefined): string | null {
  if (!plate) return null;
  const trimmed = plate.trim();
  if (trimmed.length <= 4) return '****';
  const visible = trimmed.slice(0, Math.min(4, trimmed.length - 2));
  return `${visible}****`;
}
