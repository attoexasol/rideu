import { Request, Response } from 'express';
import { sendError, sendSuccess } from '../utils/response';
import { driverUtils } from '../db/utils';
import { MeterError } from '../services/softMeter/errors';
import {
  cancelCreatedWalkUp,
  createWalkUpTrip,
  endWalkUpTrip,
  listDriverWalkUps,
  requireDriverWalkUp,
  startWalkUpMeter,
} from '../services/softMeter/walkUp.service';
import {
  finalizeOnDemandMeter,
  ingestOnDemandPoints,
  readOnDemandMeter,
  readPassengerMeter,
  startOnDemandMeter,
  stopOnDemandMeter,
} from '../services/softMeter/onDemandMeter.service';
import {
  getMeterSessionForDriver,
  ingestMeterPoints,
  pauseMeterSession,
  resumeMeterSession,
  toMeterState,
} from '../services/softMeter/meterSession.service';
import {
  readWalkUpPayment,
  readWalkUpReceipt,
  requestWalkUpPaymentLink,
} from '../services/softMeter/meterPayment.service';
import type { GpsPointInput } from '../services/softMeter/gps';

async function resolveDriver(req: Request) {
  const user = (req as { user?: { auth0Id?: string } }).user;
  if (!user?.auth0Id) return null;
  return driverUtils.findByAuth0Id(user.auth0Id);
}

function pointsFromBody(body: {
  points: Array<{
    clientPointId: string;
    latitude: number;
    longitude: number;
    accuracyMeters?: number | null;
    speedMps?: number | null;
    recordedAt: string;
  }>;
}): GpsPointInput[] {
  return body.points.map((point) => ({
    clientPointId: point.clientPointId,
    latitude: point.latitude,
    longitude: point.longitude,
    accuracyMeters: point.accuracyMeters ?? null,
    speedMps: point.speedMps ?? null,
    recordedAtMs: Date.parse(point.recordedAt),
  }));
}

export async function createWalkUpHandler(req: Request, res: Response) {
  const driver = await resolveDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  const body = req.body as {
    marketCode?: string;
    pickupLatitude: number;
    pickupLongitude: number;
    passengerLabel?: string;
    idempotencyKey?: string;
  };
  const created = await createWalkUpTrip({
    driverId: driver.id,
    accountStatus: driver.accountStatus,
    legacyVehicleId: driver.vehicleId,
    marketCode: body.marketCode,
    pickupLatitude: body.pickupLatitude,
    pickupLongitude: body.pickupLongitude,
    passengerLabel: body.passengerLabel,
    idempotencyKey: body.idempotencyKey,
  });
  return sendSuccess(res, { trip: created.trip, idempotent: created.idempotent }, created.idempotent ? 200 : 201);
}

export async function listWalkUpHandler(req: Request, res: Response) {
  const driver = await resolveDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  const trips = await listDriverWalkUps(driver.id);
  return sendSuccess(res, { trips });
}

export async function getWalkUpHandler(req: Request, res: Response) {
  const driver = await resolveDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  const trip = await requireDriverWalkUp(req.params.tripId, driver.id);
  return sendSuccess(res, { trip });
}

export async function startWalkUpHandler(req: Request, res: Response) {
  const driver = await resolveDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  const body = (req.body ?? {}) as { idempotencyKey?: string };
  const result = await startWalkUpMeter(req.params.tripId, driver.id, body.idempotencyKey);
  return sendSuccess(res, result);
}

export async function endWalkUpHandler(req: Request, res: Response) {
  const driver = await resolveDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  const result = await endWalkUpTrip(req.params.tripId, driver.id);
  return sendSuccess(res, result);
}

export async function cancelWalkUpHandler(req: Request, res: Response) {
  const driver = await resolveDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  const trip = await cancelCreatedWalkUp(req.params.tripId, driver.id);
  return sendSuccess(res, { trip });
}

export async function walkUpPointsHandler(req: Request, res: Response) {
  const driver = await resolveDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  const trip = await requireDriverWalkUp(req.params.tripId, driver.id);
  const { findMeterByWalkUp } = await import('../repositories/meterSession.repository');
  const session = await findMeterByWalkUp(trip.id);
  if (!session) throw new MeterError('METER_NOT_FOUND', 'Meter session not found.', 404);
  const ingested = await ingestMeterPoints(session.id, driver.id, pointsFromBody(req.body));
  return sendSuccess(res, { meter: toMeterState(ingested.session), results: ingested.results });
}

export async function walkUpPaymentLinkHandler(req: Request, res: Response) {
  const driver = await resolveDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  const result = await requestWalkUpPaymentLink(req.params.tripId, driver.id);
  return sendSuccess(res, result);
}

export async function walkUpPaymentHandler(req: Request, res: Response) {
  const driver = await resolveDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  return sendSuccess(res, await readWalkUpPayment(req.params.tripId, driver.id));
}

export async function walkUpReceiptHandler(req: Request, res: Response) {
  const driver = await resolveDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  return sendSuccess(res, await readWalkUpReceipt(req.params.tripId, driver.id));
}

export async function activeMeterHandler(req: Request, res: Response) {
  const driver = await resolveDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  const { findOpenMeterByDriver } = await import('../repositories/meterSession.repository');
  const session = await findOpenMeterByDriver(driver.id);
  return sendSuccess(res, { meter: session ? toMeterState(session) : null });
}

export async function meterPointsHandler(req: Request, res: Response) {
  const driver = await resolveDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  const session = await getMeterSessionForDriver(req.params.sessionId, driver.id);
  const ingested = await ingestMeterPoints(session.id, driver.id, pointsFromBody(req.body));
  return sendSuccess(res, { meter: toMeterState(ingested.session), results: ingested.results });
}

export async function meterStateHandler(req: Request, res: Response) {
  const driver = await resolveDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  const session = await getMeterSessionForDriver(req.params.sessionId, driver.id);
  return sendSuccess(res, { meter: toMeterState(session) });
}

export async function pauseMeterHandler(req: Request, res: Response) {
  const driver = await resolveDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  const body = (req.body ?? {}) as { idempotencyKey?: string };
  const result = await pauseMeterSession(req.params.sessionId, driver.id, body.idempotencyKey);
  return sendSuccess(res, { meter: toMeterState(result.session), idempotent: result.idempotent });
}

export async function resumeMeterHandler(req: Request, res: Response) {
  const driver = await resolveDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  const result = await resumeMeterSession(req.params.sessionId, driver.id);
  return sendSuccess(res, { meter: toMeterState(result.session), idempotent: result.idempotent });
}

export async function startBookingMeterHandler(req: Request, res: Response) {
  const driver = await resolveDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  const body = (req.body ?? {}) as { idempotencyKey?: string };
  const result = await startOnDemandMeter(req.params.bookingId, driver.id, body.idempotencyKey);
  return sendSuccess(res, result);
}

export async function readBookingMeterHandler(req: Request, res: Response) {
  const driver = await resolveDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  return sendSuccess(res, await readOnDemandMeter(req.params.bookingId, driver.id));
}

export async function stopBookingMeterHandler(req: Request, res: Response) {
  const driver = await resolveDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  const body = (req.body ?? {}) as { idempotencyKey?: string };
  return sendSuccess(res, await stopOnDemandMeter(req.params.bookingId, driver.id, body.idempotencyKey));
}

export async function finalizeBookingMeterHandler(req: Request, res: Response) {
  const driver = await resolveDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  return sendSuccess(res, await finalizeOnDemandMeter(req.params.bookingId, driver.id));
}

export async function bookingMeterPointsHandler(req: Request, res: Response) {
  const driver = await resolveDriver(req);
  if (!driver) return sendError(res, 'NOT_FOUND', 'Driver not found', 404);
  return sendSuccess(
    res,
    await ingestOnDemandPoints(req.params.bookingId, driver.id, pointsFromBody(req.body))
  );
}

export async function passengerMeterHandler(req: Request, res: Response) {
  const user = (req as { user?: { userId?: string } }).user;
  if (!user?.userId) return sendError(res, 'NOT_FOUND', 'Passenger not found', 404);
  return sendSuccess(res, await readPassengerMeter(req.params.bookingId, user.userId));
}
