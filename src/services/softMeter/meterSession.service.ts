import { eq } from 'drizzle-orm';
import {
  METER_STOP_POLICY,
  MeterSessionStatus,
  MeterTripKind,
  WalkUpStatus,
  type MeterSessionStatusType,
  type MeterTripKindType,
} from '../../constants/softMeter';
import { logger } from '../../middleware/logger';
import {
  meterCalculationEvents,
  meterFareRecords,
  meterGpsSamples,
  meterPauses,
  meterSessions,
  type MeterFareRecord,
  type MeterPause,
  type MeterSession,
  type StoredRateSnapshot,
} from '../../db/schema/meter_sessions';
import { walkUpTrips } from '../../db/schema/walk_up_trips';
import { findLatestRateSchedule } from '../../repositories/meterRateSchedule.repository';
import {
  findFareBySession,
  findGpsSample,
  findMeterByBooking,
  findMeterByWalkUp,
  findMeterForGpsIngest,
  findMeterSessionById,
  findOpenMeterByDriver,
  findOpenMeterPause,
  insertMeterSession,
  listMeterPauses,
  withMeterSessionLock,
  type DbTransaction,
} from '../../repositories/meterSession.repository';
import { previewFare, type FarePreview } from './fare';
import { applyStoppedInterval } from './stoppedTime';
import { MeterError, isUniqueViolation } from './errors';
import { type GpsPointInput, type MeterTrackState } from './gps';
import {
  assertCanPause,
  assertCanResume,
  assertCanStart,
  assertCanStop,
  beginFinalization,
  KeyedMutex,
} from './lifecycle';
import {
  buildMeterTiming,
  classifyMeterGps,
  isStaleMeterEvent,
  pauseDurationSeconds,
  PAUSE_REASON_DRIVER_PERSONAL_STOP,
  type PauseInterval,
} from './pause';
import { emitMeterUpdate } from './meterNotify.service';
import { materializeSnapshot, type RateSnapshot } from './rules';

const sessionMutex = new KeyedMutex();
const runningDrivers = new Set<string>();
const negativeUntil = new Map<string, number>();
const lastEmittedVersion = new Map<string, number>();

function noteMeterRunning(driverId: string): void {
  runningDrivers.add(driverId);
  negativeUntil.delete(driverId);
}

function noteMeterClosed(driverId: string): void {
  runningDrivers.delete(driverId);
  negativeUntil.set(driverId, Date.now() + 30_000);
}

function asSnapshot(value: StoredRateSnapshot): RateSnapshot {
  return value as RateSnapshot;
}

function trackFromSession(session: MeterSession): MeterTrackState {
  return {
    acceptedDistanceMillimeters: session.acceptedDistanceMillimeters,
    rejectedPointCount: session.rejectedPointCount,
    gapCount: session.gapCount,
    reviewRequired: session.reviewRequired,
    reviewReasons: session.reviewReasons ?? [],
    lastAcceptedRecordedAtMs: session.lastAcceptedRecordedAt
      ? session.lastAcceptedRecordedAt.getTime()
      : null,
    lastAcceptedLat:
      session.lastAcceptedLatitude == null ? null : Number(session.lastAcceptedLatitude),
    lastAcceptedLng:
      session.lastAcceptedLongitude == null ? null : Number(session.lastAcceptedLongitude),
    lastSequence: session.lastSequence,
  };
}

export function toMeterState(session: MeterSession): {
  sessionId: string;
  tripKind: string;
  bookingId: string | null;
  walkUpTripId: string | null;
  driverId: string;
  vehicleId: string;
  status: string;
  startedAt: string | null;
  stoppedAt: string | null;
  finalizedAt: string | null;
  acceptedDistanceMillimeters: number;
  waitingSeconds: number;
  eligibleStoppedSeconds: number;
  excludedStopSeconds: number;
  stopStreak: number;
  stopPolicy: {
    stopRadiusMillimeters: number;
    maxStoppedDisplacementMillimeters: number;
    maxStoppedGapMs: number;
    maxStoppedSpeedMps: number;
    partialMinutePolicy: string;
    confirmedBusinessRule: string;
    partialMinuteRegulatorApproved: boolean;
  };
  reviewRequired: boolean;
  reviewReasons: string[];
  rejectedPointCount: number;
  gapCount: number;
  rate: { scheduleId: string; code: string; version: number; currency: string };
  fare: FarePreview;
  pausedAt: string | null;
  totalPausedSeconds: number;
  currentPauseSeconds: number;
  chargeableElapsedSeconds: number;
  tripElapsedSeconds: number;
  pauseReason: string | null;
  fareFrozen: boolean;
  stateVersion: number;
  serverTime: string;
} {
  const snapshot = session.rateSnapshot;
  const fare = previewFare(
    asSnapshot(snapshot),
    session.acceptedDistanceMillimeters,
    session.waitingSeconds
  );
  const now = new Date();
  const timing = buildMeterTiming({
    status: session.status,
    startedAtMs: session.startedAt?.getTime() ?? null,
    stoppedAtMs: session.stoppedAt?.getTime() ?? null,
    pausedAtMs: session.pausedAt?.getTime() ?? null,
    totalPausedSeconds: session.totalPausedSeconds,
    pauseReason: session.pauseReason,
    nowMs: now.getTime(),
  });
  return {
    sessionId: session.id,
    tripKind: session.tripKind,
    bookingId: session.bookingId,
    walkUpTripId: session.walkUpTripId,
    driverId: session.driverId,
    vehicleId: session.vehicleId,
    status: session.status,
    startedAt: session.startedAt?.toISOString() ?? null,
    stoppedAt: session.stoppedAt?.toISOString() ?? null,
    finalizedAt: session.finalizedAt?.toISOString() ?? null,
    acceptedDistanceMillimeters: session.acceptedDistanceMillimeters,
    waitingSeconds: session.waitingSeconds,
    eligibleStoppedSeconds: session.waitingSeconds,
    excludedStopSeconds: session.excludedStopSeconds,
    stopStreak: session.stopStreak,
    stopPolicy: {
      stopRadiusMillimeters: METER_STOP_POLICY.stopRadiusMillimeters,
      maxStoppedDisplacementMillimeters: METER_STOP_POLICY.maxStoppedDisplacementMillimeters,
      maxStoppedGapMs: METER_STOP_POLICY.maxStoppedGapMs,
      maxStoppedSpeedMps: METER_STOP_POLICY.maxStoppedSpeedMps,
      partialMinutePolicy: METER_STOP_POLICY.partialMinutePolicy,
      confirmedBusinessRule: 'time_only_when_fully_stopped',
      partialMinuteRegulatorApproved: false,
    },
    reviewRequired: session.reviewRequired,
    reviewReasons: session.reviewReasons ?? [],
    rejectedPointCount: session.rejectedPointCount,
    gapCount: session.gapCount,
    rate: {
      scheduleId: snapshot.scheduleId,
      code: snapshot.code,
      version: snapshot.version,
      currency: snapshot.currency,
    },
    fare,
    ...timing,
    stateVersion: session.stateVersion,
    serverTime: now.toISOString(),
  };
}

async function publish(session: MeterSession, kind: 'state' | 'fare'): Promise<void> {
  const version = session.stateVersion ?? 0;
  const previous = lastEmittedVersion.get(session.id) ?? -1;
  if (isStaleMeterEvent(version, previous)) return;
  if (kind === 'fare' && session.status === MeterSessionStatus.PAUSED) return;
  lastEmittedVersion.set(session.id, version);
  await emitMeterUpdate({
    driverId: session.driverId,
    customerId: session.customerId,
    payload: toMeterState(session),
    kind,
  });
}

export async function getMeterSessionForDriver(sessionId: string, driverId: string) {
  const session = await findMeterSessionById(sessionId);
  if (!session || session.driverId !== driverId) {
    throw new MeterError('METER_NOT_FOUND', 'Meter session not found.', 404);
  }
  return session;
}

export async function startMeterSession(input: {
  driverId: string;
  vehicleId: string;
  tripKind: MeterTripKindType;
  bookingId?: string | null;
  walkUpTripId?: string | null;
  customerId?: string | null;
  idempotencyKey?: string | null;
}): Promise<{ session: MeterSession; idempotent: boolean }> {
  const existing =
    input.tripKind === MeterTripKind.WALK_UP && input.walkUpTripId
      ? await findMeterByWalkUp(input.walkUpTripId)
      : input.bookingId
        ? await findMeterByBooking(input.bookingId)
        : null;
  if (existing) {
    if (existing.driverId !== input.driverId) {
      throw new MeterError('METER_NOT_FOUND', 'Meter session not found.', 404);
    }
    const decision = assertCanStart(existing.status as MeterSessionStatusType);
    if (existing.status === MeterSessionStatus.PENDING) {
      const started = await markRunning(existing.id, input.idempotencyKey ?? null);
      noteMeterRunning(input.driverId);
      await publish(started, 'state');
      return { session: started, idempotent: false };
    }
    if (
      existing.status === MeterSessionStatus.RUNNING ||
      existing.status === MeterSessionStatus.PAUSED
    ) {
      noteMeterRunning(input.driverId);
    }
    return { session: existing, idempotent: decision.idempotent };
  }

  const open = await findOpenMeterByDriver(input.driverId);
  if (open) {
    throw new MeterError(
      'METER_ALREADY_ACTIVE',
      'This driver already has an open meter session.',
      409
    );
  }

  const schedule = await findLatestRateSchedule();
  if (!schedule) {
    throw new MeterError(
      'METER_RATE_SCHEDULE_MISSING',
      'No soft-meter rate schedule is configured.',
      409
    );
  }
  const capturedAt = new Date().toISOString();
  const snapshot = materializeSnapshot(
    {
      scheduleId: schedule.id,
      code: schedule.code,
      version: schedule.version,
      status: schedule.status as RateSnapshot['status'],
      currency: schedule.currency,
      flagDropCents: schedule.flagDropCents,
      distanceRateCentsPerMile: schedule.distanceRateCentsPerMile,
      distanceIncrementMicroMiles: schedule.distanceIncrementMicroMiles,
      distanceIncrementCents: schedule.distanceIncrementCents,
      waitingCentsPerHour: schedule.waitingCentsPerHour,
      waitingCentsPerMinute: schedule.waitingCentsPerMinute,
      chargingEnabled: false,
      rules: schedule.rules,
    },
    capturedAt
  );
  const preview = previewFare(snapshot, 0, 0);
  const now = new Date();
  try {
    const session = await insertMeterSession({
      tripKind: input.tripKind,
      bookingId: input.bookingId ?? null,
      walkUpTripId: input.walkUpTripId ?? null,
      customerId: input.customerId ?? null,
      driverId: input.driverId,
      vehicleId: input.vehicleId,
      rateScheduleId: schedule.id,
      rateSnapshot: snapshot,
      status: MeterSessionStatus.RUNNING,
      startedAt: now,
      startIdempotencyKey: input.idempotencyKey ?? null,
      provisionalTotalCents: preview.totalCents,
      billable: false,
      waitingSeconds: 0,
      reviewReasons: [],
    });
    await withMeterSessionLock(session.id, async (tx) => {
      await tx.insert(meterCalculationEvents).values({
        sessionId: session.id,
        eventType: 'meter_started',
        payload: {
          startedAt: now.toISOString(),
          rateVersion: snapshot.version,
          rateCode: snapshot.code,
          billable: false,
          blockedReasons: preview.blockedReasons,
        },
      });
      return session;
    });
    noteMeterRunning(input.driverId);
    await publish(session, 'state');
    return { session, idempotent: false };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced =
      input.walkUpTripId != null
        ? await findMeterByWalkUp(input.walkUpTripId)
        : input.bookingId
          ? await findMeterByBooking(input.bookingId)
          : await findOpenMeterByDriver(input.driverId);
    if (!raced) throw error;
    return { session: raced, idempotent: true };
  }
}

async function markRunning(sessionId: string, idempotencyKey: string | null): Promise<MeterSession> {
  return withMeterSessionLock(sessionId, async (tx, locked) => {
    if (locked.status !== MeterSessionStatus.PENDING) return locked;
    const now = new Date();
    const [updated] = await tx
      .update(meterSessions)
      .set({
        status: MeterSessionStatus.RUNNING,
        startedAt: now,
        startIdempotencyKey: idempotencyKey,
        updatedAt: now,
      })
      .where(eq(meterSessions.id, locked.id))
      .returning();
    await tx.insert(meterCalculationEvents).values({
      sessionId: locked.id,
      eventType: 'meter_started',
      payload: { startedAt: now.toISOString(), billable: false },
    });
    return updated;
  });
}

function pausesFromRows(rows: MeterPause[]): PauseInterval[] {
  return rows.map((row) => ({
    pausedAtMs: row.pausedAt.getTime(),
    resumedAtMs: row.resumedAt ? row.resumedAt.getTime() : null,
    durationSeconds: row.durationSeconds,
    reason: row.reason,
    driverId: row.driverId,
  }));
}

/** Close the unfinished pause, if any. Distance and fare columns are not touched. */
async function closeOpenPause(
  tx: DbTransaction,
  session: MeterSession,
  now: Date
): Promise<number> {
  const open = await findOpenMeterPause(session.id, tx);
  if (!open) return session.totalPausedSeconds;
  const durationSeconds = pauseDurationSeconds(open.pausedAt.getTime(), now.getTime());
  await tx
    .update(meterPauses)
    .set({ resumedAt: now, durationSeconds })
    .where(eq(meterPauses.id, open.id));
  return session.totalPausedSeconds + durationSeconds;
}

export async function pauseMeterSession(
  sessionId: string,
  driverId: string,
  idempotencyKey?: string | null
): Promise<{ session: MeterSession; idempotent: boolean }> {
  return sessionMutex.run(sessionId, async () => {
    try {
      const result = await withMeterSessionLock(sessionId, async (tx, locked) => {
        if (locked.driverId !== driverId) {
          throw new MeterError('METER_NOT_FOUND', 'Meter session not found.', 404);
        }
        const decision = assertCanPause(locked.status as MeterSessionStatusType);
        if (decision.idempotent) return { session: locked, idempotent: true };
        const now = new Date();
        const nextVersion = locked.stateVersion + 1;
        await tx.insert(meterPauses).values({
          sessionId: locked.id,
          driverId: locked.driverId,
          reason: PAUSE_REASON_DRIVER_PERSONAL_STOP,
          pausedAt: now,
          provisionalTotalCents: locked.provisionalTotalCents,
          acceptedDistanceMillimeters: locked.acceptedDistanceMillimeters,
          waitingSeconds: locked.waitingSeconds,
          stateVersionAtPause: nextVersion,
          idempotencyKey: idempotencyKey ?? null,
          metadata: { serverAuthoritative: true },
        });
        const [updated] = await tx
          .update(meterSessions)
          .set({
            status: MeterSessionStatus.PAUSED,
            pausedAt: now,
            pauseReason: PAUSE_REASON_DRIVER_PERSONAL_STOP,
            stateVersion: nextVersion,
            acceptedDistanceMillimeters: locked.acceptedDistanceMillimeters,
            waitingSeconds: locked.waitingSeconds,
            provisionalTotalCents: locked.provisionalTotalCents,
            stopStreak: 0,
            stopRemainderMs: 0,
            updatedAt: now,
          })
          .where(eq(meterSessions.id, locked.id))
          .returning();
        await tx.insert(meterCalculationEvents).values({
          sessionId: locked.id,
          eventType: 'meter_paused',
          payload: {
            pausedAt: now.toISOString(),
            reason: PAUSE_REASON_DRIVER_PERSONAL_STOP,
            acceptedDistanceMillimeters: locked.acceptedDistanceMillimeters,
            waitingSeconds: locked.waitingSeconds,
            provisionalTotalCents: locked.provisionalTotalCents,
            stateVersion: nextVersion,
            billable: false,
          },
        });
        return { session: updated, idempotent: false };
      });
      noteMeterRunning(driverId);
      if (!result.idempotent) await publish(result.session, 'state');
      return result;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const current = await findMeterSessionById(sessionId);
      if (!current || current.driverId !== driverId || current.status !== MeterSessionStatus.PAUSED) {
        throw error;
      }
      return { session: current, idempotent: true };
    }
  });
}

export async function resumeMeterSession(
  sessionId: string,
  driverId: string
): Promise<{ session: MeterSession; idempotent: boolean }> {
  return sessionMutex.run(sessionId, async () => {
    const result = await withMeterSessionLock(sessionId, async (tx, locked) => {
      if (locked.driverId !== driverId) {
        throw new MeterError('METER_NOT_FOUND', 'Meter session not found.', 404);
      }
      const decision = assertCanResume(locked.status as MeterSessionStatusType);
      if (decision.idempotent) return { session: locked, idempotent: true };
      const now = new Date();
      const totalPausedSeconds = await closeOpenPause(tx, locked, now);
      const nextVersion = locked.stateVersion + 1;
      const [updated] = await tx
        .update(meterSessions)
        .set({
          status: MeterSessionStatus.RUNNING,
          pausedAt: null,
          pauseReason: null,
          needsNewAnchor: true,
          lastAcceptedRecordedAt: null,
          lastAcceptedLatitude: null,
          lastAcceptedLongitude: null,
          totalPausedSeconds,
          stateVersion: nextVersion,
          acceptedDistanceMillimeters: locked.acceptedDistanceMillimeters,
          waitingSeconds: locked.waitingSeconds,
          provisionalTotalCents: locked.provisionalTotalCents,
          stopStreak: 0,
          stopRemainderMs: 0,
          updatedAt: now,
        })
        .where(eq(meterSessions.id, locked.id))
        .returning();
      await tx.insert(meterCalculationEvents).values({
        sessionId: locked.id,
        eventType: 'meter_resumed',
        payload: {
          resumedAt: now.toISOString(),
          totalPausedSeconds,
          acceptedDistanceMillimeters: locked.acceptedDistanceMillimeters,
          waitingSeconds: locked.waitingSeconds,
          provisionalTotalCents: locked.provisionalTotalCents,
          stateVersion: nextVersion,
          needsNewAnchor: true,
          billable: false,
        },
      });
      return { session: updated, idempotent: false };
    });
    noteMeterRunning(driverId);
    if (!result.idempotent) await publish(result.session, 'state');
    return result;
  });
}

export async function stopMeterSession(
  sessionId: string,
  driverId: string,
  idempotencyKey?: string | null
): Promise<{ session: MeterSession; idempotent: boolean }> {
  const result = await sessionMutex.run(sessionId, () =>
    withMeterSessionLock(sessionId, async (tx, locked) => {
    if (locked.driverId !== driverId) {
      throw new MeterError('METER_NOT_FOUND', 'Meter session not found.', 404);
    }
    const decision = assertCanStop(locked.status as MeterSessionStatusType);
    if (decision.idempotent) return { session: locked, idempotent: true };
    const now = new Date();
    const totalPausedSeconds = await closeOpenPause(tx, locked, now);
    const [updated] = await tx
      .update(meterSessions)
      .set({
        status: MeterSessionStatus.STOPPED,
        stoppedAt: now,
        stopIdempotencyKey: idempotencyKey ?? null,
        pausedAt: null,
        pauseReason: null,
        needsNewAnchor: false,
        totalPausedSeconds,
        stateVersion: locked.stateVersion + 1,
        acceptedDistanceMillimeters: locked.acceptedDistanceMillimeters,
        waitingSeconds: locked.waitingSeconds,
        provisionalTotalCents: locked.provisionalTotalCents,
        updatedAt: now,
      })
      .where(eq(meterSessions.id, locked.id))
      .returning();
    await tx.insert(meterCalculationEvents).values({
      sessionId: locked.id,
      eventType: 'meter_stopped',
      payload: {
        stoppedAt: now.toISOString(),
        acceptedDistanceMillimeters: locked.acceptedDistanceMillimeters,
        waitingSeconds: locked.waitingSeconds,
        provisionalTotalCents: locked.provisionalTotalCents,
        totalPausedSeconds,
        reviewRequired: locked.reviewRequired,
        reviewReasons: locked.reviewReasons,
        billable: false,
      },
    });
    if (locked.walkUpTripId) {
      await tx
        .update(walkUpTrips)
        .set({ status: WalkUpStatus.ENDED, endedAt: now, updatedAt: now })
        .where(eq(walkUpTrips.id, locked.walkUpTripId));
    }
    return { session: updated, idempotent: false };
  })
  );
  noteMeterClosed(driverId);
  await publish(result.session, 'state');
  return result;
}

export async function finalizeMeterSession(
  sessionId: string,
  driverId: string
): Promise<{ session: MeterSession; fare: MeterFareRecord; idempotent: boolean }> {
  return sessionMutex.run(sessionId, () => finalizeLocked(sessionId, driverId));
}

async function finalizeLocked(
  sessionId: string,
  driverId: string
): Promise<{ session: MeterSession; fare: MeterFareRecord; idempotent: boolean }> {
  const result = await withMeterSessionLock(sessionId, async (tx, locked) => {
    if (locked.driverId !== driverId) {
      throw new MeterError('METER_NOT_FOUND', 'Meter session not found.', 404);
    }
    const action = beginFinalization(locked.status as MeterSessionStatusType);
    if (action === 'reject') {
      throw new MeterError('METER_NOT_STARTED', 'Start the meter before finalizing it.', 409);
    }
    if (action === 'return_existing') {
      const fare = await findFareBySession(locked.id, tx);
      if (!fare) {
        throw new MeterError('METER_FARE_MISSING', 'Finalized meter has no fare record.', 500);
      }
      return { session: locked, fare, idempotent: true };
    }
    const now = new Date();
    const totalPausedSeconds = await closeOpenPause(tx, locked, now);
    const stoppedAt = locked.stoppedAt ?? now;
    const snapshot = asSnapshot(locked.rateSnapshot);
    const preview = previewFare(snapshot, locked.acceptedDistanceMillimeters, locked.waitingSeconds);
    const [fare] = await tx
      .insert(meterFareRecords)
      .values({
        sessionId: locked.id,
        rateScheduleId: locked.rateScheduleId,
        rateSnapshot: locked.rateSnapshot,
        flagDropCents: preview.flagDropCents,
        distanceChargeCents: preview.distanceChargeCents,
        waitingChargeCents: preview.waitingChargeCents,
        totalCents: preview.totalCents,
        acceptedDistanceMillimeters: locked.acceptedDistanceMillimeters,
        completedIncrements: preview.completedIncrements,
        remainderMicroMiles: preview.remainderMicroMiles,
        waitingSeconds: locked.waitingSeconds,
        billable: false,
        chargingEnabled: false,
        blockedReasons: preview.blockedReasons,
        calculation: preview as unknown as Record<string, unknown>,
      })
      .returning();
    const [updated] = await tx
      .update(meterSessions)
      .set({
        status: MeterSessionStatus.FINALIZED,
        stoppedAt,
        finalizedAt: now,
        pausedAt: null,
        pauseReason: null,
        needsNewAnchor: false,
        totalPausedSeconds,
        stateVersion: locked.stateVersion + 1,
        acceptedDistanceMillimeters: locked.acceptedDistanceMillimeters,
        waitingSeconds: locked.waitingSeconds,
        provisionalTotalCents: preview.totalCents,
        billable: false,
        updatedAt: now,
      })
      .where(eq(meterSessions.id, locked.id))
      .returning();
    await tx.insert(meterCalculationEvents).values({
      sessionId: locked.id,
      eventType: 'meter_finalized',
      payload: {
        fareRecordId: fare.id,
        totalCents: preview.totalCents,
        billable: false,
        blockedReasons: preview.blockedReasons,
        totalPausedSeconds,
        acceptedDistanceMillimeters: locked.acceptedDistanceMillimeters,
        waitingSeconds: locked.waitingSeconds,
        eligibleStoppedSeconds: locked.waitingSeconds,
        excludedStopSeconds: locked.excludedStopSeconds,
        waitingChargeCents: preview.waitingChargeCents,
        distanceChargeCents: preview.distanceChargeCents,
        flagDropCents: preview.flagDropCents,
        waitingPolicyApplied: preview.waitingPolicyApplied,
        rateVersion: snapshot.version,
        reviewRequired: locked.reviewRequired,
      },
    });
    if (locked.walkUpTripId) {
      await tx
        .update(walkUpTrips)
        .set({
          status: WalkUpStatus.FINALIZED,
          endedAt: stoppedAt,
          paymentStatus: 'not_billable',
          updatedAt: now,
        })
        .where(eq(walkUpTrips.id, locked.walkUpTripId));
    }
    return { session: updated, fare, idempotent: false };
  });
  noteMeterClosed(driverId);
  if (!result.idempotent) await publish(result.session, 'state');
  return result;
}

export interface IngestPointResult {
  clientPointId: string;
  disposition: string;
  rejectReason: string | null;
  distanceDeltaMillimeters: number;
  idempotent: boolean;
  fare: FarePreview;
}

export async function ingestMeterPoints(
  sessionId: string,
  driverId: string,
  points: GpsPointInput[]
): Promise<{ session: MeterSession; results: IngestPointResult[] }> {
  return sessionMutex.run(sessionId, async () => {
  const ordered = [...points].sort(
    (left, right) => (left.recordedAtMs ?? 0) - (right.recordedAtMs ?? 0)
  );
  const results: IngestPointResult[] = [];
  let latest: MeterSession | null = null;
  for (const point of ordered) {
    const applied = await withMeterSessionLock(sessionId, async (tx, locked) => {
      if (locked.driverId !== driverId) {
        throw new MeterError('METER_NOT_FOUND', 'Meter session not found.', 404);
      }
      const existing = await findGpsSample(sessionId, point.clientPointId, tx);
      if (existing) {
        return {
          session: locked,
          result: {
            clientPointId: point.clientPointId,
            disposition: existing.disposition,
            rejectReason: existing.rejectReason,
            distanceDeltaMillimeters: existing.distanceDeltaMillimeters,
            idempotent: true,
            fare: previewFare(
              asSnapshot(locked.rateSnapshot),
              locked.acceptedDistanceMillimeters,
              locked.waitingSeconds
            ),
          },
        };
      }
      if (
        locked.status !== MeterSessionStatus.RUNNING &&
        locked.status !== MeterSessionStatus.PAUSED
      ) {
        throw new MeterError('METER_NOT_RUNNING', 'The meter is not running.', 409);
      }
      const receivedAt = new Date();
      const pauses = pausesFromRows(await listMeterPauses(locked.id, tx));
      const decision = classifyMeterGps({
        status: locked.status,
        needsNewAnchor: locked.needsNewAnchor,
        pauses,
        track: trackFromSession(locked),
        point,
        receivedAtMs: receivedAt.getTime(),
      });
      const excluded = locked.status === MeterSessionStatus.PAUSED || decision.excludedFromFare;
      const previousRecordedAtMs = locked.lastAcceptedRecordedAt?.getTime() ?? null;
      const elapsedMs =
        point.recordedAtMs != null && previousRecordedAtMs != null
          ? point.recordedAtMs - previousRecordedAtMs
          : null;
      const stopped = applyStoppedInterval({
        acceptedDistanceMillimeters: locked.acceptedDistanceMillimeters,
        waitingSeconds: locked.waitingSeconds,
        excludedStopSeconds: locked.excludedStopSeconds,
        stopStreak: locked.stopStreak,
        stopRemainderMs: locked.stopRemainderMs,
        accepted: decision.disposition === 'accepted',
        excludedFromFare: excluded,
        gapBefore: decision.gapBefore,
        resetAnchor: decision.resetAnchor,
        displacementMillimeters: decision.distanceDeltaMillimeters,
        elapsedMs,
        speedMps: point.speedMps ?? null,
        rejectReason: decision.rejectReason,
      });
      const distanceMillimeters = stopped.acceptedDistanceMillimeters;
      const distanceDelta = stopped.distanceDeltaMillimeters;
      const waitingSeconds = stopped.waitingSeconds;
      const preview = previewFare(asSnapshot(locked.rateSnapshot), distanceMillimeters, waitingSeconds);
      const provisionalTotalCents = excluded ? locked.provisionalTotalCents : preview.totalCents;
      const acceptAnchor = decision.disposition === 'accepted' && !excluded;
      await tx.insert(meterGpsSamples).values({
        sessionId: locked.id,
        clientPointId: point.clientPointId,
        sequence: decision.next.lastSequence,
        disposition: decision.disposition,
        rejectReason: decision.rejectReason,
        recordedAt:
          point.recordedAtMs != null && Number.isFinite(point.recordedAtMs)
            ? new Date(point.recordedAtMs)
            : null,
        receivedAt,
        latitude: point.latitude.toFixed(8),
        longitude: point.longitude.toFixed(8),
        accuracyMeters:
          point.accuracyMeters == null ? null : point.accuracyMeters.toFixed(2),
        speedMps: point.speedMps == null ? null : point.speedMps.toFixed(2),
        distanceDeltaMillimeters: distanceDelta,
        gapBefore: decision.gapBefore,
      });
      const [updated] = await tx
        .update(meterSessions)
        .set({
          acceptedDistanceMillimeters: distanceMillimeters,
          waitingSeconds,
          excludedStopSeconds: stopped.excludedStopSeconds,
          stopStreak: stopped.stopStreak,
          stopRemainderMs: stopped.stopRemainderMs,
          rejectedPointCount: decision.next.rejectedPointCount,
          gapCount: decision.next.gapCount,
          reviewRequired: decision.next.reviewRequired,
          reviewReasons: decision.next.reviewReasons,
          lastAcceptedRecordedAt:
            acceptAnchor && point.recordedAtMs != null
              ? new Date(point.recordedAtMs)
              : locked.lastAcceptedRecordedAt,
          lastAcceptedLatitude: acceptAnchor
            ? point.latitude.toFixed(8)
            : locked.lastAcceptedLatitude,
          lastAcceptedLongitude: acceptAnchor
            ? point.longitude.toFixed(8)
            : locked.lastAcceptedLongitude,
          lastSequence: decision.next.lastSequence,
          needsNewAnchor: decision.resetAnchor ? false : locked.needsNewAnchor,
          stateVersion:
            distanceDelta > 0 || stopped.classification.addedStoppedSeconds > 0
              ? locked.stateVersion + 1
              : locked.stateVersion,
          provisionalTotalCents,
          updatedAt: receivedAt,
        })
        .where(eq(meterSessions.id, locked.id))
        .returning();
      await tx.insert(meterCalculationEvents).values({
        sessionId: locked.id,
        eventType: excluded
          ? 'gps_excluded_pause'
          : decision.disposition !== 'accepted'
            ? 'gps_rejected'
            : stopped.classification.addedStoppedSeconds > 0
              ? 'stopped_time_accrued'
              : 'gps_accepted',
        payload: {
          clientPointId: point.clientPointId,
          rejectReason: decision.rejectReason,
          distanceDeltaMillimeters: distanceDelta,
          gapBefore: decision.gapBefore,
          acceptedDistanceMillimeters: distanceMillimeters,
          waitingSeconds,
          eligibleStoppedSeconds: waitingSeconds,
          excludedStopSeconds: stopped.excludedStopSeconds,
          stoppedSecondsAdded: stopped.classification.addedStoppedSeconds,
          stopDisposition: stopped.classification.disposition,
          stopReason: stopped.classification.reason,
          provisionalTotalCents,
          reviewReasons: decision.reviewReasons,
          billable: false,
        },
      });
      return {
        session: updated,
        result: {
          clientPointId: point.clientPointId,
          disposition: decision.disposition,
          rejectReason: decision.rejectReason,
          distanceDeltaMillimeters: distanceDelta,
          idempotent: false,
          fare: {
            ...preview,
            totalCents: provisionalTotalCents,
          },
        },
      };
    });
    latest = applied.session;
    results.push(applied.result);
  }
  if (!latest) {
    latest = await getMeterSessionForDriver(sessionId, driverId);
  }
  if (latest.status !== MeterSessionStatus.PAUSED) {
    await publish(latest, 'fare');
  }
  return { session: latest, results };
  });
}

export async function ingestDriverLocationForActiveMeter(input: GpsPointInput & { driverId: string }): Promise<void> {
  try {
    if (!runningDrivers.has(input.driverId)) {
      const until = negativeUntil.get(input.driverId) ?? 0;
      if (Date.now() < until) return;
      const active = await findMeterForGpsIngest(input.driverId);
      if (!active) {
        negativeUntil.set(input.driverId, Date.now() + 30_000);
        return;
      }
      noteMeterRunning(input.driverId);
    }
    const active = await findMeterForGpsIngest(input.driverId);
    if (!active) {
      noteMeterClosed(input.driverId);
      return;
    }
    await ingestMeterPoints(active.id, input.driverId, [input]);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ingest failed';
    if (message.includes('does not exist')) {
      negativeUntil.set(input.driverId, Date.now() + 60_000);
      return;
    }
    logger.warn({
      type: 'meter.gps.ingest_failed',
      driverId: input.driverId,
      message,
    });
  }
}

export { findMeterSessionById, findMeterByBooking, findMeterByWalkUp, findOpenMeterByDriver };
