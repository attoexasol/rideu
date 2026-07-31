/**
 * Google Maps — passenger app only (places, geocoding, routing).
 * Admin panel map uses Mapbox via mapboxMatching.ts and /api/locations routes.
 */

export {
  autocompletePlaces,
  fetchPlaceDetails,
  getPlaceDetails,
  reverseGeocode,
  computeRoute,
  getNearbyPickupSpots,
  getDistanceMatrixKm,
  isGoogleMapsConfigured,
} from './googleMaps/googleMaps.client';

export type { LatLng } from './googleMaps/types';

export interface PlaceSuggestion {
  placeId: string;
  label: string;
  address: string;
  latitude: number;
  longitude: number;
}
