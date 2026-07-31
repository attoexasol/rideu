import { findDriverVehicleById } from '../repositories/vehicleQrCode.repository';
import { scanDriverVehicleByQrCode, ensureDriverVehicleQrCode } from './vehicleQrCode.service';

export interface ScanVehicleResult {
  driverId: string;
  driverName: string;
  cabName: string | null;
  cabNumber: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleYear: string | null;
  vehicleColor: string | null;
  cabLicence: string | null;
}

export async function scanAndAssignVehicle(
  driverId: string,
  vehicleQrCode: string
): Promise<ScanVehicleResult> {
  const result = await scanDriverVehicleByQrCode(vehicleQrCode);

  if (result.driverId !== driverId) {
    throw new Error('Scanned vehicle QR does not belong to this driver');
  }

  return result;
}

export async function getActiveAssignmentForDriver(driverId: string) {
  await ensureDriverVehicleQrCode(driverId);
  const driver = await findDriverVehicleById(driverId);
  if (!driver) return null;

  return {
    driverId: driver.id,
    driverName: driver.name,
    cabName: driver.cab_name,
    cabNumber: driver.cab_number,
    vehicleMake: driver.vehicle_make,
    vehicleModel: driver.vehicle_model,
    vehicleYear: driver.vehicle_year,
    vehicleColor: driver.vehicle_color,
    cabLicence: driver.cab_licence,
    vehicleQrCode: driver.vehicle_qr_code,
  };
}
