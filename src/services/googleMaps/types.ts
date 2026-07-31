export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface RouteLocation extends LatLng {
  address?: string;
  placeId?: string;
}

export interface RouteBounds {
  northeast: LatLng;
  southwest: LatLng;
}

export interface RouteLeg {
  start: LatLng;
  end: LatLng;
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline?: string;
}

export interface ComputedRoute {
  pickup: RouteLocation;
  dropoff: RouteLocation;
  stops: RouteLocation[];
  distanceMeters: number;
  distanceKm: number;
  durationSeconds: number;
  durationMin: number;
  staticDurationSeconds: number | null;
  trafficDelaySeconds: number | null;
  encodedPolyline: string;
  routeBounds: RouteBounds;
  legs: RouteLeg[];
  provider: 'google';
  calculatedAt: string;
}

export interface AutocompletePrediction {
  placeId: string;
  label: string;
  secondaryText: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  types: string[];
  city: string | null;
  country: string | null;
  countryCode: string | null;
}

export interface PlaceDetailsResult {
  placeId: string;
  label: string;
  address: string;
  latitude: number;
  longitude: number;
  city: string | null;
  district: string | null;
  country: string | null;
  countryCode: string | null;
  postalCode: string | null;
  types: string[];
}

export interface GeocodedAddress extends PlaceDetailsResult {}

export interface PickupSpot {
  id: string | null;
  label: string;
  address: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  source: 'database' | 'selected_location';
}
