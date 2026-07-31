/**
 * Auth0 Management API Service
 *
 * Provides methods to manage users in Auth0:
 * - Create users with roles
 * - Update user metadata and roles
 * - Delete users
 * - Send password reset emails
 */

import axios, { AxiosError } from 'axios';

interface Auth0ManagementToken {
  access_token: string;
  expires_in: number;
  token_type: string;
}

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

interface Auth0ErrorResponse {
  statusCode: number;
  error: string;
  message: string;
  errorCode?: string;
  name?: string;
}

export class PasswordResetError extends Error {
  constructor(
    message: string,
    public readonly errorCode: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = 'PasswordResetError';
  }
}

interface Auth0UserIdentity {
  connection: string;
  provider: string;
  user_id: string;
}

interface Auth0UserWithIdentities extends Auth0User {
  identities?: Auth0UserIdentity[];
}

class Auth0ManagementService {
  private token: string | null = null;
  private tokenExpiry: number = 0;

  /**
   * Get Auth0 Management API access token
   * Tokens are cached and reused until expiry
   */
  async getManagementToken(): Promise<string> {
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
      const response = await axios.post<Auth0ManagementToken>(
        `https://${domain}/oauth/token`,
        {
          client_id: clientId,
          client_secret: clientSecret,
          audience: `https://${domain}/api/v2/`,
          grant_type: 'client_credentials',
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      this.token = response.data.access_token;
      this.tokenExpiry = Date.now() + response.data.expires_in * 1000;

      return this.token;
    } catch (error) {
      console.error('Failed to get Management API token:', error);
      throw new Error('Failed to authenticate with Auth0 Management API');
    }
  }

  /**
   * Create a new user in Auth0
   */
  async createUser(
    data: CreateUserRequest,
    options?: { emailVerified?: boolean }
  ): Promise<Auth0User> {
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

      const response = await axios.post<Auth0User>(`https://${domain}/api/v2/users`, payload, {
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
      } catch (roleError: any) {
        console.warn(
          '   ⚠️ Failed to assign Auth0 role (will use app_metadata fallback):',
          roleError.message
        );
        // Non-fatal: user created but role assignment failed
        // They still have role in app_metadata
      }

      return user;
    } catch (error) {
      const axiosError = error as AxiosError<Auth0ErrorResponse>;
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
  async createCustomer(data: CreateCustomerRequest): Promise<Auth0User> {
    return this.createUser(
      {
        email: data.email,
        password: data.password,
        name: data.name,
        role: 'customer',
      },
      { emailVerified: true }
    );
  }

  /**
   * Get Auth0 Role ID by name
   * Maps our role names to Auth0 Role IDs
   */
  async getRoleId(roleName: string): Promise<string | null> {
    const token = await this.getManagementToken();
    const domain = process.env.AUTH0_DOMAIN;

    try {
      // Get all roles and find matching one
      const response = await axios.get(`https://${domain}/api/v2/roles`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const roles = response.data;
      console.log(`Available Auth0 roles: ${roles.map((r: any) => r.name).join(', ')}`);

      // Match role name (case-insensitive)
      const roleNameMap: Record<string, string[]> = {
        driver: ['Driver', 'driver'],
        admin: ['Admin', 'admin'],
        super_admin: ['Super Admin', 'super_admin', 'SuperAdmin', 'super-admin'],
        customer: ['Customer', 'customer', 'Passenger', 'passenger'],
      };

      const matchNames = roleNameMap[roleName] || [roleName];
      const role = roles.find((r: any) => matchNames.includes(r.name));

      if (!role) {
        console.error(`❌ Auth0 Role not found: ${roleName}`);
        console.error(`   Looking for one of: ${matchNames.join(', ')}`);
        console.error(`   Available roles: ${roles.map((r: any) => r.name).join(', ')}`);
        console.error(`   Please create the role in Auth0 Dashboard → User Management → Roles`);
      }

      return role?.id || null;
    } catch (error) {
      console.error('Failed to get Auth0 role ID:', error);
      return null;
    }
  }

  /**
   * Assign Auth0 Role to user
   */
  async assignRoleToUser(userId: string, roleName: string): Promise<void> {
    const token = await this.getManagementToken();
    const domain = process.env.AUTH0_DOMAIN;

    const roleId = await this.getRoleId(roleName);
    if (!roleId) {
      throw new Error(`Auth0 Role not found: ${roleName}`);
    }

    try {
      await axios.post(
        `https://${domain}/api/v2/users/${encodeURIComponent(userId)}/roles`,
        {
          roles: [roleId],
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );
    } catch (error) {
      const axiosError = error as AxiosError<Auth0ErrorResponse>;
      console.error('Failed to assign role to user:', axiosError.response?.data);
      throw new Error('Failed to assign Auth0 role to user');
    }
  }

  /**
   * Remove role from user and assign new one
   */
  async changeUserRole(userId: string, newRoleName: string): Promise<void> {
    const token = await this.getManagementToken();
    const domain = process.env.AUTH0_DOMAIN;

    try {
      // Get user's current roles
      const rolesResponse = await axios.get(
        `https://${domain}/api/v2/users/${encodeURIComponent(userId)}/roles`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const currentRoles = rolesResponse.data;

      // Remove all current roles
      if (currentRoles.length > 0) {
        const roleIds = currentRoles.map((r: any) => r.id);
        await axios.delete(`https://${domain}/api/v2/users/${encodeURIComponent(userId)}/roles`, {
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
    } catch (error) {
      const axiosError = error as AxiosError<Auth0ErrorResponse>;
      console.error('Failed to change user role:', axiosError.response?.data);
      throw new Error('Failed to change user role');
    }
  }

  /**
   * Update user's role in Auth0
   * Updates both Auth0 Role and app_metadata for backwards compatibility
   */
  async updateUserRole(auth0UserId: string, role: string): Promise<void> {
    const token = await this.getManagementToken();
    const domain = process.env.AUTH0_DOMAIN;

    try {
      // Update app_metadata (backwards compatibility)
      await axios.patch(
        `https://${domain}/api/v2/users/${encodeURIComponent(auth0UserId)}`,
        {
          app_metadata: {
            role,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      // Also update Auth0 Role
      try {
        await this.changeUserRole(auth0UserId, role);
      } catch (roleError) {
        console.warn('Failed to update Auth0 role (app_metadata updated):', roleError);
        // Non-fatal: app_metadata updated, role assignment failed
      }
    } catch (error) {
      const axiosError = error as AxiosError<Auth0ErrorResponse>;
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
  async findUserByEmail(email: string): Promise<Auth0UserWithIdentities | null> {
    const token = await this.getManagementToken();
    const domain = process.env.AUTH0_DOMAIN;

    try {
      const response = await axios.get<Auth0UserWithIdentities[]>(
        `https://${domain}/api/v2/users-by-email`,
        {
          params: { email },
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      const users = response.data ?? [];
      const databaseUser = users.find((user) =>
        user.identities?.some(
          (identity) => identity.connection === 'Username-Password-Authentication'
        )
      );

      return databaseUser ?? users[0] ?? null;
    } catch (error) {
      const axiosError = error as AxiosError<Auth0ErrorResponse>;
      console.error('[forgot-password] Auth0 users-by-email failed:', axiosError.response?.data);
      throw new PasswordResetError(
        'Unable to verify account with Auth0',
        'AUTH0_LOOKUP_FAILED',
        502
      );
    }
  }

  async getUser(auth0UserId: string): Promise<Auth0User> {
    const token = await this.getManagementToken();
    const domain = process.env.AUTH0_DOMAIN;

    try {
      const response = await axios.get<Auth0User>(
        `https://${domain}/api/v2/users/${encodeURIComponent(auth0UserId)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError<Auth0ErrorResponse>;
      console.error('Failed to get user from Auth0:', axiosError.response?.data);
      throw new Error('Failed to get user from Auth0');
    }
  }

  /**
   * Delete user from Auth0
   */
  async deleteUser(auth0UserId: string): Promise<void> {
    const token = await this.getManagementToken();
    const domain = process.env.AUTH0_DOMAIN;

    try {
      await axios.delete(`https://${domain}/api/v2/users/${encodeURIComponent(auth0UserId)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (error) {
      const axiosError = error as AxiosError<Auth0ErrorResponse>;
      console.error('Failed to delete user from Auth0:', axiosError.response?.data);
      throw new Error('Failed to delete user from Auth0');
    }
  }

  async sendPasswordResetEmail(email: string): Promise<{ delivered: boolean; detail: string }> {
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
      throw new PasswordResetError(
        'No Auth0 account found for this email on Username-Password-Authentication',
        'AUTH0_USER_NOT_FOUND',
        404
      );
    }

    const fallbackClientId =
      process.env.AUTH0_CLIENT_ID && process.env.AUTH0_CLIENT_ID !== clientId
        ? process.env.AUTH0_CLIENT_ID
        : null;

    const attemptReset = async (attemptClientId: string) => {
      const response = await axios.post(
        `https://${domain}/dbconnections/change_password`,
        {
          client_id: attemptClientId,
          email,
          connection: 'Username-Password-Authentication',
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );

      const detail =
        typeof response.data === 'string'
          ? response.data
          : 'Password reset email requested from Auth0';

      console.log(
        `[forgot-password] Auth0 change_password OK for ${email} (client ${attemptClientId.slice(0, 8)}..., auth0Id ${auth0User.user_id})`,
        detail
      );

      return { delivered: true, detail };
    };

    try {
      return await attemptReset(clientId);
    } catch (error) {
      const axiosError = error as AxiosError<Auth0ErrorResponse>;
      const status = axiosError.response?.status;

      if (status === 404 && fallbackClientId) {
        console.warn(
          `[forgot-password] Auth0 404 for client ${clientId.slice(0, 8)}..., retrying with AUTH0_CLIENT_ID`
        );
        try {
          return await attemptReset(fallbackClientId);
        } catch (retryError) {
          throw this.toPasswordResetError(email, fallbackClientId, retryError);
        }
      }

      throw this.toPasswordResetError(email, clientId, error);
    }
  }

  private toPasswordResetError(
    email: string,
    clientId: string,
    error: unknown
  ): PasswordResetError {
    const axiosError = error as AxiosError<Auth0ErrorResponse>;
    const status = axiosError.response?.status;
    const data = axiosError.response?.data;

    console.error('[forgot-password] Auth0 change_password failed:', {
      email,
      clientId: `${clientId.slice(0, 8)}...`,
      status,
      data,
    });

    if (data?.name === 'NotFoundError' || status === 404) {
      return new PasswordResetError(
        'Auth0 could not send reset email. Ensure AUTH0_CLIENT_ID is a Regular Web app with Username-Password-Authentication enabled.',
        'RESET_FAILED',
        502
      );
    }

    return new PasswordResetError(
      data?.message || 'Auth0 failed to send password reset email',
      'RESET_FAILED',
      502
    );
  }

  /** Password reset for phone-username Auth0 users (worldwide). */
  async sendPasswordResetForPhone(e164: string): Promise<void> {
    const domain = process.env.AUTH0_DOMAIN;
    const clientId = this.getPasswordResetClientId();
    if (!domain) {
      throw new Error('Auth0 configuration missing');
    }
    const username = e164.replace(/^\+/, '');
    await axios.post(`https://${domain}/dbconnections/change_password`, {
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
  getPasswordResetClientId(): string {
    const clientId =
      process.env.AUTH0_PASSWORD_RESET_CLIENT_ID ||
      process.env.AUTH0_CLIENT_ID ||
      process.env.AUTH0_PASSENGER_CLIENT_ID ||
      process.env.AUTH0_NATIVE_CLIENT_ID;
    if (!clientId) {
      throw new PasswordResetError(
        'Auth0 client ID not configured for password reset. Set AUTH0_CLIENT_ID or AUTH0_PASSWORD_RESET_CLIENT_ID.',
        'CONFIG_ERROR',
        503
      );
    }
    return clientId;
  }

  /**
   * Client ID for passenger (Flutter Native) app logins.
   */
  getPassengerClientId(): string {
    const clientId =
      process.env.AUTH0_PASSENGER_CLIENT_ID ||
      process.env.AUTH0_NATIVE_CLIENT_ID ||
      process.env.AUTH0_CLIENT_ID;
    if (!clientId) {
      throw new Error(
        'Auth0 passenger client ID not configured. Set AUTH0_PASSENGER_CLIENT_ID to your Flutter Native app Client ID.'
      );
    }
    return clientId;
  }

  isPasswordResetConfigured(): boolean {
    return Boolean(process.env.AUTH0_DOMAIN && this.getPasswordResetClientId());
  }

  /**
   * Check if Management API is properly configured
   */
  isConfigured(): boolean {
    return !!(
      process.env.AUTH0_DOMAIN &&
      process.env.AUTH0_MANAGEMENT_CLIENT_ID &&
      process.env.AUTH0_MANAGEMENT_CLIENT_SECRET
    );
  }
}

// Export singleton instance
export const auth0Management = new Auth0ManagementService();
