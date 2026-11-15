import { Request, Response } from 'express';
import { sendSuccess } from '../utils/response';
import {
  findFareBySession,
  listCalculationEvents,
  listGpsSamples,
  listMeterPauses,
  listMeterSessions,
} from '../repositories/meterSession.repository';
import { listMeterPayments } from '../repositories/meterPayment.repository';
import { findMeterSessionById } from '../repositories/meterSession.repository';
import { MeterError } from '../services/softMeter/errors';
import { toMeterState } from '../services/softMeter/meterSession.service';
import { toAdminMeterPayment } from '../services/softMeter/testPayment';
import {
  activateRateSchedule,
  approveRateSchedule,
  createDraftRateSchedule,
  getRateSchedule,
  listAdminRateSchedules,
  patchDraftRateSchedule,
  retireRateSchedule,
  submitRateSchedule,
} from '../services/softMeter/rateSchedule.service';

function actor(req: Request) {
  const user = (req as { user?: { auth0Id?: string; userId?: string; role?: string } }).user;
  return {
    actorId: user?.auth0Id || user?.userId || null,
    actorRole: user?.role || 'admin',
  };
}

export async function listRateSchedulesHandler(_req: Request, res: Response) {
  return sendSuccess(res, { schedules: await listAdminRateSchedules() });
}

export async function getRateScheduleHandler(req: Request, res: Response) {
  return sendSuccess(res, await getRateSchedule(req.params.scheduleId));
}

export async function createRateScheduleHandler(req: Request, res: Response) {
  const row = await createDraftRateSchedule(req.body, actor(req));
  return sendSuccess(res, { schedule: row }, 201);
}

export async function patchRateScheduleHandler(req: Request, res: Response) {
  const row = await patchDraftRateSchedule(req.params.scheduleId, req.body, actor(req));
  return sendSuccess(res, { schedule: row });
}

export async function submitRateScheduleHandler(req: Request, res: Response) {
  return sendSuccess(res, { schedule: await submitRateSchedule(req.params.scheduleId, actor(req)) });
}

export async function approveRateScheduleHandler(req: Request, res: Response) {
  return sendSuccess(res, { schedule: await approveRateSchedule(req.params.scheduleId, actor(req)) });
}

export async function activateRateScheduleHandler(req: Request, res: Response) {
  return sendSuccess(res, { schedule: await activateRateSchedule(req.params.scheduleId, actor(req)) });
}

export async function retireRateScheduleHandler(req: Request, res: Response) {
  return sendSuccess(res, { schedule: await retireRateSchedule(req.params.scheduleId, actor(req)) });
}

export async function listMeterSessionsHandler(req: Request, res: Response) {
  const query = req.query as {
    status?: string;
    reviewRequired?: string;
    driverId?: string;
    limit?: string;
    offset?: string;
  };
  const sessions = await listMeterSessions({
    status: query.status,
    reviewRequired:
      query.reviewRequired == null ? undefined : query.reviewRequired === 'true',
    driverId: query.driverId,
    limit: Number(query.limit ?? 50),
    offset: Number(query.offset ?? 0),
  });
  return sendSuccess(res, { sessions: sessions.map(toMeterState) });
}

export async function getMeterSessionAdminHandler(req: Request, res: Response) {
  const session = await findMeterSessionById(req.params.sessionId);
  if (!session) throw new MeterError('METER_NOT_FOUND', 'Meter session not found.', 404);
  const [samples, events, fare, pauses] = await Promise.all([
    listGpsSamples(session.id),
    listCalculationEvents(session.id),
    findFareBySession(session.id),
    listMeterPauses(session.id),
  ]);
  return sendSuccess(res, {
    meter: toMeterState(session),
    samples,
    events,
    fare,
    pauses,
  });
}

export async function listMeterReviewsHandler(req: Request, res: Response) {
  const query = req.query as { limit?: string; offset?: string };
  const sessions = await listMeterSessions({
    reviewRequired: true,
    limit: Number(query.limit ?? 50),
    offset: Number(query.offset ?? 0),
  });
  return sendSuccess(res, { sessions: sessions.map(toMeterState) });
}

export async function listMeterPaymentsHandler(req: Request, res: Response) {
  const query = req.query as { status?: string; limit?: string; offset?: string };
  const payments = await listMeterPayments({
    status: query.status,
    limit: Number(query.limit ?? 50),
    offset: Number(query.offset ?? 0),
  });
  return sendSuccess(res, { payments: payments.map(toAdminMeterPayment) });
}
