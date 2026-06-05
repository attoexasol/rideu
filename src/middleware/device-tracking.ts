/**
 * Device Tracking Middleware
 *
 * Automatically tracks driver device sessions for single-session enforcement
 * Works with Auth0 tokens - no need for separate login endpoint
 */

import { Response, NextFunction } from 'express';
import { driverUtils } from '../db/utils';
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
export const trackDriverDevice = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = (req as any).user;

    // Only track devices for drivers
    if (!user || user.role !== 'driver') {
      return next();
    }

    // Get device info from headers
    const deviceId = req.headers['x-device-id'] as string;
    const deviceInfo = req.headers['x-device-info'] as string;

    if (!deviceId) {
      // No device ID provided - allow request but log warning
      console.log(`⚠️  Driver ${user.auth0Id} made request without X-Device-ID header`);
      return next();
    }

    // Find driver in database
    const driver = await driverUtils.findByAuth0Id(user.auth0Id);

    if (!driver) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Driver not found',
        },
      });
      return;
    }

    // Check if this is the first request from this device (no active session)
    if (!driver.activeSessionId || !driver.activeDeviceId) {
      // First login or session expired - create new session
      const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

      console.log(`[DeviceTracking] First request from driver ${driver.id} on device ${deviceId}`);
      console.log(`[DeviceTracking] Creating new session: ${sessionId}`);

      await driverUtils.updateSessionInfo(driver.id, {
        activeSessionId: sessionId,
        activeDeviceId: deviceId,
        activeDeviceInfo: deviceInfo || 'Unknown Device',
      });

      // Attach session ID to request for potential use
      (req as any).driverSessionId = sessionId;

      return next();
    }

    // Check if this device matches the active session
    if (driver.activeDeviceId !== deviceId) {
      // Different device detected - need to determine which one is legitimate
      console.log(`[DeviceTracking] 🔄 Different device detected for driver ${driver.id}`);
      console.log(`[DeviceTracking]    Currently active device: ${driver.activeDeviceId}`);
      console.log(`[DeviceTracking]    Incoming request device: ${deviceId}`);

      // Get Auth0 token payload to check when it was issued
      const authPayload = (req as AuthenticatedRequest).auth?.payload || (req as AuthenticatedRequest).auth;
      const tokenIssuedAt = authPayload?.iat ? new Date(authPayload.iat * 1000) : null;

      // Compare token issue time with last login time
      const lastLoginTime = driver.lastLoginAt ? new Date(driver.lastLoginAt) : null;

      console.log(`[DeviceTracking]    Token issued at: ${tokenIssuedAt?.toISOString() || 'unknown'}`);
      console.log(`[DeviceTracking]    Last login at: ${lastLoginTime?.toISOString() || 'unknown'}`);

      // If we can't determine token age, or token is NEWER than last login, allow takeover
      // If token is OLDER than last login, reject (this is an old session trying to reconnect)
      if (tokenIssuedAt && lastLoginTime && tokenIssuedAt < lastLoginTime) {
        // This token was issued BEFORE the current session - reject it
        console.log(`[DeviceTracking] ❌ Old session rejected (token issued before current session)`);
        res.status(401).json({
          success: false,
          error: {
            code: 'SESSION_INVALID',
            message: 'Your session has been ended. You have been logged in from another device.',
          },
          sessionInvalidated: true,
          reason: 'logged_in_elsewhere',
        });
        return;
      }

      // Token is newer (or we can't tell) - allow takeover
      const newSessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

      console.log(`[DeviceTracking] ✅ New device taking over session`);
      console.log(`[DeviceTracking]    New session ID: ${newSessionId}`);
      console.log(`[DeviceTracking]    Old device ${driver.activeDeviceId} will be logged out on next request`);

      await driverUtils.updateSessionInfo(driver.id, {
        activeSessionId: newSessionId,
        activeDeviceId: deviceId,
        activeDeviceInfo: deviceInfo || 'Unknown Device',
      });

      // Attach new session ID to request
      (req as any).driverSessionId = newSessionId;

      return next();
    }

    // Valid session - device matches active session
    // Attach session ID to request for logging/debugging
    (req as any).driverSessionId = driver.activeSessionId;

    next();
  } catch (error) {
    console.error('[DeviceTracking] Error tracking device:', error);
    // Don't block the request on tracking errors
    next();
  }
};

/**
 * Optional device tracking
 *
 * Same as trackDriverDevice but doesn't fail if no device ID is provided
 * Useful for endpoints that should work with or without device tracking
 */
export const optionalDeviceTracking = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    await trackDriverDevice(req, res, next);
  } catch (error) {
    // Silently continue on errors
    next();
  }
};
