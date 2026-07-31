import { getEnvVarAsBoolean } from './env-validator';

/** When true, drivers must have an active duty session + assignment to go online or receive dispatch. */
export const qrDutyRequired = getEnvVarAsBoolean('QR_DUTY_REQUIRED', false);

export const PLATFORM_ORG_NAME = 'RYDU Platform';
export const PLATFORM_FLEET_NAME = 'Platform Fleet';

export const APPROVED_VEHICLE_STATUSES = new Set(['active', 'approved']);

export const ACTIVE_DUTY_STATUS = 'active';
export const ENDED_DUTY_STATUS = 'ended';
export const FORCED_END_DUTY_STATUS = 'forced_end';
