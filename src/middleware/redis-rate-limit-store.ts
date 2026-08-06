import type { ClientRateLimitInfo, IncrementResponse, Options, Store } from 'express-rate-limit';
import { redis, isRedisCacheEnabled } from '../config/redis';
import { withRedisTimeout } from '../utils/redisTimeout';

/**
 * Redis-backed rate limit store for multi-instance deployments.
 * Uses INCR + EXPIRE per window; compatible with express-rate-limit v7.
 * Fails open when Redis is slow/unavailable so passenger APIs are not blocked.
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
