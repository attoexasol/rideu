/**
 * Startup Health Checks
 * Verifies all required services are available before starting the server
 */
interface ServiceHealth {
    name: string;
    status: 'healthy' | 'unhealthy' | 'degraded';
    latency?: number;
    error?: string;
}
interface HealthCheckResult {
    overall: 'healthy' | 'degraded' | 'unhealthy';
    services: ServiceHealth[];
    timestamp: string;
}
/**
 * Run all startup health checks
 */
export declare function runStartupHealthChecks(): Promise<HealthCheckResult>;
/**
 * Verify critical services and fail startup if necessary
 */
export declare function verifyCriticalServices(): Promise<void>;
/**
 * Create a health check endpoint handler
 */
export declare function createHealthCheckHandler(): (_req: any, res: any) => Promise<void>;
/**
 * Safe public API health check — no credentials, URLs, or stack traces.
 * GET /api/health
 */
export declare function createApiHealthCheckHandler(): (_req: any, res: any) => Promise<import("express").Response<any, Record<string, any>>>;
export {};
//# sourceMappingURL=startup-checks.d.ts.map