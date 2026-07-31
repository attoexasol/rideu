import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { getCurrentTripForAuth0Driver } from '../services/trip.service';
import { sendError, sendNotFound, sendSuccess } from '../utils/response';

export async function getCurrentTripHandler(
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> {
  const user = (req as any).user as { auth0Id?: string };

  if (!user.auth0Id) {
    return sendError(res, 'UNAUTHORIZED', 'Authentication required', 401);
  }

  const { driverMissing, trip } = await getCurrentTripForAuth0Driver(user.auth0Id);

  if (driverMissing) {
    return sendNotFound(res, 'Driver');
  }

  if (!trip) {
    return sendError(res, 'NOT_FOUND', 'No active trip', 404);
  }

  return sendSuccess(res, trip);
}
