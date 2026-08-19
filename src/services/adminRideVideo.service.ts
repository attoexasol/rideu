import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { videoConfig } from '../config/video';
import { db } from '../db/connection';
import {
  bookingEvents,
  bookings,
  customers,
  drivers,
  serviceCategories,
  vehicles,
  videoSegments,
  videoSessions,
} from '../db/schema';
import { RideVideoError } from './rideVideo.errors';
import { createAdminSegmentReadUrl } from './rideVideoRead.service';
export { RideVideoError } from './rideVideo.errors';
export { createAdminSegmentReadUrl, resolveAdminSegmentReadPath } from './rideVideoRead.service';
import { traceRideVideo } from './rideVideoTrace.service';
import {
  computeHealthState,
  computePlaybackEligibility,
  computeRetention,
  computeSegmentCounts,
  computeUploadHealth,
  mapAdminRecordingStatus,
  mapConsentForAdmin,
  pickBestSessionForBooking,
  toDate,
  type SegmentStatInput,
} from './adminRideVideo.helpers';
import {
  buildDvrTimeline,
  DVR_PLAYBACK_MODE,
  userFriendlyPlaybackReason,
} from './rideVideoDvr.helpers';
import { buildDvrPlaybackManifest } from './rideVideoDvr.service';
import { logManifestBlockedDiagnostics } from './rideVideoSegmentTrace.service';
import {
  insertRideVideoAuditEvent,
  listRideVideoAuditEvents,
  type RideVideoAuditAction,
} from '../repositories/rideVideoAudit.repository';
import { adminUtils } from '../db/utils';

export interface AdminActor {
  auth0Id?: string;
  email?: string;
  name?: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface ListRideVideoSessionsQuery {
  page?: number;
  limit?: number;
  search?: string;
  bookingId?: string;
  sessionId?: string;
  driverId?: string;
  passengerId?: string;
  driverPhone?: string;
  passengerPhone?: string;
  vehicleRegistration?: string;
  bookingStatus?: string;
  recordingStatus?: string;
  consentStatus?: string;
  uploadHealth?: string;
  processingStatus?: string;
  retentionStatus?: string;
  serviceType?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

const PLAYABLE_STATUSES = ['uploaded', 'verified'] as const;

async function audit(
  action: RideVideoAuditAction,
  actor: AdminActor | undefined,
  fields: {
    sessionId?: string | null;
    bookingId?: string | null;
    segmentId?: string | null;
    result?: string;
    reason?: string | null;
    metadata?: Record<string, unknown> | null;
  }
) {
  let adminUserId: string | null = null;
  if (actor?.auth0Id) {
    try {
      const admin = await adminUtils.findByAuth0Id(actor.auth0Id);
      adminUserId = admin?.id ?? null;
    } catch {
      adminUserId = null;
    }
  }

  await insertRideVideoAuditEvent({
    action,
    sessionId: fields.sessionId ?? null,
    bookingId: fields.bookingId ?? null,
    segmentId: fields.segmentId ?? null,
    result: fields.result ?? 'success',
    reason: fields.reason ?? null,
    metadata: fields.metadata ?? null,
    adminUserId,
    adminAuth0Id: actor?.auth0Id ?? null,
    adminEmail: actor?.email ?? null,
    ipAddress: actor?.ipAddress ?? null,
    userAgent: actor?.userAgent ?? null,
  });
}

function segmentStats(rows: Array<typeof videoSegments.$inferSelect>): SegmentStatInput[] {
  return rows.map((segment) => ({
    sequenceNumber: segment.sequenceNumber,
    uploadStatus: segment.uploadStatus,
    durationMs: segment.durationMs,
    retentionDeletedAt: segment.retentionDeletedAt,
    uploadedAt: segment.uploadedAt,
    recordedAt: segment.recordedAt,
  }));
}

function lastActivityAt(segments: SegmentStatInput[], sessionUpdatedAt: Date): string {
  const dates = segments
    .map((s) => toDate(s.uploadedAt) ?? toDate(s.recordedAt))
    .filter((d): d is Date => Boolean(d));
  dates.push(sessionUpdatedAt);
  dates.sort((a, b) => b.getTime() - a.getTime());
  return dates[0].toISOString();
}

async function loadSegmentsForSession(sessionId: string) {
  return db
    .select()
    .from(videoSegments)
    .where(eq(videoSegments.sessionId, sessionId))
    .orderBy(asc(videoSegments.sequenceNumber));
}

function buildSessionView(params: {
  session: typeof videoSessions.$inferSelect;
  booking: typeof bookings.$inferSelect;
  driver: typeof drivers.$inferSelect | null;
  passenger: typeof customers.$inferSelect | null;
  vehicle: typeof vehicles.$inferSelect | null;
  serviceCategory: typeof serviceCategories.$inferSelect | null;
  segments: Array<typeof videoSegments.$inferSelect>;
}) {
  const stats = segmentStats(params.segments);
  const counts = computeSegmentCounts(stats);
  const healthInput = {
    sessionStatus: params.session.status,
    consentStatus: params.session.consentStatus,
    finalizedAt: params.session.finalizedAt,
    retentionDays: videoConfig.retentionDays,
    segmentDurationSeconds: videoConfig.segmentDurationSeconds,
    segments: stats,
  };
  const uploadHealth = computeUploadHealth(healthInput);
  const recordingStatus = mapAdminRecordingStatus(healthInput);
  const retention = computeRetention({
    finalizedAt: params.session.finalizedAt,
    createdAt: params.session.createdAt,
    retentionDays: videoConfig.retentionDays,
    segments: stats,
  });
  const playback = computePlaybackEligibility(healthInput);
  const dvr = buildDvrTimeline({
    sessionStatus: params.session.status,
    finalizedAt: params.session.finalizedAt,
    segments: params.segments.map((segment) => ({
      segmentId: segment.id,
      segmentIndex: segment.sequenceNumber,
      durationMs: segment.durationMs,
      mimeType: segment.mimeType,
      uploadStatus: segment.uploadStatus,
      storageKey: segment.storageKey,
      retentionDeletedAt: segment.retentionDeletedAt,
    })),
    defaultSegmentDurationSeconds: videoConfig.segmentDurationSeconds,
  });
  const latestSegmentAt =
    stats
      .map((s) => toDate(s.uploadedAt) ?? toDate(s.recordedAt))
      .filter((d): d is Date => Boolean(d))
      .sort((a, b) => b.getTime() - a.getTime())[0]
      ?.toISOString() ?? null;

  return {
    sessionId: params.session.id,
    bookingId: params.session.bookingId,
    rideDate:
      params.booking.startedAt?.toISOString() ??
      params.booking.acceptedAt?.toISOString() ??
      params.booking.createdAt.toISOString(),
    bookingStatus: params.booking.status,
    recordingStatus,
    sessionStatus: params.session.status,
    consentRequired: videoConfig.consentRequired,
    consentStatus: mapConsentForAdmin(params.session.consentStatus),
    rawConsentStatus: params.session.consentStatus,
    startedAt: params.session.startedAt?.toISOString() ?? null,
    finalizedAt: params.session.finalizedAt?.toISOString() ?? null,
    finalized: playback.finalized,
    createdAt: params.session.createdAt.toISOString(),
    failureReason: params.session.failureReason,
    durationSeconds: counts.availableDurationSeconds,
    availableDurationSeconds: counts.availableDurationSeconds,
    expectedSegmentCount: counts.expectedSegmentCount,
    uploadedSegmentCount: counts.uploadedSegmentCount,
    readySegmentCount: counts.readySegmentCount,
    availableSegmentCount: playback.availableSegmentCount,
    failedSegmentCount: counts.failedSegmentCount,
    missingSegmentCount: counts.missingSegmentCount,
    missingSequences: counts.missingSequences,
    duplicateSegmentCount: counts.duplicateSegmentCount,
    latestSegmentIndex: playback.latestSegmentIndex,
    lastSegmentAt: latestSegmentAt,
    uploadHealth,
    retentionExpiresAt: retention.retentionExpiresAt,
    retentionStatus: retention.retentionStatus,
    daysRemaining: retention.daysRemaining,
    lastActivityAt: lastActivityAt(stats, params.session.updatedAt),
    playbackAvailable: playback.playbackAvailable,
    playbackMode: DVR_PLAYBACK_MODE,
    playbackReason: playback.playbackReason,
    playbackReasonLabel: userFriendlyPlaybackReason(playback.playbackReason),
    recordingActive: dvr.recordingActive,
    timelineStartSeconds: dvr.timelineStartSeconds,
    liveEdgeSeconds: dvr.liveEdgeSeconds,
    firstAvailableSegmentIndex: dvr.firstAvailableSegmentIndex,
    latestAvailableSegmentIndex: dvr.latestAvailableSegmentIndex,
    manifestVersion: params.session.manifestVersion ?? 0,
    refreshAfterSeconds: videoConfig.manifestRefreshSeconds,
    downloadAvailable: false,
    driver: params.driver
      ? {
          id: params.driver.id,
          name: params.driver.name,
          phone: params.driver.phone,
          email: params.driver.email,
        }
      : null,
    passenger: params.passenger
      ? {
          id: params.passenger.id,
          name: params.passenger.name,
          phone: [params.passenger.phoneCountryCode, params.passenger.phoneNumber]
            .filter(Boolean)
            .join(' '),
          email: params.passenger.email,
        }
      : null,
    vehicle: params.vehicle
      ? {
          id: params.vehicle.id,
          registration: params.vehicle.plateNumber,
          type: null as string | null,
          make: params.vehicle.make,
          model: params.vehicle.model,
        }
      : null,
    serviceType: params.serviceCategory
      ? {
          id: params.serviceCategory.id,
          code: params.serviceCategory.code,
          name: params.serviceCategory.name,
        }
      : null,
    booking: {
      id: params.booking.id,
      bookingNumber: params.booking.bookingNumber,
      status: params.booking.status,
      recordingEnabled: videoConfig.enabled,
      recordingConsentStatus: mapConsentForAdmin(params.booking.recordingConsentStatus),
    },
  };
}

/** Minimal fields for standard Admin UI (diagnostics available via /health, /segments). */
export function toMinimalAdminRideVideoView(view: ReturnType<typeof buildSessionView>) {
  return {
    sessionId: view.sessionId,
    bookingId: view.bookingId,
    driver: view.driver,
    passenger: view.passenger,
    bookingStatus: view.bookingStatus,
    recordingStatus: view.recordingStatus,
    sessionStatus: view.sessionStatus,
    recordingActive: view.recordingActive,
    playbackAvailable: view.playbackAvailable,
    playbackMode: view.playbackMode,
    playbackReasonLabel: view.playbackReasonLabel,
    availableDurationSeconds: view.availableDurationSeconds,
    liveEdgeSeconds: view.liveEdgeSeconds,
    latestAvailableSegmentIndex: view.latestAvailableSegmentIndex,
    manifestVersion: view.manifestVersion,
    refreshAfterSeconds: view.refreshAfterSeconds,
    finalized: view.finalized,
    finalizedAt: view.finalizedAt,
    retentionExpiresAt: view.retentionExpiresAt,
    startedAt: view.startedAt,
  };
}

async function getSessionBundle(sessionId: string) {
  const rows = await db
    .select({
      session: videoSessions,
      booking: bookings,
      driver: drivers,
      passenger: customers,
      vehicle: vehicles,
      serviceCategory: serviceCategories,
    })
    .from(videoSessions)
    .innerJoin(bookings, eq(videoSessions.bookingId, bookings.id))
    .leftJoin(drivers, eq(videoSessions.driverId, drivers.id))
    .leftJoin(customers, eq(videoSessions.passengerId, customers.id))
    .leftJoin(vehicles, eq(bookings.assignedVehicleId, vehicles.id))
    .leftJoin(serviceCategories, eq(bookings.serviceCategoryId, serviceCategories.id))
    .where(eq(videoSessions.id, sessionId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new RideVideoError(
      'RECORDING_SESSION_NOT_FOUND',
      'Recording session was not found',
      404
    );
  }

  const segments = await loadSegmentsForSession(sessionId);
  return { ...row, segments };
}

function assertPlaybackAllowed(view: ReturnType<typeof buildSessionView>) {
  if (view.retentionStatus === 'deleted') {
    throw new RideVideoError('RECORDING_DELETED', 'Recording has been deleted by retention policy', 410);
  }
  if (view.retentionStatus === 'expired') {
    throw new RideVideoError('RECORDING_EXPIRED', 'Recording retention period has ended', 410);
  }
  if (view.playbackAvailable) return;

  switch (view.playbackReason) {
    case 'WAITING_FOR_FIRST_SEGMENT':
      throw new RideVideoError(
        'WAITING_FOR_FIRST_SEGMENT',
        'Recording session exists but no segment is ready for playback yet',
        409
      );
    case 'RECORDING_FINALIZING':
      throw new RideVideoError(
        'RECORDING_FINALIZING',
        'Recording is finalizing; new segments may still become available',
        409
      );
    case 'RECORDING_PARTIAL':
      throw new RideVideoError(
        'RECORDING_PARTIAL',
        'Recording is partially available but no playable segment was found',
        409
      );
    default:
      throw new RideVideoError(
        'RECORDING_NOT_READY',
        'Recording is not available for playback',
        409
      );
  }
}

export async function listAdminRideVideoSessions(
  query: ListRideVideoSessionsQuery,
  actor?: AdminActor
) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const offset = (page - 1) * limit;
  const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';

  const conditions: SQL[] = [];

  if (query.bookingId) conditions.push(eq(videoSessions.bookingId, query.bookingId));
  if (query.sessionId) conditions.push(eq(videoSessions.id, query.sessionId));
  if (query.driverId) conditions.push(eq(videoSessions.driverId, query.driverId));
  if (query.passengerId) conditions.push(eq(videoSessions.passengerId, query.passengerId));
  if (query.bookingStatus) conditions.push(eq(bookings.status, query.bookingStatus));
  if (query.serviceType) {
    conditions.push(
      or(
        eq(serviceCategories.code, query.serviceType),
        ilike(serviceCategories.name, `%${query.serviceType}%`)
      )!
    );
  }
  if (query.driverPhone) {
    conditions.push(ilike(drivers.phone, `%${query.driverPhone}%`));
  }
  if (query.passengerPhone) {
    conditions.push(
      or(
        ilike(customers.phoneNumber, `%${query.passengerPhone}%`),
        ilike(customers.phoneCountryCode, `%${query.passengerPhone}%`)
      )!
    );
  }
  if (query.vehicleRegistration) {
    conditions.push(ilike(vehicles.plateNumber, `%${query.vehicleRegistration}%`));
  }
  if (query.dateFrom) {
    conditions.push(gte(videoSessions.createdAt, new Date(query.dateFrom)));
  }
  if (query.dateTo) {
    conditions.push(lte(videoSessions.createdAt, new Date(query.dateTo)));
  }
  if (query.consentStatus) {
    const raw =
      query.consentStatus === 'pending'
        ? 'required'
        : query.consentStatus === 'revoked'
          ? 'denied'
          : query.consentStatus;
    conditions.push(eq(videoSessions.consentStatus, raw));
  }
  if (query.processingStatus || query.recordingStatus) {
    const mapped = mapRecordingStatusFilter(query.recordingStatus || query.processingStatus!);
    if (mapped.length) conditions.push(inArray(videoSessions.status, mapped));
  }

  if (query.search?.trim()) {
    const term = `%${query.search.trim()}%`;
    conditions.push(
      or(
        sql`${videoSessions.id}::text ilike ${term}`,
        sql`${videoSessions.bookingId}::text ilike ${term}`,
        ilike(bookings.bookingNumber, term),
        ilike(drivers.name, term),
        ilike(drivers.phone, term),
        ilike(customers.name, term),
        ilike(customers.phoneNumber, term),
        ilike(vehicles.plateNumber, term)
      )!
    );
  }

  const whereClause = conditions.length ? and(...conditions) : undefined;

  const sortColumn =
    query.sortBy === 'finalizedAt'
      ? videoSessions.finalizedAt
      : query.sortBy === 'startedAt'
        ? videoSessions.startedAt
        : query.sortBy === 'rideDate'
          ? bookings.createdAt
          : videoSessions.createdAt;

  const orderExpr = sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        session: videoSessions,
        booking: bookings,
        driver: drivers,
        passenger: customers,
        vehicle: vehicles,
        serviceCategory: serviceCategories,
      })
      .from(videoSessions)
      .innerJoin(bookings, eq(videoSessions.bookingId, bookings.id))
      .leftJoin(drivers, eq(videoSessions.driverId, drivers.id))
      .leftJoin(customers, eq(videoSessions.passengerId, customers.id))
      .leftJoin(vehicles, eq(bookings.assignedVehicleId, vehicles.id))
      .leftJoin(serviceCategories, eq(bookings.serviceCategoryId, serviceCategories.id))
      .where(whereClause)
      .orderBy(orderExpr, desc(videoSessions.id))
      .limit(limit)
      .offset(offset),
    db
      .select({ value: count() })
      .from(videoSessions)
      .innerJoin(bookings, eq(videoSessions.bookingId, bookings.id))
      .leftJoin(drivers, eq(videoSessions.driverId, drivers.id))
      .leftJoin(customers, eq(videoSessions.passengerId, customers.id))
      .leftJoin(vehicles, eq(bookings.assignedVehicleId, vehicles.id))
      .leftJoin(serviceCategories, eq(bookings.serviceCategoryId, serviceCategories.id))
      .where(whereClause),
  ]);

  const sessionIds = rows.map((r) => r.session.id);
  const allSegments =
    sessionIds.length === 0
      ? []
      : await db
          .select()
          .from(videoSegments)
          .where(inArray(videoSegments.sessionId, sessionIds));

  const bySession = new Map<string, Array<typeof videoSegments.$inferSelect>>();
  for (const segment of allSegments) {
    const list = bySession.get(segment.sessionId) || [];
    list.push(segment);
    bySession.set(segment.sessionId, list);
  }

  let items = rows.map((row) =>
    buildSessionView({
      ...row,
      segments: bySession.get(row.session.id) || [],
    })
  );

  // Post-filters that depend on computed fields
  if (query.uploadHealth) {
    items = items.filter((item) => item.uploadHealth === query.uploadHealth);
  }
  if (query.retentionStatus) {
    items = items.filter((item) => item.retentionStatus === query.retentionStatus);
  }
  if (query.recordingStatus) {
    items = items.filter((item) => item.recordingStatus === query.recordingStatus);
  }

  const minimalItems = items.map(toMinimalAdminRideVideoView);

  await audit('LISTED_SESSIONS', actor, {
    metadata: { page, limit, total: Number(totalRows[0]?.value ?? 0) },
  });

  return {
    items: minimalItems,
    pagination: {
      page,
      limit,
      total: Number(totalRows[0]?.value ?? 0),
      totalPages: Math.ceil(Number(totalRows[0]?.value ?? 0) / limit) || 0,
    },
  };
}

function mapRecordingStatusFilter(status: string): string[] {
  switch (status) {
    case 'waiting_for_consent':
      return ['pending'];
    case 'initializing':
      return ['pending'];
    case 'recording':
      return ['active', 'paused'];
    case 'uploading':
    case 'processing':
      return ['finalizing', 'paused', 'active'];
    case 'ready':
    case 'partially_available':
      return ['active', 'paused', 'finalizing', 'completed', 'partial'];
    case 'finalized':
      return ['completed', 'partial'];
    case 'failed':
      return ['failed'];
    case 'disabled':
    case 'deleted':
      return ['cancelled'];
    case 'expired':
      return ['completed', 'cancelled', 'failed'];
    default:
      // Allow raw session status passthrough
      if (
        ['pending', 'active', 'paused', 'finalizing', 'completed', 'cancelled', 'failed'].includes(
          status
        )
      ) {
        return [status];
      }
      return [];
  }
}

export async function getAdminRideVideoSummary(
  query: Pick<ListRideVideoSessionsQuery, 'dateFrom' | 'dateTo' | 'driverId' | 'passengerId'>,
  actor?: AdminActor
) {
  const conditions: SQL[] = [];
  if (query.dateFrom) conditions.push(gte(videoSessions.createdAt, new Date(query.dateFrom)));
  if (query.dateTo) conditions.push(lte(videoSessions.createdAt, new Date(query.dateTo)));
  if (query.driverId) conditions.push(eq(videoSessions.driverId, query.driverId));
  if (query.passengerId) conditions.push(eq(videoSessions.passengerId, query.passengerId));
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const sessions = await db.select().from(videoSessions).where(whereClause);
  const sessionIds = sessions.map((s) => s.id);
  const segments =
    sessionIds.length === 0
      ? []
      : await db.select().from(videoSegments).where(inArray(videoSegments.sessionId, sessionIds));
  const bySession = new Map<string, Array<typeof videoSegments.$inferSelect>>();
  for (const segment of segments) {
    const list = bySession.get(segment.sessionId) || [];
    list.push(segment);
    bySession.set(segment.sessionId, list);
  }

  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  let recordingNow = 0;
  let readyForReview = 0;
  let uploadIssues = 0;
  let missingSegments = 0;
  let expiringSoon = 0;
  let finalizedToday = 0;

  for (const session of sessions) {
    const stats = segmentStats(bySession.get(session.id) || []);
    const healthInput = {
      sessionStatus: session.status,
      consentStatus: session.consentStatus,
      finalizedAt: session.finalizedAt,
      retentionDays: videoConfig.retentionDays,
      segmentDurationSeconds: videoConfig.segmentDurationSeconds,
      segments: stats,
      now,
    };
    const status = mapAdminRecordingStatus(healthInput);
    const health = computeUploadHealth(healthInput);
    const counts = computeSegmentCounts(stats);
    const retention = computeRetention({
      finalizedAt: session.finalizedAt,
      createdAt: session.createdAt,
      retentionDays: videoConfig.retentionDays,
      segments: stats,
      now,
    });

    if (status === 'recording' || session.status === 'active') recordingNow += 1;
    if (status === 'ready' || status === 'finalized' || status === 'partially_available') {
      readyForReview += 1;
    }
    if (['failed_segments', 'missing_segments', 'delayed', 'incomplete'].includes(health)) {
      uploadIssues += 1;
    }
    if (counts.missingSegmentCount > 0) missingSegments += 1;
    if (retention.retentionStatus === 'expiring_soon') expiringSoon += 1;
    if (session.finalizedAt && session.finalizedAt >= startOfDay) finalizedToday += 1;
  }

  await audit('VIEWED_SUMMARY', actor, { metadata: { totalSessions: sessions.length } });

  return {
    totalSessions: sessions.length,
    recordingNow,
    readyForReview,
    uploadIssues,
    missingSegments,
    expiringSoon,
    finalizedToday,
  };
}

export async function getAdminRideVideoSession(sessionId: string, actor?: AdminActor) {
  const bundle = await getSessionBundle(sessionId);
  const view = buildSessionView(bundle);
  traceRideVideo({
    stage: 'admin_list_eligibility',
    bookingId: view.bookingId,
    sessionId: view.sessionId,
    driverId: bundle.session.driverId,
    sessionStatus: view.sessionStatus,
    playbackAvailable: view.playbackAvailable,
    readySegmentCount: view.readySegmentCount,
    playableSegmentCount: view.availableSegmentCount,
    includedInAdminList: true,
    finalizedAt: view.finalizedAt,
    lastActivityAt: view.lastActivityAt,
    reason: view.playbackReason,
  });
  await audit('VIEWED_METADATA', actor, {
    sessionId,
    bookingId: view.bookingId,
  });
  return toMinimalAdminRideVideoView(view);
}

export async function getAdminRideVideoDiagnostics(sessionId: string, actor?: AdminActor) {
  const bundle = await getSessionBundle(sessionId);
  const view = buildSessionView(bundle);
  await audit('VIEWED_HEALTH', actor, { sessionId, bookingId: view.bookingId });
  return view;
}

export async function getAdminBookingRideVideo(bookingId: string, actor?: AdminActor) {
  const bookingRows = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  const booking = bookingRows[0];
  if (!booking) {
    throw new RideVideoError('BOOKING_NOT_FOUND', 'Booking not found', 404);
  }

  if (!videoConfig.enabled) {
    await audit('VIEWED_METADATA', actor, {
      bookingId,
      metadata: { absenceReason: 'VIDEO_RECORDING_DISABLED' },
    });
    return {
      bookingId,
      recordingEnabled: false,
      sessionExists: false,
      absenceReason: 'VIDEO_RECORDING_DISABLED' as const,
      consentStatus: mapConsentForAdmin(booking.recordingConsentStatus),
      session: null,
      playbackAvailable: false,
      retentionStatus: null,
    };
  }

  const sessions = await db
    .select()
    .from(videoSessions)
    .where(eq(videoSessions.bookingId, bookingId))
    .orderBy(desc(videoSessions.createdAt));

  if (sessions.length === 0) {
    let absenceReason:
      | 'CONSENT_NOT_GRANTED'
      | 'SESSION_NOT_CREATED'
      | 'BOOKING_NOT_ELIGIBLE'
      | 'NO_RECORDING_DATA' = 'SESSION_NOT_CREATED';

    if (videoConfig.consentRequired && booking.recordingConsentStatus === 'denied') {
      absenceReason = 'CONSENT_NOT_GRANTED';
    } else if (videoConfig.consentRequired && booking.recordingConsentStatus === 'required') {
      absenceReason = 'CONSENT_NOT_GRANTED';
    } else if (!booking.assignedDriverId) {
      absenceReason = 'BOOKING_NOT_ELIGIBLE';
    } else {
      absenceReason = 'SESSION_NOT_CREATED';
    }

    await audit('VIEWED_METADATA', actor, {
      bookingId,
      metadata: { absenceReason },
    });

    return {
      bookingId,
      recordingEnabled: true,
      sessionExists: false,
      absenceReason,
      consentStatus: mapConsentForAdmin(booking.recordingConsentStatus),
      session: null,
      playbackAvailable: false,
      retentionStatus: null,
    };
  }

  const sessionIds = sessions.map((s) => s.id);
  const allSegments =
    sessionIds.length === 0
      ? []
      : await db
          .select()
          .from(videoSegments)
          .where(inArray(videoSegments.sessionId, sessionIds));
  const playableCountBySession = new Map<string, number>();
  for (const segment of allSegments) {
    if (
      PLAYABLE_STATUSES.includes(segment.uploadStatus as (typeof PLAYABLE_STATUSES)[number]) &&
      !segment.retentionDeletedAt
    ) {
      playableCountBySession.set(
        segment.sessionId,
        (playableCountBySession.get(segment.sessionId) ?? 0) + 1
      );
    }
  }

  const session = pickBestSessionForBooking(sessions, playableCountBySession);
  if (!session) {
    return {
      bookingId,
      recordingEnabled: true,
      sessionExists: false,
      absenceReason: 'SESSION_NOT_CREATED' as const,
      consentStatus: mapConsentForAdmin(booking.recordingConsentStatus),
      session: null,
      playbackAvailable: false,
      retentionStatus: null,
    };
  }

  const bundle = await getSessionBundle(session.id);
  const view = buildSessionView(bundle);

  let absenceReason:
    | 'RECORDING_EXPIRED'
    | 'RECORDING_DELETED'
    | 'WAITING_FOR_FIRST_SEGMENT'
    | 'NO_RECORDING_DATA'
    | null = null;
  if (view.retentionStatus === 'expired') absenceReason = 'RECORDING_EXPIRED';
  else if (view.retentionStatus === 'deleted') absenceReason = 'RECORDING_DELETED';
  else if (view.playbackReason === 'WAITING_FOR_FIRST_SEGMENT') {
    absenceReason = 'WAITING_FOR_FIRST_SEGMENT';
  } else if (!view.playbackAvailable && view.uploadedSegmentCount === 0) {
    absenceReason = 'NO_RECORDING_DATA';
  }

  traceRideVideo({
    stage: view.finalized ? 'admin_completed_visibility' : 'admin_list_eligibility',
    bookingId,
    sessionId: view.sessionId,
    driverId: bundle.session.driverId,
    sessionStatus: view.sessionStatus,
    playbackAvailable: view.playbackAvailable,
    readySegmentCount: view.readySegmentCount,
    playableSegmentCount: view.availableSegmentCount,
    includedInAdminList: true,
    finalizedAt: view.finalizedAt,
    lastActivityAt: view.lastActivityAt,
    retentionExpiresAt: view.retentionExpiresAt,
    reason: absenceReason ?? view.playbackReason,
  });

  await audit('VIEWED_METADATA', actor, {
    sessionId: session.id,
    bookingId,
    metadata: { absenceReason },
  });

  return {
    bookingId,
    recordingEnabled: true,
    sessionExists: true,
    absenceReason,
    consentStatus: view.consentStatus,
    session: toMinimalAdminRideVideoView(view),
    playbackAvailable: view.playbackAvailable,
    retentionStatus: view.retentionStatus,
    manifestVersion: view.manifestVersion,
    liveEdgeSeconds: view.liveEdgeSeconds,
    recordingActive: view.recordingActive,
  };
}

export async function listAdminRideVideoSegments(
  sessionId: string,
  query: { page?: number; limit?: number; sortOrder?: 'asc' | 'desc' },
  actor?: AdminActor
) {
  const bundle = await getSessionBundle(sessionId);
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
  const offset = (page - 1) * limit;
  const ordered =
    query.sortOrder === 'desc'
      ? [...bundle.segments].sort((a, b) => b.sequenceNumber - a.sequenceNumber)
      : bundle.segments;

  const counts = computeSegmentCounts(segmentStats(bundle.segments));
  const slice = ordered.slice(offset, offset + limit);
  const items = slice.map((segment) => {
    const playable =
      PLAYABLE_STATUSES.includes(segment.uploadStatus as (typeof PLAYABLE_STATUSES)[number]) &&
      !segment.retentionDeletedAt;
    return {
      segmentId: segment.id,
      segmentIndex: segment.sequenceNumber,
      startedAt: segment.recordedAt?.toISOString() ?? null,
      endedAt:
        segment.recordedAt && segment.durationMs != null
          ? new Date(segment.recordedAt.getTime() + segment.durationMs).toISOString()
          : null,
      durationSeconds:
        segment.durationMs != null ? Math.round(segment.durationMs / 1000) : null,
      sizeBytes: segment.fileSizeBytes,
      uploadStatus: segment.uploadStatus,
      processingStatus:
        segment.uploadStatus === 'verified'
          ? 'ready'
          : segment.uploadStatus === 'failed'
            ? 'failed'
            : segment.uploadStatus === 'uploaded'
              ? 'processing'
              : segment.uploadStatus,
      checksumStatus: segment.checksum
        ? segment.uploadStatus === 'verified'
          ? 'verified'
          : 'present'
        : 'missing',
      retryCount: segment.retryCount,
      uploadedAt: segment.uploadedAt?.toISOString() ?? null,
      errorCode: segment.uploadStatus === 'failed' ? 'UPLOAD_FAILED' : null,
      errorMessage: segment.failureReason,
      playbackAvailable: playable,
      retentionDeletedAt: segment.retentionDeletedAt?.toISOString() ?? null,
    };
  });

  await audit('VIEWED_SEGMENTS', actor, {
    sessionId,
    bookingId: bundle.booking.id,
    metadata: { missingSequences: counts.missingSequences },
  });

  return {
    items,
    missingSequences: counts.missingSequences,
    pagination: {
      page,
      limit,
      total: bundle.segments.length,
      totalPages: Math.ceil(bundle.segments.length / limit) || 0,
    },
  };
}

export async function getAdminRideVideoHealth(sessionId: string, actor?: AdminActor) {
  const bundle = await getSessionBundle(sessionId);
  const stats = segmentStats(bundle.segments);
  const counts = computeSegmentCounts(stats);
  const healthInput = {
    sessionStatus: bundle.session.status,
    consentStatus: bundle.session.consentStatus,
    finalizedAt: bundle.session.finalizedAt,
    retentionDays: videoConfig.retentionDays,
    segmentDurationSeconds: videoConfig.segmentDurationSeconds,
    segments: stats,
  };
  const health = computeHealthState(healthInput);
  const lastSegmentAt =
    stats
      .map((s) => toDate(s.uploadedAt) ?? toDate(s.recordedAt))
      .filter((d): d is Date => Boolean(d))
      .sort((a, b) => b.getTime() - a.getTime())[0]
      ?.toISOString() ?? null;

  await audit('VIEWED_HEALTH', actor, {
    sessionId,
    bookingId: bundle.booking.id,
  });

  return {
    state: health.state,
    expectedSegmentCount: counts.expectedSegmentCount,
    uploadedSegmentCount: counts.uploadedSegmentCount,
    readySegmentCount: counts.readySegmentCount,
    failedSegmentCount: counts.failedSegmentCount,
    missingSegmentCount: counts.missingSegmentCount,
    duplicateSegmentCount: counts.duplicateSegmentCount,
    missingSequences: counts.missingSequences,
    expectedDurationSeconds: health.expectedDurationSeconds,
    availableDurationSeconds: health.availableDurationSeconds,
    completenessPercentage: health.completenessPercentage,
    lastSegmentAt,
    finalized: Boolean(bundle.session.finalizedAt),
    issues: health.issues,
  };
}

const BOOKING_EVENT_MAP: Record<
  string,
  { type: string; category: string; title: string }
> = {
  booking_created: {
    type: 'BOOKING_CREATED',
    category: 'ride',
    title: 'Booking created',
  },
  driver_assigned: {
    type: 'DRIVER_ASSIGNED',
    category: 'ride',
    title: 'Driver assigned',
  },
  driver_accepted: {
    type: 'DRIVER_ACCEPTED',
    category: 'ride',
    title: 'Driver accepted',
  },
  driver_arrived: {
    type: 'DRIVER_ARRIVED',
    category: 'ride',
    title: 'Driver arrived',
  },
  ride_started: {
    type: 'RIDE_STARTED',
    category: 'ride',
    title: 'Ride started',
  },
  ride_completed: {
    type: 'RIDE_COMPLETED',
    category: 'ride',
    title: 'Ride completed',
  },
  booking_cancelled: {
    type: 'RIDE_COMPLETED',
    category: 'ride',
    title: 'Booking cancelled',
  },
};

export async function getAdminRideVideoTimeline(sessionId: string, actor?: AdminActor) {
  const bundle = await getSessionBundle(sessionId);
  const recordingStart = toDate(bundle.session.startedAt) ?? toDate(bundle.session.createdAt);

  const events: Array<{
    eventId: string;
    type: string;
    category: string;
    timestamp: string;
    title: string;
    description: string | null;
    videoOffsetSeconds: number | null;
    metadata: Record<string, unknown>;
  }> = [];

  const push = (
    eventId: string,
    type: string,
    category: string,
    timestamp: Date,
    title: string,
    description: string | null = null,
    metadata: Record<string, unknown> = {},
    withOffset = false
  ) => {
    let videoOffsetSeconds: number | null = null;
    if (withOffset && recordingStart) {
      const offset = Math.round((timestamp.getTime() - recordingStart.getTime()) / 1000);
      if (offset >= 0) videoOffsetSeconds = offset;
    }
    events.push({
      eventId,
      type,
      category,
      timestamp: timestamp.toISOString(),
      title,
      description,
      videoOffsetSeconds,
      metadata,
    });
  };

  push(
    `session-init-${bundle.session.id}`,
    'SESSION_INITIALIZED',
    'recording',
    bundle.session.createdAt,
    'Recording session initialized'
  );

  if (bundle.session.consentStatus === 'granted') {
    push(
      `consent-granted-${bundle.session.id}`,
      'CONSENT_GRANTED',
      'consent',
      bundle.booking.recordingConsentedAt ?? bundle.session.createdAt,
      'Passenger consent granted'
    );
  } else if (bundle.session.consentStatus === 'denied') {
    push(
      `consent-denied-${bundle.session.id}`,
      'CONSENT_DENIED',
      'consent',
      bundle.booking.recordingConsentRevokedAt ?? bundle.session.updatedAt,
      'Passenger consent denied'
    );
  } else if (bundle.session.consentStatus === 'required') {
    push(
      `consent-requested-${bundle.session.id}`,
      'CONSENT_REQUESTED',
      'consent',
      bundle.session.createdAt,
      'Passenger consent required'
    );
  }

  if (bundle.session.startedAt) {
    push(
      `recording-started-${bundle.session.id}`,
      'RECORDING_STARTED',
      'recording',
      bundle.session.startedAt,
      'Recording started',
      null,
      {},
      true
    );
  }

  for (const segment of bundle.segments) {
    if (segment.uploadedAt) {
      push(
        `segment-uploaded-${segment.id}`,
        'SEGMENT_UPLOADED',
        'recording',
        segment.uploadedAt,
        `Segment ${segment.sequenceNumber} uploaded`,
        null,
        { segmentId: segment.id, segmentIndex: segment.sequenceNumber },
        true
      );
    }
    if (segment.uploadStatus === 'failed') {
      push(
        `upload-failed-${segment.id}`,
        'UPLOAD_FAILED',
        'upload_error',
        segment.updatedAt,
        `Segment ${segment.sequenceNumber} failed`,
        segment.failureReason,
        { segmentId: segment.id, segmentIndex: segment.sequenceNumber }
      );
    }
  }

  const missing = computeSegmentCounts(segmentStats(bundle.segments)).missingSequences;
  for (const seq of missing) {
    push(
      `segment-missing-${bundle.session.id}-${seq}`,
      'SEGMENT_MISSING',
      'upload_error',
      bundle.session.updatedAt,
      `Segment ${seq} missing`,
      null,
      { segmentIndex: seq }
    );
  }

  if (bundle.session.endedAt) {
    push(
      `recording-stopped-${bundle.session.id}`,
      'RECORDING_STOPPED',
      'recording',
      bundle.session.endedAt,
      'Recording stopped',
      null,
      {},
      true
    );
  }

  if (bundle.session.finalizedAt) {
    push(
      `session-finalized-${bundle.session.id}`,
      'SESSION_FINALIZED',
      'recording',
      bundle.session.finalizedAt,
      'Session finalized'
    );
  }

  const bookingEventRows = await db
    .select()
    .from(bookingEvents)
    .where(eq(bookingEvents.bookingId, bundle.booking.id))
    .orderBy(asc(bookingEvents.createdAt));

  for (const event of bookingEventRows) {
    const mapped = BOOKING_EVENT_MAP[event.eventType];
    if (!mapped) continue;
    push(
      `booking-event-${event.id}`,
      mapped.type,
      mapped.category,
      event.createdAt,
      mapped.title,
      null,
      (event.payload as Record<string, unknown>) || {}
    );
  }

  const auditRows = await listRideVideoAuditEvents({
    sessionId,
    page: 1,
    limit: 50,
  });
  for (const entry of auditRows.items) {
    if (entry.action === 'STARTED_PLAYBACK' || entry.action === 'VIEWED_METADATA') {
      push(
        `admin-audit-${entry.id}`,
        'ADMIN_VIEWED_RECORDING',
        'audit',
        entry.createdAt,
        'Admin accessed recording',
        null,
        { action: entry.action, adminEmail: entry.adminEmail }
      );
    }
  }

  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  await audit('VIEWED_TIMELINE', actor, {
    sessionId,
    bookingId: bundle.booking.id,
  });

  return { items: events };
}

export async function createAdminPlaybackManifest(
  sessionId: string,
  options: {
    fromIndex?: number;
    fromSegmentIndex?: number;
    fromOffsetSeconds?: number;
    sinceManifestVersion?: number;
    limit?: number;
  } = {},
  actor?: AdminActor
) {
  const bundle = await getSessionBundle(sessionId);
  const view = buildSessionView(bundle);
  if (!view.playbackAvailable) {
    await logManifestBlockedDiagnostics({
      sessionId,
      playbackReason: view.playbackReason,
      manifestVersion: view.manifestVersion,
      segments: bundle.segments.map((segment) => ({
        id: segment.id,
        uploadStatus: segment.uploadStatus,
        storageKey: segment.storageKey,
        retentionDeletedAt: segment.retentionDeletedAt,
      })),
      uploadedCount: view.uploadedSegmentCount,
      verifiedCount: view.readySegmentCount,
    });
  }
  assertPlaybackAllowed(view);

  const built = await buildDvrPlaybackManifest(bundle.session, bundle.segments, options);

  if (built.slice.unchanged) {
    return {
      sessionId,
      bookingId: bundle.booking.id,
      playbackMode: DVR_PLAYBACK_MODE,
      recordingActive: built.timeline.recordingActive,
      finalized: built.timeline.finalized,
      timelineStartSeconds: built.timeline.timelineStartSeconds,
      liveEdgeSeconds: built.timeline.liveEdgeSeconds,
      availableDurationSeconds: built.timeline.availableDurationSeconds,
      manifestVersion: built.manifestVersion,
      refreshAfterSeconds: videoConfig.manifestRefreshSeconds,
      unchanged: true,
      segments: [],
    };
  }

  if (built.manifestSegments.length === 0 && built.storageIssues.length > 0) {
    throw new RideVideoError(
      'STORAGE_OBJECT_MISSING',
      'Segment metadata exists but storage objects are unavailable',
      409
    );
  }

  traceRideVideo({
    stage: 'admin_playback_manifest',
    bookingId: bundle.booking.id,
    sessionId,
    sessionStatus: view.sessionStatus,
    playbackAvailable: true,
    readySegmentCount: view.readySegmentCount,
    playableSegmentCount: built.timeline.playableSegmentCount,
    finalizedAt: view.finalizedAt,
    lastActivityAt: view.lastSegmentAt,
  });

  await audit('STARTED_PLAYBACK', actor, {
    sessionId,
    bookingId: bundle.booking.id,
    metadata: {
      manifestVersion: built.manifestVersion,
      segmentCount: built.manifestSegments.length,
      sinceManifestVersion: options.sinceManifestVersion,
      storageIssues: built.storageIssues,
    },
  });

  const expiresAt =
    built.manifestSegments.map((s) => s.expiresAt).sort()[0] ||
    new Date(Date.now() + videoConfig.readUrlTtlSeconds * 1000).toISOString();

  return {
    sessionId,
    bookingId: bundle.booking.id,
    sessionStatus: view.sessionStatus,
    recordingStatus: view.recordingStatus,
    playbackMode: DVR_PLAYBACK_MODE,
    recordingActive: built.timeline.recordingActive,
    finalized: built.timeline.finalized,
    timelineStartSeconds: built.timeline.timelineStartSeconds,
    liveEdgeSeconds: built.timeline.liveEdgeSeconds,
    availableDurationSeconds: built.timeline.availableDurationSeconds,
    firstAvailableSegmentIndex: built.timeline.firstAvailableSegmentIndex,
    latestAvailableSegmentIndex: built.timeline.latestAvailableSegmentIndex,
    manifestVersion: built.manifestVersion,
    refreshAfterSeconds: videoConfig.manifestRefreshSeconds,
    manifestGeneratedAt: new Date().toISOString(),
    unchanged: false,
    expiresAt,
    totalPlayableSegments: built.timeline.playableSegmentCount,
    fromSegmentIndex: built.slice.fromSegmentIndex,
    nextFromSegmentIndex: built.slice.nextFromSegmentIndex,
    storageIssues: built.storageIssues,
    segments: built.manifestSegments,
  };
}

export async function createAdminSegmentPlaybackUrl(
  sessionId: string,
  segmentId: string,
  actor?: AdminActor
) {
  const bundle = await getSessionBundle(sessionId);
  const view = buildSessionView(bundle);
  assertPlaybackAllowed(view);

  const segment = bundle.segments.find((s) => s.id === segmentId);
  if (!segment) {
    throw new RideVideoError('SEGMENT_NOT_FOUND', 'Segment not found for this session', 404);
  }
  if (segment.sessionId !== sessionId) {
    throw new RideVideoError('SEGMENT_NOT_FOUND', 'Segment does not belong to this session', 404);
  }

  const signed = await createAdminSegmentReadUrl(segmentId);

  await audit('REFRESHED_PLAYBACK_URL', actor, {
    sessionId,
    bookingId: bundle.booking.id,
    segmentId,
  });

  return {
    segmentId,
    url: signed.url,
    expiresAt: signed.expiresAt,
  };
}

export async function listAdminRideVideoAudit(
  sessionId: string,
  query: { page?: number; limit?: number },
  actor?: AdminActor
) {
  await getSessionBundle(sessionId);
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const result = await listRideVideoAuditEvents({ sessionId, page, limit });

  await audit('VIEWED_AUDIT', actor, { sessionId });

  return {
    items: result.items.map((entry) => ({
      id: entry.id,
      admin: {
        auth0Id: entry.adminAuth0Id,
        email: entry.adminEmail,
        userId: entry.adminUserId,
      },
      action: entry.action,
      result: entry.result,
      reason: entry.reason,
      sessionId: entry.sessionId,
      bookingId: entry.bookingId,
      segmentId: entry.segmentId,
      timestamp: entry.createdAt.toISOString(),
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
      metadata: entry.metadata,
    })),
    pagination: {
      page,
      limit,
      total: result.total,
      totalPages: Math.ceil(result.total / limit) || 0,
    },
  };
}

export async function requestAdminRideVideoDownload(sessionId: string, actor?: AdminActor) {
  const bundle = await getSessionBundle(sessionId);
  const view = buildSessionView(bundle);
  assertPlaybackAllowed(view);

  await audit('DOWNLOADED_RECORDING', actor, {
    sessionId,
    bookingId: bundle.booking.id,
    result: 'unsupported',
    reason: 'Combined recording download is not available',
  });

  throw new RideVideoError(
    'COMBINED_DOWNLOAD_NOT_AVAILABLE',
    'Combined recording download is not available',
    409
  );
}
