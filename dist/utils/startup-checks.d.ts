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
export {};
//# sourceMappingURL=startup-checks.d.ts.map