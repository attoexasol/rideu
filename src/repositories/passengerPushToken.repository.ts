import { db } from '../db/connection';
import { passengerPushTokens, type PassengerPushToken } from '../db/schema/passenger_push_tokens';
import { customers } from '../db/schema/customers';
import { and, eq, ne } from 'drizzle-orm';

export async function findCustomerSessionForPush(customerId: string): Promise<{
  id: string;
  activeDeviceId: string | null;
  activeSessionId: string | null;
} | null> {
  const rows = await db
    .select({
      id: customers.id,
      activeDeviceId: customers.activeDeviceId,
      activeSessionId: customers.activeSessionId,
    })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  return rows[0] ?? null;
}

export async function findEnabledPushTokenForPassengerDevice(
  customerId: string,
  deviceId: string
): Promise<PassengerPushToken | null> {
  const rows = await db
    .select()
    .from(passengerPushTokens)
    .where(
      and(
        eq(passengerPushTokens.customerId, customerId),
        eq(passengerPushTokens.deviceId, deviceId),
        eq(passengerPushTokens.enabled, true)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function deletePassengerPushTokensByFcmTokenExcept(
  fcmToken: string,
  except: { customerId: string; deviceId: string }
): Promise<number> {
  const stale = await db
    .select()
    .from(passengerPushTokens)
    .where(eq(passengerPushTokens.fcmToken, fcmToken));

  let removed = 0;
  for (const row of stale) {
    if (row.customerId === except.customerId && row.deviceId === except.deviceId) continue;
    await db.delete(passengerPushTokens).where(eq(passengerPushTokens.id, row.id));
    removed += 1;
  }
  return removed;
}

export async function deletePassengerPushTokensForCustomerExceptDevice(
  customerId: string,
  deviceId: string
): Promise<number> {
  const stale = await db
    .select({ id: passengerPushTokens.id })
    .from(passengerPushTokens)
    .where(
      and(eq(passengerPushTokens.customerId, customerId), ne(passengerPushTokens.deviceId, deviceId))
    );

  if (!stale.length) return 0;
  await db
    .delete(passengerPushTokens)
    .where(
      and(eq(passengerPushTokens.customerId, customerId), ne(passengerPushTokens.deviceId, deviceId))
    );
  return stale.length;
}

export async function deletePassengerPushTokensForCustomer(customerId: string): Promise<number> {
  const existing = await db
    .select({ id: passengerPushTokens.id })
    .from(passengerPushTokens)
    .where(eq(passengerPushTokens.customerId, customerId));
  if (!existing.length) return 0;
  await db.delete(passengerPushTokens).where(eq(passengerPushTokens.customerId, customerId));
  return existing.length;
}

export async function deletePassengerPushTokenById(id: string): Promise<void> {
  await db.delete(passengerPushTokens).where(eq(passengerPushTokens.id, id));
}

export async function upsertPassengerPushToken(input: {
  customerId: string;
  deviceId: string;
  sessionId: string | null;
  fcmToken: string;
}): Promise<PassengerPushToken> {
  await deletePassengerPushTokensByFcmTokenExcept(input.fcmToken, {
    customerId: input.customerId,
    deviceId: input.deviceId,
  });
  await deletePassengerPushTokensForCustomerExceptDevice(input.customerId, input.deviceId);

  const now = new Date();
  const [row] = await db
    .insert(passengerPushTokens)
    .values({
      customerId: input.customerId,
      deviceId: input.deviceId,
      sessionId: input.sessionId,
      fcmToken: input.fcmToken,
      enabled: true,
      lastRegisteredAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [passengerPushTokens.customerId, passengerPushTokens.deviceId],
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

export async function updatePassengerPushTokenSessionForDevice(
  customerId: string,
  deviceId: string,
  sessionId: string
): Promise<void> {
  await db
    .update(passengerPushTokens)
    .set({ sessionId, updatedAt: new Date() })
    .where(
      and(
        eq(passengerPushTokens.customerId, customerId),
        eq(passengerPushTokens.deviceId, deviceId),
        eq(passengerPushTokens.enabled, true)
      )
    );
}
