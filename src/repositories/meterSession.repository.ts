import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { OPEN_METER_STATUSES } from '../constants/softMeter';
import { db } from '../db/connection';
import {
  meterCalculationEvents,
  meterFareRecords,
  meterGpsSamples,
  meterPauses,
  meterSessions,
  type MeterSession,
  type NewMeterSession,
} from '../db/schema/meter_sessions';

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function findMeterSessionById(id: string) {
  const [row] = await db.select().from(meterSessions).where(eq(meterSessions.id, id)).limit(1);
  return row ?? null;
}

export async function findMeterByBooking(bookingId: string) {
  const [row] = await db
    .select()
    .from(meterSessions)
    .where(eq(meterSessions.bookingId, bookingId))
    .limit(1);
  return row ?? null;
}

export async function findMeterByWalkUp(walkUpTripId: string) {
  const [row] = await db
    .select()
    .from(meterSessions)
    .where(eq(meterSessions.walkUpTripId, walkUpTripId))
    .limit(1);
  return row ?? null;
}

export async function findOpenMeterByDriver(driverId: string) {
  const [row] = await db
    .select()
    .from(meterSessions)
    .where(
      and(eq(meterSessions.driverId, driverId), inArray(meterSessions.status, OPEN_METER_STATUSES))
    )
    .limit(1);
  return row ?? null;
}

export async function findRunningMeterByDriver(driverId: string) {
  const [row] = await db
    .select()
    .from(meterSessions)
    .where(and(eq(meterSessions.driverId, driverId), eq(meterSessions.status, 'running')))
    .limit(1);
  return row ?? null;
}

/** Running or paused sessions still receive GPS evidence. */
export async function findMeterForGpsIngest(driverId: string) {
  const [row] = await db
    .select()
    .from(meterSessions)
    .where(
      and(
        eq(meterSessions.driverId, driverId),
        inArray(meterSessions.status, ['running', 'paused'])
      )
    )
    .limit(1);
  return row ?? null;
}

export async function listMeterPauses(sessionId: string, tx?: DbTransaction) {
  const query = tx ?? db;
  return query
    .select()
    .from(meterPauses)
    .where(eq(meterPauses.sessionId, sessionId))
    .orderBy(meterPauses.pausedAt);
}

export async function findOpenMeterPause(sessionId: string, tx?: DbTransaction) {
  const query = tx ?? db;
  const [row] = await query
    .select()
    .from(meterPauses)
    .where(and(eq(meterPauses.sessionId, sessionId), sql`${meterPauses.resumedAt} is null`))
    .limit(1);
  return row ?? null;
}

export async function countSessionsForSchedule(scheduleId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(meterSessions)
    .where(eq(meterSessions.rateScheduleId, scheduleId));
  return row?.count ?? 0;
}

export async function insertMeterSession(values: NewMeterSession) {
  const [row] = await db.insert(meterSessions).values(values).returning();
  return row;
}

export async function listMeterSessions(filters: {
  reviewRequired?: boolean;
  status?: string;
  driverId?: string;
  limit: number;
  offset: number;
}) {
  const conditions = [];
  if (filters.reviewRequired != null) {
    conditions.push(eq(meterSessions.reviewRequired, filters.reviewRequired));
  }
  if (filters.status) conditions.push(eq(meterSessions.status, filters.status));
  if (filters.driverId) conditions.push(eq(meterSessions.driverId, filters.driverId));
  return db
    .select()
    .from(meterSessions)
    .where(conditions.length ? and(...conditions) : sql`true`)
    .orderBy(desc(meterSessions.createdAt))
    .limit(filters.limit)
    .offset(filters.offset);
}

export async function withMeterSessionLock<T>(
  sessionId: string,
  fn: (tx: DbTransaction, session: MeterSession) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(meterSessions)
      .where(eq(meterSessions.id, sessionId))
      .for('update');
    if (!session) {
      const error = new Error('Meter session not found');
      (error as Error & { code: string; statusCode: number }).code = 'METER_NOT_FOUND';
      (error as Error & { statusCode: number }).statusCode = 404;
      throw error;
    }
    return fn(tx, session);
  });
}

export async function findGpsSample(sessionId: string, clientPointId: string, tx?: DbTransaction) {
  const query = tx ?? db;
  const [row] = await query
    .select()
    .from(meterGpsSamples)
    .where(
      and(
        eq(meterGpsSamples.sessionId, sessionId),
        eq(meterGpsSamples.clientPointId, clientPointId)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function listGpsSamples(sessionId: string, limit = 500) {
  return db
    .select()
    .from(meterGpsSamples)
    .where(eq(meterGpsSamples.sessionId, sessionId))
    .orderBy(meterGpsSamples.sequence)
    .limit(limit);
}

export async function listCalculationEvents(sessionId: string) {
  return db
    .select()
    .from(meterCalculationEvents)
    .where(eq(meterCalculationEvents.sessionId, sessionId))
    .orderBy(meterCalculationEvents.createdAt);
}

export async function findFareBySession(sessionId: string, tx?: DbTransaction) {
  const query = tx ?? db;
  const [row] = await query
    .select()
    .from(meterFareRecords)
    .where(eq(meterFareRecords.sessionId, sessionId))
    .limit(1);
  return row ?? null;
}
