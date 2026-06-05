/**
 * Authentication Middleware
 *
 * Verifies Auth0 JWT tokens (RS256) in production
 * Also accepts local HS256 tokens in development for testing
 * Uses express-oauth2-jwt-bearer for Auth0 + jsonwebtoken for local tokens
 */
import { Request, Response, NextFunction } from 'express';
/**
 * Extended Express Request with user information
 */
export interface AuthenticatedRequest extends Request {
    auth?: any;
}
/**
 * Dual JWT verification middleware
 *
 * In development: Decodes JWT without full validation (for testing with real tokens)
 * In production: Validates Auth0 RS256 tokens with full signature verification
 * Can optionally bypass authentication if BYPASS_AUTH=true is set
 */
export declare const verifyJWT: (req: Request, res: Response, next: NextFunction) => void;
/**
 * Middleware to require authentication
 *
 * Use this middleware on routes that require a valid JWT token
 * Handles both Auth0 and local JWT tokens in development
 *
 * Usage:
 * router.get('/protected', requireAuth, (req, res) => { ... });
 */
export declare const requireAuth: (req: Request, res: Response, next: NextFunction) => void;
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
export declare const extractUserInfo: (req: AuthenticatedRequest, res: Response, next: NextFunction) => void;
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
export declare const optionalAuth: import("express").Handler;
/**
 * Middleware to check if user has specific permission
 *
 * Usage:
 * router.post('/drivers', requireAuth, extractUserInfo, checkPermission('create:drivers'), (req, res) => { ... });
 */
export declare const checkPermission: (permission: string) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => void;
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
export declare const requireAdmin: (req: AuthenticatedRequest, res: Response, next: NextFunction) => void;
/**
 * Require user to have super_admin role
 *
 * Must be used after extractUserInfo middleware
 *
 * Usage:
 * router.post('/admin/users', requireAuth, extractUserInfo, requireSuperAdmin, (req, res) => { ... });
 */
export declare const requireSuperAdmin: (req: AuthenticatedRequest, res: Response, next: NextFunction) => void;
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
export declare const requireDriverOrAdmin: (paramName?: string) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => void;
//# sourceMappingURL=auth.d.ts.map