import { emitToAdmins } from './bookingNotify.service';

export interface AdminRideVideoEventBase {
  sessionId: string;
  bookingId: string;
  sessionStatus: string;
  timestamp: string;
  lastActivityAt?: string | null;
}

export interface AdminRideVideoSessionEvent extends AdminRideVideoEventBase {
  recordingStatus?: string;
  playbackAvailable?: boolean;
  availableSegmentCount?: number;
  readySegmentCount?: number;
  latestSegmentIndex?: number | null;
  latestAvailableSegmentIndex?: number | null;
  liveEdgeSeconds?: number;
  manifestVersion?: number;
  recordingActive?: boolean;
  finalized?: boolean;
}

export interface AdminRideVideoSegmentEvent extends AdminRideVideoEventBase {
  segmentId: string;
  segmentIndex: number;
  uploadStatus: string;
  availableSegmentCount?: number;
  readySegmentCount?: number;
  latestSegmentIndex?: number;
  latestAvailableSegmentIndex?: number | null;
  liveEdgeSeconds?: number;
  manifestVersion?: number;
}

export interface AdminRideVideoManifestEvent extends AdminRideVideoEventBase {
  manifestVersion: number;
  latestAvailableSegmentIndex: number | null;
  liveEdgeSeconds: number;
  recordingActive: boolean;
}

function basePayload(
  sessionId: string,
  bookingId: string,
  sessionStatus: string,
  lastActivityAt?: string | null
): AdminRideVideoEventBase {
  return {
    sessionId,
    bookingId,
    sessionStatus,
    lastActivityAt: lastActivityAt ?? null,
    timestamp: new Date().toISOString(),
  };
}

export async function emitAdminRideVideoSessionUpdated(
  fields: Omit<AdminRideVideoSessionEvent, 'timestamp'>
): Promise<void> {
  await emitToAdmins('admin:ride-video:session_updated', {
    ...basePayload(fields.sessionId, fields.bookingId, fields.sessionStatus, fields.lastActivityAt),
    recordingStatus: fields.recordingStatus,
    playbackAvailable: fields.playbackAvailable,
    availableSegmentCount: fields.availableSegmentCount,
    readySegmentCount: fields.readySegmentCount,
    latestSegmentIndex: fields.latestSegmentIndex ?? fields.latestAvailableSegmentIndex ?? null,
    latestAvailableSegmentIndex: fields.latestAvailableSegmentIndex ?? fields.latestSegmentIndex ?? null,
    liveEdgeSeconds: fields.liveEdgeSeconds,
    manifestVersion: fields.manifestVersion,
    recordingActive: fields.recordingActive,
    finalized: fields.finalized ?? false,
  });
}

/** @deprecated use emitAdminRideVideoSegmentAvailable */
export async function emitAdminRideVideoSegmentUpdated(
  fields: Omit<AdminRideVideoSegmentEvent, 'timestamp'>
): Promise<void> {
  await emitAdminRideVideoSegmentAvailable(fields);
}

export async function emitAdminRideVideoSegmentAvailable(
  fields: Omit<AdminRideVideoSegmentEvent, 'timestamp'>
): Promise<void> {
  await emitToAdmins('admin:ride-video:segment_available', {
    ...basePayload(fields.sessionId, fields.bookingId, fields.sessionStatus, fields.lastActivityAt),
    segmentId: fields.segmentId,
    segmentIndex: fields.segmentIndex,
    uploadStatus: fields.uploadStatus,
    availableSegmentCount: fields.availableSegmentCount,
    readySegmentCount: fields.readySegmentCount,
    latestSegmentIndex: fields.latestSegmentIndex ?? fields.latestAvailableSegmentIndex,
    latestAvailableSegmentIndex: fields.latestAvailableSegmentIndex ?? fields.latestSegmentIndex,
    liveEdgeSeconds: fields.liveEdgeSeconds,
    manifestVersion: fields.manifestVersion,
  });
}

export async function emitAdminRideVideoManifestUpdated(
  fields: Omit<AdminRideVideoManifestEvent, 'timestamp'>
): Promise<void> {
  await emitToAdmins('admin:ride-video:manifest_updated', {
    ...basePayload(fields.sessionId, fields.bookingId, fields.sessionStatus, fields.lastActivityAt),
    manifestVersion: fields.manifestVersion,
    latestAvailableSegmentIndex: fields.latestAvailableSegmentIndex,
    liveEdgeSeconds: fields.liveEdgeSeconds,
    recordingActive: fields.recordingActive,
  });
}

export async function emitAdminRideVideoFinalizing(
  fields: Omit<AdminRideVideoSessionEvent, 'timestamp'>
): Promise<void> {
  await emitToAdmins('admin:ride-video:finalizing', {
    ...basePayload(fields.sessionId, fields.bookingId, fields.sessionStatus, fields.lastActivityAt),
    playbackAvailable: fields.playbackAvailable,
    availableSegmentCount: fields.availableSegmentCount,
    manifestVersion: fields.manifestVersion,
    latestAvailableSegmentIndex: fields.latestAvailableSegmentIndex ?? null,
    liveEdgeSeconds: fields.liveEdgeSeconds,
    recordingActive: fields.recordingActive ?? true,
  });
}

export async function emitAdminRideVideoHealthUpdated(
  fields: AdminRideVideoEventBase & {
    uploadHealth?: string;
    healthState?: string;
    missingSegmentCount?: number;
    failedSegmentCount?: number;
  }
): Promise<void> {
  await emitToAdmins('admin:ride-video:health_updated', {
    ...basePayload(fields.sessionId, fields.bookingId, fields.sessionStatus, fields.lastActivityAt),
    uploadHealth: fields.uploadHealth,
    healthState: fields.healthState,
    missingSegmentCount: fields.missingSegmentCount,
    failedSegmentCount: fields.failedSegmentCount,
  });
}

export async function emitAdminRideVideoFinalized(
  fields: Omit<AdminRideVideoSessionEvent, 'timestamp'> & { finalizedAt: string }
): Promise<void> {
  await emitToAdmins('admin:ride-video:finalized', {
    ...basePayload(fields.sessionId, fields.bookingId, fields.sessionStatus, fields.lastActivityAt),
    recordingStatus: fields.recordingStatus,
    playbackAvailable: fields.playbackAvailable,
    availableSegmentCount: fields.availableSegmentCount,
    readySegmentCount: fields.readySegmentCount,
    latestSegmentIndex: fields.latestSegmentIndex ?? fields.latestAvailableSegmentIndex ?? null,
    latestAvailableSegmentIndex: fields.latestAvailableSegmentIndex ?? fields.latestSegmentIndex ?? null,
    liveEdgeSeconds: fields.liveEdgeSeconds,
    manifestVersion: fields.manifestVersion,
    recordingActive: false,
    finalized: true,
    finalizedAt: fields.finalizedAt,
  });
}
