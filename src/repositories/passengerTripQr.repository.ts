import { queryClient } from '../db/connection';

export interface TripRecord {
  id: string;
  driver_id: string;
  status: string;
  passenger_qr_code: string | null;
  qr_verified: boolean;
  qr_verified_at: Date | null;
  trip_type: string | null;
}

export async function findTripById(tripId: string): Promise<TripRecord | null> {
  const rows = await queryClient<TripRecord[]>`
    SELECT id, driver_id, status, passenger_qr_code, qr_verified, qr_verified_at, trip_type
    FROM trips
    WHERE id = ${tripId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function findTripByPassengerQrCode(qrCode: string): Promise<TripRecord | null> {
  const rows = await queryClient<TripRecord[]>`
    SELECT id, driver_id, status, passenger_qr_code, qr_verified, qr_verified_at, trip_type
    FROM trips
    WHERE passenger_qr_code = ${qrCode}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function passengerQrCodeExists(qrCode: string): Promise<boolean> {
  const rows = await queryClient<{ exists: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM trips WHERE passenger_qr_code = ${qrCode}) AS exists
  `;
  return Boolean(rows[0]?.exists);
}

export async function setPassengerQrCode(tripId: string, qrCode: string): Promise<string> {
  const rows = await queryClient<{ passenger_qr_code: string }[]>`
    UPDATE trips
    SET passenger_qr_code = ${qrCode}, updated_at = NOW()
    WHERE id = ${tripId}
    RETURNING passenger_qr_code
  `;
  if (!rows[0]?.passenger_qr_code) {
    throw new Error(`Failed to set passenger_qr_code for trip ${tripId}`);
  }
  return rows[0].passenger_qr_code;
}

export async function markTripQrVerified(tripId: string): Promise<TripRecord> {
  const rows = await queryClient<TripRecord[]>`
    UPDATE trips
    SET qr_verified = true, qr_verified_at = NOW(), updated_at = NOW()
    WHERE id = ${tripId}
    RETURNING id, driver_id, status, passenger_qr_code, qr_verified, qr_verified_at, trip_type
  `;
  if (!rows[0]) {
    throw new Error(`Failed to verify passenger QR for trip ${tripId}`);
  }
  return rows[0];
}
