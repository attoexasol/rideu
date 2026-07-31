import { getEnvVarAsNumber } from './env-validator';

/**
 * Dispatch and driver eligibility configuration.
 * Override via environment variables in production.
 */
export const dispatchConfig = {
  driverLocationStaleSeconds: getEnvVarAsNumber('DRIVER_LOCATION_STALE_SECONDS', 120),
  dispatchRadiusKm: getEnvVarAsNumber('DISPATCH_RADIUS_KM', 15),
  dispatchBatchSize: getEnvVarAsNumber('DISPATCH_BATCH_SIZE', 5),
  dispatchOfferTimeoutSeconds: getEnvVarAsNumber('DISPATCH_OFFER_TIMEOUT_SECONDS', 45),
  dispatchMaxBatches: getEnvVarAsNumber('DISPATCH_MAX_BATCHES', 3),
};
