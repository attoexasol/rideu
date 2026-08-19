import { logger } from '../middleware/logger';
import { inspectPrivateSegment } from './ride-video-storage.service';

const PLAYABLE_UPLOAD_STATUSES = new Set(['uploaded', 'verified']);

export type SegmentRouteName =
  | 'segment_register'
  | 'segment_upload'
  | 'segment_complete'
  | 'segment_failed'
  | 'session_finalize'
  | 'segment_list';

export interface SegmentRouteTraceInput {
  route: SegmentRouteName;
  method: string;
  httpStatus: number;
  bookingId?: string | null;
  sessionId?: string | null;
  segmentId?: string | null;
  segmentIndex?: number | null;
  uploadStatusBefore?: string | null;
  uploadStatusAfter?: string | null;
  storageKey?: string | null;
  storageExists?: boolean | null;
  fileSizeBytes?: number | null;
  durationMs?: number | null;
  errorCode?: string | null;
  uploadUrlHost?: string | null;
  uploadUrlPath?: string | null;
}

/** Structured per-request trace for driver video segment routes. Never log tokens or signed URLs. */
export function logSegmentRouteTrace(input: SegmentRouteTraceInput): void {
  logger.info({
    event: 'ride_video.segment_route',
    ...input,
  });
}

export function parseUploadUrlForTrace(uploadUrl: string): {
  uploadUrlHost: string | null;
  uploadUrlPath: string;
} {
  const redacted = uploadUrl.replace(/token=[^&]+/, 'token=[redacted]');
  if (uploadUrl.startsWith('http://') || uploadUrl.startsWith('https://')) {
    try {
      const parsed = new URL(uploadUrl);
      parsed.searchParams.set('token', '[redacted]');
      return {
        uploadUrlHost: parsed.host,
        uploadUrlPath: `${parsed.pathname}${parsed.search}`,
      };
    } catch {
      return { uploadUrlHost: null, uploadUrlPath: redacted };
    }
  }
  return { uploadUrlHost: null, uploadUrlPath: redacted };
}

export async function logManifestBlockedDiagnostics(params: {
  sessionId: string;
  playbackReason: string;
  manifestVersion?: number;
  segments: Array<{
    id: string;
    uploadStatus: string;
    storageKey: string | null;
    retentionDeletedAt: Date | null;
  }>;
  uploadedCount: number;
  verifiedCount: number;
}): Promise<void> {
  let storageExistingCount = 0;
  let playableCount = 0;
  let pendingCount = 0;
  let uploadingCount = 0;
  let failedCount = 0;
  for (const segment of params.segments) {
    if (segment.uploadStatus === 'pending') pendingCount += 1;
    if (segment.uploadStatus === 'uploading') uploadingCount += 1;
    if (segment.uploadStatus === 'failed') failedCount += 1;
    const storageExists = segment.storageKey
      ? (await inspectPrivateSegment(segment.storageKey)) != null
      : false;
    if (storageExists) storageExistingCount += 1;
    if (
      PLAYABLE_UPLOAD_STATUSES.has(segment.uploadStatus) &&
      segment.storageKey &&
      !segment.retentionDeletedAt &&
      storageExists
    ) {
      playableCount += 1;
    }
  }

  logger.info({
    event: 'ride_video.manifest_blocked',
    sessionId: params.sessionId,
    playbackReason: params.playbackReason,
    totalSegments: params.segments.length,
    segmentRows: params.segments.length,
    pendingCount,
    uploadingCount,
    uploadedCount: params.uploadedCount,
    verifiedCount: params.verifiedCount,
    failedCount,
    storageObjectCount: storageExistingCount,
    storageExistingCount,
    playableCount,
    manifestVersion: params.manifestVersion ?? null,
  });
}
