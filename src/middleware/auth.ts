/**
 * Authentication Middleware
 *
 * Verifies Auth0 JWT tokens (RS256) in production
 * Also accepts local HS256 tokens in development for testing
 * Uses express-oauth2-jwt-bearer for Auth0 + jsonwebtoken for local tokens
 */

import { Request, Response, NextFunction } from 'express';
import { auth } from 'express-oauth2-jwt-bearer';
import jwt from 'jsonwebtoken';
import { auth0Config } from '../config/auth0';

/**
 * Extended Express Request with user information
 */
export interface AuthenticatedRequest extends Request {
  auth?: any; // JWT payload from either Auth0 or local token
}

/**
 * Lazy-loaded Auth0 JWT verification middleware (RS256)
 * Only initialized when actually needed (for Auth0 tokens)
 */
let verifyAuth0JWT: any = null;

const getAuth0Middleware = () => {
  if (!verifyAuth0JWT) {
    // Check if Auth0 is configured
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

/**
 * Dual JWT verification middleware
 *
 * In development: Decodes JWT without full validation (for testing with real tokens)
 * In production: Validates Auth0 RS256 tokens with full signature verification
 * Can optionally bypass authentication if BYPASS_AUTH=true is set
 */
export const verifyJWT = (req: Request, res: Response, next: NextFunction): void => {
  // Check if authentication bypass is explicitly enabled
  const bypassAuth = process.env.BYPASS_AUTH === 'true';
  const nodeEnv = process.env.NODE_ENV?.trim();
  const isDev = nodeEnv === 'development' || nodeEnv === 'test';

  if (bypassAuth) {
    // Bypass mode: Use mock admin for testing WITHOUT Auth0
    console.log('✓ Auth bypass enabled: Using mock user (set BYPASS_AUTH=false to use Auth0)');
    (req as AuthenticatedRequest).auth = {
      sub: 'dev-admin-1',
      email: 'admin@drivewize.com',
      role: 'super_admin',
    };
    next();
  } else if (isDev) {
    // Development mode: Decode JWT without full validation
    // This allows testing with real Auth0 tokens without JWKS verification
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({
          success: false,
          error: { code: 'AUTH_FAILED', message: 'No token provided' },
        });
        return;
      }

      const token = authHeader.split(' ')[1];
      const decoded = jwt.decode(token) as any;

      if (!decoded) {
        res.status(401).json({
          success: false,
          error: { code: 'AUTH_FAILED', message: 'Invalid token' },
        });
        return;
      }

      // Attach decoded token to request
      (req as AuthenticatedRequest).auth = decoded;
      next();
    } catch (error) {
      res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_FAILED',
          message: error instanceof Error ? error.message : 'Invalid token',
        },
      });
    }
  } else {
    // Production mode: Validate Auth0 tokens (RS256) with full verification
    console.log('✓ Validating Auth0 token (RS256)');
    const auth0Middleware = getAuth0Middleware();
    auth0Middleware(req, res, next);
  }
};

/**
 * Middleware to require authentication
 *
 * Use this middleware on routes that require a valid JWT token
 * Handles both Auth0 and local JWT tokens in development
 *
 * Usage:
 * router.get('/protected', requireAuth, (req, res) => { ... });
 */
export const requireAuth = verifyJWT;

/**
 * Extract user information from the JWT token
 *
 * This middleware should be used AFTER requireAuth
 * Extracts and normalizes user info from the Auth0 token
 *
 * Usage:
 * router.get('/profile', requireAuth, extractUserInfo, (req, res) => {
 *   const { userId, email, role } = req.user;
 * });
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

    // DEBUG: Log the full token payload
    console.log('=== TOKEN PAYLOAD ===');
    console.log(JSON.stringify(req.auth, null, 2));
    console.log('=== END TOKEN PAYLOAD ===');

    // Handle both Auth0 JWT format (with payload property) and direct payload
    const authPayload = req.auth.payload || req.auth;

    // Extract user info from token
    const auth0Id = authPayload.sub;
    const email = authPayload.email || authPayload['https://drivewize.com/email'];
    const name = authPayload.name || authPayload['https://drivewize.com/name'];

    // Extract role from custom claims (Auth0 rules set this)
    // Role can be in: auth.role, auth['https://drivewize.com/role'], or auth['https://drivewize.com/roles'][0]
    let role = authPayload.role || authPayload['https://drivewize.com/role'];
    if (!role && authPayload['https://drivewize.com/roles']) {
      role = Array.isArray(authPayload['https://drivewize.com/roles'])
        ? authPayload['https://drivewize.com/roles'][0]
        : authPayload['https://drivewize.com/roles'];
    }

    // Extract permissions from token
    const permissions = authPayload.permissions || authPayload['https://drivewize.com/permissions'] || [];

    // Attach normalized user info to request
    (req as any).user = {
      auth0Id,
      email,
      name,
      role,
      permissions,
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
 * Optional authentication middleware
 *
 * Verifies token if present, but doesn't fail if missing
 * Useful for routes that have different behavior for authenticated vs anonymous users
 *
 * Usage:
 * router.get('/public-route', optionalAuth, (req, res) => {
 *   if (req.auth) {
 *     // User is authenticated
 *   } else {
 *     // User is anonymous
 *   }
 * });
 */
export const optionalAuth = auth({
  audience: auth0Config.audience,
  issuerBaseURL: `https://${auth0Config.domain}`,
  tokenSigningAlg: auth0Config.tokenSigningAlg,
});

/**
 * Middleware to check if user has specific permission
 *
 * Usage:
 * router.post('/drivers', requireAuth, extractUserInfo, checkPermission('create:drivers'), (req, res) => { ... });
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

/**
 * Role-based authorization middleware
 */

/**
 * Require user to have admin or super_admin role
 *
 * Must be used after extractUserInfo middleware
 *
 * Usage:
 * router.get('/admin/dashboard', requireAuth, extractUserInfo, requireAdmin, (req, res) => { ... });
 */
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

/**
 * Require user to have super_admin role
 *
 * Must be used after extractUserInfo middleware
 *
 * Usage:
 * router.post('/admin/users', requireAuth, extractUserInfo, requireSuperAdmin, (req, res) => { ... });
 */
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

/**
 * Require user to be accessing their own data or be an admin
 *
 * Checks if the authenticated user is accessing their own resource
 * or has admin privileges
 *
 * Must be used after extractUserInfo middleware
 *
 * The route parameter name for the user ID can be specified
 * Defaults to 'id' or 'driverId'
 *
 * Usage:
 * router.get('/drivers/:driverId', requireAuth, extractUserInfo, requireDriverOrAdmin('driverId'), (req, res) => { ... });
 */
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

    // Admins can access any resource
    if (role === 'admin' || role === 'super_admin') {
      return next();
    }

    // Drivers can only access their own resources
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
