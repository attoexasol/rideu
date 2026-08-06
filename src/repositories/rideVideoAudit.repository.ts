import { count, desc, eq } from 'drizzle-orm';
import { db } from '../db/connection';
import { rideVideoAuditEvents, type NewRideVideoAuditEvent } from '../db/schema';
import type { RideVideoAuditAction } from './rideVideoAudit.types';

export type { RideVideoAuditAction } from './rideVideoAudit.types';

export async function insertRideVideoAuditEvent(
  input: Omit<NewRideVideoAuditEvent, 'id' | 'createdAt'> & {
    action: RideVideoAuditAction | string;
  }
) {
  const rows = await db
    .insert(rideVideoAuditEvents)
    .values({
      sessionId: input.sessionId ?? null,
      bookingId: input.bookingId ?? null,
      adminUserId: input.adminUserId ?? null,
      adminAuth0Id: input.adminAuth0Id ?? null,
      adminEmail: input.adminEmail ?? null,
      action: input.action,
      result: input.result ?? 'success',
      reason: input.reason ?? null,
      segmentId: input.segmentId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      metadata: input.metadata ?? null,
    })
    .returning();
  return rows[0];
}

export async function listRideVideoAuditEvents(params: {
  sessionId: string;
  page: number;
  limit: number;
}) {
  const offset = (params.page - 1) * params.limit;
  const [items, totalRow] = await Promise.all([
    db
      .select()
      .from(rideVideoAuditEvents)
      .where(eq(rideVideoAuditEvents.sessionId, params.sessionId))
      .orderBy(desc(rideVideoAuditEvents.createdAt))
      .limit(params.limit)
      .offset(offset),
    db
      .select({ value: count() })
      .from(rideVideoAuditEvents)
      .where(eq(rideVideoAuditEvents.sessionId, params.sessionId)),
  ]);

  return {
    items,
    total: Number(totalRow[0]?.value ?? 0),
  };
}
