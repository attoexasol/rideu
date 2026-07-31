"use strict";
/**
 * Auth0 Management API Service
 *
 * Provides methods to manage users in Auth0:
 * - Create users with roles
 * - Update user metadata and roles
 * - Delete users
 * - Send password reset emails
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.auth0Management = exports.PasswordResetError = void 0;
const axios_1 = __importDefault(require("axios"));
class PasswordResetError extends Error {
    errorCode;
    statusCode;
    constructor(message, errorCode, statusCode) {
        super(message);
        this.errorCode = errorCode;
        this.statusCode = statusCode;
        this.name = 'PasswordResetError';
    }
}
exports.PasswordResetError = PasswordResetError;
class Auth0ManagementService {
    token = null;
    tokenExpiry = 0;
    /**
     * Get Auth0 Management API access token
     * Tokens are cached and reused until expiry
     */
    async getManagementToken() {
        // Reuse token if still valid (with 5 min buffer)
        if (this.token && Date.now() < this.tokenExpiry - 300000) {
            return this.token;
        }
        const domain = process.env.AUTH0_DOMAIN;
        const clientId = process.env.AUTH0_MANAGEMENT_CLIENT_ID;
        const clientSecret = process.env.AUTH0_MANAGEMENT_CLIENT_SECRET?.trim();
        if (!domain || !clientId || !clientSecret) {
            throw new Error('Auth0 Management API credentials not configured');
        }
        try {
            const response = await axios_1.default.post(`https://${domain}/oauth/token`, {
                client_id: clientId,
                client_secret: clientSecret,
                audience: `https://${domain}/api/v2/`,
                grant_type: 'client_credentials',
            }, {
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            this.token = response.data.access_token;
            this.tokenExpiry = Date.now() + response.data.expires_in * 1000;
            return this.token;
        }
        catch (error) {
            console.error('Failed to get Management API token:', error);
            throw new Error('Failed to authenticate with Auth0 Management API');
        }
    }
    /**
     * Create a new user in Auth0
     */
    async createUser(data, options) {
        const token = await this.getManagementToken();
        const domain = process.env.AUTH0_DOMAIN;
        console.log('🔐 Creating Auth0 user:', { email: data.email, name: data.name, role: data.role });
        try {
            // Step 1: Create user
            const payload = {
                email: data.email,
                password: data.password,
                connection: 'Username-Password-Authentication',
                email_verified: options?.emailVerified ?? false,
                app_metadata: {
                    role: data.role, // Keep for backwards compatibility
                },
                user_metadata: {
                    name: data.name,
                },
                name: data.name,
            };
            console.log('   Payload:', { ...payload, password: '***' });
            const response = await axios_1.default.post(`https://${domain}/api/v2/users`, payload, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });
            const user = response.data;
            console.log('   ✅ Auth0 user created successfully:', user.user_id);
            // Step 2: Assign Auth0 Role
            try {
                console.log('   🎭 Assigning Auth0 role:', data.role);
                await this.assignRoleToUser(user.user_id, data.role);
                console.log('   ✅ Auth0 role assigned successfully');
            }
            catch (roleError) {
                console.warn('   ⚠️ Failed to assign Auth0 role (will use app_metadata fallback):', roleError.message);
                // Non-fatal: user created but role assignment failed
                // They still have role in app_metadata
            }
            return user;
        }
        catch (error) {
            const axiosError = error;
            console.error('   ❌ Auth0 API Error Response:', {
                status: axiosError.response?.status,
                statusText: axiosError.response?.statusText,
                data: axiosError.response?.data,
            });
            if (axiosError.response?.data?.message) {
                throw new Error(`Auth0: ${axiosError.response.data.message}`);
            }
            throw new Error('Failed to create user in Auth0');
        }
    }
    /**
     * Create passenger customer in Auth0 (email + password)
     */
    async createCustomer(data) {
        return this.createUser({
            email: data.email,
            password: data.password,
            name: data.name,
            role: 'customer',
        }, { emailVerified: true });
    }
    /**
     * Get Auth0 Role ID by name
     * Maps our role names to Auth0 Role IDs
     */
    async getRoleId(roleName) {
        const token = await this.getManagementToken();
        const domain = process.env.AUTH0_DOMAIN;
        try {
            // Get all roles and find matching one
            const response = await axios_1.default.get(`https://${domain}/api/v2/roles`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
            const roles = response.data;
            console.log(`Available Auth0 roles: ${roles.map((r) => r.name).join(', ')}`);
            // Match role name (case-insensitive)
            const roleNameMap = {
                driver: ['Driver', 'driver'],
                admin: ['Admin', 'admin'],
                super_admin: ['Super Admin', 'super_admin', 'SuperAdmin', 'super-admin'],
                customer: ['Customer', 'customer', 'Passenger', 'passenger'],
            };
            const matchNames = roleNameMap[roleName] || [roleName];
            const role = roles.find((r) => matchNames.includes(r.name));
            if (!role) {
                console.error(`❌ Auth0 Role not found: ${roleName}`);
                console.error(`   Looking for one of: ${matchNames.join(', ')}`);
                console.error(`   Available roles: ${roles.map((r) => r.name).join(', ')}`);
                console.error(`   Please create the role in Auth0 Dashboard → User Management → Roles`);
            }
            return role?.id || null;
        }
        catch (error) {
            console.error('Failed to get Auth0 role ID:', error);
            return null;
        }
    }
    /**
     * Assign Auth0 Role to user
     */
    async assignRoleToUser(userId, roleName) {
        const token = await this.getManagementToken();
        const domain = process.env.AUTH0_DOMAIN;
        const roleId = await this.getRoleId(roleName);
        if (!roleId) {
            throw new Error(`Auth0 Role not found: ${roleName}`);
        }
        try {
            await axios_1.default.post(`https://${domain}/api/v2/users/${encodeURIComponent(userId)}/roles`, {
                roles: [roleId],
            }, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });
        }
        catch (error) {
            const axiosError = error;
            console.error('Failed to assign role to user:', axiosError.response?.data);
            throw new Error('Failed to assign Auth0 role to user');
        }
    }
    /**
     * Remove role from user and assign new one
     */
    async changeUserRole(userId, newRoleName) {
        const token = await this.getManagementToken();
        const domain = process.env.AUTH0_DOMAIN;
        try {
            // Get user's current roles
            const rolesResponse = await axios_1.default.get(`https://${domain}/api/v2/users/${encodeURIComponent(userId)}/roles`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
            const currentRoles = rolesResponse.data;
            // Remove all current roles
            if (currentRoles.length > 0) {
                const roleIds = currentRoles.map((r) => r.id);
                await axios_1.default.delete(`https://${domain}/api/v2/users/${encodeURIComponent(userId)}/roles`, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    data: {
                        roles: roleIds,
                    },
                });
            }
            // Assign new role
            await this.assignRoleToUser(userId, newRoleName);
        }
        catch (error) {
            const axiosError = error;
            console.error('Failed to change user role:', axiosError.response?.data);
            throw new Error('Failed to change user role');
        }
    }
    /**
     * Update user's role in Auth0
     * Updates both Auth0 Role and app_metadata for backwards compatibility
     */
    async updateUserRole(auth0UserId, role) {
        const token = await this.getManagementToken();
        const domain = process.env.AUTH0_DOMAIN;
        try {
            // Update app_metadata (backwards compatibility)
            await axios_1.default.patch(`https://${domain}/api/v2/users/${encodeURIComponent(auth0UserId)}`, {
                app_metadata: {
                    role,
                },
            }, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });
            // Also update Auth0 Role
            try {
                await this.changeUserRole(auth0UserId, role);
            }
            catch (roleError) {
                console.warn('Failed to update Auth0 role (app_metadata updated):', roleError);
                // Non-fatal: app_metadata updated, role assignment failed
            }
        }
        catch (error) {
            const axiosError = error;
            console.error('Failed to update user role:', axiosError.response?.data);
            throw new Error('Failed to update user role in Auth0');
        }
    }
    /**
     * Get user from Auth0 by ID
     */
    /**
     * Find Auth0 user by email (Management API).
     */
    async findUserByEmail(email) {
        const token = await this.getManagementToken();
        const domain = process.env.AUTH0_DOMAIN;
        try {
            const response = await axios_1.default.get(`https://${domain}/api/v2/users-by-email`, {
                params: { email },
                headers: { Authorization: `Bearer ${token}` },
            });
            const users = response.data ?? [];
            const databaseUser = users.find((user) => user.identities?.some((identity) => identity.connection === 'Username-Password-Authentication'));
            return databaseUser ?? users[0] ?? null;
        }
        catch (error) {
            const axiosError = error;
            console.error('[forgot-password] Auth0 users-by-email failed:', axiosError.response?.data);
            throw new PasswordResetError('Unable to verify account with Auth0', 'AUTH0_LOOKUP_FAILED', 502);
        }
    }
    async getUser(auth0UserId) {
        const token = await this.getManagementToken();
        const domain = process.env.AUTH0_DOMAIN;
        try {
            const response = await axios_1.default.get(`https://${domain}/api/v2/users/${encodeURIComponent(auth0UserId)}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
            return response.data;
        }
        catch (error) {
            const axiosError = error;
            console.error('Failed to get user from Auth0:', axiosError.response?.data);
            throw new Error('Failed to get user from Auth0');
        }
    }
    /**
     * Delete user from Auth0
     */
    async deleteUser(auth0UserId) {
        const token = await this.getManagementToken();
        const domain = process.env.AUTH0_DOMAIN;
        try {
            await axios_1.default.delete(`https://${domain}/api/v2/users/${encodeURIComponent(auth0UserId)}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
        }
        catch (error) {
            const axiosError = error;
            console.error('Failed to delete user from Auth0:', axiosError.response?.data);
            throw new Error('Failed to delete user from Auth0');
        }
    }
    async sendPasswordResetEmail(email) {
        const domain = process.env.AUTH0_DOMAIN;
        const clientId = this.getPasswordResetClientId();
        if (!domain) {
            throw new PasswordResetError('Auth0 domain is not configured', 'CONFIG_ERROR', 503);
        }
        if (!this.isConfigured()) {
            throw new PasswordResetError('Auth0 Management API is not configured', 'CONFIG_ERROR', 503);
        }
        const auth0User = await this.findUserByEmail(email);
        if (!auth0User) {
            throw new PasswordResetError('No Auth0 account found for this email on Username-Password-Authentication', 'AUTH0_USER_NOT_FOUND', 404);
        }
        const fallbackClientId = process.env.AUTH0_CLIENT_ID && process.env.AUTH0_CLIENT_ID !== clientId
            ? process.env.AUTH0_CLIENT_ID
            : null;
        const attemptReset = async (attemptClientId) => {
            const response = await axios_1.default.post(`https://${domain}/dbconnections/change_password`, {
                client_id: attemptClientId,
                email,
                connection: 'Username-Password-Authentication',
            }, {
                headers: {
                    'Content-Type': 'application/json',
                },
                timeout: 15000,
            });
            const detail = typeof response.data === 'string'
                ? response.data
                : 'Password reset email requested from Auth0';
            console.log(`[forgot-password] Auth0 change_password OK for ${email} (client ${attemptClientId.slice(0, 8)}..., auth0Id ${auth0User.user_id})`, detail);
            return { delivered: true, detail };
        };
        try {
            return await attemptReset(clientId);
        }
        catch (error) {
            const axiosError = error;
            const status = axiosError.response?.status;
            if (status === 404 && fallbackClientId) {
                console.warn(`[forgot-password] Auth0 404 for client ${clientId.slice(0, 8)}..., retrying with AUTH0_CLIENT_ID`);
                try {
                    return await attemptReset(fallbackClientId);
                }
                catch (retryError) {
                    throw this.toPasswordResetError(email, fallbackClientId, retryError);
                }
            }
            throw this.toPasswordResetError(email, clientId, error);
        }
    }
    toPasswordResetError(email, clientId, error) {
        const axiosError = error;
        const status = axiosError.response?.status;
        const data = axiosError.response?.data;
        console.error('[forgot-password] Auth0 change_password failed:', {
            email,
            clientId: `${clientId.slice(0, 8)}...`,
            status,
            data,
        });
        if (data?.name === 'NotFoundError' || status === 404) {
            return new PasswordResetError('Auth0 could not send reset email. Ensure AUTH0_CLIENT_ID is a Regular Web app with Username-Password-Authentication enabled.', 'RESET_FAILED', 502);
        }
        return new PasswordResetError(data?.message || 'Auth0 failed to send password reset email', 'RESET_FAILED', 502);
    }
    /** Password reset for phone-username Auth0 users (worldwide). */
    async sendPasswordResetForPhone(e164) {
        const domain = process.env.AUTH0_DOMAIN;
        const clientId = this.getPasswordResetClientId();
        if (!domain) {
            throw new Error('Auth0 configuration missing');
        }
        const username = e164.replace(/^\+/, '');
        await axios_1.default.post(`https://${domain}/dbconnections/change_password`, {
            client_id: clientId,
            username,
            connection: 'Username-Password-Authentication',
        });
    }
    /**
     * Client ID used for Auth0 /dbconnections/change_password.
     * Must belong to an Auth0 application with Username-Password-Authentication enabled.
     * The backend (Regular Web) client usually works; Native Flutter client often returns 404.
     */
    getPasswordResetClientId() {
        const clientId = process.env.AUTH0_PASSWORD_RESET_CLIENT_ID ||
            process.env.AUTH0_CLIENT_ID ||
            process.env.AUTH0_PASSENGER_CLIENT_ID ||
            process.env.AUTH0_NATIVE_CLIENT_ID;
        if (!clientId) {
            throw new PasswordResetError('Auth0 client ID not configured for password reset. Set AUTH0_CLIENT_ID or AUTH0_PASSWORD_RESET_CLIENT_ID.', 'CONFIG_ERROR', 503);
        }
        return clientId;
    }
    /**
     * Client ID for passenger (Flutter Native) app logins.
     */
    getPassengerClientId() {
        const clientId = process.env.AUTH0_PASSENGER_CLIENT_ID ||
            process.env.AUTH0_NATIVE_CLIENT_ID ||
            process.env.AUTH0_CLIENT_ID;
        if (!clientId) {
            throw new Error('Auth0 passenger client ID not configured. Set AUTH0_PASSENGER_CLIENT_ID to your Flutter Native app Client ID.');
        }
        return clientId;
    }
    isPasswordResetConfigured() {
        return Boolean(process.env.AUTH0_DOMAIN && this.getPasswordResetClientId());
    }
    /**
     * Check if Management API is properly configured
     */
    isConfigured() {
        return !!(process.env.AUTH0_DOMAIN &&
            process.env.AUTH0_MANAGEMENT_CLIENT_ID &&
            process.env.AUTH0_MANAGEMENT_CLIENT_SECRET);
    }
}
// Export singleton instance
exports.auth0Management = new Auth0ManagementService();
//# sourceMappingURL=auth0Management.js.map