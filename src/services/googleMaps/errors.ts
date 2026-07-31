export type GoogleMapsErrorCode =
  | 'GOOGLE_MAPS_CONFIG_ERROR'
  | 'GOOGLE_MAPS_TIMEOUT'
  | 'GOOGLE_MAPS_QUOTA_EXCEEDED'
  | 'GOOGLE_MAPS_PROVIDER_ERROR'
  | 'NO_ROUTE_FOUND'
  | 'PLACE_NOT_FOUND'
  | 'INVALID_PLACE_ID';

export class GoogleMapsServiceError extends Error {
  readonly code: GoogleMapsErrorCode;
  readonly httpStatus: number;

  constructor(code: GoogleMapsErrorCode, message: string, httpStatus = 503) {
    super(message);
    this.name = 'GoogleMapsServiceError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function mapGoogleStatusToError(status: string, message?: string): GoogleMapsServiceError {
  switch (status) {
    case 'OVER_QUERY_LIMIT':
    case 'RESOURCE_EXHAUSTED':
      return new GoogleMapsServiceError(
        'GOOGLE_MAPS_QUOTA_EXCEEDED',
        'Map services quota exceeded. Please try again later.',
        503
      );
    case 'REQUEST_DENIED':
    case 'INVALID_REQUEST':
      return new GoogleMapsServiceError(
        'GOOGLE_MAPS_CONFIG_ERROR',
        'Map services are temporarily unavailable.',
        503
      );
    case 'NOT_FOUND':
    case 'ZERO_RESULTS':
      return new GoogleMapsServiceError('PLACE_NOT_FOUND', message ?? 'Location not found.', 404);
    default:
      return new GoogleMapsServiceError(
        'GOOGLE_MAPS_PROVIDER_ERROR',
        'Map services are temporarily unavailable.',
        503
      );
  }
}
