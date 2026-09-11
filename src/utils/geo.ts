/** Haversine distance in meters between two coordinates. */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return haversineKm(lat1, lon1, lat2, lon2) * 1000;
}

/** Haversine distance in kilometers between two coordinates. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Rough ETA in minutes from distance (avg 25 km/h in city traffic). */
export function estimateMinutesFromKm(distanceKm: number): number {
  const avgSpeedKmh = 25;
  return Math.max(1, Math.ceil((distanceKm / avgSpeedKmh) * 60));
}

export function normalizePhone(
  countryCode: string,
  phoneNumber: string
): {
  countryCode: string;
  phoneNumber: string;
  e164: string;
} {
  const cc = countryCode.startsWith('+') ? countryCode : `+${countryCode}`;
  const digits = phoneNumber.replace(/\D/g, '');
  return {
    countryCode: cc,
    phoneNumber: digits,
    e164: `${cc}${digits}`,
  };
}

export function generateBookingNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `RYD-${ts}-${rand}`;
}

export function generateShareToken(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).substring(2, 15)}`;
}
