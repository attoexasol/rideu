import { db } from '../src/db/connection';
import { realtimeCache } from '../src/config/redis';
import { listDriversWithActiveBookings } from '../src/repositories/booking.repository';
import { findActiveAssignmentByDriverId } from '../src/repositories/driverVehicleAssignment.repository';
import { driverServesCategory } from '../src/services/vehicleEligibility.service';
import { hasPendingExchange } from '../src/services/vehicleExchange.service';
import {
  isDispatchSuspended,
  isDriverAcceptingOffer,
} from '../src/services/driverAcceptanceLock.service';
import { listServiceAreasForMarket } from '../src/repositories/serviceArea.repository';
import { checkDriverEligibility } from '../src/services/driverAvailability.service';
import { clearServiceAreaCache } from '../src/services/serviceArea.service';

jest.mock('../src/db/connection', () => ({
  db: { select: jest.fn() },
}));

jest.mock('../src/config/redis', () => ({
  realtimeCache: {
    getDriverStatus: jest.fn(),
    getDriverLocation: jest.fn(),
    getDriverHeartbeat: jest.fn(),
  },
  mapsCache: { get: jest.fn(), set: jest.fn() },
}));

jest.mock('../src/config/duty', () => ({
  qrDutyRequired: false,
  APPROVED_VEHICLE_STATUSES: new Set(['active', 'approved']),
}));

jest.mock('../src/repositories/booking.repository', () => ({
  listDriversWithActiveBookings: jest.fn(),
}));

jest.mock('../src/repositories/walkUp.repository', () => ({
  driverHasOpenWalkUp: jest.fn().mockResolvedValue(false),
}));

jest.mock('../src/repositories/driverVehicleAssignment.repository', () => ({
  findActiveAssignmentByDriverId: jest.fn(),
}));

jest.mock('../src/repositories/dutySession.repository', () => ({
  findActiveDutySessionByDriverId: jest.fn(),
}));

jest.mock('../src/services/vehicleEligibility.service', () => ({
  driverServesCategory: jest.fn(),
}));

jest.mock('../src/services/vehicleExchange.service', () => ({
  hasPendingExchange: jest.fn(),
}));

jest.mock('../src/services/driverAcceptanceLock.service', () => ({
  isDispatchSuspended: jest.fn(),
  isDriverAcceptingOffer: jest.fn(),
}));

jest.mock('../src/repositories/serviceArea.repository', () => ({
  listServiceAreasForMarket: jest.fn(),
  findServiceAreaById: jest.fn(),
  nextServiceAreaVersion: jest.fn(),
  insertServiceArea: jest.fn(),
  activateServiceAreaRecord: jest.fn(),
}));

const zone = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [0, 0],
      [0.02, 0],
      [0.02, 0.02],
      [0, 0.02],
      [0, 0],
    ],
  ],
};

function enforced(enabled = true) {
  return {
    id: 'area-1',
    marketCode: 'US',
    code: 'coronado',
    name: 'Coronado',
    version: 1,
    status: 'active',
    geometry: zone,
    policy: 'pickup_and_dropoff',
    enforcementEnabled: enabled,
    sourceLabel: null,
    sourceUrl: null,
    approvedAt: enabled ? new Date() : null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function selectChain(row: unknown) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => [row],
      }),
    }),
  };
}

describe('driver dispatch service area', () => {
  const driver = {
    id: 'driver-1',
    status: 'online',
    accountStatus: 'active',
    vehicleId: 'vehicle-1',
  };
  const vehicle = { id: 'vehicle-1', status: 'approved' };

  beforeEach(() => {
    clearServiceAreaCache();
    (listDriversWithActiveBookings as jest.Mock).mockResolvedValue([]);
    (hasPendingExchange as jest.Mock).mockResolvedValue(false);
    (isDispatchSuspended as jest.Mock).mockResolvedValue(false);
    (isDriverAcceptingOffer as jest.Mock).mockResolvedValue(false);
    (realtimeCache.getDriverStatus as jest.Mock).mockResolvedValue('online');
    (realtimeCache.getDriverHeartbeat as jest.Mock).mockResolvedValue(new Date().toISOString());
    (findActiveAssignmentByDriverId as jest.Mock).mockResolvedValue(null);
    (driverServesCategory as jest.Mock).mockResolvedValue({
      matches: true,
      source: 'legacy_driver_vehicle',
    });
    (db.select as jest.Mock).mockReset();
    (db.select as jest.Mock)
      .mockImplementationOnce(() => selectChain(driver))
      .mockImplementationOnce(() => selectChain(vehicle));
    (listServiceAreasForMarket as jest.Mock).mockResolvedValue([enforced(true)]);
  });

  it('keeps Bangladesh eligibility on the existing rules', async () => {
    (realtimeCache.getDriverLocation as jest.Mock).mockResolvedValue({
      latitude: 4,
      longitude: 4,
      timestamp: new Date().toISOString(),
    });
    const result = await checkDriverEligibility('driver-1', 'cat-1', 4, 4, { marketCode: 'BD' });
    expect(result.eligible).toBe(true);
    expect(listServiceAreasForMarket).not.toHaveBeenCalled();
  });

  it('does not offer a US ride to a driver outside the polygon', async () => {
    (realtimeCache.getDriverLocation as jest.Mock).mockResolvedValue({
      latitude: 0.005,
      longitude: 0.05,
      timestamp: new Date().toISOString(),
    });
    const result = await checkDriverEligibility('driver-1', 'cat-1', 0.005, 0.005, {
      marketCode: 'US',
    });
    expect(result).toMatchObject({ eligible: false, code: 'OUTSIDE_SERVICE_AREA' });
  });

  it('continues existing eligibility when the US driver is inside the polygon', async () => {
    (realtimeCache.getDriverLocation as jest.Mock).mockResolvedValue({
      latitude: 0.005,
      longitude: 0.005,
      timestamp: new Date().toISOString(),
    });
    const result = await checkDriverEligibility('driver-1', 'cat-1', 0.005, 0.005, {
      marketCode: 'US',
    });
    expect(result.eligible).toBe(true);
  });

  it('does not fence US drivers while enforcement is disabled', async () => {
    clearServiceAreaCache();
    (listServiceAreasForMarket as jest.Mock).mockResolvedValue([
      { ...enforced(false), status: 'draft' },
    ]);
    (realtimeCache.getDriverLocation as jest.Mock).mockResolvedValue({
      latitude: 4,
      longitude: 4,
      timestamp: new Date().toISOString(),
    });
    const result = await checkDriverEligibility('driver-1', 'cat-1', 4, 4, { marketCode: 'US' });
    expect(result.eligible).toBe(true);
  });

  it('offers no US ride when enforcement is on and geometry cannot be used', async () => {
    clearServiceAreaCache();
    (listServiceAreasForMarket as jest.Mock).mockResolvedValue([
      { ...enforced(true), geometry: { type: 'Point', coordinates: [1, 1] } },
    ]);
    (realtimeCache.getDriverLocation as jest.Mock).mockResolvedValue({
      latitude: 0.005,
      longitude: 0.005,
      timestamp: new Date().toISOString(),
    });
    const result = await checkDriverEligibility('driver-1', 'cat-1', 0.005, 0.005, {
      marketCode: 'US',
    });
    expect(result).toMatchObject({ eligible: false, code: 'SERVICE_AREA_UNAVAILABLE' });
  });
});
