"use strict";
/**
 * Authentication Routes
 *
 * POST /api/auth/login - Login with Auth0 token
 * POST /api/auth/refresh - Refresh JWT token
 * POST /api/auth/logout - Logout and destroy session
 * GET /api/auth/me - Get current user info
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_1 = require("../middleware/auth");
const validators_1 = require("../validators");
const response_1 = require("../utils/response");
const error_handler_1 = require("../middleware/error-handler");
const rate_limiters_1 = require("../middleware/rate-limiters");
const utils_1 = require("../db/utils");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const jwt_verifier_1 = require("../utils/jwt-verifier");
const accountStatus_service_1 = require("../services/accountStatus.service");
const router = express_1.default.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
/**
 * POST /api/auth/login
 * Verify Auth0 token and create session
 */
router.post('/login', rate_limiters_1.authRateLimiter, (0, validators_1.validate)(validators_1.loginSchema), (0, error_handler_1.asyncHandler)(async (req, res) => {
    const { auth0Token, deviceId, deviceInfo } = req.body;
    // In a real implementation, verify the Auth0 token here
    // For now, we'll extract info from the Auth0 token payload
    // The Auth0 token should already be verified by the client
    try {
        // Verify Auth0 RS256 token via JWKS when configured
        let decoded;
        if ((0, jwt_verifier_1.isAuth0Configured)()) {
            decoded = await (0, jwt_verifier_1.verifyAuth0Token)(auth0Token);
        }
        else {
            decoded = jsonwebtoken_1.default.decode(auth0Token);
        }
        if (!decoded || !decoded.sub) {
            return (0, response_1.sendError)(res, 'AUTH_FAILED', 'Invalid Auth0 token', 401);
        }
        const auth0Id = decoded.sub;
        const email = decoded.email;
        const name = decoded.name;
        const role = decoded['https://drivewize.com/role'] || decoded.role;
        // Check if user is a driver or admin
        let user = null;
        let userType = 'driver';
        if (role === 'driver') {
            user = await utils_1.driverUtils.findByAuth0Id(auth0Id);
            userType = 'driver';
        }
        else if (role === 'customer') {
            const { findCustomerByAuth0Id } = await Promise.resolve().then(() => __importStar(require('../repositories/customer.repository')));
            user = await findCustomerByAuth0Id(auth0Id);
            userType = 'customer';
        }
        else if (role === 'admin' || role === 'super_admin') {
            user = await utils_1.adminUtils.findByAuth0Id(auth0Id);
            userType = 'admin';
        }
        if (!user) {
            return (0, response_1.sendError)(res, 'NOT_FOUND', 'User not found in database', 404);
        }
        if (userType === 'driver' && (0, accountStatus_service_1.isDeactivatedAccount)(user.accountStatus)) {
            return (0, response_1.sendError)(res, 'ACCOUNT_DEACTIVATED', 'This account has been deactivated', 403);
        }
        if (userType === 'customer' && (0, accountStatus_service_1.isDeactivatedAccount)(user.status)) {
            return (0, response_1.sendError)(res, 'ACCOUNT_DEACTIVATED', 'This account has been deactivated', 403);
        }
        // Generate session ID and local JWT token FIRST (before session cleanup)
        const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
        const tokenToCreate = jsonwebtoken_1.default.sign({
            userId: user.id,
            auth0Id,
            email,
            name,
            role,
            userType,
            sessionId, // Include session ID in token
            permissions: [],
        }, JWT_SECRET, {
            expiresIn: JWT_EXPIRES_IN,
            algorithm: 'HS256',
        });
        // For drivers, enforce single-session policy
        if (userType === 'driver') {
            console.log(`[Auth] Enforcing single-session for driver ${user.id} (${user.name})`);
            // Check if driver has an active session on another device
            const existingSessionId = user.activeSessionId;
            const existingDeviceId = user.activeDeviceId;
            if (existingSessionId && existingDeviceId && existingDeviceId !== deviceId) {
                console.log(`[Auth] Driver ${user.id} has active session on device ${existingDeviceId}`);
                console.log(`[Auth] Terminating old session and logging in on new device ${deviceId}`);
                await utils_1.sessionUtils.deleteAllForUser(user.id);
            }
            try {
                const { onDriverSessionReplaced } = await Promise.resolve().then(() => __importStar(require('../services/driverPushToken.service')));
                await onDriverSessionReplaced({
                    driverId: user.id,
                    newDeviceId: deviceId || 'unknown',
                    newSessionId: sessionId,
                    previousDeviceId: existingDeviceId,
                });
            }
            catch (error) {
                console.warn('[Auth] Failed to update driver push targets', {
                    driverId: user.id,
                    message: error instanceof Error ? error.message : 'unknown',
                });
            }
            // Update driver's session info with new device
            await utils_1.driverUtils.updateSessionInfo(user.id, {
                activeSessionId: sessionId,
                activeDeviceId: deviceId || 'unknown',
                activeDeviceInfo: deviceInfo || 'Unknown Device',
            });
        }
        // Create session in database with the token we generated
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
        await utils_1.sessionUtils.create({
            userId: user.id,
            userType,
            token: tokenToCreate,
            expiresAt,
        });
        // Return token and user info
        return (0, response_1.sendSuccess)(res, {
            token: tokenToCreate,
            sessionId, // Return session ID for client to use
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role,
            },
        }, 200);
    }
    catch (error) {
        console.error('Login error:', error);
        return (0, response_1.sendError)(res, 'AUTH_FAILED', 'Authentication failed', 401);
    }
}));
/**
 * POST /api/auth/refresh
 * Refresh JWT token
 */
router.post('/refresh', rate_limiters_1.authRateLimiter, (0, validators_1.validate)(validators_1.refreshTokenSchema), (0, error_handler_1.asyncHandler)(async (req, res) => {
    const { refreshToken } = req.body;
    try {
        // Verify the refresh token
        const decoded = jsonwebtoken_1.default.verify(refreshToken, JWT_SECRET);
        // Generate new access token
        const newToken = jsonwebtoken_1.default.sign({
            userId: decoded.userId,
            auth0Id: decoded.auth0Id,
            email: decoded.email,
            name: decoded.name,
            role: decoded.role,
            userType: decoded.userType,
        }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
        // Generate new refresh token
        const newRefreshToken = jsonwebtoken_1.default.sign({
            userId: decoded.userId,
            auth0Id: decoded.auth0Id,
        }, JWT_SECRET, { expiresIn: '7d' });
        return (0, response_1.sendSuccess)(res, {
            token: newToken,
            refreshToken: newRefreshToken,
        });
    }
    catch (error) {
        return (0, response_1.sendError)(res, 'AUTH_FAILED', 'Invalid or expired refresh token', 401);
    }
}));
/**
 * POST /api/auth/logout
 * Logout and destroy session
 */
router.post('/logout', auth_1.requireAuth, auth_1.extractUserInfo, (0, error_handler_1.asyncHandler)(async (req, res) => {
    try {
        const user = req.user;
        // Get token from Authorization header
        const authHeader = req.headers.authorization;
        const token = authHeader?.split(' ')[1];
        if (token) {
            // Delete session from database
            await utils_1.sessionUtils.deleteByToken(token);
        }
        // For drivers, clear session info from driver record
        if (user && user.role === 'driver') {
            await utils_1.driverUtils.clearSessionInfo(user.userId);
            try {
                const { invalidateDriverPushTargets } = await Promise.resolve().then(() => __importStar(require('../services/driverPushToken.service')));
                await invalidateDriverPushTargets(user.userId);
            }
            catch (error) {
                console.warn('[Auth] Failed to invalidate driver push targets on logout', {
                    driverId: user.userId,
                    message: error instanceof Error ? error.message : 'unknown',
                });
            }
            console.log(`[Auth] Cleared session info for driver ${user.userId}`);
        }
        return (0, response_1.sendSuccess)(res, { message: 'Logged out successfully' });
    }
    catch (error) {
        console.error('Logout error:', error);
        return (0, response_1.sendError)(res, 'SERVER_ERROR', 'Logout failed', 500);
    }
}));
/**
 * GET /api/auth/validate-session
 * Validate if the current session is still active
 * For drivers, this checks if they haven't been logged out due to another login
 */
router.get('/validate-session', auth_1.requireAuth, auth_1.extractUserInfo, (0, error_handler_1.asyncHandler)(async (req, res) => {
    try {
        const user = req.user;
        // Get token from Authorization header
        const authHeader = req.headers.authorization;
        const token = authHeader?.split(' ')[1];
        if (!token) {
            return (0, response_1.sendError)(res, 'AUTH_FAILED', 'No token provided', 401);
        }
        // Decode token to get session ID
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        const tokenSessionId = decoded.sessionId;
        // Check if session exists in database
        const session = await utils_1.sessionUtils.findByToken(token);
        if (!session) {
            // Session has been deleted (force logout)
            return (0, response_1.sendSuccess)(res, {
                valid: false,
                reason: 'Session invalidated - new login detected on another device',
            });
        }
        // For drivers, check if the session ID matches the active session
        if (user && user.role === 'driver') {
            const driver = await utils_1.driverUtils.findByAuth0Id(user.auth0Id);
            if (!driver) {
                return (0, response_1.sendSuccess)(res, {
                    valid: false,
                    reason: 'Driver not found',
                });
            }
            // Check if this session matches the driver's active session
            if (driver.activeSessionId !== tokenSessionId) {
                console.log(`[Auth] Session mismatch for driver ${driver.id}: token has ${tokenSessionId}, active is ${driver.activeSessionId}`);
                return (0, response_1.sendSuccess)(res, {
                    valid: false,
                    reason: 'Session invalidated - logged in from another device',
                });
            }
        }
        // Session is valid
        return (0, response_1.sendSuccess)(res, {
            valid: true,
            expiresAt: session.expiresAt,
        });
    }
    catch (error) {
        console.error('Session validation error:', error);
        return (0, response_1.sendError)(res, 'SERVER_ERROR', 'Failed to validate session', 500);
    }
}));
/**
 * GET /api/auth/me
 * Get current authenticated user info
 */
router.get('/me', auth_1.requireAuth, auth_1.extractUserInfo, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const user = req.user;
    if (!user) {
        return (0, response_1.sendError)(res, 'AUTH_FAILED', 'User not found', 401);
    }
    console.log('[/api/auth/me] Looking up user:', {
        auth0Id: user.auth0Id,
        email: user.email,
        role: user.role,
    });
    // Get full user data from database
    let userData = null;
    if (user.role === 'driver') {
        userData = await utils_1.driverUtils.findByAuth0Id(user.auth0Id);
        console.log('[/api/auth/me] Driver lookup result:', userData ? 'FOUND' : 'NOT FOUND');
    }
    else if (user.role === 'admin' || user.role === 'super_admin') {
        userData = await utils_1.adminUtils.findByAuth0Id(user.auth0Id);
        console.log('[/api/auth/me] Admin lookup result:', userData ? 'FOUND' : 'NOT FOUND');
    }
    if (!userData) {
        console.log('[/api/auth/me] User not found in database');
        return (0, response_1.sendError)(res, 'NOT_FOUND', 'User not found', 404);
    }
    console.log('[/api/auth/me] Returning user data:', { id: userData.id, email: userData.email });
    return (0, response_1.sendSuccess)(res, {
        id: userData.id,
        email: userData.email,
        name: userData.name,
        role: user.role,
        status: userData.status,
    });
}));
exports.default = router;
//# sourceMappingURL=auth.js.map