/**
 * Mapbox Map Matching Service
 * Snaps GPS breadcrumb trails to road networks for smooth visualization
 * Like Uber's path display - follows actual roads instead of jagged GPS points
 */
interface Coordinate {
    latitude: number;
    longitude: number;
    timestamp?: string;
}
interface MatchedCoordinate {
    latitude: number;
    longitude: number;
    distance: number;
}
/**
 * Snap GPS coordinates to road network using Mapbox Map Matching API
 * @param coordinates Array of GPS points (lat, lng)
 * @param options Configuration options
 * @returns Snapped coordinates following road geometry
 */
export declare function snapToRoads(coordinates: Coordinate[], options?: {
    radiuses?: number[];
    timestamps?: number[];
    geometries?: 'geojson' | 'polyline' | 'polyline6';
    steps?: boolean;
    overview?: 'full' | 'simplified' | 'false';
    tidy?: boolean;
}): Promise<{
    matched: MatchedCoordinate[];
    geometry: number[][];
    confidence: number;
    distance: number;
    duration: number;
}>;
/**
 * Batch process large coordinate arrays by splitting into chunks
 * First splits by distance gaps (>5km = disjoint), then by point count
 * @param coordinates All GPS points
 * @param chunkSize Maximum points per API call (default 50 for safety)
 * @returns Combined matched results
 */
export declare function snapToRoadsBatch(coordinates: Coordinate[], chunkSize?: number): Promise<{
    matched: MatchedCoordinate[];
    geometry: number[][];
    totalDistance: number;
    totalDuration: number;
}>;
export {};
//# sourceMappingURL=mapboxMatching.d.ts.map