import { APPROVED_VEHICLE_STATUSES, qrDutyRequired } from '../../config/duty';
import { findActiveBookingByDriver } from '../../repositories/booking.repository';
import { findActiveAssignmentByDriverId } from '../../repositories/driverVehicleAssignment.repository';
import { findActiveDutySessionByDriverId } from '../../repositories/dutySession.repository';
import { findOpenMeterByDriver } from '../../repositories/meterSession.repository';
import {
  findOpenWalkUpByDriver,
  findVehicleForMeter,
  findWalkUpById,
  findWalkUpByIdempotency,
  insertWalkUp,
  listWalkUpsForDriver,
  updateWalkUp,
} from '../../repositories/walkUp.repository';
import { resolveDispatchVehicle } from '../driverAvailability.service';
import { evaluateDriverServiceArea } from '../serviceArea.service';
import { WalkUpStatus, type WalkUpStatusType } from '../../constants/softMeter';
import type { NewWalkUpTrip, WalkUpTrip } from '../../db/schema/walk_up_trips';
import { assertWalkUpEligible } from './eligibility';
import { MeterError } from './errors';
import {
  finalizeMeterSession,
  getMeterSessionForDriver,
  startMeterSession,
  toMeterState,
} from './meterSession.service';
import { isDeactivatedAccount } from '../accountStatus.service';

export interface CreateWalkUpInput {
  driverId: string;
  accountStatus: string | null;
  legacyVehicleId: string | null;
  marketCode?: string | null;
  pickupLatitude: number;
  pickupLongitude: number;
  passengerLabel?: string | null;
  idempotencyKey?: string | null;
}

export interface WalkUpDeps {
  dutyRequired: boolean;
  findActiveBooking: (driverId: string) => Promise<unknown | null>;
  findOpenWalkUp: (driverId: string) => Promise<WalkUpTrip | null>;
  findByIdempotency: (key: string) => Promise<WalkUpTrip | null>;
  findOpenMeter: (driverId: string) => Promise<unknown | null>;
  resolveVehicle: (
    driverId: string,
    legacyVehicleId: string | null
  ) => Promise<{ vehicleId: string } | null>;
  vehicleApproved: (vehicleId: string) => Promise<boolean>;
  onDuty: (driverId: string) => Promise<{ onDuty: boolean; dutySessionId: string | null }>;
  serviceArea: (
    marketCode: string | null | undefined,
    latitude: number,
    longitude: number
  ) => Promise<
    | { applies: false }
    | { applies: true; inside: true }
    | { applies: true; inside: false; code: 'OUTSIDE_SERVICE_AREA' | 'SERVICE_AREA_UNAVAILABLE' }
  >;
  insertTrip: (values: NewWalkUpTrip) => Promise<WalkUpTrip>;
  currencyForMarket: (marketCode: string | null | undefined) => string;
}

export function currencyForWalkUpMarket(marketCode: string | null | undefined): string {
  return (marketCode ?? '').trim().toUpperCase() === 'BD' ? 'BDT' : 'USD';
}

export const defaultWalkUpDeps: WalkUpDeps = {
  dutyRequired: qrDutyRequired,
  findActiveBooking: (driverId) => findActiveBookingByDriver(driverId),
  findOpenWalkUp: (driverId) => findOpenWalkUpByDriver(driverId),
  findByIdempotency: (key) => findWalkUpByIdempotency(key),
  findOpenMeter: (driverId) => findOpenMeterByDriver(driverId),
  resolveVehicle: (driverId, legacyVehicleId) =>
    resolveDispatchVehicle(driverId, legacyVehicleId),
  vehicleApproved: async (vehicleId) => {
    const vehicle = await findVehicleForMeter(vehicleId);
    return Boolean(vehicle && APPROVED_VEHICLE_STATUSES.has(vehicle.status));
  },
  onDuty: async (driverId) => {
    const duty = await findActiveDutySessionByDriverId(driverId);
    const assignment = await findActiveAssignmentByDriverId(driverId);
    return { onDuty: Boolean(duty && assignment), dutySessionId: duty?.id ?? null };
  },
  serviceArea: (marketCode, latitude, longitude) =>
    evaluateDriverServiceArea(marketCode, latitude, longitude),
  insertTrip: (values) => insertWalkUp(values),
  currencyForMarket: currencyForWalkUpMarket,
};

export async function createWalkUpTrip(
  input: CreateWalkUpInput,
  deps: WalkUpDeps = defaultWalkUpDeps
): Promise<{ trip: WalkUpTrip; idempotent: boolean }> {
  if (input.idempotencyKey) {
    const existing = await deps.findByIdempotency(input.idempotencyKey);
    if (existing) {
      if (existing.driverId !== input.driverId) {
        throw new MeterError('IDEMPOTENCY_CONFLICT', 'Idempotency key belongs to another driver.', 409);
      }
      return { trip: existing, idempotent: true };
    }
  }

  const [booking, openWalkUp, openMeter, vehicle, duty] = await Promise.all([
    deps.findActiveBooking(input.driverId),
    deps.findOpenWalkUp(input.driverId),
    deps.findOpenMeter(input.driverId),
    deps.resolveVehicle(input.driverId, input.legacyVehicleId),
    deps.onDuty(input.driverId),
  ]);
  const approved = vehicle ? await deps.vehicleApproved(vehicle.vehicleId) : false;
  const serviceArea = await deps.serviceArea(
    input.marketCode,
    input.pickupLatitude,
    input.pickupLongitude
  );
  assertWalkUpEligible({
    accountActive: !isDeactivatedAccount(input.accountStatus),
    dutyRequired: deps.dutyRequired,
    onDuty: duty.onDuty,
    vehicleId: vehicle?.vehicleId ?? null,
    vehicleApproved: approved,
    activeBooking: Boolean(booking),
    openWalkUp: Boolean(openWalkUp),
    openMeter: Boolean(openMeter),
    serviceArea,
  });

  const trip = await deps.insertTrip({
    driverId: input.driverId,
    vehicleId: vehicle!.vehicleId,
    dutySessionId: duty.dutySessionId,
    status: WalkUpStatus.CREATED,
    marketCode: input.marketCode?.trim().toUpperCase() || null,
    currency: deps.currencyForMarket(input.marketCode),
    pickupLatitude: input.pickupLatitude.toFixed(8),
    pickupLongitude: input.pickupLongitude.toFixed(8),
    passengerLabel: input.passengerLabel ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    paymentStatus: 'none',
  });
  return { trip, idempotent: false };
}

export async function requireDriverWalkUp(tripId: string, driverId: string): Promise<WalkUpTrip> {
  const trip = await findWalkUpById(tripId);
  if (!trip || trip.driverId !== driverId) {
    throw new MeterError('WALK_UP_NOT_FOUND', 'Walk-up trip not found.', 404);
  }
  return trip;
}

export async function startWalkUpMeter(
  tripId: string,
  driverId: string,
  idempotencyKey?: string | null
) {
  const trip = await requireDriverWalkUp(tripId, driverId);
  if (trip.status === WalkUpStatus.CANCELLED) {
    throw new MeterError('WALK_UP_CANCELLED', 'This walk-up trip was cancelled.', 409);
  }
  const started = await startMeterSession({
    driverId,
    vehicleId: trip.vehicleId,
    tripKind: 'walk_up',
    walkUpTripId: trip.id,
    idempotencyKey,
  });
  if (trip.status === WalkUpStatus.CREATED) {
    await updateWalkUp(trip.id, {
      status: WalkUpStatus.IN_PROGRESS,
      startedAt: started.session.startedAt ?? new Date(),
    });
  }
  const session = await getMeterSessionForDriver(started.session.id, driverId);
  return { tripId: trip.id, idempotent: started.idempotent, meter: toMeterState(session) };
}

export async function endWalkUpTrip(tripId: string, driverId: string) {
  const trip = await requireDriverWalkUp(tripId, driverId);
  const session = trip.status === WalkUpStatus.CREATED ? null : await findOpenOrAny(trip.id, driverId);
  if (!session) {
    throw new MeterError('METER_NOT_STARTED', 'Start the meter before ending the walk-up trip.', 409);
  }
  const finalized = await finalizeMeterSession(session.id, driverId);
  return {
    tripId: trip.id,
    idempotent: finalized.idempotent,
    meter: toMeterState(finalized.session),
    fareRecordId: finalized.fare.id,
    billable: false,
  };
}

async function findOpenOrAny(tripId: string, driverId: string) {
  const { findMeterByWalkUp } = await import('../../repositories/meterSession.repository');
  const session = await findMeterByWalkUp(tripId);
  if (!session || session.driverId !== driverId) return null;
  return session;
}

export async function cancelCreatedWalkUp(tripId: string, driverId: string) {
  const trip = await requireDriverWalkUp(tripId, driverId);
  if (trip.status === WalkUpStatus.CANCELLED) return trip;
  if (trip.status !== WalkUpStatus.CREATED) {
    throw new MeterError(
      'WALK_UP_NOT_CANCELLABLE',
      'Only a walk-up that has not started can be cancelled.',
      409
    );
  }
  const updated = await updateWalkUp(trip.id, { status: WalkUpStatus.CANCELLED });
  return updated ?? trip;
}

export async function listDriverWalkUps(driverId: string) {
  return listWalkUpsForDriver(driverId);
}

export function walkUpStatus(value: string): WalkUpStatusType {
  return value as WalkUpStatusType;
}
