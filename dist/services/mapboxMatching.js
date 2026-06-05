"use strict";
/**
 * Mapbox Map Matching Service
 * Snaps GPS breadcrumb trails to road networks for smooth visualization
 * Like Uber's path display - follows actual roads instead of jagged GPS points
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.snapToRoads = snapToRoads;
exports.snapToRoadsBatch = snapToRoadsBatch;
const axios_1 = __importDefault(require("axios"));
const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN || '';
const MAP_MATCHING_URL = 'https://api.mapbox.com/matching/v5/mapbox/driving';
/**
 * Snap GPS coordinates to road network using Mapbox Map Matching API
 * @param coordinates Array of GPS points (lat, lng)
 * @param options Configuration options
 * @returns Snapped coordinates following road geometry
 */
async function snapToRoads(coordinates, options = {}) {
    if (!MAPBOX_ACCESS_TOKEN) {
        throw new Error('MAPBOX_ACCESS_TOKEN not configured');
    }
    if (coordinates.length < 2) {
        throw new Error('Need at least 2 coordinates for map matching');
    }
    // Mapbox has a limit of 100 coordinates per request
    if (coordinates.length > 100) {
        console.warn(`Truncating ${coordinates.length} coordinates to 100 for map matching`);
        coordinates = coordinates.slice(0, 100);
    }
    // Format coordinates as lng,lat pairs (Mapbox format)
    const coordinatesString = coordinates
        .map((coord) => `${coord.longitude},${coord.latitude}`)
        .join(';');
    // Build query parameters
    const params = new URLSearchParams({
        access_token: MAPBOX_ACCESS_TOKEN,
        geometries: options.geometries || 'geojson',
        overview: options.overview || 'full',
        tidy: options.tidy !== undefined ? String(options.tidy) : 'true',
        steps: options.steps !== undefined ? String(options.steps) : 'false',
    });
    // Add optional radiuses (how far from each point to search for roads)
    if (options.radiuses && options.radiuses.length === coordinates.length) {
        params.append('radiuses', options.radiuses.join(';'));
    }
    else {
        // Default: 25 meters search radius for each point
        params.append('radiuses', coordinates.map(() => '25').join(';'));
    }
    // Add timestamps if provided (helps with matching)
    if (options.timestamps && options.timestamps.length === coordinates.length) {
        params.append('timestamps', options.timestamps.join(';'));
    }
    try {
        const url = `${MAP_MATCHING_URL}/${coordinatesString}?${params.toString()}`;
        const response = await axios_1.default.get(url, {
            timeout: 10000, // 10 second timeout
        });
        if (response.data.code !== 'Ok' || !response.data.matchings || response.data.matchings.length === 0) {
            throw new Error(`Map matching failed: ${response.data.code}`);
        }
        const matching = response.data.matchings[0];
        // Extract matched coordinates from geometry
        const matched = response.data.tracepoints
            .filter((tp) => tp !== null)
            .map((tp) => ({
            latitude: tp.location[1],
            longitude: tp.location[0],
            distance: tp.distance,
        }));
        // Extract full road geometry
        const geometry = matching.geometry.coordinates;
        return {
            matched,
            geometry,
            confidence: matching.confidence,
            distance: matching.distance,
            duration: matching.duration,
        };
    }
    catch (error) {
        if (axios_1.default.isAxiosError(error)) {
            console.error('Mapbox Map Matching API error:', {
                status: error.response?.status,
                data: error.response?.data,
                message: error.message,
            });
            throw new Error(`Map matching failed: ${error.response?.data?.message || error.message}`);
        }
        throw error;
    }
}
/**
 * Calculate distance between two coordinates using Haversine formula
 * @returns Distance in meters
 */
function calculateDistance(coord1, coord2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = coord1.latitude * Math.PI / 180;
    const φ2 = coord2.latitude * Math.PI / 180;
    const Δφ = (coord2.latitude - coord1.latitude) * Math.PI / 180;
    const Δλ = (coord2.longitude - coord1.longitude) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
/**
 * Split coordinates into continuous segments based on distance gaps
 * @param coordinates All GPS points
 * @param maxGapMeters Maximum distance between consecutive points (default 5km)
 * @returns Array of continuous segments
 */
function splitByDistanceGaps(coordinates, maxGapMeters = 5000) {
    if (coordinates.length === 0)
        return [];
    const segments = [];
    let currentSegment = [coordinates[0]];
    for (let i = 1; i < coordinates.length; i++) {
        const distance = calculateDistance(coordinates[i - 1], coordinates[i]);
        if (distance > maxGapMeters) {
            // Gap too large - start new segment
            if (currentSegment.length >= 2) {
                segments.push(currentSegment);
            }
            currentSegment = [coordinates[i]];
        }
        else {
            currentSegment.push(coordinates[i]);
        }
    }
    // Add final segment
    if (currentSegment.length >= 2) {
        segments.push(currentSegment);
    }
    return segments;
}
/**
 * Batch process large coordinate arrays by splitting into chunks
 * First splits by distance gaps (>5km = disjoint), then by point count
 * @param coordinates All GPS points
 * @param chunkSize Maximum points per API call (default 50 for safety)
 * @returns Combined matched results
 */
async function snapToRoadsBatch(coordinates, chunkSize = 50 // Reduced from 100 to avoid distance limits
) {
    // First, split by distance gaps to avoid unrealistic jumps
    const segments = splitByDistanceGaps(coordinates, 5000); // 5km max gap
    console.log(`Split ${coordinates.length} points into ${segments.length} segment(s) by distance gaps`);
    if (segments.length === 0) {
        throw new Error('No valid segments after distance filtering');
    }
    // Now split each segment by chunk size
    const chunks = [];
    for (const segment of segments) {
        if (segment.length <= chunkSize) {
            chunks.push(segment);
        }
        else {
            // Split large segment into overlapping chunks
            const overlap = 2;
            for (let i = 0; i < segment.length; i += chunkSize - overlap) {
                const end = Math.min(i + chunkSize, segment.length);
                chunks.push(segment.slice(i, end));
                if (end >= segment.length)
                    break;
            }
        }
    }
    console.log(`Processing ${chunks.length} chunk(s) for road snapping`);
    // Process each chunk with individual error handling
    const results = await Promise.allSettled(chunks.map((chunk, index) => snapToRoads(chunk).catch(error => {
        console.warn(`Chunk ${index + 1}/${chunks.length} failed (${chunk.length} points):`, error.message);
        return null;
    })));
    // Combine successful results only
    let allMatched = [];
    let allGeometry = [];
    let totalDistance = 0;
    let totalDuration = 0;
    let successfulChunks = 0;
    results.forEach((result) => {
        if (result.status === 'fulfilled' && result.value) {
            allMatched = allMatched.concat(result.value.matched);
            allGeometry = allGeometry.concat(result.value.geometry);
            totalDistance += result.value.distance;
            totalDuration += result.value.duration;
            successfulChunks++;
        }
    });
    console.log(`✅ Successfully processed ${successfulChunks}/${chunks.length} chunks`);
    // If no chunks succeeded, throw an error
    if (successfulChunks === 0) {
        throw new Error('All map matching chunks failed - no road geometry available');
    }
    // Remove duplicate coordinates at chunk boundaries
    allGeometry = allGeometry.filter((coord, index, arr) => {
        if (index === 0)
            return true;
        const prev = arr[index - 1];
        return coord[0] !== prev[0] || coord[1] !== prev[1];
    });
    return {
        matched: allMatched,
        geometry: allGeometry,
        totalDistance,
        totalDuration,
    };
}
//# sourceMappingURL=mapboxMatching.js.map