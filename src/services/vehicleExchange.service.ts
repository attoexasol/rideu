import { db } from '../db/connection';
import { drivers } from '../db/schema/drivers';
import { vehicles } from '../db/schema/vehicles';
import { dutySessions } from '../db/schema/duty_sessions';
import { driverVehicleAssignments } from '../db/schema/driver_vehicle_assignments';
import { vehicleExchangeRequests } from '../db/schema/vehicle_exchange_requests';
import { eq, and, gt } from 'drizzle-orm';
import { driverHasActiveRide } from './duty.service';
import { resolveVehicleQrToken, VehicleQrError } from './vehicleQrToken.service';
import {
  findExchangeById,
  findExchangeByIdempotency,
  findExchangeByIdForUpdate,
  findPendingExchangeForDriver,
  insertExchangeEventTx,
  insertResourceLocks,
  releaseResourceLocks,
} from '../repositories/vehicleExchange.repository';
import type { DbTransaction } from '../utils/db-transaction';
import { findActiveDutySessionByDriverId } from '../repositories/dutySession.repository';
import {
  findActiveAssignmentByDriverId,
  findActiveAssignmentByVehicleId,
} from '../repositories/driverVehicleAssignment.repository';
import { findFleetById } from '../repositories/organization.repository';
import { cancelPendingOffersForDriver } from '../repositories/booking.repository';
import {
  isDriverAcceptingOffer,
  setDispatchSuspended,
  clearDispatchSuspended,
} from './driverAcceptanceLock.service';
import {
  emitExchangeRequested,
  emitExchangeCancelled,
  emitExchangeExpired,
  emitExchangeCompleted,
  emitVehicleAssignmentChanged,
} from './vehicleExchangeNotify.service';
import { emitOfferCancelled } from './bookingNotify.service';
import { APPROVED_VEHICLE_STATUSES } from '../config/duty';
import {
  EXCHANGE_STATUS_PENDING,
  EXCHANGE_STATUS_COMPLETED,
  EXCHANGE_STATUS_CANCELLED,
  EXCHANGE_STATUS_EXPIRED,
  vehicleExchangeTtlSeconds,
  LOCK_RESOURCE_DRIVER,
  LOCK_RESOURCE_VEHICLE,
  vehicleExchangeForceCompleteEnabled,
} from '../config/exchange';
import { realtimeCache } from '../config/redis';
import type { VehicleExchangeRequest } from '../db/schema/vehicle_exchange_requests';

export class VehicleExchangeError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 409
  ) {
    super(message);
    this.name = 'VehicleExchangeError';
  }
}

function formatLocation(location?: { latitude: number; longitude: number } | null) {
  if (!location) return null;
  return { latitude: location.latitude, longitude: location.longitude };
}

function sortIds(ids: string[]): string[] {
  return [...ids].sort();
}

async function lockDriversForUpdate(tx: DbTransaction, driverIds: string[]) {
  for (const id of sortIds(driverIds)) {
    await tx.select().from(drivers).where(eq(drivers.id, id)).for('update');
  }
}

async function lockAssignmentsForUpdate(tx: DbTransaction, assignmentIds: string[]) {
  for (const id of sortIds(assignmentIds)) {
    await tx
      .select()
      .from(driverVehicleAssignments)
      .where(eq(driverVehicleAssignments.id, id))
      .for('update');
  }
}

async function lockVehiclesForUpdate(tx: DbTransaction, vehicleIds: string[]) {
  for (const id of sortIds(vehicleIds)) {
    await tx.select().from(vehicles).where(eq(vehicles.id, id)).for('update');
  }
}

async function lockDutySessionsForUpdate(tx: DbTransaction, sessionIds: string[]) {
  for (const id of sortIds(sessionIds)) {
    await tx.select().from(dutySessions).where(eq(dutySessions.id, id)).for('update');
  }
}

async function assertNoActiveRide(driverId: string) {
  if (await driverHasActiveRide(driverId)) {
    throw new VehicleExchangeError('ACTIVE_RIDE_BLOCKS_EXCHANGE', 'Active ride blocks exchange');
  }
}

async function assertNotAccepting(driverId: string) {
  if (await isDriverAcceptingOffer(driverId)) {
    throw new VehicleExchangeError(
      'BOOKING_ACCEPTANCE_IN_PROGRESS',
      'Booking acceptance in progress'
    );
  }
}

async function summarizeVehicle(vehicleId: string) {
  const rows = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1);
  const v = rows[0];
  if (!v) return { id: vehicleId };
  return {
    id: v.id,
    plateNumber: v.plateNumber,
    make: v.make,
    model: v.model,
  };
}

async function summarizePartner(driverId: string) {
  const rows = await db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1);
  const d = rows[0];
  return { driverId, displayName: d?.name ?? 'Driver' };
}

export function mapExchangeResponse(
  exchange: VehicleExchangeRequest,
  role: 'initiator' | 'partner'
) {
  return {
    id: exchange.id,
    status: exchange.status,
    role,
    expiresAt: exchange.expiresAt,
    initiatorDriverId: exchange.initiatorDriverId,
    partnerDriverId: exchange.partnerDriverId,
    initiatorVehicleId: exchange.initiatorVehicleId,
    partnerVehicleId: exchange.partnerVehicleId,
  };
}

export interface InitiateExchangeInput {
  initiatorDriverId: string;
  scannedVehicleQrToken: string;
  idempotencyKey: string;
  location?: { latitude: number; longitude: number } | null;
}

export async function initiateVehicleExchange(input: InitiateExchangeInput) {
  const existing = await findExchangeByIdempotency(
    input.initiatorDriverId,
    input.idempotencyKey
  );
  if (existing) {
    if (existing.status === EXCHANGE_STATUS_PENDING) {
      return {
        exchange: existing,
        role: 'initiator' as const,
        idempotent: true,
      };
    }
    if (existing.status === EXCHANGE_STATUS_COMPLETED) {
      throw new VehicleExchangeError(
        'EXCHANGE_ALREADY_COMPLETED',
        'Exchange already completed',
        200
      );
    }
  }

  const pendingForInitiator = await findPendingExchangeForDriver(input.initiatorDriverId);
  if (pendingForInitiator) {
    throw new VehicleExchangeError('EXCHANGE_ALREADY_PENDING', 'Driver already has pending exchange');
  }

  await assertNoActiveRide(input.initiatorDriverId);
  await assertNotAccepting(input.initiatorDriverId);

  const initiatorDuty = await findActiveDutySessionByDriverId(input.initiatorDriverId);
  if (!initiatorDuty) {
    throw new VehicleExchangeError('DRIVER_NOT_ON_DUTY', 'Initiator is not on duty');
  }

  const initiatorAssignment = await findActiveAssignmentByDriverId(input.initiatorDriverId);
  if (!initiatorAssignment) {
    throw new VehicleExchangeError('DRIVER_NOT_ON_DUTY', 'Initiator has no active assignment');
  }

  let resolvedQr;
  try {
    resolvedQr = await resolveVehicleQrToken(input.scannedVehicleQrToken);
  } catch (err) {
    if (err instanceof VehicleQrError) {
      throw new VehicleExchangeError(err.code, err.message, err.statusCode);
    }
    throw err;
  }

  if (resolvedQr.vehicleId === initiatorAssignment.vehicle_id) {
    throw new VehicleExchangeError('CANNOT_SWAP_OWN_VEHICLE', 'Cannot scan your own vehicle', 400);
  }

  const partnerAssignment = await findActiveAssignmentByVehicleId(resolvedQr.vehicleId);
  if (!partnerAssignment) {
    throw new VehicleExchangeError('VEHICLE_NOT_ASSIGNED', 'Scanned vehicle has no active assignment');
  }

  const partnerDriverId = partnerAssignment.driver_id;
  if (partnerDriverId === input.initiatorDriverId) {
    throw new VehicleExchangeError('CANNOT_SWAP_OWN_VEHICLE', 'Cannot exchange with yourself', 400);
  }

  const pendingForPartner = await findPendingExchangeForDriver(partnerDriverId);
  if (pendingForPartner) {
    throw new VehicleExchangeError('EXCHANGE_ALREADY_PENDING', 'Partner already has pending exchange');
  }

  await assertNoActiveRide(partnerDriverId);
  await assertNotAccepting(partnerDriverId);

  const partnerDuty = await findActiveDutySessionByDriverId(partnerDriverId);
  if (!partnerDuty) {
    throw new VehicleExchangeError('OTHER_DRIVER_NOT_ON_DUTY', 'Partner is not on duty');
  }

  const fleet = await findFleetById(initiatorDuty.fleetId);
  if (!fleet || partnerDuty.fleetId !== initiatorDuty.fleetId) {
    throw new VehicleExchangeError('FLEET_MISMATCH', 'Drivers must belong to the same fleet');
  }

  const vehicleRows = await db
    .select()
    .from(vehicles)
    .where(eq(vehicles.id, resolvedQr.vehicleId))
    .limit(1);
  const partnerVehicle = vehicleRows[0];
  const initiatorVehicleRows = await db
    .select()
    .from(vehicles)
    .where(eq(vehicles.id, initiatorAssignment.vehicle_id))
    .limit(1);
  const initiatorVehicle = initiatorVehicleRows[0];

  if (
    !partnerVehicle ||
    !initiatorVehicle ||
    !APPROVED_VEHICLE_STATUSES.has(partnerVehicle.status) ||
    !APPROVED_VEHICLE_STATUSES.has(initiatorVehicle.status)
  ) {
    throw new VehicleExchangeError('VEHICLE_NOT_APPROVED', 'Vehicle is not approved');
  }

  const expiresAt = new Date(Date.now() + vehicleExchangeTtlSeconds * 1000);

  let exchange: VehicleExchangeRequest;

  try {
    exchange = await db.transaction(async (tx) => {
      await lockDriversForUpdate(tx, [input.initiatorDriverId, partnerDriverId]);
      await lockDutySessionsForUpdate(tx, [initiatorDuty.id, partnerDuty.id]);
      await lockAssignmentsForUpdate(tx, [
        initiatorAssignment.id,
        partnerAssignment.id,
      ]);
      await lockVehiclesForUpdate(tx, [
        initiatorAssignment.vehicle_id,
        partnerAssignment.vehicle_id,
      ]);

      const [created] = await tx
        .insert(vehicleExchangeRequests)
        .values({
          fleetId: initiatorDuty.fleetId,
          organizationId: initiatorDuty.organizationId,
          initiatorDriverId: input.initiatorDriverId,
          partnerDriverId,
          initiatorVehicleId: initiatorAssignment.vehicle_id,
          partnerVehicleId: partnerAssignment.vehicle_id,
          initiatorAssignmentId: initiatorAssignment.id,
          partnerAssignmentId: partnerAssignment.id,
          initiatorDutySessionId: initiatorDuty.id,
          partnerDutySessionId: partnerDuty.id,
          initiatorScannedTokenId: resolvedQr.tokenId,
          status: EXCHANGE_STATUS_PENDING,
          idempotencyKey: input.idempotencyKey,
          expiresAt,
        })
        .returning();

      await insertResourceLocks(tx, [
        {
          exchangeRequestId: created.id,
          resourceType: LOCK_RESOURCE_DRIVER,
          resourceId: input.initiatorDriverId,
        },
        {
          exchangeRequestId: created.id,
          resourceType: LOCK_RESOURCE_DRIVER,
          resourceId: partnerDriverId,
        },
        {
          exchangeRequestId: created.id,
          resourceType: LOCK_RESOURCE_VEHICLE,
          resourceId: initiatorAssignment.vehicle_id,
        },
        {
          exchangeRequestId: created.id,
          resourceType: LOCK_RESOURCE_VEHICLE,
          resourceId: partnerAssignment.vehicle_id,
        },
      ]);

      await insertExchangeEventTx(tx, {
        exchangeRequestId: created.id,
        eventType: 'initiated',
        actorType: 'driver',
        actorId: input.initiatorDriverId,
        payload: {
          location: formatLocation(input.location),
          initiatorVehicleId: initiatorAssignment.vehicle_id,
          partnerVehicleId: partnerAssignment.vehicle_id,
        },
      });

      return created;
    });
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr?.code === '23505') {
      throw new VehicleExchangeError(
        'EXCHANGE_ALREADY_PENDING',
        'Driver or vehicle already locked in pending exchange'
      );
    }
    throw err;
  }

  const cancelledInitiator = await cancelPendingOffersForDriver(
    input.initiatorDriverId,
    'vehicle_exchange_pending'
  );
  const cancelledPartner = await cancelPendingOffersForDriver(
    partnerDriverId,
    'vehicle_exchange_pending'
  );
  for (const offer of [...cancelledInitiator, ...cancelledPartner]) {
    await emitOfferCancelled(offer.driverId, {
      bookingId: offer.bookingId,
      offerId: offer.id,
      reason: 'vehicle_exchange_pending',
    });
  }

  await setDispatchSuspended(input.initiatorDriverId, exchange.id);
  await setDispatchSuspended(partnerDriverId, exchange.id);

  const partnerSummary = await summarizePartner(partnerDriverId);
  const payload = {
    exchangeId: exchange.id,
    status: exchange.status,
    expiresAt: exchange.expiresAt.toISOString(),
    partner: partnerSummary,
    yourVehicle: await summarizeVehicle(exchange.initiatorVehicleId),
    partnerVehicle: await summarizeVehicle(exchange.partnerVehicleId),
  };

  await emitExchangeRequested(partnerDriverId, payload);

  return { exchange, role: 'initiator' as const, idempotent: false };
}

export interface ConfirmExchangeInput {
  exchangeId: string;
  partnerDriverId: string;
  scannedVehicleQrToken: string;
  location?: { latitude: number; longitude: number } | null;
}

export async function confirmVehicleExchange(input: ConfirmExchangeInput) {
  const preview = await findExchangeById(input.exchangeId);
  if (!preview) {
    throw new VehicleExchangeError('EXCHANGE_CONFLICT', 'Exchange not found', 404);
  }
  if (preview.status === EXCHANGE_STATUS_COMPLETED) {
    return { exchange: preview, idempotent: true, assignments: null };
  }
  if (preview.partnerDriverId !== input.partnerDriverId) {
    throw new VehicleExchangeError('PARTNER_REQUIRED', 'Only the partner may confirm', 403);
  }
  if (preview.status !== EXCHANGE_STATUS_PENDING) {
    throw new VehicleExchangeError('EXCHANGE_CONFLICT', `Exchange is ${preview.status}`);
  }
  if (preview.expiresAt < new Date()) {
    throw new VehicleExchangeError('EXCHANGE_EXPIRED', 'Exchange has expired', 410);
  }

  let resolvedQr;
  try {
    resolvedQr = await resolveVehicleQrToken(input.scannedVehicleQrToken);
  } catch (err) {
    if (err instanceof VehicleQrError) {
      throw new VehicleExchangeError(err.code, err.message, err.statusCode);
    }
    throw err;
  }

  if (resolvedQr.vehicleId !== preview.initiatorVehicleId) {
    throw new VehicleExchangeError(
      'QR_TOKEN_INVALID',
      'Scanned QR must match initiator vehicle',
      400
    );
  }

  await assertNoActiveRide(preview.initiatorDriverId);
  await assertNoActiveRide(preview.partnerDriverId);
  await assertNotAccepting(preview.initiatorDriverId);
  await assertNotAccepting(preview.partnerDriverId);

  const swapResult = await db.transaction(async (tx) => {
    const exchange = await findExchangeByIdForUpdate(tx, input.exchangeId);
    if (!exchange) {
      throw new VehicleExchangeError('EXCHANGE_CONFLICT', 'Exchange not found', 404);
    }
    if (exchange.status === EXCHANGE_STATUS_COMPLETED) {
      return { exchange, idempotent: true, assignments: null };
    }
    if (exchange.status !== EXCHANGE_STATUS_PENDING) {
      throw new VehicleExchangeError('EXCHANGE_CONFLICT', `Exchange is ${exchange.status}`);
    }
    if (exchange.expiresAt < new Date()) {
      throw new VehicleExchangeError('EXCHANGE_EXPIRED', 'Exchange has expired', 410);
    }

    await lockDriversForUpdate(tx, [exchange.initiatorDriverId, exchange.partnerDriverId]);
    await lockDutySessionsForUpdate(tx, [
      exchange.initiatorDutySessionId,
      exchange.partnerDutySessionId,
    ]);
    await lockAssignmentsForUpdate(tx, [
      exchange.initiatorAssignmentId,
      exchange.partnerAssignmentId,
    ]);
    await lockVehiclesForUpdate(tx, [exchange.initiatorVehicleId, exchange.partnerVehicleId]);

    const initiatorAssignRows = await tx
      .select()
      .from(driverVehicleAssignments)
      .where(eq(driverVehicleAssignments.id, exchange.initiatorAssignmentId))
      .limit(1);
    const partnerAssignRows = await tx
      .select()
      .from(driverVehicleAssignments)
      .where(eq(driverVehicleAssignments.id, exchange.partnerAssignmentId))
      .limit(1);
    const initiatorAssign = initiatorAssignRows[0];
    const partnerAssign = partnerAssignRows[0];

    if (
      !initiatorAssign?.isActive ||
      !partnerAssign?.isActive ||
      initiatorAssign.vehicleId !== exchange.initiatorVehicleId ||
      partnerAssign.vehicleId !== exchange.partnerVehicleId ||
      initiatorAssign.driverId !== exchange.initiatorDriverId ||
      partnerAssign.driverId !== exchange.partnerDriverId
    ) {
      throw new VehicleExchangeError('ASSIGNMENT_CHANGED', 'Assignment changed since exchange started');
    }

    const initiatorDutyRows = await tx
      .select()
      .from(dutySessions)
      .where(eq(dutySessions.id, exchange.initiatorDutySessionId))
      .limit(1);
    const partnerDutyRows = await tx
      .select()
      .from(dutySessions)
      .where(eq(dutySessions.id, exchange.partnerDutySessionId))
      .limit(1);
    if (
      initiatorDutyRows[0]?.status !== 'active' ||
      partnerDutyRows[0]?.status !== 'active'
    ) {
      throw new VehicleExchangeError('DRIVER_NOT_ON_DUTY', 'Duty session is no longer active');
    }

    await tx
      .update(driverVehicleAssignments)
      .set({
        isActive: false,
        unassignedAt: new Date(),
        unassignedReason: 'vehicle_exchange',
      })
      .where(
        and(
          eq(driverVehicleAssignments.id, exchange.initiatorAssignmentId),
          eq(driverVehicleAssignments.isActive, true)
        )
      );

    await tx
      .update(driverVehicleAssignments)
      .set({
        isActive: false,
        unassignedAt: new Date(),
        unassignedReason: 'vehicle_exchange',
      })
      .where(
        and(
          eq(driverVehicleAssignments.id, exchange.partnerAssignmentId),
          eq(driverVehicleAssignments.isActive, true)
        )
      );

    const [newInitiatorAssignment] = await tx
      .insert(driverVehicleAssignments)
      .values({
        driverId: exchange.initiatorDriverId,
        vehicleId: exchange.partnerVehicleId,
        fleetId: exchange.fleetId,
        dutySessionId: exchange.initiatorDutySessionId,
        isActive: true,
        assignedBy: 'driver_scan',
        assignmentReason: 'vehicle_exchange',
        predecessorAssignmentId: exchange.initiatorAssignmentId,
        exchangeRequestId: exchange.id,
      })
      .returning();

    const [newPartnerAssignment] = await tx
      .insert(driverVehicleAssignments)
      .values({
        driverId: exchange.partnerDriverId,
        vehicleId: exchange.initiatorVehicleId,
        fleetId: exchange.fleetId,
        dutySessionId: exchange.partnerDutySessionId,
        isActive: true,
        assignedBy: 'driver_scan',
        assignmentReason: 'vehicle_exchange',
        predecessorAssignmentId: exchange.partnerAssignmentId,
        exchangeRequestId: exchange.id,
      })
      .returning();

    await tx
      .update(drivers)
      .set({ vehicleId: exchange.partnerVehicleId, updatedAt: new Date() })
      .where(eq(drivers.id, exchange.initiatorDriverId));

    await tx
      .update(drivers)
      .set({ vehicleId: exchange.initiatorVehicleId, updatedAt: new Date() })
      .where(eq(drivers.id, exchange.partnerDriverId));

    const [completed] = await tx
      .update(vehicleExchangeRequests)
      .set({
        status: EXCHANGE_STATUS_COMPLETED,
        confirmedAt: new Date(),
        partnerScannedTokenId: resolvedQr.tokenId,
        completedBy: 'mutual_qr',
        version: exchange.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(vehicleExchangeRequests.id, exchange.id),
          eq(vehicleExchangeRequests.status, EXCHANGE_STATUS_PENDING),
          gt(vehicleExchangeRequests.expiresAt, new Date())
        )
      )
      .returning();

    if (!completed) {
      throw new VehicleExchangeError('EXCHANGE_CONFLICT', 'Exchange could not be completed');
    }

    await releaseResourceLocks(tx, exchange.id);

    await insertExchangeEventTx(tx, {
      exchangeRequestId: exchange.id,
      eventType: 'completed',
      actorType: 'driver',
      actorId: input.partnerDriverId,
      payload: {
        location: formatLocation(input.location),
        before: {
          initiatorVehicleId: exchange.initiatorVehicleId,
          partnerVehicleId: exchange.partnerVehicleId,
        },
        after: {
          initiatorVehicleId: exchange.partnerVehicleId,
          partnerVehicleId: exchange.initiatorVehicleId,
        },
        newInitiatorAssignmentId: newInitiatorAssignment.id,
        newPartnerAssignmentId: newPartnerAssignment.id,
      },
    });

    return {
      exchange: completed,
      idempotent: false,
      assignments: {
        initiator: newInitiatorAssignment,
        partner: newPartnerAssignment,
      },
    };
  });

  if (swapResult.idempotent) {
    return swapResult;
  }

  const { exchange, assignments } = swapResult;
  if (!assignments) return swapResult;

  await clearDispatchSuspended(exchange.initiatorDriverId);
  await clearDispatchSuspended(exchange.partnerDriverId);
  await realtimeCache.setDriverStatus(exchange.initiatorDriverId, 'online');
  await realtimeCache.setDriverStatus(exchange.partnerDriverId, 'online');

  const initiatorPayload = {
    exchangeId: exchange.id,
    status: exchange.status,
    yourVehicle: await summarizeVehicle(exchange.partnerVehicleId),
    partnerVehicle: await summarizeVehicle(exchange.initiatorVehicleId),
    assignmentId: assignments.initiator.id,
  };

  const partnerPayload = {
    exchangeId: exchange.id,
    status: exchange.status,
    yourVehicle: await summarizeVehicle(exchange.initiatorVehicleId),
    partnerVehicle: await summarizeVehicle(exchange.partnerVehicleId),
    assignmentId: assignments.partner.id,
  };

  await emitExchangeCompleted(exchange.initiatorDriverId, initiatorPayload);
  await emitExchangeCompleted(exchange.partnerDriverId, partnerPayload);

  await emitVehicleAssignmentChanged(exchange.initiatorDriverId, {
    exchangeId: exchange.id,
    assignmentId: assignments.initiator.id,
    vehicleId: exchange.partnerVehicleId,
  });
  await emitVehicleAssignmentChanged(exchange.partnerDriverId, {
    exchangeId: exchange.id,
    assignmentId: assignments.partner.id,
    vehicleId: exchange.initiatorVehicleId,
  });

  return swapResult;
}

export async function cancelVehicleExchange(
  exchangeId: string,
  driverId: string,
  reason?: string
) {
  const result = await db.transaction(async (tx) => {
    const exchange = await findExchangeByIdForUpdate(tx, exchangeId);
    if (!exchange) {
      throw new VehicleExchangeError('EXCHANGE_CONFLICT', 'Exchange not found', 404);
    }
    if (exchange.status === EXCHANGE_STATUS_CANCELLED) {
      return { exchange, idempotent: true };
    }
    if (exchange.status === EXCHANGE_STATUS_COMPLETED) {
      throw new VehicleExchangeError('EXCHANGE_ALREADY_COMPLETED', 'Exchange already completed', 200);
    }
    if (exchange.status !== EXCHANGE_STATUS_PENDING) {
      throw new VehicleExchangeError('EXCHANGE_CONFLICT', `Exchange is ${exchange.status}`);
    }
    if (
      driverId !== exchange.initiatorDriverId &&
      driverId !== exchange.partnerDriverId
    ) {
      throw new VehicleExchangeError('PARTNER_REQUIRED', 'Not a participant', 403);
    }

    const [cancelled] = await tx
      .update(vehicleExchangeRequests)
      .set({
        status: EXCHANGE_STATUS_CANCELLED,
        cancelledAt: new Date(),
        cancelledByDriverId: driverId,
        cancelReason: reason ?? 'driver_cancelled',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(vehicleExchangeRequests.id, exchangeId),
          eq(vehicleExchangeRequests.status, EXCHANGE_STATUS_PENDING)
        )
      )
      .returning();

    if (!cancelled) {
      throw new VehicleExchangeError('EXCHANGE_CONFLICT', 'Exchange could not be cancelled');
    }

    await releaseResourceLocks(tx, exchangeId);

    await insertExchangeEventTx(tx, {
      exchangeRequestId: exchangeId,
      eventType: 'cancelled',
      actorType: 'driver',
      actorId: driverId,
      payload: { reason: reason ?? 'driver_cancelled' },
    });

    return { exchange: cancelled, idempotent: false };
  });

  await clearDispatchSuspended(result.exchange.initiatorDriverId);
  await clearDispatchSuspended(result.exchange.partnerDriverId);

  const payload = { exchangeId, status: EXCHANGE_STATUS_CANCELLED, reason: reason ?? 'driver_cancelled' };
  await emitExchangeCancelled(result.exchange.initiatorDriverId, payload);
  await emitExchangeCancelled(result.exchange.partnerDriverId, payload);

  return result;
}

export async function expireVehicleExchange(exchangeId: string): Promise<boolean> {
  const result = await db.transaction(async (tx) => {
    const exchange = await findExchangeByIdForUpdate(tx, exchangeId);
    if (!exchange) return null;
    if (exchange.status !== EXCHANGE_STATUS_PENDING) return null;
    if (exchange.expiresAt >= new Date()) return null;

    const [expired] = await tx
      .update(vehicleExchangeRequests)
      .set({
        status: EXCHANGE_STATUS_EXPIRED,
        cancelReason: 'expired',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(vehicleExchangeRequests.id, exchangeId),
          eq(vehicleExchangeRequests.status, EXCHANGE_STATUS_PENDING)
        )
      )
      .returning();

    if (!expired) return null;

    await releaseResourceLocks(tx, exchangeId);

    await insertExchangeEventTx(tx, {
      exchangeRequestId: exchangeId,
      eventType: 'expired',
      actorType: 'system',
      payload: { expiredAt: new Date().toISOString() },
    });

    return expired;
  });

  if (!result) return false;

  await clearDispatchSuspended(result.initiatorDriverId);
  await clearDispatchSuspended(result.partnerDriverId);

  const payload = { exchangeId, status: EXCHANGE_STATUS_EXPIRED };
  await emitExchangeExpired(result.initiatorDriverId, payload);
  await emitExchangeExpired(result.partnerDriverId, payload);
  return true;
}

export async function getCurrentVehicleExchange(driverId: string) {
  const pending = await findPendingExchangeForDriver(driverId);
  if (!pending) return null;

  const role =
    pending.initiatorDriverId === driverId ? ('initiator' as const) : ('partner' as const);
  const partnerId =
    role === 'initiator' ? pending.partnerDriverId : pending.initiatorDriverId;

  return {
    ...mapExchangeResponse(pending, role),
    partner: await summarizePartner(partnerId),
    yourVehicle: await summarizeVehicle(
      role === 'initiator' ? pending.initiatorVehicleId : pending.partnerVehicleId
    ),
    partnerVehicle: await summarizeVehicle(
      role === 'initiator' ? pending.partnerVehicleId : pending.initiatorVehicleId
    ),
  };
}

export async function hasPendingExchange(driverId: string): Promise<boolean> {
  const pending = await findPendingExchangeForDriver(driverId);
  return pending !== null;
}

export async function adminForceCompleteExchange(
  _exchangeId: string,
  _adminId: string,
  isSuperAdmin: boolean
) {
  if (!vehicleExchangeForceCompleteEnabled || !isSuperAdmin) {
    throw new VehicleExchangeError('UNAUTHORIZED', 'Force complete disabled', 403);
  }
  throw new VehicleExchangeError('NOT_IMPLEMENTED', 'Force complete not enabled in v1', 501);
}
