/**
 * Auth0 Management API Service
 *
 * Provides methods to manage users in Auth0:
 * - Create users with roles
 * - Update user metadata and roles
 * - Delete users
 * - Send password reset emails
 */
export interface CreateUserRequest {
    email: string;
    password: string;
    role: 'driver' | 'admin' | 'super_admin';
    name: string;
}
export interface Auth0User {
    user_id: string;
    email: string;
    name: string;
    email_verified: boolean;
    created_at: string;
    updated_at: string;
    app_metadata?: {
        role?: string;
    };
}
declare class Auth0ManagementService {
    private token;
    private tokenExpiry;
    /**
     * Get Auth0 Management API access token
     * Tokens are cached and reused until expiry
     */
    getManagementToken(): Promise<string>;
    /**
     * Create a new user in Auth0
     */
    createUser(data: CreateUserRequest): Promise<Auth0User>;
    /**
     * Get Auth0 Role ID by name
     * Maps our role names to Auth0 Role IDs
     */
    getRoleId(roleName: string): Promise<string | null>;
    /**
     * Assign Auth0 Role to user
     */
    assignRoleToUser(userId: string, roleName: string): Promise<void>;
    /**
     * Remove role from user and assign new one
     */
    changeUserRole(userId: string, newRoleName: string): Promise<void>;
    /**
     * Update user's role in Auth0
     * Updates both Auth0 Role and app_metadata for backwards compatibility
     */
    updateUserRole(auth0UserId: string, role: string): Promise<void>;
    /**
     * Get user from Auth0 by ID
     */
    getUser(auth0UserId: string): Promise<Auth0User>;
    /**
     * Delete user from Auth0
     */
    deleteUser(auth0UserId: string): Promise<void>;
    /**
     * Send password reset email to user
     */
    sendPasswordResetEmail(email: string): Promise<void>;
    /**
     * Check if service is properly configured
     */
    isConfigured(): boolean;
}
export declare const auth0Management: Auth0ManagementService;
export {};
//# sourceMappingURL=auth0Management.d.ts.map