import { db } from '../db/connection';
import { driverPushTokens, type DriverPushToken } from '../db/schema/driver_push_tokens';
import { drivers } from '../db/schema/drivers';
import { and, eq, ne } from 'drizzle-orm';

export async function findDriverSessionForPush(driverId: string): Promise<{
  id: string;
  activeDeviceId: string | null;
  activeSessionId: string | null;
} | null> {
  const rows = await db
    .select({
      id: drivers.id,
      activeDeviceId: drivers.activeDeviceId,
      activeSessionId: drivers.activeSessionId,
    })
    .from(drivers)
    .where(eq(drivers.id, driverId))
    .limit(1);
  return rows[0] ?? null;
}

export async function findEnabledPushTokenForDriverDevice(
  driverId: string,
  deviceId: string
): Promise<DriverPushToken | null> {
  const rows = await db
    .select()
    .from(driverPushTokens)
    .where(
      and(
        eq(driverPushTokens.driverId, driverId),
        eq(driverPushTokens.deviceId, deviceId),
        eq(driverPushTokens.enabled, true)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function deletePushTokensByFcmTokenExcept(
  fcmToken: string,
  except: { driverId: string; deviceId: string }
): Promise<number> {
  const stale = await db
    .select()
    .from(driverPushTokens)
    .where(eq(driverPushTokens.fcmToken, fcmToken));

  let removed = 0;
  for (const row of stale) {
    if (row.driverId === except.driverId && row.deviceId === except.deviceId) continue;
    await db.delete(driverPushTokens).where(eq(driverPushTokens.id, row.id));
    removed += 1;
  }
  return removed;
}

export async function deletePushTokensForDriverExceptDevice(
  driverId: string,
  deviceId: string
): Promise<number> {
  const stale = await db
    .select({ id: driverPushTokens.id })
    .from(driverPushTokens)
    .where(and(eq(driverPushTokens.driverId, driverId), ne(driverPushTokens.deviceId, deviceId)));

  if (!stale.length) return 0;
  await db
    .delete(driverPushTokens)
    .where(and(eq(driverPushTokens.driverId, driverId), ne(driverPushTokens.deviceId, deviceId)));
  return stale.length;
}

export async function deletePushTokensForDriver(driverId: string): Promise<number> {
  const existing = await db
    .select({ id: driverPushTokens.id })
    .from(driverPushTokens)
    .where(eq(driverPushTokens.driverId, driverId));
  if (!existing.length) return 0;
  await db.delete(driverPushTokens).where(eq(driverPushTokens.driverId, driverId));
  return existing.length;
}

export async function deletePushTokenById(id: string): Promise<void> {
  await db.delete(driverPushTokens).where(eq(driverPushTokens.id, id));
}

export async function upsertDriverPushToken(input: {
  driverId: string;
  deviceId: string;
  sessionId: string | null;
  fcmToken: string;
}): Promise<DriverPushToken> {
  await deletePushTokensByFcmTokenExcept(input.fcmToken, {
    driverId: input.driverId,
    deviceId: input.deviceId,
  });
  await deletePushTokensForDriverExceptDevice(input.driverId, input.deviceId);

  const now = new Date();
  const [row] = await db
    .insert(driverPushTokens)
    .values({
      driverId: input.driverId,
      deviceId: input.deviceId,
      sessionId: input.sessionId,
      fcmToken: input.fcmToken,
      enabled: true,
      lastRegisteredAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [driverPushTokens.driverId, driverPushTokens.deviceId],
      set: {
        fcmToken: input.fcmToken,
        sessionId: input.sessionId,
        enabled: true,
        lastRegisteredAt: now,
        updatedAt: now,
      },
    })
    .returning();

  return row;
}

export async function updatePushTokenSessionForDevice(
  driverId: string,
  deviceId: string,
  sessionId: string
): Promise<void> {
  await db
    .update(driverPushTokens)
    .set({ sessionId, updatedAt: new Date() })
    .where(
      and(
        eq(driverPushTokens.driverId, driverId),
        eq(driverPushTokens.deviceId, deviceId),
        eq(driverPushTokens.enabled, true)
      )
    );
}
