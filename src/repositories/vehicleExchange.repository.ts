import { db } from '../db/connection';
import type { DbTransaction } from '../utils/db-transaction';
import { vehicleExchangeRequests } from '../db/schema/vehicle_exchange_requests';
import { vehicleExchangeEvents } from '../db/schema/vehicle_exchange_events';
import { vehicleExchangeResourceLocks } from '../db/schema/vehicle_exchange_resource_locks';
import { eq, and, or, lt, sql } from 'drizzle-orm';
import { EXCHANGE_STATUS_PENDING } from '../config/exchange';

export async function insertExchangeEvent(data: typeof vehicleExchangeEvents.$inferInsert) {
  const [row] = await db.insert(vehicleExchangeEvents).values(data).returning();
  return row;
}

export async function insertExchangeEventTx(
  tx: DbTransaction,
  data: typeof vehicleExchangeEvents.$inferInsert
) {
  const [row] = await tx.insert(vehicleExchangeEvents).values(data).returning();
  return row;
}

export async function findExchangeById(id: string) {
  const rows = await db
    .select()
    .from(vehicleExchangeRequests)
    .where(eq(vehicleExchangeRequests.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function findExchangeByIdForUpdate(tx: DbTransaction, id: string) {
  const rows = await tx
    .select()
    .from(vehicleExchangeRequests)
    .where(eq(vehicleExchangeRequests.id, id))
    .for('update')
    .limit(1);
  return rows[0] ?? null;
}

export async function findExchangeByIdempotency(initiatorDriverId: string, idempotencyKey: string) {
  const rows = await db
    .select()
    .from(vehicleExchangeRequests)
    .where(
      and(
        eq(vehicleExchangeRequests.initiatorDriverId, initiatorDriverId),
        eq(vehicleExchangeRequests.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function findPendingExchangeForDriver(driverId: string) {
  const rows = await db
    .select()
    .from(vehicleExchangeRequests)
    .where(
      and(
        eq(vehicleExchangeRequests.status, EXCHANGE_STATUS_PENDING),
        or(
          eq(vehicleExchangeRequests.initiatorDriverId, driverId),
          eq(vehicleExchangeRequests.partnerDriverId, driverId)
        )
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listExchangeEvents(exchangeRequestId: string) {
  return db
    .select()
    .from(vehicleExchangeEvents)
    .where(eq(vehicleExchangeEvents.exchangeRequestId, exchangeRequestId))
    .orderBy(vehicleExchangeEvents.createdAt);
}

export async function listExchanges(filters: { status?: string; fleetId?: string } = {}) {
  const conditions = [];
  if (filters.status) {
    conditions.push(eq(vehicleExchangeRequests.status, filters.status));
  }
  if (filters.fleetId) {
    conditions.push(eq(vehicleExchangeRequests.fleetId, filters.fleetId));
  }
  if (conditions.length === 0) {
    return db.select().from(vehicleExchangeRequests).orderBy(vehicleExchangeRequests.initiatedAt);
  }
  return db
    .select()
    .from(vehicleExchangeRequests)
    .where(and(...conditions))
    .orderBy(vehicleExchangeRequests.initiatedAt);
}

export async function insertResourceLocks(
  tx: DbTransaction,
  locks: { exchangeRequestId: string; resourceType: string; resourceId: string }[]
) {
  if (!locks.length) return;
  await tx.insert(vehicleExchangeResourceLocks).values(locks);
}

export async function releaseResourceLocks(tx: DbTransaction, exchangeRequestId: string) {
  await tx
    .update(vehicleExchangeResourceLocks)
    .set({ releasedAt: new Date() })
    .where(
      and(
        eq(vehicleExchangeResourceLocks.exchangeRequestId, exchangeRequestId),
        sql`${vehicleExchangeResourceLocks.releasedAt} IS NULL`
      )
    );
}

export async function findExpiredPendingExchangeIds(limit = 50): Promise<string[]> {
  const now = new Date();
  const rows = await db
    .select({ id: vehicleExchangeRequests.id })
    .from(vehicleExchangeRequests)
    .where(
      and(
        eq(vehicleExchangeRequests.status, EXCHANGE_STATUS_PENDING),
        lt(vehicleExchangeRequests.expiresAt, now)
      )
    )
    .limit(limit);
  return rows.map((r) => r.id);
}

export async function hasActiveResourceLock(
  resourceType: string,
  resourceId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: vehicleExchangeResourceLocks.id })
    .from(vehicleExchangeResourceLocks)
    .where(
      and(
        eq(vehicleExchangeResourceLocks.resourceType, resourceType),
        eq(vehicleExchangeResourceLocks.resourceId, resourceId),
        sql`${vehicleExchangeResourceLocks.releasedAt} IS NULL`
      )
    )
    .limit(1);
  return rows.length > 0;
}
