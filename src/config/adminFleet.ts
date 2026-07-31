import { getEnvVarAsNumber } from './env-validator';

export const ADMIN_FLEET_VEHICLE_LIST_DEFAULT_LIMIT = 100;
export const ADMIN_FLEET_VEHICLE_LIST_MAX_LIMIT = getEnvVarAsNumber(
  'ADMIN_FLEET_VEHICLE_LIST_MAX_LIMIT',
  1000
);
