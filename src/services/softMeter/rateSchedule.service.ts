import {
  DRAFT_SOFT_METER_RATES,
  RateScheduleStatus,
  unconfiguredMeterRules,
  type MeterRules,
} from '../../constants/softMeter';
import { countSessionsForSchedule } from '../../repositories/meterSession.repository';
import {
  findRateScheduleById,
  insertRateSchedule,
  insertRateScheduleEvent,
  listRateScheduleEvents,
  listRateSchedules,
  nextRateScheduleVersion,
  retireActiveSchedules,
  updateRateSchedule,
} from '../../repositories/meterRateSchedule.repository';
import { MeterError } from './errors';
import {
  assertChargingReleaseAllowed,
  assertScheduleEditable,
  assertValidRateDefinition,
  normalizeMeterRules,
  transitionScheduleStatus,
  type RateDefinition,
} from './rules';

export interface RateScheduleActor {
  actorId: string | null;
  actorRole: string | null;
}

function definitionFromInput(input: {
  currency?: string;
  flagDropCents?: number;
  distanceRateCentsPerMile?: number;
  distanceIncrementMicroMiles?: number;
  distanceIncrementCents?: number;
  waitingCentsPerHour?: number;
  waitingCentsPerMinute?: number;
  rules?: Partial<MeterRules>;
}): RateDefinition {
  return {
    currency: (input.currency ?? DRAFT_SOFT_METER_RATES.currency).toUpperCase(),
    flagDropCents: input.flagDropCents ?? DRAFT_SOFT_METER_RATES.flagDropCents,
    distanceRateCentsPerMile:
      input.distanceRateCentsPerMile ?? DRAFT_SOFT_METER_RATES.distanceRateCentsPerMile,
    distanceIncrementMicroMiles:
      input.distanceIncrementMicroMiles ?? DRAFT_SOFT_METER_RATES.distanceIncrementMicroMiles,
    distanceIncrementCents:
      input.distanceIncrementCents ?? DRAFT_SOFT_METER_RATES.distanceIncrementCents,
    waitingCentsPerHour: input.waitingCentsPerHour ?? DRAFT_SOFT_METER_RATES.waitingCentsPerHour,
    waitingCentsPerMinute:
      input.waitingCentsPerMinute ?? DRAFT_SOFT_METER_RATES.waitingCentsPerMinute,
    chargingEnabled: false,
    rules: normalizeMeterRules(input.rules ?? unconfiguredMeterRules()),
  };
}

async function audit(
  scheduleId: string,
  action: string,
  actor: RateScheduleActor,
  payload: Record<string, unknown>
) {
  await insertRateScheduleEvent({
    scheduleId,
    action,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    payload,
  });
}

export async function createDraftRateSchedule(
  input: {
    code: string;
    name: string;
    currency?: string;
    flagDropCents?: number;
    distanceRateCentsPerMile?: number;
    distanceIncrementMicroMiles?: number;
    distanceIncrementCents?: number;
    waitingCentsPerHour?: number;
    waitingCentsPerMinute?: number;
    rules?: Partial<MeterRules>;
  },
  actor: RateScheduleActor
) {
  const definition = definitionFromInput(input);
  assertValidRateDefinition(definition);
  const version = await nextRateScheduleVersion(input.code);
  const row = await insertRateSchedule({
    code: input.code.trim(),
    name: input.name.trim(),
    version,
    status: RateScheduleStatus.DRAFT,
    ...definition,
    createdBy: actor.actorId,
  });
  await audit(row.id, 'draft_created', actor, { version, code: row.code });
  return row;
}

export async function patchDraftRateSchedule(
  id: string,
  input: {
    name?: string;
    currency?: string;
    flagDropCents?: number;
    distanceRateCentsPerMile?: number;
    distanceIncrementMicroMiles?: number;
    distanceIncrementCents?: number;
    waitingCentsPerHour?: number;
    waitingCentsPerMinute?: number;
    rules?: Partial<MeterRules>;
    chargingEnabled?: boolean;
  },
  actor: RateScheduleActor
) {
  if (input.chargingEnabled) assertChargingReleaseAllowed();
  const current = await findRateScheduleById(id);
  if (!current) throw new MeterError('RATE_SCHEDULE_NOT_FOUND', 'Rate schedule not found.', 404);
  const sessionCount = await countSessionsForSchedule(id);
  assertScheduleEditable({
    status: current.status as 'draft',
    sessionCount,
  });
  const definition = definitionFromInput({
    currency: input.currency ?? current.currency,
    flagDropCents: input.flagDropCents ?? current.flagDropCents,
    distanceRateCentsPerMile: input.distanceRateCentsPerMile ?? current.distanceRateCentsPerMile,
    distanceIncrementMicroMiles:
      input.distanceIncrementMicroMiles ?? current.distanceIncrementMicroMiles,
    distanceIncrementCents: input.distanceIncrementCents ?? current.distanceIncrementCents,
    waitingCentsPerHour: input.waitingCentsPerHour ?? current.waitingCentsPerHour,
    waitingCentsPerMinute: input.waitingCentsPerMinute ?? current.waitingCentsPerMinute,
    rules: input.rules ?? current.rules,
  });
  assertValidRateDefinition(definition);
  const updated = await updateRateSchedule(id, {
    name: input.name?.trim() ?? current.name,
    ...definition,
    chargingEnabled: false,
  });
  await audit(id, 'draft_updated', actor, { version: current.version });
  return updated;
}

async function transition(
  id: string,
  action: 'submit' | 'approve' | 'activate' | 'retire',
  actor: RateScheduleActor
) {
  const current = await findRateScheduleById(id);
  if (!current) throw new MeterError('RATE_SCHEDULE_NOT_FOUND', 'Rate schedule not found.', 404);
  const next = transitionScheduleStatus(current.status as 'draft', action);
  if (action === 'activate') {
    await retireActiveSchedules(current.code, current.id, actor.actorId);
  }
  const now = new Date();
  const patch =
    action === 'submit'
      ? { status: next, submittedAt: now, submittedBy: actor.actorId }
      : action === 'approve'
        ? { status: next, approvedAt: now, approvedBy: actor.actorId }
        : action === 'activate'
          ? { status: next, activatedAt: now, activatedBy: actor.actorId, chargingEnabled: false }
          : { status: next, retiredAt: now, retiredBy: actor.actorId };
  const updated = await updateRateSchedule(id, patch);
  await audit(id, action, actor, { from: current.status, to: next, version: current.version });
  return updated;
}

export const submitRateSchedule = (id: string, actor: RateScheduleActor) =>
  transition(id, 'submit', actor);
export const approveRateSchedule = (id: string, actor: RateScheduleActor) =>
  transition(id, 'approve', actor);
export const activateRateSchedule = (id: string, actor: RateScheduleActor) =>
  transition(id, 'activate', actor);
export const retireRateSchedule = (id: string, actor: RateScheduleActor) =>
  transition(id, 'retire', actor);

export async function getRateSchedule(id: string) {
  const row = await findRateScheduleById(id);
  if (!row) throw new MeterError('RATE_SCHEDULE_NOT_FOUND', 'Rate schedule not found.', 404);
  const events = await listRateScheduleEvents(id);
  return { schedule: row, events };
}

export async function listAdminRateSchedules() {
  return listRateSchedules();
}
