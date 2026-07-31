/**
 * Authentication Middleware
 *
 * Verifies Auth0 JWT tokens (RS256) via JWKS
 * Also accepts backend HS256 session tokens from /api/auth/login
 */

import { Request, Response, NextFunction } from 'express';
import { auth } from 'express-oauth2-jwt-bearer';
import { auth0Config } from '../config/auth0';
import { verifyBearerToken, isAuth0Configured } from '../utils/jwt-verifier';

/**
 * Extended Express Request with user information
 */
export interface AuthenticatedRequest extends Request {
  auth?: any; // JWT payload from either Auth0 or local token
}

/**
 * Lazy-loaded Auth0 JWT verification middleware (RS256) for optionalAuth
 */
let verifyAuth0JWT: ReturnType<typeof auth> | null = null;

const getAuth0Middleware = () => {
  if (!verifyAuth0JWT) {
    if (!auth0Config.domain || auth0Config.domain === '') {
      throw new Error('Auth0 domain not configured. Cannot use Auth0 authentication.');
    }

    verifyAuth0JWT = auth({
      audience: auth0Config.audience,
      issuerBaseURL: `https://${auth0Config.domain}`,
      tokenSigningAlg: auth0Config.tokenSigningAlg,
    });
  }
  return verifyAuth0JWT;
};

const sendAuthFailed = (res: Response, message: string): void => {
  res.status(401).json({
    success: false,
    error: { code: 'AUTH_FAILED', message },
  });
};

/**
 * JWT verification middleware
 *
 * - BYPASS_AUTH=true without token: mock admin (dev only)
 * - With token: verify Auth0 RS256 (JWKS) or backend HS256 session JWT
 */
export const verifyJWT = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const bypassAuth = process.env.BYPASS_AUTH === 'true';
  const authHeader = req.headers.authorization;
  const hasBearerToken = Boolean(authHeader?.startsWith('Bearer '));

  if (bypassAuth && !hasBearerToken) {
    console.log('✓ Auth bypass enabled: Using mock user (set BYPASS_AUTH=false to use Auth0)');
    (req as AuthenticatedRequest).auth = {
      sub: 'dev-admin-1',
      email: 'admin@drivewize.com',
      role: 'super_admin',
    };
    next();
    return;
  }

  if (!hasBearerToken) {
    sendAuthFailed(res, 'No token provided');
    return;
  }

  const token = authHeader!.split(' ')[1];

  try {
    const payload = await verifyBearerToken(token);
    (req as AuthenticatedRequest).auth = payload;
    next();
  } catch (error) {
    sendAuthFailed(res, error instanceof Error ? error.message : 'Invalid or expired token');
  }
};

/**
 * Middleware to require authentication
 */
export const requireAuth = verifyJWT;

/**
 * Extract user information from the JWT token
 *
 * This middleware should be used AFTER requireAuth
 */
export const extractUserInfo = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  try {
    if (!req.auth) {
      res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_FAILED',
          message: 'Authentication required',
        },
      });
      return;
    }

    // Handle both Auth0 JWT format (with payload property) and direct payload
    const authPayload = req.auth.payload || req.auth;

    // Auth0 tokens use `sub`; backend session JWTs from /api/auth/login use `auth0Id`
    const auth0Id = authPayload.sub || authPayload.auth0Id;
    const email = authPayload.email || authPayload['https://drivewize.com/email'];
    const name = authPayload.name || authPayload['https://drivewize.com/name'];

    let role = authPayload.role || authPayload['https://drivewize.com/role'];
    if (!role && authPayload['https://drivewize.com/roles']) {
      role = Array.isArray(authPayload['https://drivewize.com/roles'])
        ? authPayload['https://drivewize.com/roles'][0]
        : authPayload['https://drivewize.com/roles'];
    }

    const permissions =
      authPayload.permissions || authPayload['https://drivewize.com/permissions'] || [];

    const fleetIds =
      authPayload.fleetIds ||
      authPayload['https://drivewize.com/fleet_ids'] ||
      authPayload['https://drivewize.com/fleetIds'] ||
      [];

    (req as any).user = {
      userId: authPayload.userId,
      auth0Id,
      email,
      name,
      role,
      userType: authPayload.userType,
      permissions,
      fleetIds: Array.isArray(fleetIds) ? fleetIds : [],
      sessionId: authPayload.sessionId,
    };

    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Error extracting user information',
      },
    });
  }
};

/**
 * Optional authentication middleware (Auth0 RS256 only)
 */
export const optionalAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (!isAuth0Configured()) {
    next();
    return;
  }
  const auth0Middleware = getAuth0Middleware();
  auth0Middleware(req, res, next);
};

/**
 * Middleware to check if user has specific permission
 */
export const checkPermission = (permission: string) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const user = (req as any).user;

    if (!user || !user.permissions) {
      res.status(403).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Insufficient permissions',
        },
      });
      return;
    }

    if (!user.permissions.includes(permission)) {
      res.status(403).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: `Missing required permission: ${permission}`,
        },
      });
      return;
    }

    next();
  };
};

export const requireAdmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const user = (req as any).user;

  if (!user || !user.role) {
    res.status(403).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Admin access required',
      },
    });
    return;
  }

  const role = user.role.toLowerCase();
  if (role !== 'admin' && role !== 'super_admin') {
    res.status(403).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Admin access required',
      },
    });
    return;
  }

  next();
};

export const requireSuperAdmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const user = (req as any).user;

  if (!user || !user.role) {
    res.status(403).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Super admin access required',
      },
    });
    return;
  }

  const role = user.role.toLowerCase();
  if (role !== 'super_admin') {
    res.status(403).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Super admin access required',
      },
    });
    return;
  }

  next();
};

export const requireDriverOrAdmin = (paramName: string = 'id') => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const user = (req as any).user;

    if (!user) {
      res.status(403).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Access denied',
        },
      });
      return;
    }

    const requestedUserId = req.params[paramName];
    const authenticatedUserId = user.auth0Id;
    const role = user.role?.toLowerCase();

    if (role === 'admin' || role === 'super_admin') {
      return next();
    }

    if (requestedUserId && requestedUserId === authenticatedUserId) {
      return next();
    }

    res.status(403).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'You can only access your own data',
      },
    });
  };
};
