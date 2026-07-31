/**
 * Startup Health Checks
 * Verifies all required services are available before starting the server
 */

import { redisHealthCheck, verifyRedisRealtimeCache, verifyRedisPubSub } from '../config/redis';
import { healthCheck as dbHealthCheck } from '../db/connection';
import { sendSuccess, sendError } from './response';
import axios from 'axios';

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
 * Check if Auth0 is reachable
 */
async function checkAuth0Health(): Promise<ServiceHealth> {
  const auth0Domain = process.env.AUTH0_DOMAIN;

  if (!auth0Domain) {
    return {
      name: 'Auth0',
      status: 'unhealthy',
      error: 'AUTH0_DOMAIN not configured',
    };
  }

  try {
    const start = Date.now();
    const response = await axios.get(`https://${auth0Domain}/.well-known/openid-configuration`, {
      timeout: 5000,
    });
    const latency = Date.now() - start;

    return {
      name: 'Auth0',
      status: response.status === 200 ? 'healthy' : 'degraded',
      latency,
    };
  } catch (error) {
    return {
      name: 'Auth0',
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check if Mapbox is reachable (if configured)
 */
async function checkMapboxHealth(): Promise<ServiceHealth | null> {
  const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN;

  if (!mapboxToken) {
    // Mapbox is optional
    return null;
  }

  try {
    const start = Date.now();
    const response = await axios.get(
      `https://api.mapbox.com/tokens/v2?access_token=${mapboxToken}`,
      {
        timeout: 5000,
      }
    );
    const latency = Date.now() - start;

    return {
      name: 'Mapbox',
      status: response.status === 200 ? 'healthy' : 'degraded',
      latency,
    };
  } catch (error) {
    return {
      name: 'Mapbox',
      status: 'degraded', // Don't fail startup if Mapbox is down
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Run all startup health checks
 */
export async function runStartupHealthChecks(): Promise<HealthCheckResult> {
  console.log('\n🔍 Running startup health checks...\n');

  const services: ServiceHealth[] = [];

  // Check Database
  console.log('  Checking Database...');
  const dbHealth = await dbHealthCheck();
  services.push({
    name: 'PostgreSQL',
    status: dbHealth.healthy ? 'healthy' : 'unhealthy',
    latency: dbHealth.latency,
    error: dbHealth.error,
  });
  console.log(`    ✓ Database: ${dbHealth.healthy ? 'Connected' : '✗ Failed'}`);

  // Check Redis
  console.log('  Checking Redis...');
  const redisHealth = await redisHealthCheck();
  services.push({
    name: 'Redis',
    status: redisHealth.healthy ? 'healthy' : 'unhealthy',
    latency: redisHealth.latency,
    error: redisHealth.error,
  });
  console.log(`    ✓ Redis: ${redisHealth.healthy ? 'Connected' : '✗ Failed'}`);

  // Check Auth0 (only in production/staging)
  const nodeEnv = process.env.NODE_ENV?.trim();
  const bypassAuth = process.env.BYPASS_AUTH === 'true';

  if (!bypassAuth && nodeEnv !== 'development' && nodeEnv !== 'test') {
    console.log('  Checking Auth0...');
    const auth0Health = await checkAuth0Health();
    services.push(auth0Health);
    console.log(`    ${auth0Health.status === 'healthy' ? '✓' : '✗'} Auth0: ${auth0Health.status}`);
  }

  // Check Mapbox (optional)
  if (process.env.MAPBOX_ACCESS_TOKEN) {
    console.log('  Checking Mapbox...');
    const mapboxHealth = await checkMapboxHealth();
    if (mapboxHealth) {
      services.push(mapboxHealth);
      console.log(
        `    ${mapboxHealth.status === 'healthy' ? '✓' : '⚠'} Mapbox: ${mapboxHealth.status}`
      );
    }
  }

  // Determine overall health
  const unhealthyCount = services.filter((s) => s.status === 'unhealthy').length;
  const degradedCount = services.filter((s) => s.status === 'degraded').length;

  let overall: 'healthy' | 'degraded' | 'unhealthy';
  if (unhealthyCount > 0) {
    overall = 'unhealthy';
  } else if (degradedCount > 0) {
    overall = 'degraded';
  } else {
    overall = 'healthy';
  }

  const result: HealthCheckResult = {
    overall,
    services,
    timestamp: new Date().toISOString(),
  };

  // Print summary
  console.log('\n📊 Health Check Summary:');
  console.log(`  Overall Status: ${overall.toUpperCase()}`);
  services.forEach((service) => {
    const icon = service.status === 'healthy' ? '✅' : service.status === 'degraded' ? '⚠️' : '❌';
    const latencyStr = service.latency ? ` (${service.latency}ms)` : '';
    const errorStr = service.error ? ` - ${service.error}` : '';
    console.log(`  ${icon} ${service.name}: ${service.status}${latencyStr}${errorStr}`);
  });

  return result;
}

/**
 * Verify critical services and fail startup if necessary
 */
export async function verifyCriticalServices(): Promise<void> {
  const healthCheck = await runStartupHealthChecks();

  // Check for critical service failures
  const criticalServices = ['PostgreSQL', 'Redis'];
  const failedCritical = healthCheck.services.filter(
    (s) => criticalServices.includes(s.name) && s.status === 'unhealthy'
  );

  if (failedCritical.length > 0) {
    console.error('\n❌ Critical services are unavailable:');
    failedCritical.forEach((service) => {
      console.error(`  - ${service.name}: ${service.error || 'Connection failed'}`);
    });
    console.error('\nPlease ensure all required services are running and try again.');
    process.exit(1);
  }

  // Warn about degraded services but don't fail
  const degradedServices = healthCheck.services.filter((s) => s.status === 'degraded');
  if (degradedServices.length > 0) {
    console.warn('\n⚠️  Some services are degraded:');
    degradedServices.forEach((service) => {
      console.warn(`  - ${service.name}: ${service.error || 'Service degraded'}`);
    });
    console.warn('\nThe server will start but some features may not work properly.');
  }

  if (healthCheck.overall === 'healthy') {
    console.log('\n✅ All services are healthy. Ready to start server.\n');
  }
}

/**
 * Create a health check endpoint handler
 */
export function createHealthCheckHandler() {
  return async (_req: any, res: any) => {
    const healthCheck = await runStartupHealthChecks();

    const statusCode =
      healthCheck.overall === 'healthy' ? 200 : healthCheck.overall === 'degraded' ? 200 : 503;

    res.status(statusCode).json(healthCheck);
  };
}

/**
 * Safe public API health check — no credentials, URLs, or stack traces.
 * GET /api/health
 */
export function createApiHealthCheckHandler() {
  return async (_req: any, res: any) => {
    try {
      const [dbHealth, redisHealth, writeRead, pubSub] = await Promise.all([
        dbHealthCheck(),
        redisHealthCheck(),
        verifyRedisRealtimeCache(),
        verifyRedisPubSub(),
      ]);

      const redisOk =
        redisHealth.healthy && writeRead.pass && pubSub.pass;

      const data = {
        server: 'ok',
        database: dbHealth.healthy ? 'ok' : 'error',
        redis: redisOk ? 'ok' : 'error',
        redisProbes: {
          ping: redisHealth.ping ?? (redisHealth.healthy ? 'PONG' : 'failure'),
          writeRead: writeRead.pass ? 'pass' : 'fail',
          pubSub: pubSub.pass ? 'pass' : 'fail',
        },
      };

      const allOk = data.database === 'ok' && data.redis === 'ok';
      if (allOk) {
        return sendSuccess(res, data);
      }

      return sendError(res, 'SERVICE_UNAVAILABLE', 'One or more services are unavailable', 503, data);
    } catch {
      return sendError(
        res,
        'HEALTH_CHECK_FAILED',
        'Health check failed',
        503,
        {
          server: 'ok',
          database: 'error',
          redis: 'error',
          redisProbes: { ping: 'failure', writeRead: 'fail', pubSub: 'fail' },
        }
      );
    }
  };
}
