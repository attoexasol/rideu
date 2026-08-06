import { Request, Response, NextFunction } from 'express';
import { logger } from './logger';

const PASSENGER_LOCATION_PATHS = [
  '/api/v1/passenger/places/autocomplete',
  '/api/v1/passenger/places/details',
  '/api/v1/passenger/places/reverse-geocode',
  '/api/v1/passenger/pickup-spots',
  '/api/v1/passenger/routes/preview',
  '/api/v1/passenger/bookings/quote',
];

function normalizePath(path: string): string {
  return (path.split('?')[0] || '/').replace(/\/$/, '') || '/';
}

function isPassengerLocationPath(path: string): boolean {
  const normalized = normalizePath(path);
  return PASSENGER_LOCATION_PATHS.some((candidate) => normalized === candidate);
}

/**
 * Structured timing logs for passenger location-selection flow.
 * Safe for production: no tokens, API keys, or raw coordinates.
 */
export function passengerLocationTiming(req: Request, res: Response, next: NextFunction): void {
  if (!isPassengerLocationPath(req.path)) {
    next();
    return;
  }

  const startedAt = Date.now();
  const user = (req as Request & { user?: { userId?: string; auth0Id?: string } }).user;

  res.on('finish', () => {
    logger.info({
      event: 'passenger.location_flow',
      method: req.method,
      path: normalizePath(req.path),
      userId: user?.userId ?? null,
      auth0Id: user?.auth0Id ?? null,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      externalGoogleMs: res.locals.externalGoogleMs ?? null,
      redisMs: res.locals.redisMs ?? null,
      dbMs: res.locals.dbMs ?? null,
      errorCode: res.locals.errorCode ?? null,
    });
  });

  next();
}
