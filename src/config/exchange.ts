import { getEnvVarAsNumber, getEnvVarAsBoolean } from './env-validator';

export const EXCHANGE_STATUS_PENDING = 'pending';
export const EXCHANGE_STATUS_COMPLETED = 'completed';
export const EXCHANGE_STATUS_CANCELLED = 'cancelled';
export const EXCHANGE_STATUS_EXPIRED = 'expired';
export const EXCHANGE_STATUS_FAILED = 'failed';

export const TERMINAL_EXCHANGE_STATUSES = new Set([
  EXCHANGE_STATUS_COMPLETED,
  EXCHANGE_STATUS_CANCELLED,
  EXCHANGE_STATUS_EXPIRED,
  EXCHANGE_STATUS_FAILED,
]);

export const vehicleExchangeTtlSeconds = getEnvVarAsNumber(
  'VEHICLE_EXCHANGE_TTL_SECONDS',
  300
);

export const vehicleExchangeForceCompleteEnabled = getEnvVarAsBoolean(
  'VEHICLE_EXCHANGE_FORCE_COMPLETE_ENABLED',
  false
);

export const LOCK_RESOURCE_DRIVER = 'driver';
export const LOCK_RESOURCE_VEHICLE = 'vehicle';
