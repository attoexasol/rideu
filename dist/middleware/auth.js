"use strict";
/**
 * Authentication Middleware
 *
 * Verifies Auth0 JWT tokens (RS256) via JWKS
 * Also accepts backend HS256 session tokens from /api/auth/login
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireDriverOrAdmin = exports.requireSuperAdmin = exports.requireAdmin = exports.checkPermission = exports.optionalAuth = exports.extractUserInfo = exports.requireAuth = exports.verifyJWT = void 0;
const express_oauth2_jwt_bearer_1 = require("express-oauth2-jwt-bearer");
const auth0_1 = require("../config/auth0");
const jwt_verifier_1 = require("../utils/jwt-verifier");
/**
 * Lazy-loaded Auth0 JWT verification middleware (RS256) for optionalAuth
 */
let verifyAuth0JWT = null;
const getAuth0Middleware = () => {
    if (!verifyAuth0JWT) {
        if (!auth0_1.auth0Config.domain || auth0_1.auth0Config.domain === '') {
            throw new Error('Auth0 domain not configured. Cannot use Auth0 authentication.');
        }
        verifyAuth0JWT = (0, express_oauth2_jwt_bearer_1.auth)({
            audience: auth0_1.auth0Config.audience,
            issuerBaseURL: `https://${auth0_1.auth0Config.domain}`,
            tokenSigningAlg: auth0_1.auth0Config.tokenSigningAlg,
        });
    }
    return verifyAuth0JWT;
};
const sendAuthFailed = (res, message) => {
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
const verifyJWT = async (req, res, next) => {
    const bypassAuth = process.env.BYPASS_AUTH === 'true';
    const authHeader = req.headers.authorization;
    const hasBearerToken = Boolean(authHeader?.startsWith('Bearer '));
    if (bypassAuth && !hasBearerToken) {
        console.log('✓ Auth bypass enabled: Using mock user (set BYPASS_AUTH=false to use Auth0)');
        req.auth = {
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
    const token = authHeader.split(' ')[1];
    try {
        const payload = await (0, jwt_verifier_1.verifyBearerToken)(token);
        req.auth = payload;
        next();
    }
    catch (error) {
        sendAuthFailed(res, error instanceof Error ? error.message : 'Invalid or expired token');
    }
};
exports.verifyJWT = verifyJWT;
/**
 * Middleware to require authentication
 */
exports.requireAuth = exports.verifyJWT;
/**
 * Extract user information from the JWT token
 *
 * This middleware should be used AFTER requireAuth
 */
const extractUserInfo = (req, res, next) => {
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
        const permissions = authPayload.permissions || authPayload['https://drivewize.com/permissions'] || [];
        const fleetIds = authPayload.fleetIds ||
            authPayload['https://drivewize.com/fleet_ids'] ||
            authPayload['https://drivewize.com/fleetIds'] ||
            [];
        req.user = {
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
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: {
                code: 'SERVER_ERROR',
                message: 'Error extracting user information',
            },
        });
    }
};
exports.extractUserInfo = extractUserInfo;
/**
 * Optional authentication middleware (Auth0 RS256 only)
 */
const optionalAuth = (req, res, next) => {
    if (!(0, jwt_verifier_1.isAuth0Configured)()) {
        next();
        return;
    }
    const auth0Middleware = getAuth0Middleware();
    auth0Middleware(req, res, next);
};
exports.optionalAuth = optionalAuth;
/**
 * Middleware to check if user has specific permission
 */
const checkPermission = (permission) => {
    return (req, res, next) => {
        const user = req.user;
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
exports.checkPermission = checkPermission;
const requireAdmin = (req, res, next) => {
    const user = req.user;
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
exports.requireAdmin = requireAdmin;
const requireSuperAdmin = (req, res, next) => {
    const user = req.user;
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
exports.requireSuperAdmin = requireSuperAdmin;
const requireDriverOrAdmin = (paramName = 'id') => {
    return (req, res, next) => {
        const user = req.user;
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
exports.requireDriverOrAdmin = requireDriverOrAdmin;
//# sourceMappingURL=auth.js.map