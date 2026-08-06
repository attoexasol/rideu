import { Response } from 'express';
import { sendError } from '../utils/response';
import { GoogleMapsServiceError } from '../services/googleMaps/errors';

export function handleGoogleMapsError(res: Response, error: unknown): Response {
  if (error instanceof GoogleMapsServiceError) {
    res.locals.errorCode = error.code;
    return sendError(res, error.code, error.message, error.httpStatus);
  }
  if (error instanceof Error && error.message.includes('not configured')) {
    return sendError(
      res,
      'GOOGLE_MAPS_CONFIG_ERROR',
      'Map services are temporarily unavailable.',
      503
    );
  }
  return sendError(
    res,
    'GOOGLE_MAPS_PROVIDER_ERROR',
    'Map services are temporarily unavailable.',
    503
  );
}
