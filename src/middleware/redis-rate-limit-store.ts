import type { ClientRateLimitInfo, IncrementResponse, Options, Store } from 'express-rate-limit';
import { redis, isRedisCacheEnabled } from '../config/redis';
import { withRedisTimeout } from '../utils/redisTimeout';

/**
 * Redis-backed rate limit store for multi-instance deployments.
 *
 * Algorithm: fixed window via atomic INCR + PEXPIRE (TTL = windowMs).
 * Chosen over sliding-window/token-bucket because the observed 429s were caused
 * by shared IP identity keys, not fixed-window burst edges. INCR is atomic and
 * consistent across horizontally scaled instances that share REDIS_URL.
 *
 * Operational failure policy: **fail open** — when Redis is disabled, slow, or
 * errors, increment returns totalHits=1 so legitimate traffic is not blocked.
 * This prefers availability over strict limiting during Redis outages.
 *
 * Not suitable as the sole production mechanism without Redis when running
 * multiple Node instances (each would keep a separate in-memory counter).
 */
export class RedisRateLimitStore implements Store {
  prefix: string;
  private keyPrefix: string;
  private windowMs = 60_000;

  constructor(prefix: string) {
    this.prefix = prefix;
    this.keyPrefix = `rl:${prefix}:`;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private redisKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  private failOpen(): IncrementResponse {
    return {
      totalHits: 1,
      resetTime: new Date(Date.now() + this.windowMs),
    };
  }

  async increment(key: string): Promise<IncrementResponse> {
    if (!isRedisCacheEnabled()) return this.failOpen();
    const redisKey = this.redisKey(key);
    try {
      const totalHits = await withRedisTimeout(redis.incr(redisKey));
      if (totalHits === 1) {
        await withRedisTimeout(redis.pexpire(redisKey, this.windowMs));
      }
      const ttlMs = await withRedisTimeout(redis.pttl(redisKey));
      const resetTime =
        ttlMs > 0 ? new Date(Date.now() + ttlMs) : new Date(Date.now() + this.windowMs);
      return { totalHits, resetTime };
    } catch {
      return this.failOpen();
    }
  }

  async decrement(key: string): Promise<void> {
    const redisKey = this.redisKey(key);
    try {
      const hits = await withRedisTimeout(redis.decr(redisKey));
      if (hits <= 0) {
        await withRedisTimeout(redis.del(redisKey));
      }
    } catch {
      // fail open
    }
  }

  async resetKey(key: string): Promise<void> {
    try {
      await withRedisTimeout(redis.del(this.redisKey(key)));
    } catch {
      // fail open
    }
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const redisKey = this.redisKey(key);
    try {
      const [hitsRaw, ttlMs] = await Promise.all([
        withRedisTimeout(redis.get(redisKey)),
        withRedisTimeout(redis.pttl(redisKey)),
      ]);
      if (!hitsRaw) return undefined;
      const totalHits = parseInt(hitsRaw, 10);
      if (!Number.isFinite(totalHits) || totalHits <= 0) return undefined;
      const resetTime =
        ttlMs > 0 ? new Date(Date.now() + ttlMs) : new Date(Date.now() + this.windowMs);
      return { totalHits, resetTime };
    } catch {
      return undefined;
    }
  }
}
