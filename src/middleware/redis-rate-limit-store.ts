import type { ClientRateLimitInfo, IncrementResponse, Options, Store } from 'express-rate-limit';
import { redis } from '../config/redis';

/**
 * Redis-backed rate limit store for multi-instance deployments.
 * Uses INCR + EXPIRE per window; compatible with express-rate-limit v7.
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

  async increment(key: string): Promise<IncrementResponse> {
    const redisKey = this.redisKey(key);
    const totalHits = await redis.incr(redisKey);
    if (totalHits === 1) {
      await redis.pexpire(redisKey, this.windowMs);
    }
    const ttlMs = await redis.pttl(redisKey);
    const resetTime =
      ttlMs > 0 ? new Date(Date.now() + ttlMs) : new Date(Date.now() + this.windowMs);
    return { totalHits, resetTime };
  }

  async decrement(key: string): Promise<void> {
    const redisKey = this.redisKey(key);
    const hits = await redis.decr(redisKey);
    if (hits <= 0) {
      await redis.del(redisKey);
    }
  }

  async resetKey(key: string): Promise<void> {
    await redis.del(this.redisKey(key));
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const redisKey = this.redisKey(key);
    const [hitsRaw, ttlMs] = await Promise.all([redis.get(redisKey), redis.pttl(redisKey)]);
    if (!hitsRaw) return undefined;
    const totalHits = parseInt(hitsRaw, 10);
    if (!Number.isFinite(totalHits) || totalHits <= 0) return undefined;
    const resetTime =
      ttlMs > 0 ? new Date(Date.now() + ttlMs) : new Date(Date.now() + this.windowMs);
    return { totalHits, resetTime };
  }
}
