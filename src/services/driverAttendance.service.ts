import { driverUtils } from '../db/utils';
import {
  closeActiveAttendance,
  createCheckIn,
  findActiveAttendanceByDriverId,
  findLatestAttendanceByDriverId,
} from '../repositories/driverAttendance.repository';
import { db } from '../db/connection';
import { drivers } from '../db/schema/drivers';
import { eq } from 'drizzle-orm';
import { isCompanyCheckInQr } from '../utils/qrCodeConstants';

export interface CheckInResult {
  attendance: {
    id: string;
    driverId: string;
    checkInTime: Date;
    status: string;
  };
}

export async function driverCheckIn(
  driverId: string,
  qrCode: string,
  location?: string | null
): Promise<CheckInResult> {
  if (!isCompanyCheckInQr(qrCode)) {
    throw new Error('Invalid check-in QR code. Expected COMPANY_CHECKIN');
  }

  const driver = await db.query.drivers.findFirst({ where: eq(drivers.id, driverId) });
  if (!driver) {
    throw new Error('Driver not found');
  }

  const active = await findActiveAttendanceByDriverId(driverId);
  if (active) {
    throw new Error('Driver is already checked in');
  }

  const record = await createCheckIn(driverId, location);
  await driverUtils.updateStatus(driverId, 'online');

  return {
    attendance: {
      id: record.id,
      driverId: record.driver_id,
      checkInTime: record.check_in_time,
      status: record.status,
    },
  };
}

export interface CheckOutResult {
  attendance: {
    id: string;
    driverId: string;
    checkInTime: Date;
    checkOutTime: Date | null;
    status: string;
  };
}

export async function driverCheckOut(driverId: string, qrCode: string): Promise<CheckOutResult> {
  if (!isCompanyCheckInQr(qrCode)) {
    throw new Error('Invalid check-out QR code. Expected COMPANY_CHECKIN');
  }

  const driver = await db.query.drivers.findFirst({ where: eq(drivers.id, driverId) });
  if (!driver) {
    throw new Error('Driver not found');
  }

  const closed = await closeActiveAttendance(driverId);
  if (!closed) {
    throw new Error('No active check-in found for driver');
  }

  await driverUtils.updateStatus(driverId, 'offline');

  return {
    attendance: {
      id: closed.id,
      driverId: closed.driver_id,
      checkInTime: closed.check_in_time,
      checkOutTime: closed.check_out_time,
      status: closed.status,
    },
  };
}

export async function getDriverAttendanceStatus(driverId: string) {
  const latest = await findLatestAttendanceByDriverId(driverId);
  const active = await findActiveAttendanceByDriverId(driverId);
  return { latest, active };
}
