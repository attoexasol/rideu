/**
 * Authentication Middleware
 *
 * Verifies Auth0 JWT tokens (RS256) via JWKS
 * Also accepts backend HS256 session tokens from /api/auth/login
 */
import { Request, Response, NextFunction } from 'express';
/**
 * Extended Express Request with user information
 */
export interface AuthenticatedRequest extends Request {
    auth?: any;
}
/**
 * JWT verification middleware
 *
 * - BYPASS_AUTH=true without token: mock admin (dev only)
 * - With token: verify Auth0 RS256 (JWKS) or backend HS256 session JWT
 */
export declare const verifyJWT: (req: Request, res: Response, next: NextFunction) => Promise<void>;
/**
 * Middleware to require authentication
 */
export declare const requireAuth: (req: Request, res: Response, next: NextFunction) => Promise<void>;
/**
 * Extract user information from the JWT token
 *
 * This middleware should be used AFTER requireAuth
 */
export declare const extractUserInfo: (req: AuthenticatedRequest, res: Response, next: NextFunction) => void;
/**
 * Optional authentication middleware (Auth0 RS256 only)
 */
export declare const optionalAuth: (req: Request, res: Response, next: NextFunction) => void;
/**
 * Middleware to check if user has specific permission
 */
export declare const checkPermission: (permission: string) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => void;
export declare const requireAdmin: (req: AuthenticatedRequest, res: Response, next: NextFunction) => void;
export declare const requireSuperAdmin: (req: AuthenticatedRequest, res: Response, next: NextFunction) => void;
export declare const requireDriverOrAdmin: (paramName?: string) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => void;
//# sourceMappingURL=auth.d.ts.map