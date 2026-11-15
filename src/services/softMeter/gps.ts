import { METER_GPS_POLICY } from '../../constants/softMeter';
import { haversineMeters } from '../../utils/geo';

export interface MeterTrackState {
  acceptedDistanceMillimeters: number;
  rejectedPointCount: number;
  gapCount: number;
  reviewRequired: boolean;
  reviewReasons: string[];
  lastAcceptedRecordedAtMs: number | null;
  lastAcceptedLat: number | null;
  lastAcceptedLng: number | null;
  lastSequence: number;
}

export function emptyTrackState(): MeterTrackState {
  return {
    acceptedDistanceMillimeters: 0,
    rejectedPointCount: 0,
    gapCount: 0,
    reviewRequired: false,
    reviewReasons: [],
    lastAcceptedRecordedAtMs: null,
    lastAcceptedLat: null,
    lastAcceptedLng: null,
    lastSequence: 0,
  };
}

export interface GpsPointInput {
  clientPointId: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  speedMps: number | null;
  recordedAtMs: number | null;
}

export interface GpsDecision {
  disposition: 'accepted' | 'rejected';
  rejectReason: string | null;
  distanceDeltaMillimeters: number;
  gapBefore: boolean;
  reviewReasons: string[];
  next: MeterTrackState;
}

export function distanceMillimeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const millimeters = Math.round(haversineMeters(lat1, lng1, lat2, lng2) * 1000);
  if (!Number.isSafeInteger(millimeters) || millimeters < 0) {
    throw new Error('Distance is not a safe integer');
  }
  return millimeters;
}

function withReason(reasons: string[], reason: string): string[] {
  return reasons.includes(reason) ? reasons : [...reasons, reason];
}

function reject(
  state: MeterTrackState,
  reason: string,
  reviewReason?: string
): GpsDecision {
  const reviewReasons = reviewReason
    ? withReason(state.reviewReasons, reviewReason)
    : state.reviewReasons;
  return {
    disposition: 'rejected',
    rejectReason: reason,
    distanceDeltaMillimeters: 0,
    gapBefore: false,
    reviewReasons,
    next: {
      ...state,
      rejectedPointCount: state.rejectedPointCount + 1,
      reviewRequired: state.reviewRequired || Boolean(reviewReason),
      reviewReasons,
    },
  };
}

/**
 * Accept or reject one GPS sample against the last accepted anchor.
 * A gap does not add straight-line distance. The new point can become the
 * next anchor so later samples still work, and the session is flagged.
 */
export function evaluateGpsPoint(
  state: MeterTrackState,
  point: GpsPointInput,
  receivedAtMs: number
): GpsDecision {
  if (
    !Number.isFinite(point.latitude) ||
    !Number.isFinite(point.longitude) ||
    point.latitude < -90 ||
    point.latitude > 90 ||
    point.longitude < -180 ||
    point.longitude > 180
  ) {
    return reject(state, 'invalid_coordinates');
  }
  if (point.recordedAtMs == null || !Number.isFinite(point.recordedAtMs)) {
    return reject(state, 'device_timestamp_missing');
  }
  if (point.accuracyMeters == null || !Number.isFinite(point.accuracyMeters)) {
    return reject(state, 'accuracy_missing');
  }
  if (point.accuracyMeters > METER_GPS_POLICY.maxAccuracyMeters) {
    return reject(state, 'low_accuracy');
  }
  if (point.recordedAtMs > receivedAtMs + METER_GPS_POLICY.maxFutureSkewMs) {
    return reject(state, 'future_timestamp');
  }
  if (receivedAtMs - point.recordedAtMs > METER_GPS_POLICY.maxLateArrivalMs) {
    return reject(state, 'stale', 'stale_gps');
  }

  if (state.lastAcceptedRecordedAtMs == null || state.lastAcceptedLat == null || state.lastAcceptedLng == null) {
    return {
      disposition: 'accepted',
      rejectReason: null,
      distanceDeltaMillimeters: 0,
      gapBefore: false,
      reviewReasons: state.reviewReasons,
      next: {
        ...state,
        lastAcceptedRecordedAtMs: point.recordedAtMs,
        lastAcceptedLat: point.latitude,
        lastAcceptedLng: point.longitude,
        lastSequence: state.lastSequence + 1,
      },
    };
  }

  if (point.recordedAtMs < state.lastAcceptedRecordedAtMs) {
    return reject(state, 'out_of_order');
  }

  const deltaMm = distanceMillimeters(
    state.lastAcceptedLat,
    state.lastAcceptedLng,
    point.latitude,
    point.longitude
  );
  const elapsedMs = point.recordedAtMs - state.lastAcceptedRecordedAtMs;
  if (
    deltaMm <= METER_GPS_POLICY.duplicateDistanceMillimeters &&
    elapsedMs <= METER_GPS_POLICY.duplicateWindowMs
  ) {
    return reject(state, 'duplicate');
  }

  const gap = elapsedMs > METER_GPS_POLICY.outageGapMs;
  if (!gap && elapsedMs > 0) {
    const speedMps = deltaMm / 1000 / (elapsedMs / 1000);
    if (speedMps > METER_GPS_POLICY.maxSpeedMps) {
      return reject(state, 'implausible_movement', 'implausible_movement');
    }
  }

  const reviewReasons = gap ? withReason(state.reviewReasons, 'gps_outage') : state.reviewReasons;
  const acceptedDelta = gap ? 0 : deltaMm;
  return {
    disposition: 'accepted',
    rejectReason: null,
    distanceDeltaMillimeters: acceptedDelta,
    gapBefore: gap,
    reviewReasons,
    next: {
      ...state,
      acceptedDistanceMillimeters: state.acceptedDistanceMillimeters + acceptedDelta,
      gapCount: state.gapCount + (gap ? 1 : 0),
      reviewRequired: state.reviewRequired || gap,
      reviewReasons,
      lastAcceptedRecordedAtMs: point.recordedAtMs,
      lastAcceptedLat: point.latitude,
      lastAcceptedLng: point.longitude,
      lastSequence: state.lastSequence + 1,
    },
  };
}
