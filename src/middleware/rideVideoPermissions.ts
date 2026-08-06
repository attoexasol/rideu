import { Response, NextFunction } from 'express';
import {
  RideVideoPermission,
  hasRideVideoPermission,
} from '../constants/rideVideoPermissions';
import { AuthenticatedRequest } from './auth';

/**
 * Require an authenticated admin with the given ride_video.* permission.
 * Must run after requireAuth + extractUserInfo + requireAdmin.
 */
export function requireRideVideoPermission(permission: RideVideoPermission) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const user = (req as AuthenticatedRequest & {
      user?: { role?: string | null; permissions?: unknown };
    }).user;
    if (!user) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication required',
          retryable: false,
        },
      });
      return;
    }

    if (!hasRideVideoPermission(user, permission)) {
      res.status(403).json({
        success: false,
        error: {
          code: 'MISSING_PERMISSION',
          message: `Missing permission: ${permission}`,
          retryable: false,
          details: { required: permission },
        },
      });
      return;
    }

    next();
  };
}
