import { db } from '../db/connection';
import { drivers, vehicles } from '../db/schema';
import { eq } from 'drizzle-orm';
import { realtimeCache } from '../config/redis';
import { dispatchConfig } from '../config/dispatch';
import { qrDutyRequired, APPROVED_VEHICLE_STATUSES } from '../config/duty';
import { listDriversWithActiveBookings } from '../repositories/booking.repository';
import { driverHasOpenWalkUp } from '../repositories/walkUp.repository';
import { findActiveAssignmentByDriverId } from '../repositories/driverVehicleAssignment.repository';
import { findActiveDutySessionByDriverId } from '../repositories/dutySession.repository';
import { driverServesCategory } from './vehicleEligibility.service';
import { hasPendingExchange } from './vehicleExchange.service';
import { isDriverAcceptingOffer, isDispatchSuspended } from './driverAcceptanceLock.service';
import { haversineKm } from '../utils/geo';
import { isDeactivatedAccount } from './accountStatus.service';
import { evaluateDriverServiceArea } from './serviceArea.service';

export type VehicleEligibilitySource = 'active_assignment' | 'legacy_driver_vehicle';
export type CategoryEligibilitySource = 'active_assignment' | 'legacy_driver_vehicle';

export function isLocationFresh(
  locationTimestamp: string | Date | undefined,
  staleSeconds = dispatchConfig.driverLocationStaleSeconds
): boolean {
  if (!locationTimestamp) return false;
  const ts = typeof locationTimestamp === 'string' ? new Date(locationTimestamp) : locationTimestamp;
  if (Number.isNaN(ts.getTime())) return false;
  return Date.now() - ts.getTime() <= staleSeconds * 1000;
}

export async function setDriverBusy(driverId: string): Promise<void> {
  await db
    .update(drivers)
    .set({ status: 'busy', updatedAt: new Date() })
    .where(eq(drivers.id, driverId));
  await realtimeCache.setDriverStatus(driverId, 'busy');
}

export async function releaseDriverAvailability(driverId: string): Promise<void> {
  const driverRows = await db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1);
  const driver = driverRows[0];
  if (driver && isDeactivatedAccount(driver.accountStatus)) {
    await db
      .update(drivers)
      .set({ status: 'offline', updatedAt: new Date() })
      .where(eq(drivers.id, driverId));
    await realtimeCache.setDriverStatus(driverId, 'offline');
    return;
  }

  await db
    .update(drivers)
    .set({ status: 'online', updatedAt: new Date() })
    .where(eq(drivers.id, driverId));
  await realtimeCache.setDriverStatus(driverId, 'online');
}

export interface ResolvedDispatchVehicle {
  vehicleId: string;
  source: VehicleEligibilitySource;
}

export async function resolveDispatchVehicle(
  driverId: string,
  driverVehicleId: string | null
): Promise<ResolvedDispatchVehicle | null> {
  const activeAssignment = await findActiveAssignmentByDriverId(driverId);
  if (activeAssignment) {
    return { vehicleId: activeAssignment.vehicle_id, source: 'active_assignment' };
  }
  if (driverVehicleId) {
    return { vehicleId: driverVehicleId, source: 'legacy_driver_vehicle' };
  }
  return null;
}

export interface DriverEligibilityResult {
  eligible: boolean;
  code?:
    | 'DRIVER_NOT_ONLINE'
    | 'DRIVER_BUSY'
    | 'DRIVER_NOT_ELIGIBLE'
    | 'DRIVER_NOT_ON_DUTY'
    | 'VEHICLE_NOT_APPROVED'
    | 'SERVICE_CATEGORY_MISMATCH'
    | 'LOCATION_STALE'
    | 'NO_ACTIVE_VEHICLE'
    | 'EXCHANGE_PENDING'
    | 'OUTSIDE_SERVICE_AREA'
    | 'SERVICE_AREA_UNAVAILABLE';
  message?: string;
  vehicleSource?: VehicleEligibilitySource;
  categorySource?: CategoryEligibilitySource;
}

export async function checkDriverEligibility(
  driverId: string,
  serviceCategoryId: string,
  pickupLat: number,
  pickupLng: number,
  options: {
    radiusKm?: number;
    skipBusyCheck?: boolean;
    skipAcceptingCheck?: boolean;
    marketCode?: string | null;
  } = {}
): Promise<DriverEligibilityResult> {
  const radiusKm = options.radiusKm ?? dispatchConfig.dispatchRadiusKm;

  const driverRows = await db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1);
  const driver = driverRows[0];
  if (!driver) {
    return { eligible: false, code: 'DRIVER_NOT_ELIGIBLE', message: 'Driver not found' };
  }

  if (isDeactivatedAccount(driver.accountStatus)) {
    return { eligible: false, code: 'DRIVER_NOT_ELIGIBLE', message: 'Driver account is deactivated' };
  }

  const busyIds = new Set(await listDriversWithActiveBookings());
  if (!options.skipBusyCheck && busyIds.has(driverId)) {
    return { eligible: false, code: 'DRIVER_BUSY', message: 'Driver has an active booking' };
  }

  if (!options.skipBusyCheck && (await driverHasOpenWalkUp(driverId))) {
    return { eligible: false, code: 'DRIVER_BUSY', message: 'Driver has an active walk-up trip' };
  }

  if (await hasPendingExchange(driverId) || (await isDispatchSuspended(driverId))) {
    return {
      eligible: false,
      code: 'EXCHANGE_PENDING',
      message: 'Driver has a pending vehicle exchange',
    };
  }

  if (!options.skipAcceptingCheck && (await isDriverAcceptingOffer(driverId))) {
    return {
      eligible: false,
      code: 'EXCHANGE_PENDING',
      message: 'Driver is processing a booking acceptance',
    };
  }

  const redisStatus = await realtimeCache.getDriverStatus(driverId);
  const effectiveStatus = redisStatus ?? driver.status;
  if (effectiveStatus !== 'online') {
    return { eligible: false, code: 'DRIVER_NOT_ONLINE', message: 'Driver is not online' };
  }

  if (qrDutyRequired) {
    const duty = await findActiveDutySessionByDriverId(driverId);
    const assignment = await findActiveAssignmentByDriverId(driverId);
    if (!duty || !assignment) {
      return {
        eligible: false,
        code: 'DRIVER_NOT_ON_DUTY',
        message: 'Driver must have active duty and assignment',
      };
    }
  }

  const resolvedVehicle = await resolveDispatchVehicle(driverId, driver.vehicleId);
  if (!resolvedVehicle) {
    return { eligible: false, code: 'NO_ACTIVE_VEHICLE', message: 'Driver has no assigned vehicle' };
  }

  const vehicleRows = await db
    .select()
    .from(vehicles)
    .where(eq(vehicles.id, resolvedVehicle.vehicleId))
    .limit(1);
  const vehicle = vehicleRows[0];
  if (!vehicle || !APPROVED_VEHICLE_STATUSES.has(vehicle.status)) {
    return {
      eligible: false,
      code: 'VEHICLE_NOT_APPROVED',
      message: 'Vehicle is not approved for dispatch',
      vehicleSource: resolvedVehicle.source,
    };
  }

  const categoryCheck = await driverServesCategory(driverId, serviceCategoryId);
  if (!categoryCheck.matches) {
    return {
      eligible: false,
      code: 'SERVICE_CATEGORY_MISMATCH',
      message: 'Driver does not serve this service category',
      vehicleSource: resolvedVehicle.source,
      categorySource: categoryCheck.source,
    };
  }

  if (process.env.LOG_LEVEL === 'debug') {
    console.debug('[dispatch-eligibility]', {
      driverId,
      vehicleSource: resolvedVehicle.source,
      categorySource: categoryCheck.source,
      vehicleId: resolvedVehicle.vehicleId,
    });
  }

  const location = await realtimeCache.getDriverLocation(driverId);
  const heartbeat = await realtimeCache.getDriverHeartbeat(driverId);
  if (!location?.latitude || !location?.longitude) {
    return { eligible: false, code: 'LOCATION_STALE', message: 'Driver location is unavailable' };
  }

  const lat = parseFloat(String(location.latitude));
  const lng = parseFloat(String(location.longitude));
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { eligible: false, code: 'LOCATION_STALE', message: 'Driver location is invalid' };
  }

  const activityFresh =
    isLocationFresh(heartbeat ?? undefined) || isLocationFresh(location.timestamp);
  if (!activityFresh) {
    return { eligible: false, code: 'LOCATION_STALE', message: 'Driver location is stale' };
  }

  const serviceArea = await evaluateDriverServiceArea(options.marketCode, lat, lng);
  if (serviceArea.applies && !serviceArea.inside) {
    return {
      eligible: false,
      code: serviceArea.code,
      message:
        serviceArea.code === 'OUTSIDE_SERVICE_AREA'
          ? 'Driver is outside the service area'
          : 'Service area is unavailable',
    };
  }

  const distanceKm = haversineKm(pickupLat, pickupLng, lat, lng);
  if (distanceKm > radiusKm) {
    return {
      eligible: false,
      code: 'DRIVER_NOT_ELIGIBLE',
      message: 'Driver is outside dispatch radius',
    };
  }

  return {
    eligible: true,
    vehicleSource: resolvedVehicle.source,
    categorySource: categoryCheck.source,
  };
}

export async function diagnoseDriverEligibility(
  driverId: string,
  serviceCategoryId: string,
  pickupLat: number,
  pickupLng: number,
  marketCode?: string | null
): Promise<{ driverId: string; eligible: boolean; reasons: string[] }> {
  const reasons: string[] = [];
  const driverRows = await db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1);
  const driver = driverRows[0];
  if (!driver) {
    return { driverId, eligible: false, reasons: ['DRIVER_NOT_FOUND'] };
  }

  const busyIds = new Set(await listDriversWithActiveBookings());
  if (busyIds.has(driverId)) reasons.push('DRIVER_BUSY');
  if (await driverHasOpenWalkUp(driverId)) reasons.push('WALK_UP_ACTIVE');

  if (await hasPendingExchange(driverId)) reasons.push('EXCHANGE_PENDING');
  if (await isDispatchSuspended(driverId)) reasons.push('DISPATCH_SUSPENDED');
  if (await isDriverAcceptingOffer(driverId)) reasons.push('BOOKING_ACCEPTANCE_IN_PROGRESS');

  const redisStatus = await realtimeCache.getDriverStatus(driverId);
  const effectiveStatus = redisStatus ?? driver.status;
  if (effectiveStatus !== 'online') reasons.push('DRIVER_NOT_ONLINE');

  if (qrDutyRequired) {
    const duty = await findActiveDutySessionByDriverId(driverId);
    const assignment = await findActiveAssignmentByDriverId(driverId);
    if (!duty || !assignment) reasons.push('DRIVER_NOT_ON_DUTY');
  }

  const resolvedVehicle = await resolveDispatchVehicle(driverId, driver.vehicleId);
  if (!resolvedVehicle) {
    reasons.push('NO_ACTIVE_VEHICLE');
  } else {
    reasons.push(`vehicle_source:${resolvedVehicle.source}`);
    const vehicleRows = await db
      .select()
      .from(vehicles)
      .where(eq(vehicles.id, resolvedVehicle.vehicleId))
      .limit(1);
    const vehicle = vehicleRows[0];
    if (!vehicle || !APPROVED_VEHICLE_STATUSES.has(vehicle.status)) {
      reasons.push('VEHICLE_NOT_APPROVED');
    }
  }

  const categoryCheck = await driverServesCategory(driverId, serviceCategoryId);
  reasons.push(`category_source:${categoryCheck.source}`);
  if (!categoryCheck.matches) reasons.push('SERVICE_CATEGORY_MISMATCH');

  const location = await realtimeCache.getDriverLocation(driverId);
  const heartbeat = await realtimeCache.getDriverHeartbeat(driverId);
  if (!location?.latitude || !location?.longitude) {
    reasons.push('LOCATION_UNAVAILABLE');
  } else {
    const activityFresh =
      isLocationFresh(heartbeat ?? undefined) || isLocationFresh(location.timestamp);
    if (!activityFresh) reasons.push('LOCATION_STALE');

    const serviceArea = await evaluateDriverServiceArea(
      marketCode,
      parseFloat(String(location.latitude)),
      parseFloat(String(location.longitude))
    );
    if (serviceArea.applies && !serviceArea.inside) reasons.push(serviceArea.code);

    const distanceKm = haversineKm(
      pickupLat,
      pickupLng,
      parseFloat(String(location.latitude)),
      parseFloat(String(location.longitude))
    );
    if (distanceKm > dispatchConfig.dispatchRadiusKm) reasons.push('OUTSIDE_DISPATCH_RADIUS');
  }

  return { driverId, eligible: reasons.length === 0, reasons };
}
