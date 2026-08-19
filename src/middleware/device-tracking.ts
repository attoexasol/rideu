/**
 * Device Tracking Middleware
 *
 * Automatically tracks driver device sessions for single-session enforcement
 * Works with backend session JWTs (sessionId) and Auth0 tokens
 */

import { Response, NextFunction } from 'express';
import { driverUtils } from '../db/utils';
import { AuthenticatedRequest } from './auth';
import { isDeactivatedAccount } from '../services/accountStatus.service';

function getAuthPayload(req: AuthenticatedRequest) {
  return req.auth?.payload || req.auth;
}

function logDeviceTrackingContext(req: AuthenticatedRequest, label: string): void {
  const user = (req as any).user;
  const authPayload = getAuthPayload(req);
  console.log(`[DeviceTracking] ${label}`, {
    user: user
      ? {
          userId: user.userId,
          auth0Id: user.auth0Id,
          role: user.role,
          sessionId: user.sessionId,
        }
      : null,
    session: authPayload
      ? {
          sessionId: authPayload.sessionId,
          iat: authPayload.iat,
          sub: authPayload.sub || authPayload.auth0Id,
        }
      : null,
    deviceIdHeader: req.headers['x-device-id'] ?? null,
    path: req.path,
    method: req.method,
  });
}

function rejectSession(res: Response, reason: string, details: Record<string, unknown>): void {
  console.log('[DeviceTracking] ❌ SESSION_INVALID', { reason, ...details });
  res.status(401).json({
    success: false,
    error: {
      code: 'SESSION_INVALID',
      message: 'Your session has been ended. You have been logged in from another device.',
    },
    sessionInvalidated: true,
    reason: 'logged_in_elsewhere',
  });
}

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
export const trackDriverDevice = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    logDeviceTrackingContext(req, 'request');

    const user = (req as any).user;

    // Only track devices for drivers
    if (!user || user.role !== 'driver') {
      return next();
    }

    const deviceId = req.headers['x-device-id'] as string | undefined;
    const deviceInfo = req.headers['x-device-info'] as string | undefined;
    const authPayload = getAuthPayload(req);
    const tokenSessionId = authPayload?.sessionId as string | undefined;
    const tokenIssuedAt = authPayload?.iat ? new Date(Number(authPayload.iat) * 1000) : null;

    if (!deviceId) {
      console.log(
        `[DeviceTracking] ⚠️  Driver ${user.auth0Id} made request without X-Device-ID header (${req.method} ${req.path})`
      );
    }

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

    if (isDeactivatedAccount(driver.accountStatus)) {
      res.status(403).json({
        success: false,
        error: {
          code: 'ACCOUNT_DEACTIVATED',
          message: 'This account has been deactivated',
        },
      });
      return;
    }

    // Backend session JWT matches the active login session — always accept
    if (tokenSessionId && driver.activeSessionId && tokenSessionId === driver.activeSessionId) {
      console.log('[DeviceTracking] ✅ Active session token accepted', {
        sessionId: tokenSessionId,
        activeDeviceId: driver.activeDeviceId,
        requestDeviceId: deviceId ?? null,
      });
      (req as any).driverSessionId = driver.activeSessionId;
      return next();
    }

    // No active session on record — establish one from this request
    if (!driver.activeSessionId || !driver.activeDeviceId) {
      const sessionId =
        tokenSessionId || `sess_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

      console.log('[DeviceTracking] Creating new session', {
        driverId: driver.id,
        sessionId,
        deviceId: deviceId ?? 'unknown',
      });

      await driverUtils.updateSessionInfo(driver.id, {
        activeSessionId: sessionId,
        activeDeviceId: deviceId || 'unknown',
        activeDeviceInfo: deviceInfo || 'Unknown Device',
      });

      (req as any).driverSessionId = sessionId;
      return next();
    }

    // Device matches active session
    if (deviceId && driver.activeDeviceId === deviceId) {
      (req as any).driverSessionId = driver.activeSessionId;
      return next();
    }

    // Different device — only reject stale tokens from a prior login
    console.log('[DeviceTracking] 🔄 Device/session mismatch', {
      driverId: driver.id,
      activeSessionId: driver.activeSessionId,
      tokenSessionId: tokenSessionId ?? null,
      activeDeviceId: driver.activeDeviceId,
      requestDeviceId: deviceId ?? null,
      tokenIssuedAt: tokenIssuedAt?.toISOString() ?? null,
      lastLoginAt: driver.lastLoginAt ? new Date(driver.lastLoginAt).toISOString() : null,
    });

    const lastLoginTime = driver.lastLoginAt ? new Date(driver.lastLoginAt) : null;

    if (tokenSessionId && tokenSessionId !== driver.activeSessionId) {
      rejectSession(res, 'token_session_id_mismatch', {
        tokenSessionId,
        activeSessionId: driver.activeSessionId,
        activeDeviceId: driver.activeDeviceId,
        requestDeviceId: deviceId ?? null,
      });
      return;
    }

    if (tokenIssuedAt && lastLoginTime && tokenIssuedAt < lastLoginTime) {
      rejectSession(res, 'token_iat_before_last_login', {
        tokenIssuedAt: tokenIssuedAt.toISOString(),
        lastLoginAt: lastLoginTime.toISOString(),
        activeDeviceId: driver.activeDeviceId,
        requestDeviceId: deviceId ?? null,
      });
      return;
    }

    // Newer token or Auth0 token without sessionId — allow device takeover
    const newSessionId =
      tokenSessionId || `sess_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

    console.log('[DeviceTracking] ✅ New device/session taking over', {
      newSessionId,
      previousDeviceId: driver.activeDeviceId,
      requestDeviceId: deviceId ?? 'unknown',
    });

    await driverUtils.updateSessionInfo(driver.id, {
      activeSessionId: newSessionId,
      activeDeviceId: deviceId || 'unknown',
      activeDeviceInfo: deviceInfo || 'Unknown Device',
    });

    (req as any).driverSessionId = newSessionId;
    next();
  } catch (error) {
    console.error('[DeviceTracking] Error tracking device:', error);
    next();
  }
};

/**
 * Optional device tracking
 *
 * Same as trackDriverDevice but doesn't fail if no device ID is provided
 */
export const optionalDeviceTracking = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    await trackDriverDevice(req, res, next);
  } catch (error) {
    next();
  }
};
