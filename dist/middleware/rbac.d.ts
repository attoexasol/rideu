/**
 * Role-Based Access Control (RBAC) Middleware
 *
 * Enforces role-based access control for API endpoints
 * Roles: driver, admin, super_admin
 *
 * Usage:
 * - requireRole(['admin']): Only admins can access
 * - requireRole(['admin', 'super_admin']): Admins or super_admins can access
 * - requireRole(['driver']): Only drivers can access
 */
import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';
/**
 * Extended Request with user information
 */
interface UserRequest extends AuthenticatedRequest {
    user?: {
        auth0Id: string;
        email?: string;
        name?: string;
        role?: string;
        permissions?: string[];
    };
}
/**
 * Middleware to require specific role(s)
 *
 * @param allowedRoles - Array of roles that can access the endpoint
 *
 * Usage:
 * router.get('/admin/users', requireAuth, extractUserInfo, requireRole(['admin', 'super_admin']), (req, res) => { ... });
 */
export declare const requireRole: (allowedRoles: string[]) => (req: UserRequest, res: Response, next: NextFunction) => void;
/**
 * Middleware to allow only admins and super admins
 *
 * Shorthand for requireRole(['admin', 'super_admin'])
 *
 * Usage:
 * router.get('/drivers', requireAuth, extractUserInfo, requireAdmin, (req, res) => { ... });
 */
export declare const requireAdmin: (req: UserRequest, res: Response, next: NextFunction) => void;
/**
 * Middleware to allow only super admins
 *
 * Usage:
 * router.post('/admin/users', requireAuth, extractUserInfo, requireSuperAdmin, (req, res) => { ... });
 */
export declare const requireSuperAdmin: (req: UserRequest, res: Response, next: NextFunction) => void;
/**
 * Middleware to allow only drivers
 * Automatically includes device tracking for single-session enforcement
 *
 * Usage:
 * router.post('/locations', requireAuth, extractUserInfo, requireDriver, (req, res) => { ... });
 */
export declare const requireDriver: ((req: UserRequest, res: Response, next: NextFunction) => void)[];
/**
 * Middleware to ensure user can only access their own resources
 *
 * Checks if the requested resource ID matches the authenticated user's ID
 * Admins and super_admins bypass this check (can access any resource)
 *
 * @param paramName - The name of the route parameter containing the resource ID (default: 'id' or 'driverId')
 *
 * Usage:
 * router.get('/drivers/:id/trips', requireAuth, extractUserInfo, requireOwnResource('id'), (req, res) => { ... });
 * // Driver can only access their own trips
 * // Admins can access any driver's trips
 */
export declare const requireOwnResource: (paramName?: string) => (req: UserRequest, res: Response, next: NextFunction) => Promise<void>;
/**
 * Check if user is an admin or super_admin
 *
 * Utility function (not middleware)
 */
export declare const isAdmin: (role?: string) => boolean;
/**
 * Check if user is a super_admin
 *
 * Utility function (not middleware)
 */
export declare const isSuperAdmin: (role?: string) => boolean;
/**
 * Check if user is a driver
 *
 * Utility function (not middleware)
 */
export declare const isDriver: (role?: string) => boolean;
/**
 * Get user role hierarchy level
 *
 * Higher number = more privileges
 * super_admin > admin > driver
 */
export declare const getRoleLevel: (role?: string) => number;
/**
 * Check if user has sufficient role level
 *
 * @param userRole - User's current role
 * @param requiredRole - Minimum required role
 * @returns true if user role level >= required role level
 */
export declare const hasRoleLevel: (userRole?: string, requiredRole?: string) => boolean;
export {};
//# sourceMappingURL=rbac.d.ts.map