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
    duration: number;
    distance?: number;
}
/**
 * Detect sessions from location history based on time gaps
 * A new session starts when there's a gap larger than the threshold
 */
export declare function detectSessions(locations: LocationPoint[], gapThresholdMinutes?: number): Session[];
/**
 * Simplify GPS points using Douglas-Peucker algorithm
 * Reduces point density while preserving shape
 */
export declare function simplifyPoints(points: LocationPoint[], tolerance?: number): LocationPoint[];
/**
 * Filter points to reduce density while keeping important points
 * Keeps points where:
 * - Speed changes significantly
 * - Direction changes significantly
 * - Time gap is significant
 * - Start/end of session
 */
export declare function filterSignificantPoints(points: LocationPoint[], minTimeDeltaSeconds?: number, minSpeedDelta?: number, // m/s
minHeadingDelta?: number): LocationPoint[];
/**
 * Calculate total distance of a session in meters
 */
export declare function calculateSessionDistance(points: LocationPoint[]): number;
export {};
//# sourceMappingURL=sessions.d.ts.map