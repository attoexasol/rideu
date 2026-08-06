import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { videoConfig } from '../config/video';
import { BookingStatus } from '../constants/bookingStatus';
import { db } from '../db/connection';
import { bookings, videoSegments, videoSessions } from '../db/schema';
import { inspectPrivateSegment } from './ride-video-storage.service';
import { createAdminSegmentReadUrl } from './rideVideoRead.service';
import { traceRideVideo } from './rideVideoTrace.service';
import {
  buildDvrTimeline,
  isPlayableSegment,
  resolveTerminalSessionStatus,
  sliceDvrManifest,
  type DvrSegmentInput,
} from './rideVideoDvr.helpers';
import {
  emitAdminRideVideoFinalized,
  emitAdminRideVideoFinalizing,
  emitAdminRideVideoManifestUpdated,
  emitAdminRideVideoSegmentAvailable,
} from './adminRideVideoNotify.service';
import {
  computePlaybackEligibility,
  computeSegmentCounts,
  mapAdminRecordingStatus,
  type SegmentStatInput,
} from './adminRideVideo.helpers';

const RECOVERABLE_STATUSES = ['pending', 'active', 'paused', 'finalizing'];
const TERMINAL_BOOKING_STATUSES = [
  BookingStatus.COMPLETED,
  BookingStatus.CANCELLED,
] as string[];

export type ManifestBumpReason =
  | 'segment_playable'
  | 'segment_failed'
  | 'segment_recovered'
  | 'session_finalizing'
  | 'session_finalized';

function toDvrSegments(
  rows: Array<typeof videoSegments.$inferSelect>
): DvrSegmentInput[] {
  return rows.map((segment) => ({
    segmentId: segment.id,
    segmentIndex: segment.sequenceNumber,
    durationMs: segment.durationMs,
    mimeType: segment.mimeType,
    uploadStatus: segment.uploadStatus,
    storageKey: segment.storageKey,
    retentionDeletedAt: segment.retentionDeletedAt,
  }));
}

function toSegmentStats(rows: Array<typeof videoSegments.$inferSelect>): SegmentStatInput[] {
  return rows.map((segment) => ({
    sequenceNumber: segment.sequenceNumber,
    uploadStatus: segment.uploadStatus,
    durationMs: segment.durationMs,
    retentionDeletedAt: segment.retentionDeletedAt,
    uploadedAt: segment.uploadedAt,
    recordedAt: segment.recordedAt,
  }));
}

export async function bumpManifestVersion(
  sessionId: string,
  reason: ManifestBumpReason
): Promise<number> {
  const updated = await db
    .update(videoSessions)
    .set({
      manifestVersion: sql`${videoSessions.manifestVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(videoSessions.id, sessionId))
    .returning({
      manifestVersion: videoSessions.manifestVersion,
      bookingId: videoSessions.bookingId,
      status: videoSessions.status,
    });

  const row = updated[0];
  if (!row) return 0;

  traceRideVideo({
    stage: 'admin_playback_manifest',
    bookingId: row.bookingId,
    sessionId,
    sessionStatus: row.status,
    reason,
  });

  return row.manifestVersion;
}

export async function touchUploadActivity(sessionId: string): Promise<void> {
  await db
    .update(videoSessions)
    .set({ lastUploadActivityAt: new Date(), updatedAt: new Date() })
    .where(eq(videoSessions.id, sessionId));
}

export async function reconcileStaleSegments(sessionId: string): Promise<void> {
  const now = Date.now();
  const segments = await db
    .select()
    .from(videoSegments)
    .where(eq(videoSegments.sessionId, sessionId));

  for (const segment of segments) {
    const ageMs = now - (segment.updatedAt?.getTime() ?? segment.createdAt.getTime());
    if (segment.uploadStatus === 'pending' && ageMs > videoConfig.staleRegisteredSegmentSeconds * 1000) {
      if (segment.storageKey) {
        const object = await inspectPrivateSegment(segment.storageKey);
        if (object) {
          await db
            .update(videoSegments)
            .set({
              uploadStatus: 'uploaded',
              fileSizeBytes: object.fileSizeBytes,
              uploadedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(videoSegments.id, segment.id));
          continue;
        }
      }
      await db
        .update(videoSegments)
        .set({
          uploadStatus: 'failed',
          failureReason: 'Stale registered segment timed out',
          updatedAt: new Date(),
        })
        .where(eq(videoSegments.id, segment.id));
      await bumpManifestVersion(sessionId, 'segment_failed');
    }

    if (
      segment.uploadStatus === 'uploading' &&
      ageMs > videoConfig.staleUploadingSegmentSeconds * 1000
    ) {
      await db
        .update(videoSegments)
        .set({
          uploadStatus: 'failed',
          failureReason: 'Upload did not complete in time',
          updatedAt: new Date(),
        })
        .where(eq(videoSegments.id, segment.id));
      await bumpManifestVersion(sessionId, 'segment_failed');
    }
  }
}

export async function completeFinalizingSession(
  sessionId: string,
  reason = 'Upload grace elapsed'
): Promise<typeof videoSessions.$inferSelect | null> {
  const sessionRows = await db
    .select()
    .from(videoSessions)
    .where(eq(videoSessions.id, sessionId))
    .limit(1);
  const session = sessionRows[0];
  if (!session || session.status !== 'finalizing') return session ?? null;

  await reconcileStaleSegments(sessionId);

  const segments = await db
    .select()
    .from(videoSegments)
    .where(eq(videoSegments.sessionId, sessionId));

  const pending = segments.filter((s) => ['pending', 'uploading'].includes(s.uploadStatus));
  const lastActivity = session.lastUploadActivityAt ?? session.updatedAt;
  const graceElapsed =
    Date.now() - lastActivity.getTime() > videoConfig.uploadGracePeriodSeconds * 1000;

  if (pending.length > 0 && !graceElapsed) return session;

  if (pending.length > 0 && graceElapsed) {
    for (const segment of pending) {
      if (segment.storageKey) {
        const object = await inspectPrivateSegment(segment.storageKey);
        if (object) {
          await db
            .update(videoSegments)
            .set({
              uploadStatus: 'verified',
              fileSizeBytes: object.fileSizeBytes,
              uploadedAt: segment.uploadedAt ?? new Date(),
              updatedAt: new Date(),
            })
            .where(eq(videoSegments.id, segment.id));
          continue;
        }
      }
      await db
        .update(videoSegments)
        .set({
          uploadStatus: 'failed',
          failureReason: reason,
          updatedAt: new Date(),
        })
        .where(eq(videoSegments.id, segment.id));
    }
  }

  const refreshed = await db
    .select()
    .from(videoSegments)
    .where(eq(videoSegments.sessionId, sessionId));

  const terminalStatus = resolveTerminalSessionStatus({
    segments: toDvrSegments(refreshed),
    pendingCount: refreshed.filter((s) => ['pending', 'uploading'].includes(s.uploadStatus)).length,
    defaultSegmentDurationSeconds: videoConfig.segmentDurationSeconds,
  });

  const now = new Date();
  const updated = await db
    .update(videoSessions)
    .set({
      status: terminalStatus,
      finalizedAt: now,
      endedAt: session.endedAt ?? now,
      updatedAt: now,
    })
    .where(eq(videoSessions.id, sessionId))
    .returning();

  let finalizedSession = updated[0];
  if (!finalizedSession) {
    const reloaded = await db
      .select()
      .from(videoSessions)
      .where(eq(videoSessions.id, sessionId))
      .limit(1);
    finalizedSession = reloaded[0];
  }
  if (!finalizedSession) return null;

  await bumpManifestVersion(sessionId, 'session_finalized');

  const dvr = buildDvrTimeline({
    sessionStatus: finalizedSession.status,
    finalizedAt: finalizedSession.finalizedAt,
    segments: toDvrSegments(refreshed),
    defaultSegmentDurationSeconds: videoConfig.segmentDurationSeconds,
  });
  const healthInput = {
    sessionStatus: finalizedSession.status,
    consentStatus: finalizedSession.consentStatus,
    finalizedAt: finalizedSession.finalizedAt,
    retentionDays: videoConfig.retentionDays,
    segmentDurationSeconds: videoConfig.segmentDurationSeconds,
    segments: toSegmentStats(refreshed),
  };
  const playback = computePlaybackEligibility(healthInput);
  const counts = computeSegmentCounts(toSegmentStats(refreshed));

  await emitAdminRideVideoFinalized({
    sessionId,
    bookingId: finalizedSession.bookingId,
    sessionStatus: finalizedSession.status,
    recordingStatus: mapAdminRecordingStatus(healthInput),
    playbackAvailable: playback.playbackAvailable,
    availableSegmentCount: dvr.playableSegmentCount,
    readySegmentCount: counts.readySegmentCount,
    latestSegmentIndex: dvr.latestAvailableSegmentIndex,
    finalizedAt: finalizedSession.finalizedAt!.toISOString(),
    lastActivityAt: finalizedSession.updatedAt.toISOString(),
    manifestVersion: finalizedSession.manifestVersion,
    liveEdgeSeconds: dvr.liveEdgeSeconds,
    recordingActive: false,
  });

  traceRideVideo({
    stage: 'session_finalized',
    bookingId: finalizedSession.bookingId,
    sessionId,
    sessionStatus: finalizedSession.status,
    finalizedAt: finalizedSession.finalizedAt?.toISOString() ?? null,
    readySegmentCount: counts.readySegmentCount,
    playableSegmentCount: dvr.playableSegmentCount,
    reason,
  });

  return finalizedSession;
}

export async function onSegmentBecamePlayable(params: {
  session: typeof videoSessions.$inferSelect;
  segment: typeof videoSegments.$inferSelect;
  allSegments: Array<typeof videoSegments.$inferSelect>;
}): Promise<number> {
  await touchUploadActivity(params.session.id);
  const version = await bumpManifestVersion(params.session.id, 'segment_playable');

  const dvr = buildDvrTimeline({
    sessionStatus: params.session.status,
    finalizedAt: params.session.finalizedAt,
    segments: toDvrSegments(params.allSegments),
    defaultSegmentDurationSeconds: videoConfig.segmentDurationSeconds,
  });

  await emitAdminRideVideoSegmentAvailable({
    sessionId: params.session.id,
    bookingId: params.session.bookingId,
    sessionStatus: params.session.status,
    segmentId: params.segment.id,
    segmentIndex: params.segment.sequenceNumber,
    uploadStatus: params.segment.uploadStatus,
    availableSegmentCount: dvr.playableSegmentCount,
    latestAvailableSegmentIndex: dvr.latestAvailableSegmentIndex,
    liveEdgeSeconds: dvr.liveEdgeSeconds,
    manifestVersion: version,
    lastActivityAt: params.segment.uploadedAt?.toISOString() ?? new Date().toISOString(),
  });

  await emitAdminRideVideoManifestUpdated({
    sessionId: params.session.id,
    bookingId: params.session.bookingId,
    sessionStatus: params.session.status,
    manifestVersion: version,
    latestAvailableSegmentIndex: dvr.latestAvailableSegmentIndex,
    liveEdgeSeconds: dvr.liveEdgeSeconds,
    recordingActive: dvr.recordingActive,
    lastActivityAt: params.segment.uploadedAt?.toISOString(),
  });

  if (params.session.status === 'finalizing') {
    await completeFinalizingSession(params.session.id);
  }

  return version;
}

export async function enterSessionFinalizing(
  session: typeof videoSessions.$inferSelect,
  reason: string
): Promise<typeof videoSessions.$inferSelect> {
  const now = new Date();
  await db
    .update(videoSessions)
    .set({ status: 'finalizing', endedAt: now, updatedAt: now })
    .where(eq(videoSessions.id, session.id));

  const version = await bumpManifestVersion(session.id, 'session_finalizing');
  const segments = await db
    .select()
    .from(videoSegments)
    .where(eq(videoSegments.sessionId, session.id));
  const dvr = buildDvrTimeline({
    sessionStatus: 'finalizing',
    finalizedAt: null,
    segments: toDvrSegments(segments),
    defaultSegmentDurationSeconds: videoConfig.segmentDurationSeconds,
  });

  await emitAdminRideVideoFinalizing({
    sessionId: session.id,
    bookingId: session.bookingId,
    sessionStatus: 'finalizing',
    manifestVersion: version,
    latestAvailableSegmentIndex: dvr.latestAvailableSegmentIndex,
    liveEdgeSeconds: dvr.liveEdgeSeconds,
    recordingActive: true,
    playbackAvailable: dvr.playableSegmentCount > 0,
    availableSegmentCount: dvr.playableSegmentCount,
    lastActivityAt: now.toISOString(),
  });

  traceRideVideo({
    stage: 'session_finalizing',
    bookingId: session.bookingId,
    sessionId: session.id,
    driverId: session.driverId,
    sessionStatus: 'finalizing',
    reason,
  });

  return { ...session, status: 'finalizing', endedAt: now, updatedAt: now, manifestVersion: version };
}

export interface BuildDvrManifestOptions {
  fromOffsetSeconds?: number;
  fromSegmentIndex?: number;
  fromIndex?: number;
  sinceManifestVersion?: number;
  limit?: number;
}

export async function buildDvrPlaybackManifest(
  session: typeof videoSessions.$inferSelect,
  segments: Array<typeof videoSegments.$inferSelect>,
  options: BuildDvrManifestOptions = {}
) {
  const verifiedSegments: DvrSegmentInput[] = [];
  const storageIssues: Array<{ segmentId: string; segmentIndex: number }> = [];

  for (const segment of segments) {
    const candidate: DvrSegmentInput = {
      segmentId: segment.id,
      segmentIndex: segment.sequenceNumber,
      durationMs: segment.durationMs,
      mimeType: segment.mimeType,
      uploadStatus: segment.uploadStatus,
      storageKey: segment.storageKey,
      retentionDeletedAt: segment.retentionDeletedAt,
    };
    if (!isPlayableSegment(candidate)) continue;
    const object = segment.storageKey ? await inspectPrivateSegment(segment.storageKey) : null;
    if (!object) {
      storageIssues.push({ segmentId: segment.id, segmentIndex: segment.sequenceNumber });
      continue;
    }
    verifiedSegments.push(candidate);
  }

  const timeline = buildDvrTimeline({
    sessionStatus: session.status,
    finalizedAt: session.finalizedAt,
    segments: verifiedSegments,
    defaultSegmentDurationSeconds: videoConfig.segmentDurationSeconds,
  });

  const fromSegmentIndex =
    options.fromSegmentIndex ??
    (options.fromIndex != null ? options.fromIndex : undefined);

  const slice = sliceDvrManifest(timeline, {
    fromOffsetSeconds: options.fromOffsetSeconds,
    fromSegmentIndex,
    sinceManifestVersion: options.sinceManifestVersion,
    currentManifestVersion: session.manifestVersion,
    limit: options.limit,
  });

  const manifestSegments = [];
  for (const segment of slice.segments) {
    const signed = await createAdminSegmentReadUrl(segment.segmentId);
    manifestSegments.push({
      segmentId: segment.segmentId,
      segmentIndex: segment.segmentIndex,
      startOffsetSeconds: segment.startOffsetSeconds,
      durationSeconds: segment.durationSeconds,
      endOffsetSeconds: segment.endOffsetSeconds,
      url: signed.url,
      expiresAt: signed.expiresAt,
      contentType: segment.mimeType,
      availabilityStatus: 'ready' as const,
    });
  }

  return {
    timeline,
    slice,
    storageIssues,
    manifestSegments,
    manifestVersion: session.manifestVersion,
  };
}

export async function reconcileStaleSessions(): Promise<number> {
  if (!videoConfig.enabled) return 0;

  const cutoff = new Date(Date.now() - videoConfig.uploadGracePeriodSeconds * 1000);
  const sessions = await db
    .select({
      session: videoSessions,
      booking: bookings,
    })
    .from(videoSessions)
    .innerJoin(bookings, eq(videoSessions.bookingId, bookings.id))
    .where(
      and(
        inArray(videoSessions.status, RECOVERABLE_STATUSES),
        lt(videoSessions.updatedAt, cutoff)
      )
    );

  let reconciled = 0;
  for (const { session, booking } of sessions) {
    const bookingTerminal = TERMINAL_BOOKING_STATUSES.includes(booking.status);
    const inactive =
      session.lastUploadActivityAt != null
        ? session.lastUploadActivityAt < cutoff
        : session.updatedAt < cutoff;

    if (!bookingTerminal && session.status !== 'finalizing') continue;
    if (!inactive && session.status !== 'finalizing') continue;

    if (session.status !== 'finalizing') {
      await enterSessionFinalizing(session, 'Disconnect recovery — booking terminal');
    }
    await completeFinalizingSession(session.id, 'Disconnect recovery finalize');
    reconciled += 1;
  }

  return reconciled;
}

export async function emitRecordingStopInstruction(params: {
  bookingId: string;
  sessionId: string;
  driverId: string;
  reason: string;
}): Promise<void> {
  const { emitToDriver } = await import('./bookingNotify.service');
  await emitToDriver(params.driverId, 'recording:stop', {
    bookingId: params.bookingId,
    sessionId: params.sessionId,
    reason: params.reason,
    timestamp: new Date().toISOString(),
  });
}

export { buildDvrTimeline, userFriendlyPlaybackReason } from './rideVideoDvr.helpers';
