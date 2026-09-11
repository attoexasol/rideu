/**
 * Backend authority for airport trip classification.
 * Coordinates + radius geofence are primary. Place ID is an extra positive
 * signal, never address-text matching. Polygon geofence_type is reserved.
 */

import {
  getTransactionCurrency,
  isAirportFeeChargeable,
  normalizeCurrencyCode,
} from '../constants/payment';
import { logger } from '../middleware/logger';
import { listActiveAirports } from '../repositories/airport.repository';
import type { Airport } from '../db/schema/airports';
import { haversineMeters } from '../utils/geo';
import { minorToMajorString } from '../utils/money';

export type AirportTripType = 'pickup' | 'dropoff';

export type AirportMatchSource = 'geofence' | 'place_id' | 'geofence_and_place_id';

export interface AirportPointMatch {
  airport: Airport;
  distanceMeters: number;
  matchedBy: AirportMatchSource;
  placeIdMatched: boolean;
}

export interface AirportTripDetection {
  airportId: string | null;
  airportCode: string | null;
  airportName: string | null;
  tripType: AirportTripType | null;
  feeMinor: number;
  feeMajor: string;
  currency: string | null;
  matchedBy: AirportMatchSource | null;
  bothEndsSameAirport: boolean;
  crossAirport: boolean;
  ambiguous: boolean;
  currencyMismatch: boolean;
}

export const EMPTY_AIRPORT_DETECTION: AirportTripDetection = {
  airportId: null,
  airportCode: null,
  airportName: null,
  tripType: null,
  feeMinor: 0,
  feeMajor: '0.00',
  currency: null,
  matchedBy: null,
  bothEndsSameAirport: false,
  crossAirport: false,
  ambiguous: false,
  currencyMismatch: false,
};

function parseCoord(value: string | number): number {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : NaN;
}

function pointMatchesAirport(
  latitude: number,
  longitude: number,
  placeId: string | null | undefined,
  airport: Airport
): AirportPointMatch | null {
  const centerLat = parseCoord(airport.centerLatitude);
  const centerLng = parseCoord(airport.centerLongitude);
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) return null;

  const distanceMeters = haversineMeters(latitude, longitude, centerLat, centerLng);
  const inGeofence =
    airport.geofenceType === 'radius' && distanceMeters <= airport.radiusMeters;
  const placeIdMatched = Boolean(
    placeId && airport.googlePlaceId && placeId === airport.googlePlaceId
  );

  // Coordinates are primary. Place ID is an additional positive inside signal
  // when the client already supplied a Place ID (pin-drops may omit it).
  if (!inGeofence && !placeIdMatched) return null;

  const matchedBy: AirportMatchSource =
    inGeofence && placeIdMatched
      ? 'geofence_and_place_id'
      : placeIdMatched && !inGeofence
        ? 'place_id'
        : 'geofence';

  return { airport, distanceMeters, matchedBy, placeIdMatched };
}

function resolveOverlappingMatches(
  matches: AirportPointMatch[],
  placeId?: string | null
): { match: AirportPointMatch | null; ambiguous: boolean } {
  if (matches.length === 0) return { match: null, ambiguous: false };
  if (matches.length === 1) return { match: matches[0], ambiguous: false };

  if (placeId) {
    const byPlace = matches.filter((m) => m.placeIdMatched);
    if (byPlace.length === 1) return { match: byPlace[0], ambiguous: false };
    if (byPlace.length > 1) return { match: null, ambiguous: true };
  }

  const sorted = [...matches].sort((a, b) => a.distanceMeters - b.distanceMeters);
  const nearest = sorted[0];
  const second = sorted[1];
  if (nearest && second && nearest.distanceMeters < second.distanceMeters) {
    return { match: nearest, ambiguous: false };
  }
  return { match: null, ambiguous: true };
}

function toDetection(
  match: AirportPointMatch,
  tripType: AirportTripType,
  transactionCurrency: string,
  extras: Partial<AirportTripDetection> = {}
): AirportTripDetection {
  const rawFeeMinor = tripType === 'pickup' ? match.airport.pickupFeeMinor : match.airport.dropoffFeeMinor;
  const chargeable = isAirportFeeChargeable(match.airport.currency, transactionCurrency);
  if (!chargeable) {
    logger.warn({
      type: 'airport.detection.currency_mismatch',
      airportId: match.airport.id,
      airportCode: match.airport.code,
      airportCurrency: normalizeCurrencyCode(match.airport.currency),
      transactionCurrency: normalizeCurrencyCode(transactionCurrency),
      tripType,
      withheldFeeMinor: rawFeeMinor,
    });
  }
  const feeMinor = chargeable ? rawFeeMinor : 0;
  return {
    airportId: match.airport.id,
    airportCode: match.airport.code,
    airportName: match.airport.name,
    tripType,
    feeMinor,
    feeMajor: minorToMajorString(feeMinor),
    currency: match.airport.currency,
    matchedBy: match.matchedBy,
    bothEndsSameAirport: false,
    crossAirport: false,
    ambiguous: false,
    currencyMismatch: !chargeable,
    ...extras,
  };
}

export async function detectAirportTrip(input: {
  pickupLatitude: number;
  pickupLongitude: number;
  pickupPlaceId?: string | null;
  dropoffLatitude: number;
  dropoffLongitude: number;
  dropoffPlaceId?: string | null;
  transactionCurrency?: string | null;
}): Promise<AirportTripDetection> {
  const transactionCurrency = normalizeCurrencyCode(
    input.transactionCurrency ?? getTransactionCurrency()
  );
  const airports = await listActiveAirports();
  if (!airports.length) return { ...EMPTY_AIRPORT_DETECTION };

  const pickupMatches: AirportPointMatch[] = [];
  const dropoffMatches: AirportPointMatch[] = [];
  for (const airport of airports) {
    const pickup = pointMatchesAirport(
      input.pickupLatitude,
      input.pickupLongitude,
      input.pickupPlaceId,
      airport
    );
    if (pickup) pickupMatches.push(pickup);
    const dropoff = pointMatchesAirport(
      input.dropoffLatitude,
      input.dropoffLongitude,
      input.dropoffPlaceId,
      airport
    );
    if (dropoff) dropoffMatches.push(dropoff);
  }

  const pickupResolved = resolveOverlappingMatches(pickupMatches, input.pickupPlaceId);
  const dropoffResolved = resolveOverlappingMatches(dropoffMatches, input.dropoffPlaceId);

  if (pickupResolved.ambiguous || dropoffResolved.ambiguous) {
    logger.warn({
      type: 'airport.detection.ambiguous',
      pickupMatchCount: pickupMatches.length,
      dropoffMatchCount: dropoffMatches.length,
    });
    return { ...EMPTY_AIRPORT_DETECTION, ambiguous: true };
  }

  const pickup = pickupResolved.match;
  const dropoff = dropoffResolved.match;

  if (pickup && dropoff && pickup.airport.id !== dropoff.airport.id) {
    logger.warn({
      type: 'airport.detection.cross_airport',
      pickupAirportId: pickup.airport.id,
      pickupAirportCode: pickup.airport.code,
      dropoffAirportId: dropoff.airport.id,
      dropoffAirportCode: dropoff.airport.code,
    });
    return {
      ...EMPTY_AIRPORT_DETECTION,
      crossAirport: true,
    };
  }

  if (pickup && dropoff && pickup.airport.id === dropoff.airport.id) {
    // Policy assumption (needs client confirmation): both ends inside the
    // same airport → classify as pickup and charge pickup fee once.
    logger.info({
      type: 'airport.detection.both_inside_same_airport',
      airportId: pickup.airport.id,
      airportCode: pickup.airport.code,
      appliedTripType: 'pickup',
    });
    return toDetection(pickup, 'pickup', transactionCurrency, { bothEndsSameAirport: true });
  }

  if (pickup && !dropoff) {
    return toDetection(pickup, 'pickup', transactionCurrency);
  }

  if (dropoff && !pickup) {
    return toDetection(dropoff, 'dropoff', transactionCurrency);
  }

  return { ...EMPTY_AIRPORT_DETECTION };
}

export function airportPublicView(detection: AirportTripDetection): {
  id: string;
  code: string;
  name: string;
  tripType: AirportTripType;
} | null {
  if (detection.currencyMismatch) return null;
  if (!detection.airportId || !detection.tripType || !detection.airportCode || !detection.airportName) {
    return null;
  }
  return {
    id: detection.airportId,
    code: detection.airportCode,
    name: detection.airportName,
    tripType: detection.tripType,
  };
}
