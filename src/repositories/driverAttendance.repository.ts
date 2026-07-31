import { queryClient } from '../db/connection';

export interface AttendanceRecord {
  id: string;
  driver_id: string;
  check_in_time: Date;
  check_out_time: Date | null;
  location: string | null;
  status: string;
}

export async function findActiveAttendanceByDriverId(
  driverId: string
): Promise<AttendanceRecord | null> {
  const rows = await queryClient<AttendanceRecord[]>`
    SELECT id, driver_id, check_in_time, check_out_time, location, status
    FROM driver_attendance
    WHERE driver_id = ${driverId} AND status = 'checked_in'
    ORDER BY check_in_time DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function createCheckIn(
  driverId: string,
  location?: string | null
): Promise<AttendanceRecord> {
  const rows = await queryClient<AttendanceRecord[]>`
    INSERT INTO driver_attendance (driver_id, location, status)
    VALUES (${driverId}, ${location ?? null}, 'checked_in')
    RETURNING id, driver_id, check_in_time, check_out_time, location, status
  `;
  if (!rows[0]) {
    throw new Error('Failed to create attendance record');
  }
  return rows[0];
}

export async function closeActiveAttendance(driverId: string): Promise<AttendanceRecord | null> {
  const rows = await queryClient<AttendanceRecord[]>`
    UPDATE driver_attendance
    SET check_out_time = NOW(), status = 'checked_out'
    WHERE driver_id = ${driverId} AND status = 'checked_in'
    RETURNING id, driver_id, check_in_time, check_out_time, location, status
  `;
  return rows[0] ?? null;
}

export async function findLatestAttendanceByDriverId(
  driverId: string
): Promise<AttendanceRecord | null> {
  const rows = await queryClient<AttendanceRecord[]>`
    SELECT id, driver_id, check_in_time, check_out_time, location, status
    FROM driver_attendance
    WHERE driver_id = ${driverId}
    ORDER BY check_in_time DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}
