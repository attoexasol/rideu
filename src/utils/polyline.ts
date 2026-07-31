export interface PolylineLatLng {
  latitude: number;
  longitude: number;
}

export interface PolylineBounds {
  northeast: PolylineLatLng;
  southwest: PolylineLatLng;
}

/**
 * Decode a Google encoded polyline into lat/lng points.
 * @see https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function decodeGooglePolyline(encoded: string): PolylineLatLng[] {
  if (!encoded || typeof encoded !== 'string') return [];

  const coordinates: PolylineLatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    coordinates.push({
      latitude: lat / 1e5,
      longitude: lng / 1e5,
    });
  }

  return coordinates;
}

/** Bounds from an encoded Google polyline, or null when geometry is empty/invalid. */
export function boundsFromEncodedPolyline(
  encoded: string | null | undefined
): PolylineBounds | null {
  if (!encoded) return null;
  const points = decodeGooglePolyline(encoded);
  if (points.length === 0) return null;

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
