/**
 * Session Detection and Processing Utilities
 * Detects driving sessions based on time gaps and driver status
 */

interface LocationPoint {
  id: string;
  latitude: number;
  longitude: number;
  speed?: number;
  heading?: number;
  accuracy?: number;
  timestamp: string;
}

interface Session {
  id: string;
  startTime: Date;
  endTime: Date;
  points: LocationPoint[];
  duration: number; // in milliseconds
  distance?: number; // in meters
}

/**
 * Detect sessions from location history based on time gaps
 * A new session starts when there's a gap larger than the threshold
 */
export function detectSessions(
  locations: LocationPoint[],
  gapThresholdMinutes: number = 5
): Session[] {
  if (locations.length === 0) return [];

  const sessions: Session[] = [];
  let currentSession: LocationPoint[] = [];
  let sessionId = 1;

  // Sort locations by timestamp
  const sorted = [...locations].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  sorted.forEach((location, index) => {
    if (index === 0) {
      // First location starts a new session
      currentSession = [location];
    } else {
      const prevTime = new Date(sorted[index - 1].timestamp).getTime();
      const currTime = new Date(location.timestamp).getTime();
      const gapMs = currTime - prevTime;
      const gapMinutes = gapMs / (1000 * 60);

      if (gapMinutes > gapThresholdMinutes) {
        // Gap detected - save current session and start new one
        if (currentSession.length > 0) {
          const startTime = new Date(currentSession[0].timestamp);
          const endTime = new Date(currentSession[currentSession.length - 1].timestamp);

          sessions.push({
            id: `session-${sessionId}`,
            startTime,
            endTime,
            points: currentSession,
            duration: endTime.getTime() - startTime.getTime(),
          });
          sessionId++;
        }
        currentSession = [location];
      } else {
        // Continue current session
        currentSession.push(location);
      }
    }
  });

  // Save the last session
  if (currentSession.length > 0) {
    const startTime = new Date(currentSession[0].timestamp);
    const endTime = new Date(currentSession[currentSession.length - 1].timestamp);

    sessions.push({
      id: `session-${sessionId}`,
      startTime,
      endTime,
      points: currentSession,
      duration: endTime.getTime() - startTime.getTime(),
    });
  }

  return sessions;
}

/**
 * Simplify GPS points using Douglas-Peucker algorithm
 * Reduces point density while preserving shape
 */
export function simplifyPoints(
  points: LocationPoint[],
  tolerance: number = 0.00001 // ~1 meter at equator
): LocationPoint[] {
  if (points.length <= 2) return points;

  // Find the point with maximum distance from line segment
  let maxDist = 0;
  let maxIndex = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  // If max distance is greater than tolerance, recursively simplify
  if (maxDist > tolerance) {
    const leftPart = simplifyPoints(points.slice(0, maxIndex + 1), tolerance);
    const rightPart = simplifyPoints(points.slice(maxIndex), tolerance);

    // Remove duplicate point at the junction
    return [...leftPart.slice(0, -1), ...rightPart];
  } else {
    // All points between start and end can be removed
    return [points[0], points[points.length - 1]];
  }
}

/**
 * Calculate perpendicular distance from point to line segment
 */
function perpendicularDistance(
  point: LocationPoint,
  lineStart: LocationPoint,
  lineEnd: LocationPoint
): number {
  const x = point.longitude;
  const y = point.latitude;
  const x1 = lineStart.longitude;
  const y1 = lineStart.latitude;
  const x2 = lineEnd.longitude;
  const y2 = lineEnd.latitude;

  const A = x - x1;
  const B = y - y1;
  const C = x2 - x1;
  const D = y2 - y1;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;

  if (lenSq !== 0) {
    param = dot / lenSq;
  }

  let xx, yy;

  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }

  const dx = x - xx;
  const dy = y - yy;

  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Filter points to reduce density while keeping important points
 * Keeps points where:
 * - Speed changes significantly
 * - Direction changes significantly
 * - Time gap is significant
 * - Start/end of session
 */
export function filterSignificantPoints(
  points: LocationPoint[],
  minTimeDeltaSeconds: number = 10,
  minSpeedDelta: number = 5, // m/s
  minHeadingDelta: number = 15 // degrees
): LocationPoint[] {
  if (points.length <= 2) return points;

  const filtered: LocationPoint[] = [points[0]]; // Always keep first point
  let lastKeptPoint = points[0];

  for (let i = 1; i < points.length - 1; i++) {
    const point = points[i];
    const timeDelta =
      (new Date(point.timestamp).getTime() - new Date(lastKeptPoint.timestamp).getTime()) / 1000;

    // Check if this point is significant
    let isSignificant = false;

    // Time-based filtering
    if (timeDelta >= minTimeDeltaSeconds) {
      isSignificant = true;
    }

    // Speed change detection
    if (point.speed !== undefined && lastKeptPoint.speed !== undefined) {
      const speedDelta = Math.abs(point.speed - lastKeptPoint.speed);
      if (speedDelta >= minSpeedDelta) {
        isSignificant = true;
      }
    }

    // Heading change detection
    if (point.heading !== undefined && lastKeptPoint.heading !== undefined) {
      let headingDelta = Math.abs(point.heading - lastKeptPoint.heading);
      // Handle wrap-around (e.g., 359° to 1°)
      if (headingDelta > 180) {
        headingDelta = 360 - headingDelta;
      }
      if (headingDelta >= minHeadingDelta) {
        isSignificant = true;
      }
    }

    if (isSignificant) {
      filtered.push(point);
      lastKeptPoint = point;
    }
  }

  // Always keep last point
  filtered.push(points[points.length - 1]);

  return filtered;
}

/**
 * Calculate total distance of a session in meters
 */
export function calculateSessionDistance(points: LocationPoint[]): number {
  if (points.length < 2) return 0;

  let totalDistance = 0;
  for (let i = 1; i < points.length; i++) {
    totalDistance += haversineDistance(
      points[i - 1].latitude,
      points[i - 1].longitude,
      points[i].latitude,
      points[i].longitude
    );
  }

  return totalDistance;
}

/**
 * Calculate distance between two points using Haversine formula
 * Returns distance in meters
 */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}
