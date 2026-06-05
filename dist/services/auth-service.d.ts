/**
 * Authentication Service
 *
 * Handles Auth0 token operations, session management, and user authentication
 */
/**
 * Token response from Auth0
 */
interface Auth0TokenResponse {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    token_type: string;
    expires_in: number;
}
/**
 * User information from Auth0
 */
interface Auth0UserInfo {
    sub: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    nickname?: string;
    picture?: string;
    updated_at?: string;
    [key: string]: any;
}
/**
 * Session data structure
 */
export interface SessionData {
    userId: string;
    userType: 'driver' | 'admin';
    role: string;
    token: string;
    refreshToken?: string;
    expiresAt: Date;
}
/**
 * Auth Service Class
 */
export declare class AuthService {
    /**
     * Exchange Auth0 authorization code for tokens
     *
     * @param code - Authorization code from Auth0
     * @param redirectUri - Redirect URI used in the authorization request
     * @returns Token response with access_token, refresh_token, etc.
     */
    exchangeCodeForToken(code: string, redirectUri: string): Promise<Auth0TokenResponse>;
    /**
     * Refresh access token using refresh token
     *
     * @param refreshToken - Refresh token from Auth0
     * @returns New token response
     */
    refreshAccessToken(refreshToken: string): Promise<Auth0TokenResponse>;
    /**
     * Get user information from Auth0 using access token
     *
     * @param accessToken - Auth0 access token
     * @returns User information
     */
    getUserInfo(accessToken: string): Promise<Auth0UserInfo>;
    /**
     * Verify Auth0 ID token
     *
     * @param idToken - Auth0 ID token
     * @returns Decoded token payload
     */
    verifyIdToken(idToken: string): Promise<any>;
    /**
     * Revoke refresh token (logout)
     *
     * @param refreshToken - Refresh token to revoke
     */
    revokeRefreshToken(refreshToken: string): Promise<void>;
    /**
     * Create session data
     *
     * @param userInfo - User information from Auth0
     * @param tokens - Token response from Auth0
     * @returns Session data object
     */
    createSessionData(userInfo: Auth0UserInfo, tokens: Auth0TokenResponse, role: string): SessionData;
    /**
     * Store session in Redis
     *
     * @param sessionId - Unique session ID
     * @param sessionData - Session data to store
     * @param redisClient - Redis client instance
     */
    storeSession(sessionId: string, sessionData: SessionData, redisClient: any): Promise<void>;
    /**
     * Get session from Redis
     *
     * @param sessionId - Session ID to retrieve
     * @param redisClient - Redis client instance
     * @returns Session data or null if not found
     */
    getSession(sessionId: string, redisClient: any): Promise<SessionData | null>;
    /**
     * Delete session from Redis
     *
     * @param sessionId - Session ID to delete
     * @param redisClient - Redis client instance
     */
    deleteSession(sessionId: string, redisClient: any): Promise<void>;
    /**
     * Update session expiration
     *
     * @param sessionId - Session ID
     * @param expiresIn - New expiration time in seconds
     * @param redisClient - Redis client instance
     */
    updateSessionExpiration(sessionId: string, expiresIn: number, redisClient: any): Promise<void>;
    /**
     * Get all sessions for a user
     *
     * @param userId - Auth0 user ID
     * @param redisClient - Redis client instance
     * @returns Array of session IDs
     */
    getUserSessions(userId: string, redisClient: any): Promise<string[]>;
    /**
     * Delete all sessions for a user (logout from all devices)
     *
     * @param userId - Auth0 user ID
     * @param redisClient - Redis client instance
     */
    deleteAllUserSessions(userId: string, redisClient: any): Promise<void>;
}
export declare const authService: AuthService;
export {};
//# sourceMappingURL=auth-service.d.ts.map