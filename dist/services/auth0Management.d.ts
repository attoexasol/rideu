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
    role: 'driver' | 'admin' | 'super_admin' | 'customer';
    name: string;
}
export interface CreateCustomerRequest {
    email: string;
    password: string;
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
export declare class PasswordResetError extends Error {
    readonly errorCode: string;
    readonly statusCode: number;
    constructor(message: string, errorCode: string, statusCode: number);
}
interface Auth0UserIdentity {
    connection: string;
    provider: string;
    user_id: string;
}
interface Auth0UserWithIdentities extends Auth0User {
    identities?: Auth0UserIdentity[];
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
    createUser(data: CreateUserRequest, options?: {
        emailVerified?: boolean;
    }): Promise<Auth0User>;
    /**
     * Create passenger customer in Auth0 (email + password)
     */
    createCustomer(data: CreateCustomerRequest): Promise<Auth0User>;
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
    /**
     * Find Auth0 user by email (Management API).
     */
    findUserByEmail(email: string): Promise<Auth0UserWithIdentities | null>;
    getUser(auth0UserId: string): Promise<Auth0User>;
    /**
     * Update Auth0 display name. Call before persisting name to Postgres.
     * Requires Management API scope: update:users
     */
    updateUserName(auth0UserId: string, name: string): Promise<void>;
    /**
     * Delete user from Auth0
     */
    deleteUser(auth0UserId: string): Promise<void>;
    sendPasswordResetEmail(email: string): Promise<{
        delivered: boolean;
        detail: string;
    }>;
    private toPasswordResetError;
    /** Password reset for phone-username Auth0 users (worldwide). */
    sendPasswordResetForPhone(e164: string): Promise<void>;
    /**
     * Client ID used for Auth0 /dbconnections/change_password.
     * Must belong to an Auth0 application with Username-Password-Authentication enabled.
     * The backend (Regular Web) client usually works; Native Flutter client often returns 404.
     */
    getPasswordResetClientId(): string;
    /**
     * Client ID for passenger (Flutter Native) app logins.
     */
    getPassengerClientId(): string;
    isPasswordResetConfigured(): boolean;
    /**
     * Check if Management API is properly configured
     */
    isConfigured(): boolean;
}
export declare const auth0Management: Auth0ManagementService;
export {};
//# sourceMappingURL=auth0Management.d.ts.map