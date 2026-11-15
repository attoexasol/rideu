import { and, desc, eq, sql } from 'drizzle-orm';
import {
  DRAFT_SOFT_METER_CODE,
  type RateScheduleStatusType,
} from '../constants/softMeter';
import { db } from '../db/connection';
import {
  meterRateScheduleEvents,
  meterRateSchedules,
  type NewMeterRateSchedule,
} from '../db/schema/meter_rate_schedules';

export async function findRateScheduleById(id: string) {
  const [row] = await db
    .select()
    .from(meterRateSchedules)
    .where(eq(meterRateSchedules.id, id))
    .limit(1);
  return row ?? null;
}

export async function findLatestRateSchedule(code = DRAFT_SOFT_METER_CODE) {
  const [active] = await db
    .select()
    .from(meterRateSchedules)
    .where(and(eq(meterRateSchedules.code, code), eq(meterRateSchedules.status, 'active')))
    .limit(1);
  if (active) return active;
  const [latest] = await db
    .select()
    .from(meterRateSchedules)
    .where(eq(meterRateSchedules.code, code))
    .orderBy(desc(meterRateSchedules.version))
    .limit(1);
  return latest ?? null;
}

export async function listRateSchedules(limit = 50) {
  return db
    .select()
    .from(meterRateSchedules)
    .orderBy(desc(meterRateSchedules.createdAt))
    .limit(limit);
}

export async function nextRateScheduleVersion(code: string): Promise<number> {
  const [row] = await db
    .select({ version: meterRateSchedules.version })
    .from(meterRateSchedules)
    .where(eq(meterRateSchedules.code, code))
    .orderBy(desc(meterRateSchedules.version))
    .limit(1);
  return (row?.version ?? 0) + 1;
}

export async function insertRateSchedule(values: NewMeterRateSchedule) {
  const [row] = await db.insert(meterRateSchedules).values(values).returning();
  return row;
}

export async function updateRateSchedule(
  id: string,
  patch: Partial<NewMeterRateSchedule> & { status?: RateScheduleStatusType }
) {
  const [row] = await db
    .update(meterRateSchedules)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(meterRateSchedules.id, id))
    .returning();
  return row ?? null;
}

export async function retireActiveSchedules(
  code: string,
  exceptId: string,
  actorId: string | null
) {
  await db
    .update(meterRateSchedules)
    .set({
      status: 'retired',
      retiredAt: new Date(),
      retiredBy: actorId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(meterRateSchedules.code, code),
        eq(meterRateSchedules.status, 'active'),
        sql`${meterRateSchedules.id} <> ${exceptId}`
      )
    );
}

export async function insertRateScheduleEvent(values: {
  scheduleId: string;
  action: string;
  actorId: string | null;
  actorRole: string | null;
  payload: Record<string, unknown>;
}) {
  const [row] = await db.insert(meterRateScheduleEvents).values(values).returning();
  return row;
}

export async function listRateScheduleEvents(scheduleId: string) {
  return db
    .select()
    .from(meterRateScheduleEvents)
    .where(eq(meterRateScheduleEvents.scheduleId, scheduleId))
    .orderBy(desc(meterRateScheduleEvents.createdAt));
}
