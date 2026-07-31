/**
 * Local Redis verification — uses local .env only (no credentials in output).
 */
import 'dotenv/config';
import {
  redisHealthCheck,
  verifyRedisRealtimeCache,
  verifyRedisPubSub,
  testRedisConnection,
} from '../config/redis';

async function main() {
  const health = await redisHealthCheck();
  const writeRead = await verifyRedisRealtimeCache();
  const pubSub = await verifyRedisPubSub();
  const connected = await testRedisConnection();

  const report = {
    target: 'local',
    backendCommand: 'npm run dev',
    config: {
      client: 'ioredis',
      redisUrlConfigured: Boolean(process.env.REDIS_URL),
      redisHostConfigured: Boolean(process.env.REDIS_HOST),
      redisPortConfigured: Boolean(process.env.REDIS_PORT),
    },
    backendStarted: 'verified separately',
    redisConnected: connected,
    ping: {
      main: health.ping ?? 'failure',
      publisher: health.pubSub?.publisher ? 'PONG' : 'failure',
      subscriber: health.pubSub?.subscriber ? 'PONG' : 'failure',
    },
    writeRead: writeRead.pass ? 'pass' : 'fail',
    pubSub: pubSub.pass ? 'pass' : 'fail',
    latencyMs: health.latency ?? null,
    errors: [writeRead.error, pubSub.error, health.error].filter(Boolean),
    finalStatus:
      connected && health.healthy && writeRead.pass && pubSub.pass
        ? 'REDIS READY'
        : 'REDIS NOT READY',
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.finalStatus === 'REDIS READY' ? 0 : 1);
}

main().catch(() => {
  console.log(JSON.stringify({ target: 'local', finalStatus: 'REDIS NOT READY' }));
  process.exit(1);
});
