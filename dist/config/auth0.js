"use strict";
/**
 * Auth0 Configuration
 *
 * Configures Auth0 settings for JWT verification and authentication
 *
 * Environment Variables Required:
 * - AUTH0_DOMAIN: Your Auth0 tenant domain (e.g., your-tenant.auth0.com)
 * - AUTH0_API_IDENTIFIER or AUTH0_AUDIENCE: API identifier/audience
 * - AUTH0_ALGORITHM: JWT signing algorithm (default RS256)
 * - AUTH0_CLIENT_ID: Backend application client ID
 * - AUTH0_CLIENT_SECRET: Backend application client secret
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Auth0Permissions = exports.Auth0Roles = exports.validateAuth0Config = exports.auth0Config = void 0;
exports.auth0Config = {
    // Auth0 tenant domain
    domain: process.env.AUTH0_DOMAIN || '',
    // API identifier (audience) — AUTH0_AUDIENCE alias supported
    audience: process.env.AUTH0_AUDIENCE || process.env.AUTH0_API_IDENTIFIER || 'https://api.drivewize.com',
    // Client credentials for backend
    clientId: process.env.AUTH0_CLIENT_ID || '',
    clientSecret: process.env.AUTH0_CLIENT_SECRET || '',
    // Token settings
    tokenSigningAlg: (process.env.AUTH0_ALGORITHM || 'RS256'),
    // JWKS URI for token verification
    jwksUri: process.env.AUTH0_DOMAIN
        ? `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`
        : '',
    // Issuer URL
    issuer: process.env.AUTH0_DOMAIN ? `https://${process.env.AUTH0_DOMAIN}/` : '',
};
/**
 * Validates Auth0 configuration
 * Throws error if required environment variables are missing
 */
const validateAuth0Config = () => {
    const required = [
        'AUTH0_DOMAIN',
        'AUTH0_API_IDENTIFIER',
        'AUTH0_CLIENT_ID',
        'AUTH0_CLIENT_SECRET',
    ];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length > 0) {
        throw new Error(`Missing required Auth0 environment variables: ${missing.join(', ')}\n` +
            'Please check your .env file and ensure all Auth0 variables are set.');
    }
};
exports.validateAuth0Config = validateAuth0Config;
/**
 * Auth0 role definitions
 */
exports.Auth0Roles = {
    DRIVER: 'driver',
    ADMIN: 'admin',
    SUPER_ADMIN: 'super_admin',
    CUSTOMER: 'customer',
    FLEET_MANAGER: 'fleet_manager',
};
/**
 * Auth0 permissions/scopes
 */
exports.Auth0Permissions = {
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
};
//# sourceMappingURL=auth0.js.map