/**
 * Auth0 Configuration
 *
 * Configures Auth0 settings for JWT verification and authentication
 *
 * Environment Variables Required:
 * - AUTH0_DOMAIN: Your Auth0 tenant domain (e.g., your-tenant.auth0.com)
 * - AUTH0_API_IDENTIFIER: The API identifier/audience (e.g., https://api.drivewize.com)
 * - AUTH0_CLIENT_ID: Backend application client ID
 * - AUTH0_CLIENT_SECRET: Backend application client secret
 */

export const auth0Config = {
  // Auth0 tenant domain
  domain: process.env.AUTH0_DOMAIN || '',

  // API identifier (audience)
  audience: process.env.AUTH0_API_IDENTIFIER || 'https://api.drivewize.com',

  // Client credentials for backend
  clientId: process.env.AUTH0_CLIENT_ID || '',
  clientSecret: process.env.AUTH0_CLIENT_SECRET || '',

  // Token settings
  tokenSigningAlg: 'RS256',

  // JWKS URI for token verification
  jwksUri: process.env.AUTH0_DOMAIN
    ? `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`
    : '',

  // Issuer URL
  issuer: process.env.AUTH0_DOMAIN
    ? `https://${process.env.AUTH0_DOMAIN}/`
    : '',
};

/**
 * Validates Auth0 configuration
 * Throws error if required environment variables are missing
 */
export const validateAuth0Config = (): void => {
  const required = ['AUTH0_DOMAIN', 'AUTH0_API_IDENTIFIER', 'AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required Auth0 environment variables: ${missing.join(', ')}\n` +
      'Please check your .env file and ensure all Auth0 variables are set.'
    );
  }
};

/**
 * Auth0 role definitions
 */
export const Auth0Roles = {
  DRIVER: 'driver',
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin',
} as const;

export type Auth0Role = typeof Auth0Roles[keyof typeof Auth0Roles];

/**
 * Auth0 permissions/scopes
 */
export const Auth0Permissions = {
  // Driver permissions
  READ_OWN_DATA: 'read:own_data',
  UPDATE_OWN_DATA: 'update:own_data',
  CREATE_LOCATION: 'create:location',
  CREATE_TRIP: 'create:trip',

  // Admin permissions
  READ_DRIVERS: 'read:drivers',
  CREATE_DRIVERS: 'create:drivers',
  UPDATE_DRIVERS: 'update:drivers',
  DELETE_DRIVERS: 'delete:drivers',
  READ_REPORTS: 'read:reports',
  EXPORT_DATA: 'export:data',

  // Super admin permissions
  READ_ADMINS: 'read:admins',
  CREATE_ADMINS: 'create:admins',
  UPDATE_ADMINS: 'update:admins',
  DELETE_ADMINS: 'delete:admins',
} as const;

export type Auth0Permission = typeof Auth0Permissions[keyof typeof Auth0Permissions];
