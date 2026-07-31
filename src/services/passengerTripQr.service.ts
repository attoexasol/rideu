import { generateQrImage } from '../utils/qrImage';
import {
  generatePassengerTripQrCodeValue,
  isValidPassengerTripQrCode,
} from '../utils/qrCodeConstants';
import {
  findTripById,
  findTripByPassengerQrCode,
  markTripQrVerified,
  passengerQrCodeExists,
  setPassengerQrCode,
} from '../repositories/passengerTripQr.repository';

const MAX_UNIQUE_ATTEMPTS = 5;

export interface GeneratePassengerQrResult {
  tripId: string;
  qrCode: string;
}

export interface PassengerQrImageResult {
  tripId: string;
  qrCode: string;
  format: 'png' | 'base64';
  pngBuffer?: Buffer;
  base64?: string;
  dataUrl?: string;
}

export interface ScanPassengerQrResult {
  verified: boolean;
  tripId: string;
  driverId: string;
  tripStatus: string;
}

async function generateUniquePassengerTripQrCode(tripId: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_UNIQUE_ATTEMPTS; attempt++) {
    const candidate = generatePassengerTripQrCodeValue(tripId);
    const exists = await passengerQrCodeExists(candidate);
    if (!exists) return candidate;
  }
  throw new Error('Failed to generate a unique passenger trip QR code');
}

export async function generatePassengerQrForTrip(
  tripId: string
): Promise<GeneratePassengerQrResult> {
  const trip = await findTripById(tripId);
  if (!trip) {
    throw new Error('Trip not found');
  }

  const qrCode = await generateUniquePassengerTripQrCode(tripId);
  await setPassengerQrCode(tripId, qrCode);

  return { tripId, qrCode };
}

export async function generatePassengerQrImage(
  tripId: string,
  format: 'png' | 'base64' = 'png'
): Promise<PassengerQrImageResult> {
  const trip = await findTripById(tripId);
  if (!trip) {
    throw new Error('Trip not found');
  }

  if (!trip.passenger_qr_code) {
    throw new Error('Passenger QR code has not been generated for this trip');
  }

  const image = await generateQrImage(trip.passenger_qr_code, format);

  return {
    tripId,
    qrCode: trip.passenger_qr_code,
    format: image.format,
    pngBuffer: image.pngBuffer,
    base64: image.base64,
    dataUrl: image.dataUrl,
  };
}

export async function scanPassengerQr(
  driverId: string,
  qrCode: string
): Promise<ScanPassengerQrResult> {
  const trimmed = qrCode.trim();

  if (!isValidPassengerTripQrCode(trimmed)) {
    throw new Error('Invalid passenger trip QR code format');
  }

  const trip = await findTripByPassengerQrCode(trimmed);
  if (!trip) {
    throw new Error('Trip not found');
  }

  if (trip.driver_id !== driverId) {
    throw new Error('QR code does not belong to this driver');
  }

  if (trip.qr_verified) {
    return {
      verified: true,
      tripId: trip.id,
      driverId: trip.driver_id,
      tripStatus: trip.status,
    };
  }

  const verified = await markTripQrVerified(trip.id);

  return {
    verified: true,
    tripId: verified.id,
    driverId: verified.driver_id,
    tripStatus: verified.status,
  };
}
