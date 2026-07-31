import { db } from '../db/connection';
import { dutySessions } from '../db/schema/duty_sessions';
import { eq, and } from 'drizzle-orm';
import { ACTIVE_DUTY_STATUS } from '../config/duty';

export async function findActiveDutySessionByDriverId(driverId: string) {
  const rows = await db
    .select()
    .from(dutySessions)
    .where(and(eq(dutySessions.driverId, driverId), eq(dutySessions.status, ACTIVE_DUTY_STATUS)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findDutySessionById(id: string) {
  const rows = await db.select().from(dutySessions).where(eq(dutySessions.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createDutySession(data: typeof dutySessions.$inferInsert) {
  const [row] = await db.insert(dutySessions).values(data).returning();
  return row;
}

export async function endDutySession(
  id: string,
  endedReason: string,
  endLocation?: string | null,
  forced = false
) {
  const [row] = await db
    .update(dutySessions)
    .set({
      status: forced ? 'forced_end' : 'ended',
      endedAt: new Date(),
      endedReason,
      endLocation: endLocation ?? null,
      updatedAt: new Date(),
    })
    .where(eq(dutySessions.id, id))
    .returning();
  return row ?? null;
}
