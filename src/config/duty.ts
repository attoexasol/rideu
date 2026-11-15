import { getEnvVarAsBoolean } from './env-validator';

/** When true, drivers must have an active duty session + assignment to go online or receive dispatch. */
export const qrDutyRequired = getEnvVarAsBoolean('QR_DUTY_REQUIRED', false);

/** User-visible platform organization display name. Not an ID or slug. */
export const PLATFORM_ORG_NAME = 'DriveWize Platform';
/**
 * Previous display names for the same platform organization (`type = 'platform'`).
 * Used only to locate existing database rows. Never returned as a new label.
 */
export const PLATFORM_ORG_LEGACY_NAMES = ['RYDU Platform'] as const;
export const PLATFORM_FLEET_NAME = 'Platform Fleet';

export const APPROVED_VEHICLE_STATUSES = new Set(['active', 'approved']);

export const ACTIVE_DUTY_STATUS = 'active';
export const ENDED_DUTY_STATUS = 'ended';
export const FORCED_END_DUTY_STATUS = 'forced_end';
