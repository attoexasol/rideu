import { randomBytes } from 'crypto';

export const VEHICLE_QR_TOKEN_PREFIX = 'VQR_';

/** Opaque vehicle QR token — no vehicle or fleet identifiers in the payload. */
export function generateOpaqueVehicleQrToken(): string {
  return `${VEHICLE_QR_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function isOpaqueVehicleQrToken(token: string): boolean {
  return token.startsWith(VEHICLE_QR_TOKEN_PREFIX) && token.length > VEHICLE_QR_TOKEN_PREFIX.length + 16;
}

/** Legacy formats still accepted during migration. */
export function isLegacyVehicleQrToken(token: string): boolean {
  const trimmed = token.trim();
  return (
    trimmed.startsWith('VEHICLE_') ||
    (!trimmed.startsWith(VEHICLE_QR_TOKEN_PREFIX) && trimmed.length > 0)
  );
}
