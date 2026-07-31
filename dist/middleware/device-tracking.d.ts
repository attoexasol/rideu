/**
 * Device Tracking Middleware
 *
 * Automatically tracks driver device sessions for single-session enforcement
 * Works with backend session JWTs (sessionId) and Auth0 tokens
 */
import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';
/**
 * Track driver device session
 *
 * For driver requests, this middleware:
 * 1. Accepts tokens whose sessionId matches the driver's activeSessionId (primary check)
 * 2. Validates X-Device-ID against active device when sessionId is unavailable
 * 3. Returns 401 if an older session token is used after login elsewhere
 *
 * Must be used AFTER requireAuth and extractUserInfo middleware
 */
export declare const trackDriverDevice: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<void>;
/**
 * Optional device tracking
 *
 * Same as trackDriverDevice but doesn't fail if no device ID is provided
 */
export declare const optionalDeviceTracking: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<void>;
//# sourceMappingURL=device-tracking.d.ts.map