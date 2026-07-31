import { randomUUID } from 'crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { videoConfig } from '../config/video';
import { BookingStatus } from '../constants/bookingStatus';
import { db } from '../db/connection';
import { videoSegments, videoSessions } from '../db/schema';
import { logger } from '../middleware/logger';
import { findBookingById } from '../repositories/booking.repository';
import {
  createPrivateStorageKey,
  createReadToken,
  createUploadToken,
  inspectPrivateSegment,
  savePrivateSegment,
  verifyStorageToken,
} from './ride-video-storage.service';
import { emitToAdmins, emitToCustomer, emitToDriver } from './bookingNotify.service';

const RECORDABLE_BOOKING_STATUSES = [
  BookingStatus.ACCEPTED,
  BookingStatus.DRIVER_EN_ROUTE,
  BookingStatus.ARRIVED,
  BookingStatus.IN_PROGRESS,
] as string[];
const RECOVERABLE_SESSION_STATUSES = ['pending', 'active', 'paused', 'finalizing'];
const REGISTERABLE_SESSION_STATUSES = ['active', 'paused'];

export class RideVideoError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
  }
}

function consentStatus(booking: Awaited<ReturnType<typeof findBookingById>>) {
  if (!videoConfig.consentRequired) return 'not_required' as const;
  if (booking?.recordingConsentStatus === 'denied') return 'denied' as const;
  if (booking?.recordingConsentStatus === 'granted' || booking?.recordingConsentedAt) {
    return 'granted' as const;
  }
  return 'required' as const;
}

function assertRecordingEnabled(): void {
  if (!videoConfig.enabled) {
    throw new RideVideoError('VIDEO_RECORDING_DISABLED', 'Ride video recording is disabled', 503);
  }
}

async function assertRecordableBooking(bookingId: string, driverId: string) {
  const booking = await findBookingById(bookingId);
  if (!booking) throw new RideVideoError('BOOKING_NOT_FOUND', 'Booking not found', 404);
  if (booking.assignedDriverId !== driverId) {
    logger.warn({ event: 'recording.unauthorized', bookingId, driverId });
    throw new RideVideoError('FORBIDDEN', 'Driver is not assigned to this booking', 403);
  }
  if (!RECORDABLE_BOOKING_STATUSES.includes(booking.status)) {
    throw new RideVideoError(
      'BOOKING_NOT_RECORDABLE',
      `Booking status ${booking.status} does not allow recording`,
      409
    );
  }
  const authoritativeConsent = consentStatus(booking);
  if (authoritativeConsent !== 'granted' && authoritativeConsent !== 'not_required') {
    logger.info({
      event: 'recording.consent_denied',
      bookingId,
      driverId,
      consentStatus: authoritativeConsent,
    });
    throw new RideVideoError(
      authoritativeConsent === 'denied' ? 'RECORDING_CONSENT_DENIED' : 'RECORDING_CONSENT_REQUIRED',
      authoritativeConsent === 'denied'
        ? 'Passenger denied recording consent'
        : 'Passenger recording consent is required',
      409
    );
  }
  return { booking, consentStatus: authoritativeConsent };
}

async function findRecoverableSession(bookingId: string, driverId?: string) {
  const conditions = [
    eq(videoSessions.bookingId, bookingId),
    inArray(videoSessions.status, RECOVERABLE_SESSION_STATUSES),
  ];
  if (driverId) conditions.push(eq(videoSessions.driverId, driverId));
  const rows = await db
    .select()
    .from(videoSessions)
    .where(and(...conditions))
    .orderBy(desc(videoSessions.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

async function getOwnedSession(sessionId: string, driverId: string) {
  const rows = await db
    .select()
    .from(videoSessions)
    .where(eq(videoSessions.id, sessionId))
    .limit(1);
  const session = rows[0];
  if (!session) throw new RideVideoError('VIDEO_SESSION_NOT_FOUND', 'Video session not found', 404);
  if (session.driverId !== driverId) {
    logger.warn({ event: 'recording.unauthorized', sessionId, driverId });
    throw new RideVideoError('FORBIDDEN', 'Video session belongs to another driver', 403);
  }
  return session;
}

function formatSession(session: typeof videoSessions.$inferSelect) {
  return {
    id: session.id,
    bookingId: session.bookingId,
    driverId: session.driverId,
    status: session.status,
    consentStatus: session.consentStatus,
    startedAt: session.startedAt?.toISOString() ?? null,
    pausedAt: session.pausedAt?.toISOString() ?? null,
    endedAt: session.endedAt?.toISOString() ?? null,
    finalizedAt: session.finalizedAt?.toISOString() ?? null,
    segmentDurationSeconds: videoConfig.segmentDurationSeconds,
    maxSegmentSizeBytes: videoConfig.maxSegmentSizeBytes,
  };
}

function formatSegment(segment: typeof videoSegments.$inferSelect) {
  return {
    id: segment.id,
    sessionId: segment.sessionId,
    bookingId: segment.bookingId,
    sequenceNumber: segment.sequenceNumber,
    clientSegmentId: segment.clientSegmentId,
    uploadStatus: segment.uploadStatus,
    durationMs: segment.durationMs,
    fileSizeBytes: segment.fileSizeBytes,
    mimeType: segment.mimeType,
    checksum: segment.checksum,
    recordedAt: segment.recordedAt?.toISOString() ?? null,
    uploadedAt: segment.uploadedAt?.toISOString() ?? null,
    retryCount: segment.retryCount,
    failureReason: segment.failureReason,
    createdAt: segment.createdAt.toISOString(),
    updatedAt: segment.updatedAt.toISOString(),
  };
}

function uploadDetails(segment: typeof videoSegments.$inferSelect) {
  if (!segment.storageKey) {
    throw new RideVideoError('VIDEO_STORAGE_ERROR', 'Segment storage key is missing', 500);
  }
  const authorization = createUploadToken({
    segmentId: segment.id,
    driverId: segment.driverId,
    storageKey: segment.storageKey,
  });
  return {
    segment: formatSegment(segment),
    upload: {
      method: 'PUT',
      url: `/api/v1/driver/video/segments/${segment.id}/upload?token=${authorization.token}`,
      storageKey: segment.storageKey,
      expiresAt: authorization.expiresAt.toISOString(),
      requiredHeaders: { 'Content-Type': segment.mimeType },
    },
  };
}

export async function createOrRestoreRideVideoSession(bookingId: string, driverId: string) {
  assertRecordingEnabled();
  const { booking, consentStatus: status } = await assertRecordableBooking(bookingId, driverId);
  const existing = await findRecoverableSession(bookingId, driverId);
  if (existing) {
    logger.info({
      event: 'recording.session_restored',
      bookingId,
      sessionId: existing.id,
      driverId,
    });
    return formatSession(existing);
  }

  const now = new Date();
  let session: typeof videoSessions.$inferSelect;
  try {
    session = await db.transaction(async (tx) => {
      const existingInTransaction = await tx
        .select()
        .from(videoSessions)
        .where(
          and(
            eq(videoSessions.bookingId, bookingId),
            eq(videoSessions.driverId, driverId),
            inArray(videoSessions.status, RECOVERABLE_SESSION_STATUSES)
          )
        )
        .limit(1);
      if (existingInTransaction[0]) return existingInTransaction[0];
      const inserted = await tx
        .insert(videoSessions)
        .values({
          bookingId,
          tripId: booking.linkedTripId,
          driverId,
          passengerId: booking.customerId,
          status: 'active',
          consentStatus: status,
          startedAt: now,
        })
        .returning();
      return inserted[0];
    });
  } catch (error) {
    if ((error as { code?: string }).code !== '23505') throw error;
    const raced = await findRecoverableSession(bookingId, driverId);
    if (!raced) throw error;
    session = raced;
  }

  logger.info({ event: 'recording.session_created', bookingId, sessionId: session.id, driverId });
  const payload = {
    bookingId,
    sessionId: session.id,
    status: session.status,
    timestamp: now.toISOString(),
  };
  await Promise.allSettled([
    emitToDriver(driverId, 'recording:session_started', payload),
    emitToCustomer(booking.customerId, 'recording:session_started', payload),
    emitToAdmins('recording:session_started', payload),
  ]);
  return formatSession(session);
}

export async function getRideVideoSessionStatus(bookingId: string, driverId: string) {
  assertRecordingEnabled();
  const booking = await findBookingById(bookingId);
  if (!booking) throw new RideVideoError('BOOKING_NOT_FOUND', 'Booking not found', 404);
  if (booking.assignedDriverId !== driverId) {
    throw new RideVideoError('FORBIDDEN', 'Driver is not assigned to this booking', 403);
  }
  const session = await findRecoverableSession(bookingId, driverId);
  const authoritativeConsent = consentStatus(booking);
  if (!session) {
    return {
      session: null,
      consentStatus: authoritativeConsent,
      nextExpectedSequenceNumber: 0,
      uploadedSegmentCount: 0,
      pendingOrFailedSegmentCount: 0,
      shouldContinueRecording:
        RECORDABLE_BOOKING_STATUSES.includes(booking.status) &&
        ['granted', 'not_required'].includes(authoritativeConsent),
      bookingStatus: booking.status,
    };
  }

  const segments = await db
    .select()
    .from(videoSegments)
    .where(eq(videoSegments.sessionId, session.id));
  const maxSequence = segments.reduce(
    (maximum, segment) => Math.max(maximum, segment.sequenceNumber),
    -1
  );
  return {
    session: formatSession(session),
    consentStatus: authoritativeConsent,
    nextExpectedSequenceNumber: maxSequence + 1,
    uploadedSegmentCount: segments.filter((segment) =>
      ['uploaded', 'verified'].includes(segment.uploadStatus)
    ).length,
    pendingOrFailedSegmentCount: segments.filter((segment) =>
      ['pending', 'uploading', 'failed'].includes(segment.uploadStatus)
    ).length,
    shouldContinueRecording:
      REGISTERABLE_SESSION_STATUSES.includes(session.status) &&
      RECORDABLE_BOOKING_STATUSES.includes(booking.status) &&
      ['granted', 'not_required'].includes(authoritativeConsent),
    bookingStatus: booking.status,
  };
}

export interface RegisterSegmentInput {
  clientSegmentId: string;
  sequenceNumber: number;
  durationMs?: number;
  fileSizeBytes?: number;
  mimeType: string;
  recordedAt?: Date;
  checksum?: string;
}

export async function registerRideVideoSegment(
  sessionId: string,
  driverId: string,
  input: RegisterSegmentInput
) {
  assertRecordingEnabled();
  const session = await getOwnedSession(sessionId, driverId);
  if (!REGISTERABLE_SESSION_STATUSES.includes(session.status)) {
    throw new RideVideoError('VIDEO_SESSION_NOT_ACTIVE', 'Session cannot accept segments', 409);
  }
  await assertRecordableBooking(session.bookingId, driverId);
  if (!Number.isSafeInteger(input.sequenceNumber) || input.sequenceNumber < 0) {
    throw new RideVideoError('INVALID_SEQUENCE_NUMBER', 'sequenceNumber must be non-negative', 400);
  }
  if (
    input.durationMs != null &&
    (!Number.isFinite(input.durationMs) ||
      input.durationMs < 0 ||
      input.durationMs > videoConfig.segmentDurationSeconds * 2_000)
  ) {
    throw new RideVideoError(
      'INVALID_DURATION',
      'durationMs is outside the allowed segment range',
      400
    );
  }
  if (
    input.fileSizeBytes != null &&
    (!Number.isSafeInteger(input.fileSizeBytes) ||
      input.fileSizeBytes < 0 ||
      input.fileSizeBytes > videoConfig.maxSegmentSizeBytes)
  ) {
    throw new RideVideoError(
      'VIDEO_SEGMENT_TOO_LARGE',
      `Segment exceeds ${videoConfig.maxSegmentSizeBytes} bytes`,
      413
    );
  }
  if (!videoConfig.allowedMimeTypes.has(input.mimeType)) {
    throw new RideVideoError('INVALID_VIDEO_MIME_TYPE', 'Unsupported video MIME type', 400);
  }

  const duplicates = await db
    .select()
    .from(videoSegments)
    .where(
      and(
        eq(videoSegments.sessionId, sessionId),
        sql`(${videoSegments.clientSegmentId} = ${input.clientSegmentId} OR ${videoSegments.sequenceNumber} = ${input.sequenceNumber})`
      )
    );
  const byClientId = duplicates.find(
    (segment) => segment.clientSegmentId === input.clientSegmentId
  );
  if (byClientId) {
    if (
      byClientId.sequenceNumber !== input.sequenceNumber ||
      byClientId.mimeType !== input.mimeType ||
      (input.durationMs != null && byClientId.durationMs !== input.durationMs) ||
      (input.fileSizeBytes != null && byClientId.fileSizeBytes !== input.fileSizeBytes)
    ) {
      throw new RideVideoError(
        'SEGMENT_IDEMPOTENCY_CONFLICT',
        'clientSegmentId was already used with different immutable metadata',
        409
      );
    }
    logger.info({
      event: 'recording.segment_restored',
      bookingId: session.bookingId,
      sessionId,
      segmentId: byClientId.id,
      driverId,
      sequenceNumber: input.sequenceNumber,
    });
    return uploadDetails(byClientId);
  }
  if (duplicates.some((segment) => segment.sequenceNumber === input.sequenceNumber)) {
    throw new RideVideoError(
      'SEGMENT_SEQUENCE_CONFLICT',
      'sequenceNumber already belongs to another segment',
      409
    );
  }

  const segmentId = randomUUID();
  const storageKey = createPrivateStorageKey({
    bookingId: session.bookingId,
    sessionId,
    sequenceNumber: input.sequenceNumber,
    segmentId,
    mimeType: input.mimeType,
  });
  let segment: typeof videoSegments.$inferSelect;
  try {
    const inserted = await db
      .insert(videoSegments)
      .values({
        id: segmentId,
        sessionId,
        bookingId: session.bookingId,
        driverId,
        sequenceNumber: input.sequenceNumber,
        clientSegmentId: input.clientSegmentId,
        storageKey,
        uploadStatus: 'pending',
        durationMs: input.durationMs,
        fileSizeBytes: input.fileSizeBytes,
        mimeType: input.mimeType,
        recordedAt: input.recordedAt,
        checksum: input.checksum,
      })
      .returning();
    segment = inserted[0];
  } catch (error) {
    if ((error as { code?: string }).code !== '23505') throw error;
    const raced = await db
      .select()
      .from(videoSegments)
      .where(
        and(
          eq(videoSegments.sessionId, sessionId),
          eq(videoSegments.clientSegmentId, input.clientSegmentId)
        )
      )
      .limit(1);
    if (!raced[0] || raced[0].sequenceNumber !== input.sequenceNumber) {
      throw new RideVideoError('SEGMENT_SEQUENCE_CONFLICT', 'Segment already registered', 409);
    }
    segment = raced[0];
  }

  logger.info({
    event: 'recording.segment_registered',
    bookingId: session.bookingId,
    sessionId,
    segmentId: segment.id,
    driverId,
    sequenceNumber: input.sequenceNumber,
  });
  return uploadDetails(segment);
}

export async function uploadRideVideoSegment(params: {
  segmentId: string;
  driverId: string;
  token: string;
  mimeType: string;
  buffer: Buffer;
}) {
  const rows = await db
    .select()
    .from(videoSegments)
    .where(eq(videoSegments.id, params.segmentId))
    .limit(1);
  const segment = rows[0];
  if (!segment || !segment.storageKey) {
    throw new RideVideoError('VIDEO_SEGMENT_NOT_FOUND', 'Video segment not found', 404);
  }
  if (segment.driverId !== params.driverId) {
    throw new RideVideoError('FORBIDDEN', 'Video segment belongs to another driver', 403);
  }
  const session = await getOwnedSession(segment.sessionId, params.driverId);
  if (!REGISTERABLE_SESSION_STATUSES.includes(session.status)) {
    throw new RideVideoError('VIDEO_SESSION_NOT_ACTIVE', 'Session cannot accept uploads', 409);
  }
  await assertRecordableBooking(segment.bookingId, params.driverId);
  if (params.mimeType.split(';')[0].trim() !== segment.mimeType) {
    throw new RideVideoError(
      'INVALID_VIDEO_MIME_TYPE',
      'Content-Type does not match registration',
      400
    );
  }
  if (params.buffer.length > videoConfig.maxSegmentSizeBytes) {
    throw new RideVideoError('VIDEO_SEGMENT_TOO_LARGE', 'Uploaded segment is too large', 413);
  }
  if (segment.fileSizeBytes != null && params.buffer.length !== segment.fileSizeBytes) {
    throw new RideVideoError(
      'VIDEO_SIZE_MISMATCH',
      'Uploaded size does not match registration',
      409
    );
  }
  try {
    verifyStorageToken(params.token, {
      purpose: 'upload',
      segmentId: segment.id,
      storageKey: segment.storageKey,
      driverId: params.driverId,
    });
  } catch {
    throw new RideVideoError(
      'INVALID_VIDEO_UPLOAD_AUTHORIZATION',
      'Video upload authorization is invalid or expired',
      403
    );
  }
  const stored = await savePrivateSegment(segment.storageKey, params.buffer);
  if (segment.checksum && segment.checksum.toLowerCase() !== stored.checksum) {
    throw new RideVideoError('VIDEO_CHECKSUM_MISMATCH', 'Uploaded checksum does not match', 409);
  }
  const updated = await db
    .update(videoSegments)
    .set({
      uploadStatus: 'uploaded',
      fileSizeBytes: stored.fileSizeBytes,
      checksum: stored.checksum,
      uploadedAt: new Date(),
      failureReason: null,
      updatedAt: new Date(),
    })
    .where(eq(videoSegments.id, segment.id))
    .returning();
  return formatSegment(updated[0]);
}

export async function completeRideVideoSegment(
  sessionId: string,
  segmentId: string,
  driverId: string,
  confirmation: { checksum?: string; fileSizeBytes?: number }
) {
  await getOwnedSession(sessionId, driverId);
  const rows = await db
    .select()
    .from(videoSegments)
    .where(and(eq(videoSegments.id, segmentId), eq(videoSegments.sessionId, sessionId)))
    .limit(1);
  const segment = rows[0];
  if (!segment || segment.driverId !== driverId || !segment.storageKey) {
    throw new RideVideoError('VIDEO_SEGMENT_NOT_FOUND', 'Video segment not found', 404);
  }
  if (segment.uploadStatus === 'verified') return formatSegment(segment);
  const object = await inspectPrivateSegment(segment.storageKey);
  if (!object)
    throw new RideVideoError('VIDEO_OBJECT_NOT_FOUND', 'Uploaded object was not found', 409);
  if (
    (segment.fileSizeBytes != null && object.fileSizeBytes !== segment.fileSizeBytes) ||
    (confirmation.fileSizeBytes != null && object.fileSizeBytes !== confirmation.fileSizeBytes)
  ) {
    throw new RideVideoError('VIDEO_SIZE_MISMATCH', 'Stored object size does not match', 409);
  }
  if (
    confirmation.checksum &&
    segment.checksum &&
    confirmation.checksum.toLowerCase() !== segment.checksum.toLowerCase()
  ) {
    throw new RideVideoError('VIDEO_CHECKSUM_MISMATCH', 'Stored checksum does not match', 409);
  }
  const updated = await db
    .update(videoSegments)
    .set({
      uploadStatus: 'verified',
      fileSizeBytes: object.fileSizeBytes,
      uploadedAt: segment.uploadedAt ?? new Date(),
      updatedAt: new Date(),
      failureReason: null,
    })
    .where(eq(videoSegments.id, segment.id))
    .returning();
  logger.info({
    event: 'recording.upload_confirmed',
    bookingId: segment.bookingId,
    sessionId,
    segmentId,
    driverId,
    sequenceNumber: segment.sequenceNumber,
  });
  return formatSegment(updated[0]);
}

export async function failRideVideoSegment(
  sessionId: string,
  segmentId: string,
  driverId: string,
  reason?: string
) {
  await getOwnedSession(sessionId, driverId);
  const updated = await db
    .update(videoSegments)
    .set({
      uploadStatus: 'failed',
      retryCount: sql`${videoSegments.retryCount} + 1`,
      failureReason: reason?.slice(0, 1000) || 'Client reported upload failure',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(videoSegments.id, segmentId),
        eq(videoSegments.sessionId, sessionId),
        eq(videoSegments.driverId, driverId)
      )
    )
    .returning();
  if (!updated[0])
    throw new RideVideoError('VIDEO_SEGMENT_NOT_FOUND', 'Video segment not found', 404);
  logger.warn({
    event: 'recording.upload_failed',
    bookingId: updated[0].bookingId,
    sessionId,
    segmentId,
    driverId,
    sequenceNumber: updated[0].sequenceNumber,
  });
  return uploadDetails(updated[0]);
}

export async function listRideVideoSegments(sessionId: string, driverId: string, status?: string) {
  await getOwnedSession(sessionId, driverId);
  const allowedStatuses = ['pending', 'uploading', 'uploaded', 'verified', 'failed'];
  if (status && !allowedStatuses.includes(status)) {
    throw new RideVideoError('INVALID_UPLOAD_STATUS', 'Unsupported segment status filter', 400);
  }
  const conditions = [eq(videoSegments.sessionId, sessionId)];
  if (status) conditions.push(eq(videoSegments.uploadStatus, status));
  const rows = await db
    .select()
    .from(videoSegments)
    .where(and(...conditions))
    .orderBy(asc(videoSegments.sequenceNumber));
  return rows.map((segment) => ({
    ...formatSegment(segment),
    retryUpload: ['pending', 'failed'].includes(segment.uploadStatus)
      ? uploadDetails(segment).upload
      : null,
  }));
}

export async function pauseRideVideoSession(sessionId: string, driverId: string) {
  const session = await getOwnedSession(sessionId, driverId);
  if (session.status === 'paused') return formatSession(session);
  if (session.status !== 'active') {
    throw new RideVideoError(
      'VIDEO_SESSION_NOT_ACTIVE',
      'Only an active session can be paused',
      409
    );
  }
  const updated = await db
    .update(videoSessions)
    .set({ status: 'paused', pausedAt: new Date(), updatedAt: new Date() })
    .where(eq(videoSessions.id, sessionId))
    .returning();
  logger.info({
    event: 'recording.session_paused',
    bookingId: session.bookingId,
    sessionId,
    driverId,
  });
  const payload = {
    bookingId: session.bookingId,
    sessionId,
    driverId,
    timestamp: new Date().toISOString(),
  };
  await Promise.allSettled([
    emitToDriver(driverId, 'recording:session_paused', payload),
    session.passengerId
      ? emitToCustomer(session.passengerId, 'recording:session_paused', payload)
      : Promise.resolve(),
    emitToAdmins('recording:session_paused', payload),
  ]);
  return formatSession(updated[0]);
}

export async function resumeRideVideoSession(sessionId: string, driverId: string) {
  const session = await getOwnedSession(sessionId, driverId);
  if (session.status === 'active') return formatSession(session);
  if (session.status !== 'paused') {
    throw new RideVideoError(
      'VIDEO_SESSION_NOT_PAUSED',
      'Only a paused session can be resumed',
      409
    );
  }
  const { consentStatus: status } = await assertRecordableBooking(session.bookingId, driverId);
  const updated = await db
    .update(videoSessions)
    .set({
      status: 'active',
      consentStatus: status,
      pausedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(videoSessions.id, sessionId))
    .returning();
  logger.info({
    event: 'recording.session_resumed',
    bookingId: session.bookingId,
    sessionId,
    driverId,
  });
  const payload = {
    bookingId: session.bookingId,
    sessionId,
    driverId,
    timestamp: new Date().toISOString(),
  };
  await Promise.allSettled([
    emitToDriver(driverId, 'recording:session_resumed', payload),
    session.passengerId
      ? emitToCustomer(session.passengerId, 'recording:session_resumed', payload)
      : Promise.resolve(),
    emitToAdmins('recording:session_resumed', payload),
  ]);
  return formatSession(updated[0]);
}

async function finalizeSessionRecord(
  session: typeof videoSessions.$inferSelect,
  terminalStatus: 'completed' | 'cancelled',
  reason: string
) {
  if (['completed', 'cancelled', 'failed'].includes(session.status)) return session;
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(videoSessions)
      .set({ status: 'finalizing', endedAt: now, updatedAt: now })
      .where(eq(videoSessions.id, session.id));
    await tx
      .update(videoSegments)
      .set({
        uploadStatus: 'failed',
        failureReason: sql`COALESCE(${videoSegments.failureReason}, ${reason})`,
        updatedAt: now,
      })
      .where(
        and(
          eq(videoSegments.sessionId, session.id),
          inArray(videoSegments.uploadStatus, ['pending', 'uploading'])
        )
      );
    await tx
      .update(videoSessions)
      .set({ status: terminalStatus, finalizedAt: now, endedAt: now, updatedAt: now })
      .where(eq(videoSessions.id, session.id));
  });
  const updated = await db
    .select()
    .from(videoSessions)
    .where(eq(videoSessions.id, session.id))
    .limit(1);
  logger.info({
    event: 'recording.session_finalized',
    bookingId: session.bookingId,
    sessionId: session.id,
    driverId: session.driverId,
    status: terminalStatus,
  });
  const payload = {
    bookingId: session.bookingId,
    sessionId: session.id,
    driverId: session.driverId,
    status: terminalStatus,
    timestamp: now.toISOString(),
  };
  await Promise.allSettled([
    emitToDriver(session.driverId, 'recording:session_finalized', payload),
    session.passengerId
      ? emitToCustomer(session.passengerId, 'recording:session_finalized', payload)
      : Promise.resolve(),
    emitToAdmins('recording:session_finalized', payload),
  ]);
  return updated[0];
}

export async function finalizeRideVideoSession(sessionId: string, driverId: string) {
  const session = await getOwnedSession(sessionId, driverId);
  const booking = await findBookingById(session.bookingId);
  if (!booking) throw new RideVideoError('BOOKING_NOT_FOUND', 'Booking not found', 404);
  const terminalStatus = booking.status === BookingStatus.CANCELLED ? 'cancelled' : 'completed';
  const finalized = await finalizeSessionRecord(
    session,
    terminalStatus,
    'Session finalized before upload'
  );
  return formatSession(finalized);
}

export async function finalizeRideVideoSessionsForBooking(
  bookingId: string,
  reason: string
): Promise<void> {
  const booking = await findBookingById(bookingId);
  const rows = await db
    .select()
    .from(videoSessions)
    .where(
      and(
        eq(videoSessions.bookingId, bookingId),
        inArray(videoSessions.status, RECOVERABLE_SESSION_STATUSES)
      )
    );
  const terminalStatus = booking?.status === BookingStatus.CANCELLED ? 'cancelled' : 'completed';
  for (const session of rows) {
    await finalizeSessionRecord(session, terminalStatus, reason);
  }
}

export async function getAdminRideVideoMetadata(bookingId: string) {
  const booking = await findBookingById(bookingId);
  if (!booking) throw new RideVideoError('BOOKING_NOT_FOUND', 'Booking not found', 404);
  const sessions = await db
    .select()
    .from(videoSessions)
    .where(eq(videoSessions.bookingId, bookingId))
    .orderBy(desc(videoSessions.createdAt));
  const result = [];
  for (const session of sessions) {
    const segments = await db
      .select()
      .from(videoSegments)
      .where(eq(videoSegments.sessionId, session.id));
    result.push({
      ...formatSession(session),
      segmentCount: segments.length,
      uploadedCount: segments.filter((segment) =>
        ['uploaded', 'verified'].includes(segment.uploadStatus)
      ).length,
      failedCount: segments.filter((segment) => segment.uploadStatus === 'failed').length,
      totalKnownDurationMs: segments.reduce(
        (total, segment) => total + (segment.durationMs ?? 0),
        0
      ),
      totalKnownSizeBytes: segments.reduce(
        (total, segment) => total + (segment.fileSizeBytes ?? 0),
        0
      ),
    });
  }
  return {
    booking: { id: booking.id, status: booking.status },
    driverId: booking.assignedDriverId,
    consentStatus: consentStatus(booking),
    sessions: result,
  };
}

export async function createAdminSegmentReadUrl(segmentId: string) {
  const rows = await db
    .select()
    .from(videoSegments)
    .where(eq(videoSegments.id, segmentId))
    .limit(1);
  const segment = rows[0];
  if (!segment?.storageKey || !['uploaded', 'verified'].includes(segment.uploadStatus)) {
    throw new RideVideoError('VIDEO_SEGMENT_NOT_FOUND', 'Readable video segment not found', 404);
  }
  const authorization = createReadToken({
    segmentId: segment.id,
    storageKey: segment.storageKey,
  });
  return {
    url: `/api/v1/admin/video/segments/${segment.id}/content?token=${authorization.token}`,
    expiresAt: authorization.expiresAt.toISOString(),
  };
}

export async function resolveAdminSegmentReadPath(segmentId: string, token: string) {
  const rows = await db
    .select()
    .from(videoSegments)
    .where(eq(videoSegments.id, segmentId))
    .limit(1);
  const segment = rows[0];
  if (!segment?.storageKey) {
    throw new RideVideoError('VIDEO_SEGMENT_NOT_FOUND', 'Video segment not found', 404);
  }
  try {
    verifyStorageToken(token, {
      purpose: 'read',
      segmentId: segment.id,
      storageKey: segment.storageKey,
    });
  } catch {
    throw new RideVideoError(
      'INVALID_VIDEO_READ_AUTHORIZATION',
      'Video read authorization is invalid or expired',
      403
    );
  }
  const object = await inspectPrivateSegment(segment.storageKey);
  if (!object) throw new RideVideoError('VIDEO_OBJECT_NOT_FOUND', 'Video object not found', 404);
  return { absolutePath: object.absolutePath, mimeType: segment.mimeType };
}

export async function updateSessionsForConsent(
  bookingId: string,
  status: 'granted' | 'denied' | 'required'
): Promise<void> {
  await db
    .update(videoSessions)
    .set({
      consentStatus: status,
      status: status === 'denied' ? 'paused' : sql`${videoSessions.status}`,
      pausedAt: status === 'denied' ? new Date() : sql`${videoSessions.pausedAt}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(videoSessions.bookingId, bookingId),
        inArray(videoSessions.status, ['pending', 'active', 'paused'])
      )
    );
}

export async function linkSessionToTrip(bookingId: string, tripId: string): Promise<void> {
  await db
    .update(videoSessions)
    .set({ tripId, updatedAt: new Date() })
    .where(
      and(
        eq(videoSessions.bookingId, bookingId),
        inArray(videoSessions.status, ['active', 'paused'])
      )
    );
}

export function emitRideVideoAvailable(params: {
  bookingId: string;
  driverId: string;
  passengerId: string;
}): Promise<unknown[]> {
  const payload = {
    bookingId: params.bookingId,
    consentRequired: videoConfig.consentRequired,
    recordingEnabled: videoConfig.enabled,
    timestamp: new Date().toISOString(),
  };
  return Promise.all([
    emitToDriver(params.driverId, 'recording:session_available', payload),
    emitToCustomer(params.passengerId, 'recording:session_available', payload),
    emitToAdmins('recording:session_available', payload),
  ]);
}
