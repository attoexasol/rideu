/**
 * Pure helpers for admin ride-video health / status mapping (unit-testable).
 */

export type AdminRecordingStatus =
  | 'waiting_for_consent'
  | 'initializing'
  | 'recording'
  | 'uploading'
  | 'processing'
  | 'ready'
  | 'partially_available'
  | 'failed'
  | 'finalized'
  | 'expired'
  | 'deleted'
  | 'disabled';

export type UploadHealth =
  | 'healthy'
  | 'delayed'
  | 'missing_segments'
  | 'failed_segments'
  | 'duplicate_segments'
  | 'incomplete'
  | 'unknown';

export type RetentionStatus = 'active' | 'expiring_soon' | 'expired' | 'deleted';

export type HealthState = 'healthy' | 'partial' | 'upload_delayed' | 'failed' | 'unknown';

export interface SegmentStatInput {
  sequenceNumber: number;
  uploadStatus: string;
  durationMs: number | null;
  retentionDeletedAt: Date | string | null;
  uploadedAt: Date | string | null;
  recordedAt: Date | string | null;
}

export interface SessionHealthInput {
  sessionStatus: string;
  consentStatus: string;
  finalizedAt: Date | string | null;
  retentionDays: number;
  segmentDurationSeconds: number;
  now?: Date;
  uploadDelaySeconds?: number;
  segments: SegmentStatInput[];
}

export function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

export function detectMissingSequences(sequenceNumbers: number[]): number[] {
  if (sequenceNumbers.length === 0) return [];
  const sorted = [...new Set(sequenceNumbers)].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const present = new Set(sorted);
  const missing: number[] = [];
  for (let i = min; i <= max; i += 1) {
    if (!present.has(i)) missing.push(i);
  }
  return missing;
}

export function computeRetention(params: {
  finalizedAt: Date | string | null;
  createdAt?: Date | string | null;
  retentionDays: number;
  segments: Array<{ retentionDeletedAt: Date | string | null }>;
  now?: Date;
}): {
  retentionExpiresAt: string | null;
  retentionStatus: RetentionStatus;
  daysRemaining: number | null;
} {
  const now = params.now ?? new Date();
  const allDeleted =
    params.segments.length > 0 &&
    params.segments.every((segment) => Boolean(segment.retentionDeletedAt));
  if (allDeleted) {
    return {
      retentionExpiresAt: null,
      retentionStatus: 'deleted',
      daysRemaining: 0,
    };
  }

  const anchor = toDate(params.finalizedAt) ?? toDate(params.createdAt);
  if (!anchor) {
    return { retentionExpiresAt: null, retentionStatus: 'active', daysRemaining: null };
  }

  const expiresAt = new Date(anchor.getTime() + params.retentionDays * 24 * 60 * 60 * 1000);
  const msRemaining = expiresAt.getTime() - now.getTime();
  const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));

  if (msRemaining <= 0) {
    return {
      retentionExpiresAt: expiresAt.toISOString(),
      retentionStatus: 'expired',
      daysRemaining: 0,
    };
  }

  if (daysRemaining <= 7) {
    return {
      retentionExpiresAt: expiresAt.toISOString(),
      retentionStatus: 'expiring_soon',
      daysRemaining,
    };
  }

  return {
    retentionExpiresAt: expiresAt.toISOString(),
    retentionStatus: 'active',
    daysRemaining,
  };
}

export function computeSegmentCounts(segments: SegmentStatInput[]) {
  const uploadedSegmentCount = segments.filter((s) =>
    ['uploaded', 'verified'].includes(s.uploadStatus)
  ).length;
  const readySegmentCount = segments.filter((s) => s.uploadStatus === 'verified').length;
  const failedSegmentCount = segments.filter((s) => s.uploadStatus === 'failed').length;
  const playableSegmentCount = segments.filter(
    (s) =>
      ['uploaded', 'verified'].includes(s.uploadStatus) && !s.retentionDeletedAt
  ).length;
  const sequences = segments.map((s) => s.sequenceNumber);
  const missingSequences = detectMissingSequences(sequences);
  const expectedSegmentCount =
    sequences.length === 0 ? 0 : Math.max(...sequences) - Math.min(...sequences) + 1;
  const duplicateSegmentCount = sequences.length - new Set(sequences).size;
  const availableDurationSeconds = Math.round(
    segments
      .filter((s) => ['uploaded', 'verified'].includes(s.uploadStatus) && !s.retentionDeletedAt)
      .reduce((sum, s) => sum + (s.durationMs ?? 0), 0) / 1000
  );

  return {
    expectedSegmentCount,
    uploadedSegmentCount,
    readySegmentCount,
    failedSegmentCount,
    missingSegmentCount: missingSequences.length,
    missingSequences,
    duplicateSegmentCount,
    playableSegmentCount,
    availableDurationSeconds,
  };
}

export function computeUploadHealth(input: SessionHealthInput): UploadHealth {
  const counts = computeSegmentCounts(input.segments);
  if (counts.duplicateSegmentCount > 0) return 'duplicate_segments';
  if (counts.failedSegmentCount > 0) return 'failed_segments';
  if (counts.missingSegmentCount > 0) return 'missing_segments';

  const delaySeconds = input.uploadDelaySeconds ?? 45;
  const now = input.now ?? new Date();
  if (['active', 'paused', 'finalizing'].includes(input.sessionStatus)) {
    const lastActivity = input.segments
      .map((s) => toDate(s.uploadedAt) ?? toDate(s.recordedAt))
      .filter((d): d is Date => Boolean(d))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    if (lastActivity && (now.getTime() - lastActivity.getTime()) / 1000 > delaySeconds) {
      return 'delayed';
    }
  }

  if (
    ['completed', 'cancelled', 'failed'].includes(input.sessionStatus) &&
    (counts.missingSegmentCount > 0 ||
      counts.failedSegmentCount > 0 ||
      counts.uploadedSegmentCount < counts.expectedSegmentCount)
  ) {
    return 'incomplete';
  }

  if (
    counts.expectedSegmentCount > 0 &&
    counts.readySegmentCount === counts.expectedSegmentCount &&
    counts.failedSegmentCount === 0 &&
    counts.missingSegmentCount === 0
  ) {
    return 'healthy';
  }

  if (counts.uploadedSegmentCount > 0 && counts.failedSegmentCount === 0) {
    // Active sessions still receiving segments are healthy enough for ops.
    if (['active', 'paused', 'finalizing', 'pending'].includes(input.sessionStatus)) {
      return 'healthy';
    }
  }

  if (input.segments.length === 0) return 'unknown';
  return 'incomplete';
}

export function computeHealthState(input: SessionHealthInput): {
  state: HealthState;
  completenessPercentage: number;
  expectedDurationSeconds: number;
  availableDurationSeconds: number;
  issues: Array<{ code: string; message: string }>;
} {
  const counts = computeSegmentCounts(input.segments);
  const uploadHealth = computeUploadHealth(input);
  const expectedDurationSeconds =
    counts.expectedSegmentCount * input.segmentDurationSeconds;
  const completenessPercentage =
    counts.expectedSegmentCount === 0
      ? 0
      : Math.min(
          100,
          Math.round((counts.playableSegmentCount / counts.expectedSegmentCount) * 100)
        );

  const issues: Array<{ code: string; message: string }> = [];
  if (counts.missingSegmentCount > 0) {
    issues.push({
      code: 'MISSING_SEGMENTS',
      message: `Missing sequence numbers: ${counts.missingSequences.join(', ')}`,
    });
  }
  if (counts.failedSegmentCount > 0) {
    issues.push({
      code: 'FAILED_SEGMENTS',
      message: `${counts.failedSegmentCount} segment(s) failed upload/processing`,
    });
  }
  if (counts.duplicateSegmentCount > 0) {
    issues.push({
      code: 'DUPLICATE_SEGMENTS',
      message: `${counts.duplicateSegmentCount} duplicate sequence(s) detected`,
    });
  }

  let state: HealthState = 'unknown';
  if (uploadHealth === 'failed_segments' || input.sessionStatus === 'failed') {
    state = 'failed';
  } else if (uploadHealth === 'delayed') {
    state = 'upload_delayed';
  } else if (
    counts.missingSegmentCount > 0 ||
    uploadHealth === 'incomplete' ||
    uploadHealth === 'missing_segments' ||
    (counts.expectedSegmentCount > 0 && completenessPercentage < 100)
  ) {
    state = 'partial';
  } else if (
    uploadHealth === 'healthy' &&
    counts.expectedSegmentCount > 0 &&
    counts.failedSegmentCount === 0 &&
    counts.missingSegmentCount === 0 &&
    // Must not mark healthy merely because one segment exists
    (counts.readySegmentCount === counts.expectedSegmentCount ||
      ['active', 'paused', 'finalizing', 'pending'].includes(input.sessionStatus))
  ) {
    state = 'healthy';
  }

  return {
    state,
    completenessPercentage,
    expectedDurationSeconds,
    availableDurationSeconds: counts.availableDurationSeconds,
    issues,
  };
}

export function mapAdminRecordingStatus(input: SessionHealthInput): AdminRecordingStatus {
  const retention = computeRetention({
    finalizedAt: input.finalizedAt,
    retentionDays: input.retentionDays,
    segments: input.segments,
    now: input.now,
  });
  if (retention.retentionStatus === 'deleted') return 'deleted';
  if (retention.retentionStatus === 'expired') return 'expired';

  if (input.consentStatus === 'required') return 'waiting_for_consent';
  if (input.consentStatus === 'denied') return 'disabled';

  const counts = computeSegmentCounts(input.segments);
  switch (input.sessionStatus) {
    case 'pending':
      return 'initializing';
    case 'active':
      if (counts.playableSegmentCount > 0 && counts.uploadedSegmentCount > counts.readySegmentCount) {
        return 'uploading';
      }
      if (counts.playableSegmentCount > 0) return 'partially_available';
      return 'recording';
    case 'paused':
      return counts.uploadedSegmentCount > 0 ? 'uploading' : 'recording';
    case 'finalizing':
      return counts.playableSegmentCount > 0 ? 'partially_available' : 'processing';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'disabled';
    case 'completed': {
      if (counts.missingSegmentCount > 0 || counts.failedSegmentCount > 0) {
        return 'partially_available';
      }
      if (
        counts.expectedSegmentCount > 0 &&
        counts.readySegmentCount === counts.expectedSegmentCount
      ) {
        return 'finalized';
      }
      if (counts.playableSegmentCount > 0) return 'ready';
      return 'processing';
    }
    case 'partial':
      return counts.playableSegmentCount > 0 ? 'partially_available' : 'failed';
    default:
      return 'initializing';
  }
}

export function mapConsentForAdmin(consentStatus: string): string {
  switch (consentStatus) {
    case 'required':
      return 'pending';
    case 'granted':
      return 'granted';
    case 'denied':
      return 'denied';
    case 'not_required':
      return 'not_required';
    default:
      return consentStatus;
  }
}

export type PlaybackReasonCode =
  | 'PLAYBACK_READY'
  | 'WAITING_FOR_FIRST_SEGMENT'
  | 'RECORDING_ACTIVE'
  | 'RECORDING_FINALIZING'
  | 'RECORDING_PARTIAL'
  | 'RECORDING_READY'
  | 'RECORDING_EXPIRED'
  | 'RECORDING_DELETED'
  | 'SESSION_NOT_FOUND'
  | 'STORAGE_OBJECT_MISSING';

export function computePlaybackEligibility(input: SessionHealthInput & { now?: Date }): {
  playbackAvailable: boolean;
  playbackReason: PlaybackReasonCode;
  availableSegmentCount: number;
  latestSegmentIndex: number | null;
  finalized: boolean;
} {
  const retention = computeRetention({
    finalizedAt: input.finalizedAt,
    retentionDays: input.retentionDays,
    segments: input.segments,
    now: input.now,
  });
  const counts = computeSegmentCounts(input.segments);
  const finalized = Boolean(input.finalizedAt) || input.sessionStatus === 'completed';
  const latestSegmentIndex =
    input.segments.length === 0
      ? null
      : Math.max(...input.segments.map((s) => s.sequenceNumber));

  if (retention.retentionStatus === 'deleted') {
    return {
      playbackAvailable: false,
      playbackReason: 'RECORDING_DELETED',
      availableSegmentCount: 0,
      latestSegmentIndex,
      finalized,
    };
  }
  if (retention.retentionStatus === 'expired') {
    return {
      playbackAvailable: false,
      playbackReason: 'RECORDING_EXPIRED',
      availableSegmentCount: 0,
      latestSegmentIndex,
      finalized,
    };
  }

  if (counts.playableSegmentCount > 0) {
  if (input.sessionStatus === 'finalizing') {
    return {
      playbackAvailable: counts.playableSegmentCount > 0,
      playbackReason: counts.playableSegmentCount > 0 ? 'RECORDING_FINALIZING' : 'RECORDING_FINALIZING',
      availableSegmentCount: counts.playableSegmentCount,
      latestSegmentIndex,
      finalized: false,
    };
  }
    if (
      finalized &&
      (counts.missingSegmentCount > 0 || counts.failedSegmentCount > 0)
    ) {
      return {
        playbackAvailable: true,
        playbackReason: 'RECORDING_PARTIAL',
        availableSegmentCount: counts.playableSegmentCount,
        latestSegmentIndex,
        finalized: true,
      };
    }
    if (finalized) {
      return {
        playbackAvailable: true,
        playbackReason: 'RECORDING_READY',
        availableSegmentCount: counts.playableSegmentCount,
        latestSegmentIndex,
        finalized: true,
      };
    }
    if (['active', 'paused'].includes(input.sessionStatus)) {
      return {
        playbackAvailable: true,
        playbackReason: 'RECORDING_ACTIVE',
        availableSegmentCount: counts.playableSegmentCount,
        latestSegmentIndex,
        finalized: false,
      };
    }
    return {
      playbackAvailable: true,
      playbackReason: 'PLAYBACK_READY',
      availableSegmentCount: counts.playableSegmentCount,
      latestSegmentIndex,
      finalized,
    };
  }

  if (input.sessionStatus === 'finalizing') {
    return {
      playbackAvailable: false,
      playbackReason: 'RECORDING_FINALIZING',
      availableSegmentCount: 0,
      latestSegmentIndex,
      finalized: false,
    };
  }

  if (['active', 'paused', 'pending'].includes(input.sessionStatus)) {
    return {
      playbackAvailable: false,
      playbackReason: 'WAITING_FOR_FIRST_SEGMENT',
      availableSegmentCount: 0,
      latestSegmentIndex,
      finalized: false,
    };
  }

  if (finalized) {
    return {
      playbackAvailable: false,
      playbackReason: 'RECORDING_PARTIAL',
      availableSegmentCount: 0,
      latestSegmentIndex,
      finalized: true,
    };
  }

  return {
    playbackAvailable: false,
    playbackReason: 'WAITING_FOR_FIRST_SEGMENT',
    availableSegmentCount: 0,
    latestSegmentIndex,
    finalized,
  };
}

/** Pick the best session row when multiple exist for one booking. */
export function pickBestSessionForBooking<
  T extends {
    id: string;
    status: string;
    createdAt: Date;
    finalizedAt: Date | null;
  }
>(
  sessions: T[],
  playableCountBySession: Map<string, number>
): T | null {
  if (sessions.length === 0) return null;
  const recoverable = new Set(['pending', 'active', 'paused', 'finalizing']);
  const score = (session: T) => {
    let value = 0;
    if (recoverable.has(session.status)) value += 1000;
    if (session.status === 'completed') value += 500;
    value += (playableCountBySession.get(session.id) ?? 0) * 10;
    if (session.finalizedAt) value += 5;
    value += session.createdAt.getTime() / 1_000_000_000_000;
    return value;
  };
  return [...sessions].sort((a, b) => score(b) - score(a))[0];
}
