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
export declare const auth0Config: {
    domain: string;
    audience: string;
    clientId: string;
    clientSecret: string;
    tokenSigningAlg: "RS256";
    jwksUri: string;
    issuer: string;
};
/**
 * Validates Auth0 configuration
 * Throws error if required environment variables are missing
 */
export declare const validateAuth0Config: () => void;
/**
 * Auth0 role definitions
 */
export declare const Auth0Roles: {
    readonly DRIVER: "driver";
    readonly ADMIN: "admin";
    readonly SUPER_ADMIN: "super_admin";
    readonly CUSTOMER: "customer";
    readonly FLEET_MANAGER: "fleet_manager";
};
export type Auth0Role = (typeof Auth0Roles)[keyof typeof Auth0Roles];
/**
 * Auth0 permissions/scopes
 */
export declare const Auth0Permissions: {
    readonly READ_OWN_DATA: "read:own_data";
    readonly UPDATE_OWN_DATA: "update:own_data";
    readonly CREATE_LOCATION: "create:location";
    readonly CREATE_TRIP: "create:trip";
    readonly READ_DRIVERS: "read:drivers";
    readonly CREATE_DRIVERS: "create:drivers";
    readonly UPDATE_DRIVERS: "update:drivers";
    readonly DELETE_DRIVERS: "delete:drivers";
    readonly READ_REPORTS: "read:reports";
    readonly EXPORT_DATA: "export:data";
    readonly RIDE_VIDEO_VIEW: "ride_video.view";
    readonly RIDE_VIDEO_PLAY: "ride_video.play";
    readonly RIDE_VIDEO_DOWNLOAD: "ride_video.download";
    readonly RIDE_VIDEO_AUDIT: "ride_video.audit";
    readonly RIDE_VIDEO_MANAGE: "ride_video.manage";
    readonly RIDE_VIDEO_DELETE: "ride_video.delete";
    readonly READ_ADMINS: "read:admins";
    readonly CREATE_ADMINS: "create:admins";
    readonly UPDATE_ADMINS: "update:admins";
    readonly DELETE_ADMINS: "delete:admins";
};
export type Auth0Permission = (typeof Auth0Permissions)[keyof typeof Auth0Permissions];
//# sourceMappingURL=auth0.d.ts.map