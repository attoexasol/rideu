import { db } from '../db/connection';
import { vehicleQrTokens } from '../db/schema/vehicle_qr_tokens';
import { vehicles } from '../db/schema/vehicles';
import { drivers } from '../db/schema/drivers';
import { eq, and } from 'drizzle-orm';

export async function findActiveTokenByValue(token: string) {
  const rows = await db
    .select()
    .from(vehicleQrTokens)
    .where(and(eq(vehicleQrTokens.token, token), eq(vehicleQrTokens.status, 'active')))
    .limit(1);
  return rows[0] ?? null;
}

export async function findTokenByValue(token: string) {
  const rows = await db
    .select()
    .from(vehicleQrTokens)
    .where(eq(vehicleQrTokens.token, token))
    .limit(1);
  return rows[0] ?? null;
}

export async function findActiveTokenForVehicle(vehicleId: string) {
  const rows = await db
    .select()
    .from(vehicleQrTokens)
    .where(and(eq(vehicleQrTokens.vehicleId, vehicleId), eq(vehicleQrTokens.status, 'active')))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertVehicleQrToken(data: typeof vehicleQrTokens.$inferInsert) {
  const [row] = await db.insert(vehicleQrTokens).values(data).returning();
  return row;
}

export async function revokeToken(id: string) {
  const [row] = await db
    .update(vehicleQrTokens)
    .set({ status: 'revoked', revokedAt: new Date(), updatedAt: new Date() })
    .where(eq(vehicleQrTokens.id, id))
    .returning();
  return row ?? null;
}

export async function markTokenRotated(id: string) {
  const [row] = await db
    .update(vehicleQrTokens)
    .set({ status: 'rotated', revokedAt: new Date(), updatedAt: new Date() })
    .where(eq(vehicleQrTokens.id, id))
    .returning();
  return row ?? null;
}

export async function listTokensForVehicle(vehicleId: string) {
  return db
    .select()
    .from(vehicleQrTokens)
    .where(eq(vehicleQrTokens.vehicleId, vehicleId))
    .orderBy(vehicleQrTokens.issuedAt);
}

/** Legacy: vehicles.qr_code column */
export async function findVehicleByLegacyQrCode(qrCode: string) {
  const rows = await db
    .select()
    .from(vehicles)
    .where(eq(vehicles.qrCode, qrCode))
    .limit(1);
  return rows[0] ?? null;
}

/** Legacy: drivers.vehicle_qr_code — resolves to driver's fleet vehicle if vehicle_id set */
export async function findDriverByLegacyVehicleQrCode(qrCode: string) {
  const rows = await db
    .select()
    .from(drivers)
    .where(eq(drivers.vehicleQrCode, qrCode))
    .limit(1);
  return rows[0] ?? null;
}
