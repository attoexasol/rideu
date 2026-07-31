/**
 * Deployed backend Redis verification via HTTP health endpoints only.
 * Does not use local Redis configuration.
 */
const BASE = process.env.LIVE_TEST_BASE_URL || 'http://103.208.181.253:3000';

interface ApiResponse {
  success?: boolean;
  data?: {
    server?: string;
    database?: string;
    redis?: string;
    redisProbes?: {
      ping?: string;
      writeRead?: string;
      pubSub?: string;
    };
  };
  error?: { code?: string; message?: string };
}

interface DetailedHealth {
  overall?: string;
  services?: { name: string; status: string; latency?: number; error?: string }[];
}

async function fetchJson<T>(path: string): Promise<{ status: number; body: T | null; error?: string }> {
  try {
    const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(15000) });
    let body: T | null = null;
    try {
      body = (await res.json()) as T;
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch (e) {
    return {
      status: 0,
      body: null,
      error: e instanceof Error ? e.message : 'Request failed',
    };
  }
}

async function main() {
  const api = await fetchJson<ApiResponse>('/api/health');
  const detailed = await fetchJson<DetailedHealth>('/health');

  const redisService = detailed.body?.services?.find((s) => s.name === 'Redis');
  const hasNewProbes = Boolean(api.body?.data?.redisProbes);

  const report = {
    target: 'deployed',
    baseUrl: BASE,
    healthEndpoint: {
      path: '/api/health',
      httpStatus: api.status,
      reachable: api.status > 0,
      updatedWithRedisProbes: hasNewProbes,
      response: api.body,
      requestError: api.error ?? null,
    },
    legacyHealthEndpoint: {
      path: '/health',
      httpStatus: detailed.status,
      reachable: detailed.status > 0,
      overall: detailed.body?.overall ?? null,
      redisService: redisService
        ? {
            status: redisService.status,
            latencyMs: redisService.latency ?? null,
            error: redisService.error ?? null,
          }
        : null,
      requestError: detailed.error ?? null,
    },
    redis: {
      status: api.body?.data?.redis ?? (redisService?.status === 'healthy' ? 'ok' : 'unknown'),
      ping: api.body?.data?.redisProbes?.ping ?? (redisService?.status === 'healthy' ? 'PONG' : null),
      writeRead: api.body?.data?.redisProbes?.writeRead ?? (hasNewProbes ? null : 'not_available_on_endpoint'),
      pubSub: api.body?.data?.redisProbes?.pubSub ?? (hasNewProbes ? null : 'not_available_on_endpoint'),
    },
    deployNote: hasNewProbes
      ? null
      : 'Rebuild and redeploy backend so GET /api/health includes redisProbes',
    finalStatus: 'REDIS NOT READY',
  };

  const deployedReady =
    api.status === 200 &&
    api.body?.success === true &&
    api.body?.data?.redis === 'ok' &&
    api.body?.data?.database === 'ok' &&
    api.body?.data?.redisProbes?.writeRead === 'pass' &&
    api.body?.data?.redisProbes?.pubSub === 'pass';

  if (deployedReady) {
    report.finalStatus = 'REDIS READY';
  } else if (
    !hasNewProbes &&
    detailed.status === 200 &&
    redisService?.status === 'healthy' &&
    api.status === 404
  ) {
    // Legacy only — cannot confirm probes
    report.finalStatus = 'REDIS NOT READY';
    (report as any).reason = 'Health endpoint not updated; redeploy required for full probe verification';
  } else if (api.status === 0) {
    (report as any).reason = 'Deployed server unreachable from test environment';
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.finalStatus === 'REDIS READY' ? 0 : 1);
}

main().catch(() => {
  console.log(JSON.stringify({ target: 'deployed', finalStatus: 'REDIS NOT READY' }));
  process.exit(1);
});
