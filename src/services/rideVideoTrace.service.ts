import { logger } from '../middleware/logger';

export type RideVideoTraceStage =
  | 'booking_accepted'
  | 'session_created'
  | 'session_restored'
  | 'consent_granted'
  | 'recording_started'
  | 'upload_url_issued'
  | 'segment_registered'
  | 'segment_uploaded'
  | 'segment_ready'
  | 'segment_failed'
  | 'admin_list_eligibility'
  | 'admin_playback_manifest'
  | 'ride_completed'
  | 'recording_stop'
  | 'session_finalize_requested'
  | 'session_finalizing'
  | 'session_finalized'
  | 'retention_calculated'
  | 'admin_completed_visibility';

export interface RideVideoTraceFields {
  stage: RideVideoTraceStage;
  bookingId?: string;
  sessionId?: string;
  segmentId?: string;
  segmentIndex?: number;
  driverId?: string;
  sessionStatus?: string;
  segmentStatus?: string;
  uploadStatus?: string;
  storageExists?: boolean;
  finalizedAt?: string | null;
  lastActivityAt?: string | null;
  retentionExpiresAt?: string | null;
  playbackAvailable?: boolean;
  readySegmentCount?: number;
  playableSegmentCount?: number;
  includedInAdminList?: boolean;
  reason?: string;
  errorCode?: string;
}

/** Structured trace logging for end-to-end ride video lifecycle debugging. */
export function traceRideVideo(fields: RideVideoTraceFields): void {
  logger.info({
    event: 'ride_video.trace',
    ...fields,
  });
}
