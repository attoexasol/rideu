import {
  findActiveTokenByValue,
  findVehicleByLegacyQrCode,
  findDriverByLegacyVehicleQrCode,
  findActiveTokenForVehicle,
  insertVehicleQrToken,
  revokeToken,
  markTokenRotated,
  listTokensForVehicle,
} from '../repositories/vehicleQrToken.repository';
import { insertFleetAuditEvent } from '../repositories/fleetAudit.repository';
import { generateOpaqueVehicleQrToken } from '../utils/vehicleQrToken';
import { db } from '../db/connection';
import { vehicles } from '../db/schema/vehicles';
import { eq } from 'drizzle-orm';

export class VehicleQrError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400
  ) {
    super(message);
    this.name = 'VehicleQrError';
  }
}

export interface ResolvedVehicleQr {
  vehicleId: string;
  fleetId: string | null;
  tokenId: string | null;
  legacySource: 'vehicle_qr_tokens' | 'vehicles_qr_code' | 'drivers_vehicle_qr_code' | null;
}

export async function resolveVehicleQrToken(token: string): Promise<ResolvedVehicleQr> {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new VehicleQrError('QR_TOKEN_INVALID', 'QR token is required');
  }

  const activeToken = await findActiveTokenByValue(trimmed);
  if (activeToken) {
    return {
      vehicleId: activeToken.vehicleId,
      fleetId: activeToken.fleetId,
      tokenId: activeToken.id,
      legacySource: 'vehicle_qr_tokens',
    };
  }

  const legacyVehicle = await findVehicleByLegacyQrCode(trimmed);
  if (legacyVehicle) {
    return {
      vehicleId: legacyVehicle.id,
      fleetId: legacyVehicle.fleetId,
      tokenId: null,
      legacySource: 'vehicles_qr_code',
    };
  }

  const legacyDriver = await findDriverByLegacyVehicleQrCode(trimmed);
  if (legacyDriver?.vehicleId) {
    const vehicleRows = await db
      .select()
      .from(vehicles)
      .where(eq(vehicles.id, legacyDriver.vehicleId))
      .limit(1);
    const vehicle = vehicleRows[0];
    if (vehicle) {
      return {
        vehicleId: vehicle.id,
        fleetId: vehicle.fleetId,
        tokenId: null,
        legacySource: 'drivers_vehicle_qr_code',
      };
    }
  }

  throw new VehicleQrError('QR_TOKEN_INVALID', 'Invalid or revoked vehicle QR token');
}

export async function issueVehicleQrToken(
  vehicleId: string,
  fleetId: string,
  issuedByAdminId?: string | null
) {
  const vehicleRows = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
  const vehicle = vehicleRows[0];
  if (!vehicle) {
    throw new VehicleQrError('NOT_FOUND', 'Vehicle not found', 404);
  }

  const existing = await findActiveTokenForVehicle(vehicleId);
  if (existing) {
    await markTokenRotated(existing.id);
    await insertFleetAuditEvent({
      eventType: 'qr_rotated',
      actorType: 'admin',
      actorId: issuedByAdminId ?? null,
      entityType: 'vehicle_qr_token',
      entityId: existing.id,
      vehicleId,
      fleetId,
      payload: { reason: 'reissue' },
    });
  }

  let tokenValue = generateOpaqueVehicleQrToken();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const row = await insertVehicleQrToken({
        vehicleId,
        fleetId,
        token: tokenValue,
        status: 'active',
        legacySource: 'issued',
        issuedByAdminId: issuedByAdminId ?? null,
      });
      await insertFleetAuditEvent({
        eventType: 'qr_issued',
        actorType: issuedByAdminId ? 'admin' : 'system',
        actorId: issuedByAdminId ?? null,
        entityType: 'vehicle_qr_token',
        entityId: row.id,
        vehicleId,
        fleetId,
        payload: { tokenPrefix: tokenValue.slice(0, 8) },
      });
      return row;
    } catch {
      tokenValue = generateOpaqueVehicleQrToken();
    }
  }
  throw new VehicleQrError('INTERNAL_ERROR', 'Failed to issue unique QR token', 500);
}

export async function revokeVehicleQrToken(
  tokenId: string,
  adminId?: string | null,
  reason = 'admin_revoke'
) {
  const row = await revokeToken(tokenId);
  if (!row) {
    throw new VehicleQrError('NOT_FOUND', 'QR token not found', 404);
  }
  await insertFleetAuditEvent({
    eventType: 'qr_revoked',
    actorType: adminId ? 'admin' : 'system',
    actorId: adminId ?? null,
    entityType: 'vehicle_qr_token',
    entityId: tokenId,
    vehicleId: row.vehicleId,
    fleetId: row.fleetId,
    payload: { reason },
  });
  return row;
}

export async function rotateVehicleQrToken(
  vehicleId: string,
  fleetId: string,
  adminId?: string | null
) {
  return issueVehicleQrToken(vehicleId, fleetId, adminId);
}

export async function getVehicleQrTokens(vehicleId: string) {
  return listTokensForVehicle(vehicleId);
}
