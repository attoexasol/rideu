import { v4 as uuidv4 } from 'uuid';

export const COMPANY_CHECKIN_QR = 'COMPANY_CHECKIN';

export const DRIVER_QR_PREFIX = 'DRIVER_';
export const VEHICLE_QR_PREFIX = 'VEHICLE_';
export const TRIP_QR_PREFIX = 'TRIP_';

const DRIVER_QR_PATTERN =
  /^DRIVER_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const VEHICLE_QR_PATTERN =
  /^VEHICLE_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TRIP_QR_PATTERN =
  /^TRIP_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function generateDriverQrCodeValue(): string {
  return `${DRIVER_QR_PREFIX}${uuidv4()}`;
}

export function generateVehicleQrCodeValue(driverId: string): string {
  return `${VEHICLE_QR_PREFIX}${driverId}_${uuidv4()}`;
}

export function generatePassengerTripQrCodeValue(tripId: string): string {
  return `${TRIP_QR_PREFIX}${tripId}_${uuidv4()}`;
}

export function isValidDriverQrCode(qrCode: string): boolean {
  return DRIVER_QR_PATTERN.test(qrCode.trim());
}

export function isValidVehicleQrCode(qrCode: string): boolean {
  return VEHICLE_QR_PATTERN.test(qrCode.trim());
}

export function isValidPassengerTripQrCode(qrCode: string): boolean {
  return TRIP_QR_PATTERN.test(qrCode.trim());
}

export function isCompanyCheckInQr(qrCode: string): boolean {
  return qrCode.trim() === COMPANY_CHECKIN_QR;
}
