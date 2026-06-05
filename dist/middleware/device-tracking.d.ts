/**
 * Device Tracking Middleware
 *
 * Automatically tracks driver device sessions for single-session enforcement
 * Works with Auth0 tokens - no need for separate login endpoint
 */
import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';
/**
 * Track driver device session
 *
 * For driver requests, this middleware:
 * 1. Checks if device ID is provided in headers
 * 2. Validates the device matches the active session using Auth0 token timestamps
 * 3. Returns 401 if another device has taken over the session
 *
 * Must be used AFTER requireAuth and extractUserInfo middleware
 *
 * Expected headers:
 * - X-Device-ID: Unique device identifier
 * - X-Device-Info: Human-readable device info (optional)
 *
 * Usage:
 * router.get('/api/drivers/me', requireAuth, extractUserInfo, trackDriverDevice, (req, res) => { ... });
 */
export declare const trackDriverDevice: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<void>;
/**
 * Optional device tracking
 *
 * Same as trackDriverDevice but doesn't fail if no device ID is provided
 * Useful for endpoints that should work with or without device tracking
 */
export declare const optionalDeviceTracking: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<void>;
//# sourceMappingURL=device-tracking.d.ts.map