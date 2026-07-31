import {
  generateOpaqueVehicleQrToken,
  isOpaqueVehicleQrToken,
  isLegacyVehicleQrToken,
  VEHICLE_QR_TOKEN_PREFIX,
} from '../src/utils/vehicleQrToken';
import { qrDutyRequired } from '../src/config/duty';
import { ACTIVE_BOOKING_STATUSES, BookingStatus } from '../src/constants/bookingStatus';

describe('vehicle QR token utilities', () => {
  it('generates opaque non-predictable tokens', () => {
    const a = generateOpaqueVehicleQrToken();
    const b = generateOpaqueVehicleQrToken();
    expect(a).not.toBe(b);
    expect(isOpaqueVehicleQrToken(a)).toBe(true);
    expect(a.startsWith(VEHICLE_QR_TOKEN_PREFIX)).toBe(true);
    expect(a.length).toBeGreaterThan(VEHICLE_QR_TOKEN_PREFIX.length + 20);
  });

  it('does not embed uuid vehicle identifiers in token format', () => {
    const token = generateOpaqueVehicleQrToken();
    expect(token).toMatch(/^VQR_[A-Za-z0-9_-]+$/);
    expect(token).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i
    );
  });

  it('detects legacy vehicle QR patterns', () => {
    expect(isLegacyVehicleQrToken('VEHICLE_abc_def')).toBe(true);
    expect(isLegacyVehicleQrToken('VQR_opaquevalue')).toBe(false);
  });
});

describe('QR duty feature flag', () => {
  it('defaults to false when env unset', () => {
    expect(qrDutyRequired).toBe(false);
  });
});

describe('active booking statuses for duty guards', () => {
  it('includes in-progress states that block duty end', () => {
    expect(ACTIVE_BOOKING_STATUSES).toContain(BookingStatus.ACCEPTED);
    expect(ACTIVE_BOOKING_STATUSES).toContain(BookingStatus.DRIVER_EN_ROUTE);
    expect(ACTIVE_BOOKING_STATUSES).toContain(BookingStatus.ARRIVED);
    expect(ACTIVE_BOOKING_STATUSES).toContain(BookingStatus.IN_PROGRESS);
  });

  it('excludes completed and cancelled', () => {
    expect(ACTIVE_BOOKING_STATUSES).not.toContain(BookingStatus.COMPLETED);
    expect(ACTIVE_BOOKING_STATUSES).not.toContain(BookingStatus.CANCELLED);
  });
});

describe('duty error codes', () => {
  it('defines expected duty start rejection codes', async () => {
    const { DutyError } = await import('../src/services/duty.service');
    const err = new DutyError('VEHICLE_ALREADY_ASSIGNED', 'taken');
    expect(err.code).toBe('VEHICLE_ALREADY_ASSIGNED');
    expect(err.statusCode).toBe(409);
  });

  it('defines duty end active ride block code', async () => {
    const { DutyError } = await import('../src/services/duty.service');
    const err = new DutyError('ACTIVE_RIDE_BLOCKS_DUTY_END', 'blocked');
    expect(err.code).toBe('ACTIVE_RIDE_BLOCKS_DUTY_END');
  });
});
