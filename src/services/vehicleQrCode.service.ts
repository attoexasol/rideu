import { generateQrImage } from '../utils/qrImage';
import { generateVehicleQrCodeValue, isValidVehicleQrCode } from '../utils/qrCodeConstants';
import {
  driverVehicleQrCodeExists,
  findDriverByVehicleQrCode,
  findDriverVehicleById,
  findDriversWithoutVehicleQrCode,
  setDriverVehicleQrCode,
  DriverVehicleScanDetails,
} from '../repositories/vehicleQrCode.repository';

const MAX_UNIQUE_ATTEMPTS = 5;

export type VehicleScanResult = Omit<DriverVehicleScanDetails, 'vehicleQrCode'>;

export async function generateUniqueDriverVehicleQrCode(driverId: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_UNIQUE_ATTEMPTS; attempt++) {
    const candidate = generateVehicleQrCodeValue(driverId);
    const exists = await driverVehicleQrCodeExists(candidate);
    if (!exists) return candidate;
  }
  throw new Error('Failed to generate a unique vehicle QR code');
}

export async function ensureDriverVehicleQrCode(driverId: string): Promise<string> {
  const driver = await findDriverVehicleById(driverId);
  if (!driver) {
    throw new Error(`Driver not found: ${driverId}`);
  }
  if (driver.vehicle_qr_code) {
    return driver.vehicle_qr_code;
  }
  const qrCode = await generateUniqueDriverVehicleQrCode(driverId);
  return setDriverVehicleQrCode(driverId, qrCode);
}

export async function scanDriverVehicleByQrCode(qrCode: string): Promise<VehicleScanResult> {
  const trimmed = qrCode.trim();

  if (!isValidVehicleQrCode(trimmed)) {
    throw new Error('Invalid vehicle QR code format');
  }

  const driver = await findDriverByVehicleQrCode(trimmed);
  if (!driver) {
    throw new Error('Vehicle not found');
  }

  return {
    driverId: driver.driverId,
    driverName: driver.driverName,
    cabName: driver.cabName,
    cabNumber: driver.cabNumber,
    vehicleMake: driver.vehicleMake,
    vehicleModel: driver.vehicleModel,
    vehicleYear: driver.vehicleYear,
    vehicleColor: driver.vehicleColor,
    cabLicence: driver.cabLicence,
  };
}

export interface VehicleQrImageResult {
  driverId: string;
  qrCode: string;
  format: 'png' | 'base64';
  pngBuffer?: Buffer;
  base64?: string;
  dataUrl?: string;
}

export async function generateDriverVehicleQrImage(
  driverId: string,
  format: 'png' | 'base64' = 'png'
): Promise<VehicleQrImageResult> {
  const qrCode = await ensureDriverVehicleQrCode(driverId);
  const image = await generateQrImage(qrCode, format);

  return {
    driverId,
    qrCode,
    format: image.format,
    pngBuffer: image.pngBuffer,
    base64: image.base64,
    dataUrl: image.dataUrl,
  };
}

export interface BackfillDriverVehicleQrResult {
  total: number;
  updated: number;
  failed: number;
  errors: Array<{ driverId: string; message: string }>;
}

export async function backfillMissingDriverVehicleQrCodes(): Promise<BackfillDriverVehicleQrResult> {
  const missing = await findDriversWithoutVehicleQrCode();
  const result: BackfillDriverVehicleQrResult = {
    total: missing.length,
    updated: 0,
    failed: 0,
    errors: [],
  };

  for (const { id } of missing) {
    try {
      const qrCode = await generateUniqueDriverVehicleQrCode(id);
      await setDriverVehicleQrCode(id, qrCode);
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
