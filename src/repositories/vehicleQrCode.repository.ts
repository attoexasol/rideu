import { queryClient } from '../db/connection';

export interface DriverVehicleScanDetails {
  driverId: string;
  driverName: string;
  cabName: string | null;
  cabNumber: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleYear: string | null;
  vehicleColor: string | null;
  cabLicence: string | null;
  vehicleQrCode: string;
}

interface DriverVehicleRow {
  id: string;
  name: string;
  cab_name: string | null;
  cab_number: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: string | null;
  vehicle_color: string | null;
  cab_licence: string | null;
  vehicle_qr_code: string | null;
}

function mapDriverVehicle(row: DriverVehicleRow): DriverVehicleScanDetails {
  return {
    driverId: row.id,
    driverName: row.name,
    cabName: row.cab_name,
    cabNumber: row.cab_number,
    vehicleMake: row.vehicle_make,
    vehicleModel: row.vehicle_model,
    vehicleYear: row.vehicle_year,
    vehicleColor: row.vehicle_color,
    cabLicence: row.cab_licence,
    vehicleQrCode: row.vehicle_qr_code!,
  };
}

export async function findDriverByVehicleQrCode(
  qrCode: string
): Promise<DriverVehicleScanDetails | null> {
  const rows = await queryClient<DriverVehicleRow[]>`
    SELECT id, name, cab_name, cab_number, vehicle_make, vehicle_model,
           vehicle_year, vehicle_color, cab_licence, vehicle_qr_code
    FROM drivers
    WHERE vehicle_qr_code = ${qrCode}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row?.vehicle_qr_code) return null;
  return mapDriverVehicle(row);
}

export async function findDriverVehicleById(driverId: string): Promise<DriverVehicleRow | null> {
  const rows = await queryClient<DriverVehicleRow[]>`
    SELECT id, name, cab_name, cab_number, vehicle_make, vehicle_model,
           vehicle_year, vehicle_color, cab_licence, vehicle_qr_code
    FROM drivers
    WHERE id = ${driverId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function driverVehicleQrCodeExists(qrCode: string): Promise<boolean> {
  const rows = await queryClient<{ exists: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM drivers WHERE vehicle_qr_code = ${qrCode}) AS exists
  `;
  return Boolean(rows[0]?.exists);
}

export async function setDriverVehicleQrCode(driverId: string, qrCode: string): Promise<string> {
  const rows = await queryClient<{ vehicle_qr_code: string }[]>`
    UPDATE drivers
    SET vehicle_qr_code = ${qrCode}, updated_at = NOW()
    WHERE id = ${driverId}
    RETURNING vehicle_qr_code
  `;
  if (!rows[0]?.vehicle_qr_code) {
    throw new Error(`Failed to set vehicle_qr_code for driver ${driverId}`);
  }
  return rows[0].vehicle_qr_code;
}

export async function findDriversWithoutVehicleQrCode(): Promise<{ id: string }[]> {
  return queryClient<{ id: string }[]>`
    SELECT id FROM drivers WHERE vehicle_qr_code IS NULL ORDER BY created_at ASC
  `;
}
