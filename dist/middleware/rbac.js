"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasRoleLevel = exports.getRoleLevel = exports.isDriver = exports.isSuperAdmin = exports.isAdmin = exports.requireOwnResource = exports.requireDriver = exports.requireSuperAdmin = exports.requireAdmin = exports.requireRole = void 0;
const auth0_1 = require("../config/auth0");
const device_tracking_1 = require("./device-tracking");
/**
 * Middleware to require specific role(s)
 *
 * @param allowedRoles - Array of roles that can access the endpoint
 *
 * Usage:
 * router.get('/admin/users', requireAuth, extractUserInfo, requireRole(['admin', 'super_admin']), (req, res) => { ... });
 */
const requireRole = (allowedRoles) => {
    return (req, res, next) => {
        try {
            // Ensure user is authenticated
            if (!req.user || !req.user.role) {
                res.status(401).json({
                    success: false,
                    error: {
                        code: 'AUTH_FAILED',
                        message: 'Authentication required',
                    },
                });
                return;
            }
            const userRole = req.user.role;
            // Check if user has required role
            if (!allowedRoles.includes(userRole)) {
                res.status(403).json({
                    success: false,
                    error: {
                        code: 'UNAUTHORIZED',
                        message: `Access denied. Required role(s): ${allowedRoles.join(', ')}`,
                        details: `Your role: ${userRole}`,
                    },
                });
                return;
            }
            next();
        }
        catch (error) {
            res.status(500).json({
                success: false,
                error: {
                    code: 'SERVER_ERROR',
                    message: 'Error checking user role',
                },
            });
        }
    };
};
exports.requireRole = requireRole;
/**
 * Middleware to allow only admins and super admins
 *
 * Shorthand for requireRole(['admin', 'super_admin'])
 *
 * Usage:
 * router.get('/drivers', requireAuth, extractUserInfo, requireAdmin, (req, res) => { ... });
 */
exports.requireAdmin = (0, exports.requireRole)([auth0_1.Auth0Roles.ADMIN, auth0_1.Auth0Roles.SUPER_ADMIN]);
/**
 * Middleware to allow only super admins
 *
 * Usage:
 * router.post('/admin/users', requireAuth, extractUserInfo, requireSuperAdmin, (req, res) => { ... });
 */
exports.requireSuperAdmin = (0, exports.requireRole)([auth0_1.Auth0Roles.SUPER_ADMIN]);
/**
 * Middleware to allow only drivers
 * Automatically includes device tracking for single-session enforcement
 *
 * Usage:
 * router.post('/locations', requireAuth, extractUserInfo, requireDriver, (req, res) => { ... });
 */
exports.requireDriver = [
    (0, exports.requireRole)([auth0_1.Auth0Roles.DRIVER]),
    device_tracking_1.trackDriverDevice,
];
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
const requireOwnResource = (paramName = 'id') => {
    return async (req, res, next) => {
        try {
            if (!req.user) {
                res.status(401).json({
                    success: false,
                    error: {
                        code: 'AUTH_FAILED',
                        message: 'Authentication required',
                    },
                });
                return;
            }
            const userRole = req.user.role;
            const requestedResourceId = req.params[paramName];
            // Admins and super_admins can access any resource
            if (userRole === auth0_1.Auth0Roles.ADMIN || userRole === auth0_1.Auth0Roles.SUPER_ADMIN) {
                next();
                return;
            }
            // For drivers, check if they're accessing their own resource
            if (userRole === auth0_1.Auth0Roles.DRIVER) {
                // The user's database ID should be fetched from the database using auth0Id
                // For now, we'll assume the resourceId matches the auth0Id or a driver ID
                // In a real implementation, you'd query the database to get the driver's ID
                // Get the driver ID from the database (this is a placeholder)
                // In actual implementation, this should query: SELECT id FROM drivers WHERE auth0_id = req.user.auth0Id
                const userDriverId = req.user.auth0Id; // Simplified - in reality, query DB
                if (requestedResourceId !== userDriverId) {
                    res.status(403).json({
                        success: false,
                        error: {
                            code: 'UNAUTHORIZED',
                            message: 'Access denied. You can only access your own resources.',
                        },
                    });
                    return;
                }
                next();
                return;
            }
            // Unknown role
            res.status(403).json({
                success: false,
                error: {
                    code: 'UNAUTHORIZED',
                    message: 'Access denied',
                },
            });
        }
        catch (error) {
            res.status(500).json({
                success: false,
                error: {
                    code: 'SERVER_ERROR',
                    message: 'Error checking resource ownership',
                },
            });
        }
    };
};
exports.requireOwnResource = requireOwnResource;
/**
 * Check if user is an admin or super_admin
 *
 * Utility function (not middleware)
 */
const isAdmin = (role) => {
    return role === auth0_1.Auth0Roles.ADMIN || role === auth0_1.Auth0Roles.SUPER_ADMIN;
};
exports.isAdmin = isAdmin;
/**
 * Check if user is a super_admin
 *
 * Utility function (not middleware)
 */
const isSuperAdmin = (role) => {
    return role === auth0_1.Auth0Roles.SUPER_ADMIN;
};
exports.isSuperAdmin = isSuperAdmin;
/**
 * Check if user is a driver
 *
 * Utility function (not middleware)
 */
const isDriver = (role) => {
    return role === auth0_1.Auth0Roles.DRIVER;
};
exports.isDriver = isDriver;
/**
 * Get user role hierarchy level
 *
 * Higher number = more privileges
 * super_admin > admin > driver
 */
const getRoleLevel = (role) => {
    switch (role) {
        case auth0_1.Auth0Roles.SUPER_ADMIN:
            return 3;
        case auth0_1.Auth0Roles.ADMIN:
            return 2;
        case auth0_1.Auth0Roles.DRIVER:
            return 1;
        default:
            return 0;
    }
};
exports.getRoleLevel = getRoleLevel;
/**
 * Check if user has sufficient role level
 *
 * @param userRole - User's current role
 * @param requiredRole - Minimum required role
 * @returns true if user role level >= required role level
 */
const hasRoleLevel = (userRole, requiredRole) => {
    return (0, exports.getRoleLevel)(userRole) >= (0, exports.getRoleLevel)(requiredRole);
};
exports.hasRoleLevel = hasRoleLevel;
//# sourceMappingURL=rbac.js.map