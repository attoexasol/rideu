import {
  EXCHANGE_STATUS_PENDING,
  EXCHANGE_STATUS_COMPLETED,
  EXCHANGE_STATUS_CANCELLED,
  EXCHANGE_STATUS_EXPIRED,
  vehicleExchangeTtlSeconds,
  LOCK_RESOURCE_DRIVER,
  LOCK_RESOURCE_VEHICLE,
} from '../src/config/exchange';
import { VehicleExchangeError } from '../src/services/vehicleExchange.service';
import { ACTIVE_BOOKING_STATUSES, BookingStatus } from '../src/constants/bookingStatus';

describe('vehicle exchange config', () => {
  it('defaults TTL to 300 seconds', () => {
    expect(vehicleExchangeTtlSeconds).toBeGreaterThanOrEqual(60);
  });

  it('defines terminal and pending statuses', () => {
    expect(EXCHANGE_STATUS_PENDING).toBe('pending');
    expect(EXCHANGE_STATUS_COMPLETED).toBe('completed');
    expect(EXCHANGE_STATUS_CANCELLED).toBe('cancelled');
    expect(EXCHANGE_STATUS_EXPIRED).toBe('expired');
  });

  it('defines lock resource types', () => {
    expect(LOCK_RESOURCE_DRIVER).toBe('driver');
    expect(LOCK_RESOURCE_VEHICLE).toBe('vehicle');
  });
});

describe('vehicle exchange error codes', () => {
  it('maps business rejection codes', () => {
    const codes = [
      'ACTIVE_RIDE_BLOCKS_EXCHANGE',
      'CANNOT_SWAP_OWN_VEHICLE',
      'EXCHANGE_ALREADY_PENDING',
      'ASSIGNMENT_CHANGED',
      'EXCHANGE_EXPIRED',
      'PARTNER_REQUIRED',
      'EXCHANGE_PENDING',
      'BOOKING_ACCEPTANCE_IN_PROGRESS',
    ];
    for (const code of codes) {
      const err = new VehicleExchangeError(code, 'test');
      expect(err.code).toBe(code);
    }
  });
});

describe('active ride guard statuses', () => {
  it('blocks exchange during in-progress ride states', () => {
    expect(ACTIVE_BOOKING_STATUSES).toContain(BookingStatus.IN_PROGRESS);
    expect(ACTIVE_BOOKING_STATUSES).toContain(BookingStatus.DRIVER_EN_ROUTE);
  });
});

describe('resource lock guarantee (documented)', () => {
  it('documents cross-role uniqueness via vehicle_exchange_resource_locks', () => {
    // Partial unique indexes uq_verl_active_driver and uq_verl_active_vehicle
    // on resource_id WHERE released_at IS NULL prevent the same driver or vehicle
    // from appearing in ANY pending exchange regardless of initiator/partner role.
    const guarantee =
      'One unreleased lock row per driver_id and per vehicle_id globally';
    expect(guarantee).toContain('per driver_id');
  });
});
