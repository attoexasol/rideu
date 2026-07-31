import { computeRoute } from './googleMaps/googleMaps.client';
import { ComputedRoute, RouteLocation } from './googleMaps/types';

export type { ComputedRoute, RouteLocation };

export interface RoutePreviewInput {
  pickup: RouteLocation;
  dropoff: RouteLocation;
  stops?: RouteLocation[];
  travelMode?: 'DRIVE' | 'TWO_WHEELER';
  routePreference?: 'TRAFFIC_AWARE' | 'TRAFFIC_UNAWARE';
}

export async function previewRoute(input: RoutePreviewInput): Promise<ComputedRoute> {
  return computeRoute(input);
}

export function toRouteSummary(route: ComputedRoute) {
  return {
    distanceMeters: route.distanceMeters,
    distanceKm: route.distanceKm,
    durationSeconds: route.durationSeconds,
    durationMin: route.durationMin,
    encodedPolyline: route.encodedPolyline,
    routeBounds: route.routeBounds,
  };
}
