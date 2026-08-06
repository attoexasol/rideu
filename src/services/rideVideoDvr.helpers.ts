/**
 * Pure DVR timeline and manifest helpers (unit-testable).
 */

export const PLAYABLE_UPLOAD_STATUSES = ['uploaded', 'verified'] as const;
export const DVR_PLAYBACK_MODE = 'dvr_segmented' as const;

export interface DvrSegmentInput {
  segmentId: string;
  segmentIndex: number;
  durationMs: number | null;
  mimeType: string;
  uploadStatus: string;
  storageKey: string | null;
  retentionDeletedAt: Date | string | null;
}

export interface DvrTimelineSegment extends DvrSegmentInput {
  startOffsetSeconds: number;
  durationSeconds: number;
  endOffsetSeconds: number;
}

export interface DvrTimeline {
  timelineStartSeconds: number;
  liveEdgeSeconds: number;
  availableDurationSeconds: number;
  firstAvailableSegmentIndex: number | null;
  latestAvailableSegmentIndex: number | null;
  recordingActive: boolean;
  finalized: boolean;
  playableSegmentCount: number;
  segments: DvrTimelineSegment[];
}

export function segmentDurationSeconds(
  durationMs: number | null | undefined,
  defaultSegmentDurationSeconds: number
): number {
  if (durationMs == null || durationMs <= 0) return defaultSegmentDurationSeconds;
  return Math.max(1, Math.round(durationMs / 1000));
}

export function isPlayableSegment(segment: DvrSegmentInput): boolean {
  return (
    PLAYABLE_UPLOAD_STATUSES.includes(segment.uploadStatus as (typeof PLAYABLE_UPLOAD_STATUSES)[number]) &&
    Boolean(segment.storageKey) &&
    !segment.retentionDeletedAt
  );
}

export function buildDvrTimeline(params: {
  sessionStatus: string;
  finalizedAt: Date | string | null;
  segments: DvrSegmentInput[];
  defaultSegmentDurationSeconds: number;
}): DvrTimeline {
  const playable = params.segments
    .filter(isPlayableSegment)
    .sort((a, b) => a.segmentIndex - b.segmentIndex);

  let offset = 0;
  const withOffsets: DvrTimelineSegment[] = playable.map((segment) => {
    const durationSeconds = segmentDurationSeconds(
      segment.durationMs,
      params.defaultSegmentDurationSeconds
    );
    const startOffsetSeconds = offset;
    offset += durationSeconds;
    return {
      ...segment,
      startOffsetSeconds,
      durationSeconds,
      endOffsetSeconds: startOffsetSeconds + durationSeconds,
    };
  });

  const recordingActive = ['active', 'paused', 'finalizing'].includes(params.sessionStatus);
  const finalized =
    Boolean(params.finalizedAt) ||
    ['completed', 'partial', 'failed', 'cancelled'].includes(params.sessionStatus);

  return {
    timelineStartSeconds: 0,
    liveEdgeSeconds: offset,
    availableDurationSeconds: offset,
    firstAvailableSegmentIndex: withOffsets[0]?.segmentIndex ?? null,
    latestAvailableSegmentIndex:
      withOffsets.length > 0 ? withOffsets[withOffsets.length - 1].segmentIndex : null,
    recordingActive,
    finalized,
    playableSegmentCount: withOffsets.length,
    segments: withOffsets,
  };
}

export function resolveTerminalSessionStatus(input: {
  segments: DvrSegmentInput[];
  pendingCount: number;
  defaultSegmentDurationSeconds: number;
}): 'completed' | 'partial' | 'failed' {
  const playable = input.segments.filter(isPlayableSegment);
  if (playable.length === 0) return 'failed';

  const hasFailed = input.segments.some((s) => s.uploadStatus === 'failed');
  const indices = playable.map((s) => s.segmentIndex).sort((a, b) => a - b);
  let hasGap = false;
  for (let i = 1; i < indices.length; i += 1) {
    if (indices[i] !== indices[i - 1] + 1) {
      hasGap = true;
      break;
    }
  }

  if (input.pendingCount > 0 || hasFailed || hasGap) return 'partial';
  const allVerified = playable.every((s) => s.uploadStatus === 'verified');
  if (!allVerified) return 'partial';
  return 'completed';
}

export interface ManifestSliceOptions {
  fromOffsetSeconds?: number;
  fromSegmentIndex?: number;
  sinceManifestVersion?: number;
  currentManifestVersion?: number;
  limit?: number;
}

export interface ManifestSliceResult {
  unchanged: boolean;
  fromSegmentIndex: number;
  nextFromSegmentIndex: number | null;
  segments: DvrTimelineSegment[];
}

export function sliceDvrManifest(
  timeline: DvrTimeline,
  options: ManifestSliceOptions = {}
): ManifestSliceResult {
  const limit = Math.min(30, Math.max(1, options.limit ?? 10));

  if (
    options.sinceManifestVersion != null &&
    options.currentManifestVersion != null &&
    options.sinceManifestVersion >= options.currentManifestVersion
  ) {
    return {
      unchanged: true,
      fromSegmentIndex: timeline.latestAvailableSegmentIndex ?? 0,
      nextFromSegmentIndex: null,
      segments: [],
    };
  }

  let segments = timeline.segments;

  if (options.fromSegmentIndex != null) {
    segments = segments.filter((s) => s.segmentIndex >= options.fromSegmentIndex!);
  } else if (options.fromOffsetSeconds != null && options.fromOffsetSeconds > 0) {
    segments = segments.filter((s) => s.endOffsetSeconds > options.fromOffsetSeconds!);
  } else if (
    options.sinceManifestVersion != null &&
    options.currentManifestVersion != null &&
    options.sinceManifestVersion < options.currentManifestVersion &&
    timeline.latestAvailableSegmentIndex != null
  ) {
    // Incremental refresh: return only the newest playable segment when version advanced.
    const latest = timeline.segments[timeline.segments.length - 1];
    segments = latest ? [latest] : [];
  }

  const window = segments.slice(0, limit);
  const last = window[window.length - 1];
  const nextFromSegmentIndex =
    last && timeline.segments.some((s) => s.segmentIndex > last.segmentIndex)
      ? last.segmentIndex + 1
      : null;

  return {
    unchanged: false,
    fromSegmentIndex: window[0]?.segmentIndex ?? 0,
    nextFromSegmentIndex,
    segments: window,
  };
}

export function userFriendlyPlaybackReason(code: string): string {
  switch (code) {
    case 'WAITING_FOR_FIRST_SEGMENT':
      return 'Waiting for the first video segment to upload';
    case 'RECORDING_ACTIVE':
      return 'Recording in progress — playback available with live edge';
    case 'RECORDING_FINALIZING':
      return 'Ride ended — final segments are uploading';
    case 'RECORDING_PARTIAL':
      return 'Partial recording available — some segments may be missing';
    case 'RECORDING_READY':
      return 'Full recording available';
    case 'PLAYBACK_READY':
      return 'Recording available';
    case 'RECORDING_EXPIRED':
      return 'Recording retention period has ended';
    case 'RECORDING_DELETED':
      return 'Recording has been deleted';
    default:
      return 'Recording not available yet';
  }
}
