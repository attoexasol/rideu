const DEFAULT_REDIS_COMMAND_TIMEOUT_MS = Number(
  process.env.REDIS_COMMAND_TIMEOUT_MS || 2000
);

export class RedisCommandTimeoutError extends Error {
  constructor(message = 'Redis command timed out') {
    super(message);
    this.name = 'RedisCommandTimeoutError';
  }
}

/** Prevent hung ioredis commands from blocking HTTP handlers indefinitely. */
export async function withRedisTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number = DEFAULT_REDIS_COMMAND_TIMEOUT_MS
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new RedisCommandTimeoutError()),
          Math.max(100, timeoutMs)
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
