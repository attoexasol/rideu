import QRCode from 'qrcode';
import {
  findDriverByQrCode,
  findDriverForQrAccess,
  findDriversWithoutQrCode,
  qrCodeExists,
  setDriverQrCode,
  DriverQrPublicDetails,
} from '../repositories/driverQrCode.repository';
import { generateDriverQrCode } from '../utils/driverQrCode';
import { toDriverQrScanResult, DriverQrScanResult } from '../utils/driverQrScanFormat';

const MAX_UNIQUE_ATTEMPTS = 5;

/**
 * Generate a unique DRIVER_<uuid> value not present in the database.
 */
export async function generateUniqueDriverQrCode(): Promise<string> {
  for (let attempt = 0; attempt < MAX_UNIQUE_ATTEMPTS; attempt++) {
    const candidate = generateDriverQrCode();
    const exists = await qrCodeExists(candidate);
    if (!exists) {
      return candidate;
    }
  }

  throw new Error('Failed to generate a unique driver QR code');
}

/**
 * Ensure driver has qr_code; assign one if missing.
 */
export async function ensureDriverQrCode(driverId: string): Promise<string> {
  const existing = await findDriverForQrAccess(driverId);
  if (!existing) {
    throw new Error(`Driver not found: ${driverId}`);
  }
  if (existing.qrCode) {
    return existing.qrCode;
  }

  const qrCode = await generateUniqueDriverQrCode();
  return setDriverQrCode(driverId, qrCode);
}

/**
 * Lookup driver by QR code value (full profile fields).
 */
export async function getDriverByQrCode(qrCode: string): Promise<DriverQrPublicDetails | null> {
  return findDriverByQrCode(qrCode);
}

/**
 * Lookup driver by QR scan with display fields for the result screen.
 */
export async function scanDriverByQrCode(qrCode: string): Promise<DriverQrScanResult | null> {
  const driver = await findDriverByQrCode(qrCode);
  if (!driver) return null;
  return toDriverQrScanResult(driver);
}

export interface DriverQrImageResult {
  qrCode: string;
  format: 'png' | 'base64';
  pngBuffer?: Buffer;
  base64?: string;
  dataUrl?: string;
}

/**
 * Generate QR image for a driver's qr_code.
 */
export async function generateDriverQrImage(
  driverId: string,
  format: 'png' | 'base64' = 'png'
): Promise<DriverQrImageResult> {
  const qrCode = await ensureDriverQrCode(driverId);

  if (format === 'base64') {
    const dataUrl = await QRCode.toDataURL(qrCode, {
      type: 'image/png',
      width: 300,
      margin: 2,
      errorCorrectionLevel: 'M',
    });

    return {
      qrCode,
      format: 'base64',
      base64: dataUrl.replace(/^data:image\/png;base64,/, ''),
      dataUrl,
    };
  }

  const pngBuffer = await QRCode.toBuffer(qrCode, {
    type: 'png',
    width: 300,
    margin: 2,
    errorCorrectionLevel: 'M',
  });

  return {
    qrCode,
    format: 'png',
    pngBuffer,
  };
}

export interface BackfillResult {
  total: number;
  updated: number;
  failed: number;
  errors: Array<{ driverId: string; message: string }>;
}

/**
 * Backfill qr_code for all drivers where qr_code IS NULL.
 */
export async function backfillMissingDriverQrCodes(): Promise<BackfillResult> {
  const driversWithoutQr = await findDriversWithoutQrCode();
  const result: BackfillResult = {
    total: driversWithoutQr.length,
    updated: 0,
    failed: 0,
    errors: [],
  };

  for (const { id } of driversWithoutQr) {
    try {
      const qrCode = await generateUniqueDriverQrCode();
      await setDriverQrCode(id, qrCode);
      result.updated += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push({
        driverId: id,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return result;
}
