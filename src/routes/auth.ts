/**
 * Authentication Routes
 *
 * POST /api/auth/login - Login with Auth0 token
 * POST /api/auth/refresh - Refresh JWT token
 * POST /api/auth/logout - Logout and destroy session
 * GET /api/auth/me - Get current user info
 */

import express from 'express';
import { requireAuth, extractUserInfo, AuthenticatedRequest } from '../middleware/auth';
import { validate, loginSchema, refreshTokenSchema } from '../validators';
import { sendSuccess, sendError } from '../utils/response';
import { asyncHandler } from '../middleware/error-handler';
import { authRateLimiter } from '../middleware/rate-limiters';
import { driverUtils, adminUtils, sessionUtils } from '../db/utils';
import jwt from 'jsonwebtoken';
import { verifyAuth0Token, isAuth0Configured } from '../utils/jwt-verifier';
import { isDeactivatedAccount } from '../services/accountStatus.service';

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

/**
 * POST /api/auth/login
 * Verify Auth0 token and create session
 */
router.post(
  '/login',
  authRateLimiter,
  validate(loginSchema),
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const { auth0Token, deviceId, deviceInfo } = req.body;

    // In a real implementation, verify the Auth0 token here
    // For now, we'll extract info from the Auth0 token payload
    // The Auth0 token should already be verified by the client

    try {
      // Verify Auth0 RS256 token via JWKS when configured
      let decoded: any;
      if (isAuth0Configured()) {
        decoded = await verifyAuth0Token(auth0Token);
      } else {
        decoded = jwt.decode(auth0Token) as any;
      }

      if (!decoded || !decoded.sub) {
        return sendError(res, 'AUTH_FAILED', 'Invalid Auth0 token', 401);
      }

      const auth0Id = decoded.sub;
      const email = decoded.email;
      const name = decoded.name;
      const role = decoded['https://drivewize.com/role'] || decoded.role;

      // Check if user is a driver or admin
      let user: any = null;
      let userType: 'driver' | 'admin' | 'customer' = 'driver';

      if (role === 'driver') {
        user = await driverUtils.findByAuth0Id(auth0Id);
        userType = 'driver';
      } else if (role === 'customer') {
        const { findCustomerByAuth0Id } = await import('../repositories/customer.repository');
        user = await findCustomerByAuth0Id(auth0Id);
        userType = 'customer';
      } else if (role === 'admin' || role === 'super_admin') {
        user = await adminUtils.findByAuth0Id(auth0Id);
        userType = 'admin';
      }

      if (!user) {
        return sendError(res, 'NOT_FOUND', 'User not found in database', 404);
      }

      if (userType === 'driver' && isDeactivatedAccount(user.accountStatus)) {
        return sendError(res, 'ACCOUNT_DEACTIVATED', 'This account has been deactivated', 403);
      }
      if (userType === 'customer' && isDeactivatedAccount(user.status)) {
        return sendError(res, 'ACCOUNT_DEACTIVATED', 'This account has been deactivated', 403);
      }

      // Generate session ID and local JWT token FIRST (before session cleanup)
      const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
      const tokenToCreate = jwt.sign(
        {
          userId: user.id,
          auth0Id,
          email,
          name,
          role,
          userType,
          sessionId, // Include session ID in token
          permissions: [],
        },
        JWT_SECRET as jwt.Secret,
        {
          expiresIn: JWT_EXPIRES_IN,
          algorithm: 'HS256',
        } as jwt.SignOptions
      );

      // For drivers, enforce single-session policy
      if (userType === 'driver') {
        console.log(`[Auth] Enforcing single-session for driver ${user.id} (${user.name})`);

        // Check if driver has an active session on another device
        const existingSessionId = user.activeSessionId;
        const existingDeviceId = user.activeDeviceId;

        if (existingSessionId && existingDeviceId && existingDeviceId !== deviceId) {
          console.log(`[Auth] Driver ${user.id} has active session on device ${existingDeviceId}`);
          console.log(`[Auth] Terminating old session and logging in on new device ${deviceId}`);
          await sessionUtils.deleteAllForUser(user.id);
        }

        try {
          const { onDriverSessionReplaced } = await import('../services/driverPushToken.service');
          await onDriverSessionReplaced({
            driverId: user.id,
            newDeviceId: deviceId || 'unknown',
            newSessionId: sessionId,
            previousDeviceId: existingDeviceId,
          });
        } catch (error) {
          console.warn('[Auth] Failed to update driver push targets', {
            driverId: user.id,
            message: error instanceof Error ? error.message : 'unknown',
          });
        }

        // Update driver's session info with new device
        await driverUtils.updateSessionInfo(user.id, {
          activeSessionId: sessionId,
          activeDeviceId: deviceId || 'unknown',
          activeDeviceInfo: deviceInfo || 'Unknown Device',
        });
      }

      // Create session in database with the token we generated
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      await sessionUtils.create({
        userId: user.id,
        userType,
        token: tokenToCreate,
        expiresAt,
      });

      // Return token and user info
      return sendSuccess(
        res,
        {
          token: tokenToCreate,
          sessionId, // Return session ID for client to use
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role,
          },
        },
        200
      );
    } catch (error) {
      console.error('Login error:', error);
      return sendError(res, 'AUTH_FAILED', 'Authentication failed', 401);
    }
  })
);

/**
 * POST /api/auth/refresh
 * Refresh JWT token
 */
router.post(
  '/refresh',
  authRateLimiter,
  validate(refreshTokenSchema),
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const { refreshToken } = req.body;

    try {
      // Verify the refresh token
      const decoded = jwt.verify(refreshToken, JWT_SECRET) as any;

      // Generate new access token
      const newToken = jwt.sign(
        {
          userId: decoded.userId,
          auth0Id: decoded.auth0Id,
          email: decoded.email,
          name: decoded.name,
          role: decoded.role,
          userType: decoded.userType,
        },
        JWT_SECRET as jwt.Secret,
        { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
      );

      // Generate new refresh token
      const newRefreshToken = jwt.sign(
        {
          userId: decoded.userId,
          auth0Id: decoded.auth0Id,
        },
        JWT_SECRET as jwt.Secret,
        { expiresIn: '7d' } as jwt.SignOptions
      );

      return sendSuccess(res, {
        token: newToken,
        refreshToken: newRefreshToken,
      });
    } catch (error) {
      return sendError(res, 'AUTH_FAILED', 'Invalid or expired refresh token', 401);
    }
  })
);

/**
 * POST /api/auth/logout
 * Logout and destroy session
 */
router.post(
  '/logout',
  requireAuth,
  extractUserInfo,
  asyncHandler(async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const user = (req as any).user;

      // Get token from Authorization header
      const authHeader = req.headers.authorization;
      const token = authHeader?.split(' ')[1];

      if (token) {
        // Delete session from database
        await sessionUtils.deleteByToken(token);
      }

      // For drivers, clear session info from driver record
      if (user && user.role === 'driver') {
        await driverUtils.clearSessionInfo(user.userId);
        try {
          const { invalidateDriverPushTargets } = await import('../services/driverPushToken.service');
          await invalidateDriverPushTargets(user.userId);
        } catch (error) {
          console.warn('[Auth] Failed to invalidate driver push targets on logout', {
            driverId: user.userId,
            message: error instanceof Error ? error.message : 'unknown',
          });
        }
        console.log(`[Auth] Cleared session info for driver ${user.userId}`);
      }

      return sendSuccess(res, { message: 'Logged out successfully' });
    } catch (error) {
      console.error('Logout error:', error);
      return sendError(res, 'SERVER_ERROR', 'Logout failed', 500);
    }
  })
);

/**
 * GET /api/auth/validate-session
 * Validate if the current session is still active
 * For drivers, this checks if they haven't been logged out due to another login
 */
router.get(
  '/validate-session',
  requireAuth,
  extractUserInfo,
  asyncHandler(async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const user = (req as any).user;

      // Get token from Authorization header
      const authHeader = req.headers.authorization;
      const token = authHeader?.split(' ')[1];

      if (!token) {
        return sendError(res, 'AUTH_FAILED', 'No token provided', 401);
      }

      // Decode token to get session ID
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      const tokenSessionId = decoded.sessionId;

      // Check if session exists in database
      const session = await sessionUtils.findByToken(token);

      if (!session) {
        // Session has been deleted (force logout)
        return sendSuccess(res, {
          valid: false,
          reason: 'Session invalidated - new login detected on another device',
        });
      }

      // For drivers, check if the session ID matches the active session
      if (user && user.role === 'driver') {
        const driver = await driverUtils.findByAuth0Id(user.auth0Id);

        if (!driver) {
          return sendSuccess(res, {
            valid: false,
            reason: 'Driver not found',
          });
        }

        // Check if this session matches the driver's active session
        if (driver.activeSessionId !== tokenSessionId) {
          console.log(
            `[Auth] Session mismatch for driver ${driver.id}: token has ${tokenSessionId}, active is ${driver.activeSessionId}`
          );
          return sendSuccess(res, {
            valid: false,
            reason: 'Session invalidated - logged in from another device',
          });
        }
      }

      // Session is valid
      return sendSuccess(res, {
        valid: true,
        expiresAt: session.expiresAt,
      });
    } catch (error) {
      console.error('Session validation error:', error);
      return sendError(res, 'SERVER_ERROR', 'Failed to validate session', 500);
    }
  })
);

/**
 * GET /api/auth/me
 * Get current authenticated user info
 */
router.get(
  '/me',
  requireAuth,
  extractUserInfo,
  asyncHandler(async (req: AuthenticatedRequest, res: express.Response) => {
    const user = (req as any).user;

    if (!user) {
      return sendError(res, 'AUTH_FAILED', 'User not found', 401);
    }

    console.log('[/api/auth/me] Looking up user:', {
      auth0Id: user.auth0Id,
      email: user.email,
      role: user.role,
    });

    // Get full user data from database
    let userData: any = null;

    if (user.role === 'driver') {
      userData = await driverUtils.findByAuth0Id(user.auth0Id);
      console.log('[/api/auth/me] Driver lookup result:', userData ? 'FOUND' : 'NOT FOUND');
    } else if (user.role === 'admin' || user.role === 'super_admin') {
      userData = await adminUtils.findByAuth0Id(user.auth0Id);
      console.log('[/api/auth/me] Admin lookup result:', userData ? 'FOUND' : 'NOT FOUND');
    }

    if (!userData) {
      console.log('[/api/auth/me] User not found in database');
      return sendError(res, 'NOT_FOUND', 'User not found', 404);
    }

    console.log('[/api/auth/me] Returning user data:', { id: userData.id, email: userData.email });

    return sendSuccess(res, {
      id: userData.id,
      email: userData.email,
      name: userData.name,
      role: user.role,
      status: userData.status,
    });
  })
);

export default router;
