import { queryClient } from '../db/connection';

export interface DriverQrRow {
  id: string;
  auth0_id: string;
  email: string;
  name: string;
  phone: string | null;
  status: string;
  cab_name: string | null;
  cab_number: string | null;
  cab_licence: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: string | null;
  vehicle_color: string | null;
  qr_code: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface DriverQrPublicDetails {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  cabName: string | null;
  cabNumber: string | null;
  cabLicence: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleYear: string | null;
  vehicleColor: string | null;
  qrCode: string;
}

function mapToPublicDetails(row: DriverQrRow): DriverQrPublicDetails {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    cabName: row.cab_name,
    cabNumber: row.cab_number,
    cabLicence: row.cab_licence,
    vehicleMake: row.vehicle_make,
    vehicleModel: row.vehicle_model,
    vehicleYear: row.vehicle_year,
    vehicleColor: row.vehicle_color,
    qrCode: row.qr_code!,
  };
}

/**
 * Find driver by qr_code (parameterized).
 */
export async function findDriverByQrCode(qrCode: string): Promise<DriverQrPublicDetails | null> {
  const rows = await queryClient<DriverQrRow[]>`
    SELECT
      id,
      auth0_id,
      email,
      name,
      phone,
      status,
      cab_name,
      cab_number,
      cab_licence,
      vehicle_make,
      vehicle_model,
      vehicle_year,
      vehicle_color,
      qr_code,
      created_at,
      updated_at
    FROM drivers
    WHERE qr_code = ${qrCode}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row || !row.qr_code) {
    return null;
  }

  return mapToPublicDetails(row);
}

/**
 * Find driver by id for QR access checks (parameterized).
 */
export async function findDriverForQrAccess(
  driverId: string
): Promise<{ id: string; auth0Id: string; qrCode: string | null } | null> {
  const rows = await queryClient<{ id: string; auth0_id: string; qr_code: string | null }[]>`
    SELECT id, auth0_id, qr_code
    FROM drivers
    WHERE id = ${driverId}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    return null;
  }

  return { id: row.id, auth0Id: row.auth0_id, qrCode: row.qr_code };
}

/**
 * Find driver id and qr_code by driver id (parameterized).
 */
export async function findDriverQrCodeById(
  driverId: string
): Promise<{ id: string; qrCode: string; auth0Id: string } | null> {
  const driver = await findDriverForQrAccess(driverId);
  if (!driver?.qrCode) {
    return null;
  }

  return { id: driver.id, qrCode: driver.qrCode, auth0Id: driver.auth0Id };
}

/**
 * Assign qr_code to a driver (parameterized).
 */
export async function setDriverQrCode(driverId: string, qrCode: string): Promise<string> {
  const rows = await queryClient<{ qr_code: string }[]>`
    UPDATE drivers
    SET qr_code = ${qrCode}, updated_at = NOW()
    WHERE id = ${driverId}
    RETURNING qr_code
  `;

  if (!rows[0]?.qr_code) {
    throw new Error(`Failed to set qr_code for driver ${driverId}`);
  }

  return rows[0].qr_code;
}

/**
 * Check if qr_code already exists (parameterized).
 */
export async function qrCodeExists(qrCode: string): Promise<boolean> {
  const rows = await queryClient<{ exists: boolean }[]>`
    SELECT EXISTS(
      SELECT 1 FROM drivers WHERE qr_code = ${qrCode}
    ) AS exists
  `;
  return Boolean(rows[0]?.exists);
}

/**
 * List drivers missing qr_code (parameterized).
 */
export async function findDriversWithoutQrCode(): Promise<{ id: string }[]> {
  return queryClient<{ id: string }[]>`
    SELECT id
    FROM drivers
    WHERE qr_code IS NULL
    ORDER BY created_at ASC
  `;
}
