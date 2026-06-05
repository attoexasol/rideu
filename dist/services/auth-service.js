"use strict";
/**
 * Authentication Service
 *
 * Handles Auth0 token operations, session management, and user authentication
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authService = exports.AuthService = void 0;
const axios_1 = __importDefault(require("axios"));
const auth0_1 = require("../config/auth0");
/**
 * Auth Service Class
 */
class AuthService {
    /**
     * Exchange Auth0 authorization code for tokens
     *
     * @param code - Authorization code from Auth0
     * @param redirectUri - Redirect URI used in the authorization request
     * @returns Token response with access_token, refresh_token, etc.
     */
    async exchangeCodeForToken(code, redirectUri) {
        try {
            const response = await axios_1.default.post(`https://${auth0_1.auth0Config.domain}/oauth/token`, {
                grant_type: 'authorization_code',
                client_id: auth0_1.auth0Config.clientId,
                client_secret: auth0_1.auth0Config.clientSecret,
                code,
                redirect_uri: redirectUri,
            }, {
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            return response.data;
        }
        catch (error) {
            throw new Error(`Failed to exchange code for token: ${error.response?.data?.error_description || error.message}`);
        }
    }
    /**
     * Refresh access token using refresh token
     *
     * @param refreshToken - Refresh token from Auth0
     * @returns New token response
     */
    async refreshAccessToken(refreshToken) {
        try {
            const response = await axios_1.default.post(`https://${auth0_1.auth0Config.domain}/oauth/token`, {
                grant_type: 'refresh_token',
                client_id: auth0_1.auth0Config.clientId,
                client_secret: auth0_1.auth0Config.clientSecret,
                refresh_token: refreshToken,
            }, {
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            return response.data;
        }
        catch (error) {
            throw new Error(`Failed to refresh token: ${error.response?.data?.error_description || error.message}`);
        }
    }
    /**
     * Get user information from Auth0 using access token
     *
     * @param accessToken - Auth0 access token
     * @returns User information
     */
    async getUserInfo(accessToken) {
        try {
            const response = await axios_1.default.get(`https://${auth0_1.auth0Config.domain}/userinfo`, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });
            return response.data;
        }
        catch (error) {
            throw new Error(`Failed to get user info: ${error.response?.data?.error_description || error.message}`);
        }
    }
    /**
     * Verify Auth0 ID token
     *
     * @param idToken - Auth0 ID token
     * @returns Decoded token payload
     */
    async verifyIdToken(idToken) {
        try {
            // In production, use jsonwebtoken library to verify signature
            // For now, we'll decode without verification (NOT SECURE - placeholder)
            const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
            // Check expiration
            if (payload.exp && Date.now() >= payload.exp * 1000) {
                throw new Error('Token expired');
            }
            return payload;
        }
        catch (error) {
            throw new Error(`Failed to verify ID token: ${error.message}`);
        }
    }
    /**
     * Revoke refresh token (logout)
     *
     * @param refreshToken - Refresh token to revoke
     */
    async revokeRefreshToken(refreshToken) {
        try {
            await axios_1.default.post(`https://${auth0_1.auth0Config.domain}/oauth/revoke`, {
                client_id: auth0_1.auth0Config.clientId,
                client_secret: auth0_1.auth0Config.clientSecret,
                token: refreshToken,
            }, {
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        }
        catch (error) {
            throw new Error(`Failed to revoke token: ${error.response?.data?.error_description || error.message}`);
        }
    }
    /**
     * Create session data
     *
     * @param userInfo - User information from Auth0
     * @param tokens - Token response from Auth0
     * @returns Session data object
     */
    createSessionData(userInfo, tokens, role) {
        const expiresAt = new Date();
        expiresAt.setSeconds(expiresAt.getSeconds() + tokens.expires_in);
        // Determine user type based on role
        const userType = role === 'driver' ? 'driver' : 'admin';
        return {
            userId: userInfo.sub,
            userType,
            role,
            token: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresAt,
        };
    }
    /**
     * Store session in Redis
     *
     * @param sessionId - Unique session ID
     * @param sessionData - Session data to store
     * @param redisClient - Redis client instance
     */
    async storeSession(sessionId, sessionData, redisClient) {
        try {
            // Calculate TTL (time to live) in seconds
            const ttl = Math.floor((sessionData.expiresAt.getTime() - Date.now()) / 1000);
            // Store session in Redis with expiration
            await redisClient.setex(`session:${sessionId}`, ttl, JSON.stringify(sessionData));
        }
        catch (error) {
            throw new Error(`Failed to store session: ${error.message}`);
        }
    }
    /**
     * Get session from Redis
     *
     * @param sessionId - Session ID to retrieve
     * @param redisClient - Redis client instance
     * @returns Session data or null if not found
     */
    async getSession(sessionId, redisClient) {
        try {
            const data = await redisClient.get(`session:${sessionId}`);
            if (!data) {
                return null;
            }
            const sessionData = JSON.parse(data);
            // Check if session is expired
            if (new Date(sessionData.expiresAt) < new Date()) {
                await this.deleteSession(sessionId, redisClient);
                return null;
            }
            return sessionData;
        }
        catch (error) {
            throw new Error(`Failed to get session: ${error.message}`);
        }
    }
    /**
     * Delete session from Redis
     *
     * @param sessionId - Session ID to delete
     * @param redisClient - Redis client instance
     */
    async deleteSession(sessionId, redisClient) {
        try {
            await redisClient.del(`session:${sessionId}`);
        }
        catch (error) {
            throw new Error(`Failed to delete session: ${error.message}`);
        }
    }
    /**
     * Update session expiration
     *
     * @param sessionId - Session ID
     * @param expiresIn - New expiration time in seconds
     * @param redisClient - Redis client instance
     */
    async updateSessionExpiration(sessionId, expiresIn, redisClient) {
        try {
            await redisClient.expire(`session:${sessionId}`, expiresIn);
        }
        catch (error) {
            throw new Error(`Failed to update session expiration: ${error.message}`);
        }
    }
    /**
     * Get all sessions for a user
     *
     * @param userId - Auth0 user ID
     * @param redisClient - Redis client instance
     * @returns Array of session IDs
     */
    async getUserSessions(userId, redisClient) {
        try {
            const keys = await redisClient.keys('session:*');
            const sessions = [];
            for (const key of keys) {
                const data = await redisClient.get(key);
                if (data) {
                    const sessionData = JSON.parse(data);
                    if (sessionData.userId === userId) {
                        sessions.push(key.replace('session:', ''));
                    }
                }
            }
            return sessions;
        }
        catch (error) {
            throw new Error(`Failed to get user sessions: ${error.message}`);
        }
    }
    /**
     * Delete all sessions for a user (logout from all devices)
     *
     * @param userId - Auth0 user ID
     * @param redisClient - Redis client instance
     */
    async deleteAllUserSessions(userId, redisClient) {
        try {
            const sessions = await this.getUserSessions(userId, redisClient);
            for (const sessionId of sessions) {
                await this.deleteSession(sessionId, redisClient);
            }
        }
        catch (error) {
            throw new Error(`Failed to delete all user sessions: ${error.message}`);
        }
    }
}
exports.AuthService = AuthService;
// Export singleton instance
exports.authService = new AuthService();
//# sourceMappingURL=auth-service.js.map