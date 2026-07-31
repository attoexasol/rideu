import { DriverQrPublicDetails } from '../repositories/driverQrCode.repository';

export interface DriverQrScanResult {
  /** Internal UUID */
  id: string;
  /** Display ID shown on scan screen (e.g. D-10025 from cab number) */
  driverId: string;
  name: string;
  vehicle: string;
  status: string;
  qrCode: string;
  email: string;
  phone: string | null;
  cabName: string | null;
  cabNumber: string | null;
  cabLicence: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleYear: string | null;
  vehicleColor: string | null;
}

/**
 * Display driver ID: prefer cab number (e.g. D-10025), then cab name, then short UUID fallback.
 */
export function formatDriverDisplayId(
  cabNumber: string | null,
  cabName: string | null,
  uuid: string
): string {
  if (cabNumber?.trim()) return cabNumber.trim();
  if (cabName?.trim()) return cabName.trim();
  return `D-${uuid.replace(/-/g, '').slice(0, 5).toUpperCase()}`;
}

/**
 * Vehicle label for scan screen (e.g. "Prius 24" from model + year).
 */
export function formatVehicleLabel(
  make: string | null,
  model: string | null,
  year: string | null
): string {
  const parts: string[] = [];
  if (model?.trim()) {
    parts.push(model.trim());
  } else if (make?.trim()) {
    parts.push(make.trim());
  }
  if (year?.trim()) {
    const y = year.trim();
    parts.push(y.length === 4 ? y.slice(-2) : y);
  }
  return parts.length > 0 ? parts.join(' ') : '—';
}

/**
 * Human-readable status for scan screen (e.g. online → Active).
 */
export function formatDriverScanStatus(status: string): string {
  const normalized = status.trim().toLowerCase();
  switch (normalized) {
    case 'online':
      return 'Active';
    case 'offline':
      return 'Offline';
    case 'busy':
      return 'Busy';
    case 'in_progress':
      return 'In Progress';
    default:
      return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
  }
}

export function toDriverQrScanResult(driver: DriverQrPublicDetails): DriverQrScanResult {
  return {
    id: driver.id,
    driverId: formatDriverDisplayId(driver.cabNumber, driver.cabName, driver.id),
    name: driver.name,
    vehicle: formatVehicleLabel(driver.vehicleMake, driver.vehicleModel, driver.vehicleYear),
    status: formatDriverScanStatus(driver.status),
    qrCode: driver.qrCode,
    email: driver.email,
    phone: driver.phone,
    cabName: driver.cabName,
    cabNumber: driver.cabNumber,
    cabLicence: driver.cabLicence,
    vehicleMake: driver.vehicleMake,
    vehicleModel: driver.vehicleModel,
    vehicleYear: driver.vehicleYear,
    vehicleColor: driver.vehicleColor,
  };
}
