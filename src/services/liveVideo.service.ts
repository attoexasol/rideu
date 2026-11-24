import { db } from '../db/connection';
import { videoSessions, videoSegments } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { localVideoStorage } from './video-storage.service';
import { emitLiveVideoSegment } from './bookingNotify.service';
import { BookingStatus } from '../constants/bookingStatus';
import { findBookingById } from '../repositories/booking.repository';
import { videoConfig } from '../config/video';
import { isVideoRecordingSettingEnabled } from './videoRecordingPolicy.service';

export async function startVideoSessionForTrip(params: {
  tripId: string;
  bookingId: string;
  driverId: string;
  customerId: string;
}) {
  const existing = await findActiveSessionByBooking(params.bookingId);
  if (existing) return existing;

  const [session] = await db
    .insert(videoSessions)
    .values({
      tripId: params.tripId,
      bookingId: params.bookingId,
      driverId: params.driverId,
      passengerId: params.customerId,
      status: 'active',
      consentStatus: 'granted',
      startedAt: new Date(),
    })
    .returning();

  const { emitToAdmins } = await import('./bookingNotify.service');
  await emitToAdmins('video:session-started', {
    sessionId: session.id,
    tripId: params.tripId,
    bookingId: params.bookingId,
    customerId: params.customerId,
  });

  return session;
}

export async function findActiveSessionByBooking(bookingId: string) {
  const rows = await db
    .select()
    .from(videoSessions)
    .where(and(eq(videoSessions.bookingId, bookingId), eq(videoSessions.status, 'active')))
    .limit(1);
  return rows[0] ?? null;
}

async function assertVideoUploadAllowed(bookingId: string, driverId: string) {
  const booking = await findBookingById(bookingId);
  if (!booking) {
    const err = new Error('Booking not found');
    (err as any).code = 'BOOKING_NOT_ASSIGNED';
    throw err;
  }
  if (booking.assignedDriverId !== driverId) {
    const err = new Error('Access denied');
    (err as any).code = 'FORBIDDEN';
    throw err;
  }
  if (booking.status !== BookingStatus.IN_PROGRESS) {
    const err = new Error('Video upload is only allowed while ride is in progress');
    (err as any).code = 'INVALID_STATUS_TRANSITION';
    throw err;
  }
  if (!booking.recordingConsentedAt) {
    const err = new Error('Passenger recording consent is required');
    (err as any).code = 'RECORDING_CONSENT_REQUIRED';
    throw err;
  }
  return booking;
}

export async function uploadLiveChunk(params: {
  sessionId: string;
  driverId: string;
  buffer: Buffer;
  mimeType: string;
  segmentIndex: number;
  durationSeconds?: number;
}) {
  if (videoConfig.enabled) {
    const err = new Error('Legacy public live-chunk uploads are disabled');
    (err as any).code = 'LEGACY_VIDEO_UPLOAD_DISABLED';
    throw err;
  }
  if (!(await isVideoRecordingSettingEnabled('legacy_live_chunk'))) {
    const err = new Error('Ride video recording is disabled');
    (err as any).code = 'VIDEO_RECORDING_DISABLED';
    throw err;
  }

  const sessionRows = await db
    .select()
    .from(videoSessions)
    .where(eq(videoSessions.id, params.sessionId))
    .limit(1);
  const session = sessionRows[0];
  if (!session) {
    const err = new Error('Video session not found');
    (err as any).code = 'VIDEO_SESSION_NOT_FOUND';
    throw err;
  }
  if (session.driverId !== params.driverId) {
    const err = new Error('Access denied');
    (err as any).code = 'FORBIDDEN';
    throw err;
  }
  if (session.status !== 'active') {
    const err = new Error('Video session is not active');
    (err as any).code = 'VIDEO_SESSION_NOT_FOUND';
    throw err;
  }

  if (session.bookingId) {
    await assertVideoUploadAllowed(session.bookingId, params.driverId);
  }

  const existing = await db
    .select()
    .from(videoSegments)
    .where(
      and(
        eq(videoSegments.sessionId, params.sessionId),
        eq(videoSegments.sequenceNumber, params.segmentIndex)
      )
    )
    .limit(1);

  if (existing[0]) {
    return existing[0];
  }

  const stored = await localVideoStorage.saveBuffer({
    buffer: params.buffer,
    mimeType: params.mimeType,
    prefix: `live/${session.tripId}`,
  });

  const [segment] = await db
    .insert(videoSegments)
    .values({
      sessionId: params.sessionId,
      bookingId: session.bookingId,
      driverId: params.driverId,
      sequenceNumber: params.segmentIndex,
      clientSegmentId: `legacy-${params.segmentIndex}`,
      storageKey: stored.storageKey,
      uploadStatus: 'verified',
      videoUrl: stored.videoUrl,
      mimeType: params.mimeType,
      fileSizeBytes: params.buffer.length,
      durationMs: params.durationSeconds ? Math.round(params.durationSeconds * 1000) : null,
      uploadedAt: new Date(),
    })
    .returning();

  if (session.bookingId) {
    const bookingRow = await findBookingById(session.bookingId);
    if (bookingRow) {
      await emitLiveVideoSegment(bookingRow.customerId, session.bookingId, {
        sessionId: params.sessionId,
        segmentIndex: params.segmentIndex,
        videoUrl: stored.videoUrl,
        timestamp: new Date().toISOString(),
      });
    }
  }

  return segment;
}

export async function uploadLiveChunkForBooking(params: {
  bookingId: string;
  sessionId: string;
  driverId: string;
  buffer: Buffer;
  mimeType: string;
  segmentIndex: number;
  durationSeconds?: number;
}) {
  await assertVideoUploadAllowed(params.bookingId, params.driverId);

  const sessionRows = await db
    .select()
    .from(videoSessions)
    .where(
      and(eq(videoSessions.id, params.sessionId), eq(videoSessions.bookingId, params.bookingId))
    )
    .limit(1);

  if (!sessionRows[0]) {
    const err = new Error('Video session not found for booking');
    (err as any).code = 'VIDEO_SESSION_NOT_FOUND';
    throw err;
  }

  return uploadLiveChunk({
    sessionId: params.sessionId,
    driverId: params.driverId,
    buffer: params.buffer,
    mimeType: params.mimeType,
    segmentIndex: params.segmentIndex,
    durationSeconds: params.durationSeconds,
  });
}

export async function endVideoSessionForBooking(bookingId: string) {
  const session = await findActiveSessionByBooking(bookingId);
  if (!session) return null;

  const [ended] = await db
    .update(videoSessions)
    .set({ status: 'ended', endedAt: new Date(), updatedAt: new Date() })
    .where(eq(videoSessions.id, session.id))
    .returning();

  const { emitToAdmins } = await import('./bookingNotify.service');
  await emitToAdmins('video:session-ended', {
    sessionId: session.id,
    bookingId,
  });

  return ended;
}

export async function listLiveSegments(sessionId: string) {
  return db
    .select()
    .from(videoSegments)
    .where(eq(videoSegments.sessionId, sessionId))
    .orderBy(videoSegments.sequenceNumber);
}

export async function listLiveSegmentsByBooking(bookingId: string) {
  const session = await findActiveSessionByBooking(bookingId);
  if (!session) {
    const past = await db
      .select()
      .from(videoSessions)
      .where(eq(videoSessions.bookingId, bookingId))
      .orderBy(desc(videoSessions.startedAt))
      .limit(1);
    if (!past[0]) return { session: null, segments: [] };
    const segments = await listLiveSegments(past[0].id);
    return { session: past[0], segments };
  }
  const segments = await listLiveSegments(session.id);
  return { session, segments };
}
