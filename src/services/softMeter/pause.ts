import {
  MeterSessionStatus,
  type MeterSessionStatusType,
} from '../../constants/softMeter';
import { MeterError } from './errors';
import { evaluateGpsPoint, type GpsDecision, type GpsPointInput, type MeterTrackState } from './gps';

export const PAUSE_REASON_DRIVER_PERSONAL_STOP = 'driver_personal_stop';

export interface PauseInterval {
  pausedAtMs: number;
  resumedAtMs: number | null;
  durationSeconds: number | null;
  reason: string;
  driverId: string;
}

export interface SoftMeterClockState {
  status: MeterSessionStatusType;
  driverId: string;
  tripKind: 'on_demand' | 'walk_up';
  startedAtMs: number | null;
  stoppedAtMs: number | null;
  acceptedDistanceMillimeters: number;
  waitingSeconds: number;
  provisionalTotalCents: number;
  totalPausedSeconds: number;
  pausedAtMs: number | null;
  pauseReason: string | null;
  needsNewAnchor: boolean;
  stateVersion: number;
  pauses: PauseInterval[];
  track: MeterTrackState;
  billable: boolean;
}

export interface MeterTimingFields {
  pausedAt: string | null;
  totalPausedSeconds: number;
  currentPauseSeconds: number;
  chargeableElapsedSeconds: number;
  tripElapsedSeconds: number;
  pauseReason: string | null;
  fareFrozen: boolean;
}

export function assertMeterDriver(sessionDriverId: string, actorDriverId: string): void {
  if (sessionDriverId !== actorDriverId) {
    throw new MeterError('METER_NOT_FOUND', 'Meter session not found.', 404);
  }
}

export function isStaleMeterEvent(eventVersion: number, latestVersion: number): boolean {
  return eventVersion < latestVersion;
}

function cloneState(state: SoftMeterClockState): SoftMeterClockState {
  return {
    ...state,
    pauses: state.pauses.map((pause) => ({ ...pause })),
    track: { ...state.track, reviewReasons: [...state.track.reviewReasons] },
  };
}

function openPause(state: SoftMeterClockState): PauseInterval | null {
  return state.pauses.find((pause) => pause.resumedAtMs == null) ?? null;
}

export function pauseDurationSeconds(pausedAtMs: number, resumedAtMs: number): number {
  return Math.max(0, Math.floor((resumedAtMs - pausedAtMs) / 1000));
}

export function buildMeterTiming(input: {
  status: string;
  startedAtMs: number | null;
  stoppedAtMs: number | null;
  pausedAtMs: number | null;
  totalPausedSeconds: number;
  pauseReason: string | null;
  nowMs: number;
}): MeterTimingFields {
  const ended = input.status === MeterSessionStatus.STOPPED || input.status === MeterSessionStatus.FINALIZED;
  const endMs = ended ? (input.stoppedAtMs ?? input.nowMs) : input.nowMs;
  const tripElapsedSeconds =
    input.startedAtMs == null ? 0 : Math.max(0, Math.floor((endMs - input.startedAtMs) / 1000));
  const currentPauseSeconds =
    input.status === MeterSessionStatus.PAUSED && input.pausedAtMs != null
      ? Math.max(0, Math.floor((input.nowMs - input.pausedAtMs) / 1000))
      : 0;
  return {
    pausedAt:
      input.status === MeterSessionStatus.PAUSED && input.pausedAtMs != null
        ? new Date(input.pausedAtMs).toISOString()
        : null,
    totalPausedSeconds: input.totalPausedSeconds,
    currentPauseSeconds,
    chargeableElapsedSeconds: Math.max(
      0,
      tripElapsedSeconds - input.totalPausedSeconds - currentPauseSeconds
    ),
    tripElapsedSeconds,
    pauseReason: input.status === MeterSessionStatus.PAUSED ? input.pauseReason : null,
    fareFrozen: input.status === MeterSessionStatus.PAUSED,
  };
}

/**
 * Pause a running meter. Distance, waiting seconds, and provisional fare stay put.
 * A second pause is the same open interval, not an overlap.
 */
export function pauseSoftMeter(
  state: SoftMeterClockState,
  nowMs: number,
  actorDriverId: string
): { state: SoftMeterClockState; idempotent: boolean } {
  assertMeterDriver(state.driverId, actorDriverId);
  if (state.status === MeterSessionStatus.PAUSED) {
    return { state, idempotent: true };
  }
  if (state.status !== MeterSessionStatus.RUNNING) {
    throw new MeterError(
      'METER_NOT_PAUSABLE',
      'Only a running meter can be paused.',
      409
    );
  }
  const next = cloneState(state);
  next.status = MeterSessionStatus.PAUSED;
  next.pausedAtMs = nowMs;
  next.pauseReason = PAUSE_REASON_DRIVER_PERSONAL_STOP;
  next.stateVersion += 1;
  next.pauses.push({
    pausedAtMs: nowMs,
    resumedAtMs: null,
    durationSeconds: null,
    reason: PAUSE_REASON_DRIVER_PERSONAL_STOP,
    driverId: state.driverId,
  });
  return { state: next, idempotent: false };
}

function closeOpenInterval(state: SoftMeterClockState, nowMs: number): void {
  const current = openPause(state);
  if (!current) return;
  current.resumedAtMs = nowMs;
  current.durationSeconds = pauseDurationSeconds(current.pausedAtMs, nowMs);
  state.totalPausedSeconds += current.durationSeconds;
  state.pausedAtMs = null;
  state.pauseReason = null;
}

/** Resume from the preserved totals and drop the previous GPS anchor. */
export function resumeSoftMeter(
  state: SoftMeterClockState,
  nowMs: number,
  actorDriverId: string
): { state: SoftMeterClockState; idempotent: boolean } {
  assertMeterDriver(state.driverId, actorDriverId);
  if (state.status === MeterSessionStatus.RUNNING && !openPause(state)) {
    return { state, idempotent: true };
  }
  if (state.status !== MeterSessionStatus.PAUSED) {
    throw new MeterError(
      'METER_NOT_RESUMABLE',
      'Only a paused meter can be resumed.',
      409
    );
  }
  const next = cloneState(state);
  closeOpenInterval(next, nowMs);
  next.status = MeterSessionStatus.RUNNING;
  next.needsNewAnchor = true;
  next.track.lastAcceptedLat = null;
  next.track.lastAcceptedLng = null;
  next.track.lastAcceptedRecordedAtMs = null;
  next.stateVersion += 1;
  return { state: next, idempotent: false };
}

/**
 * Stop or finalize. An open pause is closed at the server time and is not billed.
 */
export function finalizeSoftMeter(
  state: SoftMeterClockState,
  nowMs: number,
  actorDriverId: string
): { state: SoftMeterClockState; idempotent: boolean } {
  assertMeterDriver(state.driverId, actorDriverId);
  if (state.status === MeterSessionStatus.FINALIZED) {
    return { state, idempotent: true };
  }
  if (
    state.status !== MeterSessionStatus.RUNNING &&
    state.status !== MeterSessionStatus.PAUSED &&
    state.status !== MeterSessionStatus.STOPPED
  ) {
    throw new MeterError('METER_NOT_STARTED', 'Start the meter before finalizing it.', 409);
  }
  const next = cloneState(state);
  if (next.status === MeterSessionStatus.PAUSED || openPause(next)) {
    closeOpenInterval(next, nowMs);
  }
  if (next.stoppedAtMs == null) next.stoppedAtMs = nowMs;
  next.status = MeterSessionStatus.FINALIZED;
  next.needsNewAnchor = false;
  next.billable = false;
  next.stateVersion += 1;
  return { state: next, idempotent: false };
}

export function reloadPausedMeter(state: SoftMeterClockState): SoftMeterClockState {
  const next = cloneState(state);
  if (next.status !== MeterSessionStatus.PAUSED) return next;
  const open = next.pauses.filter((pause) => pause.resumedAtMs == null);
  if (open.length !== 1) {
    throw new MeterError(
      'METER_PAUSE_INCONSISTENT',
      'A paused meter must have one unfinished pause interval.',
      409
    );
  }
  next.pausedAtMs = open[0].pausedAtMs;
  next.pauseReason = open[0].reason;
  return next;
}

export interface MeterGpsClassification extends GpsDecision {
  excludedFromFare: boolean;
  resetAnchor: boolean;
}

function withReview(reasons: string[], reason: string): string[] {
  return reasons.includes(reason) ? reasons : [...reasons, reason];
}

function excludePoint(
  track: MeterTrackState,
  reason: string,
  reviewReason: string
): MeterGpsClassification {
  const reviewReasons = withReview(track.reviewReasons, reviewReason);
  return {
    disposition: 'rejected',
    rejectReason: reason,
    distanceDeltaMillimeters: 0,
    gapBefore: false,
    excludedFromFare: true,
    resetAnchor: false,
    reviewReasons,
    next: {
      ...track,
      rejectedPointCount: track.rejectedPointCount + 1,
      reviewRequired: true,
      reviewReasons,
      lastSequence: track.lastSequence + 1,
    },
  };
}

export function pointInsidePause(recordedAtMs: number, pauses: PauseInterval[]): boolean {
  return pauses.some(
    (pause) =>
      recordedAtMs >= pause.pausedAtMs &&
      (pause.resumedAtMs == null || recordedAtMs < pause.resumedAtMs)
  );
}

function latestResumeMs(pauses: PauseInterval[]): number | null {
  const resumes = pauses
    .map((pause) => pause.resumedAtMs)
    .filter((value): value is number => value != null);
  if (!resumes.length) return null;
  return Math.max(...resumes);
}

/**
 * Server pause bounds decide what can enter the meter.
 * Movement inside a pause, or a jump from the pre-pause anchor, is not billed.
 */
export function classifyMeterGps(input: {
  status: string;
  needsNewAnchor: boolean;
  pauses: PauseInterval[];
  track: MeterTrackState;
  point: GpsPointInput;
  receivedAtMs: number;
}): MeterGpsClassification {
  const { point, track } = input;
  if (
    !Number.isFinite(point.latitude) ||
    !Number.isFinite(point.longitude) ||
    point.latitude < -90 ||
    point.latitude > 90 ||
    point.longitude < -180 ||
    point.longitude > 180
  ) {
    return excludePoint(track, 'invalid_coordinates', 'pause_gps_excluded');
  }

  const recordedAt = point.recordedAtMs;
  const inside =
    recordedAt != null && Number.isFinite(recordedAt) && pointInsidePause(recordedAt, input.pauses);
  const pausedNow = input.status === MeterSessionStatus.PAUSED;
  if (pausedNow || inside) {
    const clockConflict = pausedNow && !inside;
    return excludePoint(
      track,
      inside ? 'paused_interval' : 'meter_paused',
      clockConflict ? 'pause_timestamp_conflict' : 'pause_gps_excluded'
    );
  }

  const resumeAt = latestResumeMs(input.pauses);
  if (input.needsNewAnchor && (recordedAt == null || (resumeAt != null && recordedAt < resumeAt))) {
    return excludePoint(track, 'before_resume_boundary', 'pause_timestamp_conflict');
  }

  if (input.needsNewAnchor) {
    const fresh = evaluateGpsPoint(
      {
        ...track,
        lastAcceptedLat: null,
        lastAcceptedLng: null,
        lastAcceptedRecordedAtMs: null,
      },
      point,
      input.receivedAtMs
    );
    if (fresh.disposition !== 'accepted') {
      return { ...fresh, excludedFromFare: true, resetAnchor: false };
    }
    return {
      ...fresh,
      distanceDeltaMillimeters: 0,
      excludedFromFare: false,
      resetAnchor: true,
      next: {
        ...fresh.next,
        acceptedDistanceMillimeters: track.acceptedDistanceMillimeters,
      },
    };
  }

  const decision = evaluateGpsPoint(track, point, input.receivedAtMs);
  return { ...decision, excludedFromFare: false, resetAnchor: false };
}

export function applyGpsBatch(
  state: SoftMeterClockState,
  points: GpsPointInput[],
  receivedAtMs: number
): {
  state: SoftMeterClockState;
  results: Array<{
    clientPointId: string;
    disposition: string;
    rejectReason: string | null;
    distanceDeltaMillimeters: number;
  }>;
} {
  const next = cloneState(state);
  const ordered = [...points].sort(
    (left, right) => (left.recordedAtMs ?? 0) - (right.recordedAtMs ?? 0)
  );
  const results = ordered.map((point) => {
    const decision = classifyMeterGps({
      status: next.status,
      needsNewAnchor: next.needsNewAnchor,
      pauses: next.pauses,
      track: next.track,
      point,
      receivedAtMs,
    });
    const frozen = next.status === MeterSessionStatus.PAUSED || decision.excludedFromFare;
    next.track = decision.next;
    if (frozen) {
      next.track.acceptedDistanceMillimeters = next.acceptedDistanceMillimeters;
    } else {
      next.acceptedDistanceMillimeters = decision.next.acceptedDistanceMillimeters;
    }
    next.waitingSeconds = state.waitingSeconds;
    if (decision.resetAnchor) next.needsNewAnchor = false;
    return {
      clientPointId: point.clientPointId,
      disposition: decision.disposition,
      rejectReason: decision.rejectReason,
      distanceDeltaMillimeters: frozen ? 0 : decision.distanceDeltaMillimeters,
    };
  });
  if (next.status === MeterSessionStatus.PAUSED) {
    next.acceptedDistanceMillimeters = state.acceptedDistanceMillimeters;
    next.waitingSeconds = state.waitingSeconds;
    next.provisionalTotalCents = state.provisionalTotalCents;
  }
  return { state: next, results };
}
