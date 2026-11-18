# Redis production operations

## Role in DriveWize

| Use | Key pattern / mechanism | TTL? |
|-----|-------------------------|------|
| Driver presence / location | `location:driver:*`, `status:driver:*`, `heartbeat:driver:*` | Yes (SETEX) |
| Sessions | `session:*` | Yes |
| Maps cache | `maps:*` | Yes |
| API rate limiting | `rl:*` | Yes (PEXPIRE) |
| Socket.IO adapter | Redis adapter internals | Adapter-managed |
| Booking fan-out | Pub/Sub channel `booking:update` | N/A (not durable keys) |

PostgreSQL remains the source of truth for bookings, drivers, and payments.

## Memory / eviction

Configured in `docker/redis/redis.conf`:

- `maxmemory 512mb` (container limit 640M)
- `maxmemory-policy volatile-lru` — only keys **with an expire** may be evicted

### Failure behavior

- Rate-limit store **fail-opens** if Redis errors.
- Driver location/status reads return empty/null on Redis failure; DB inactivity checker still applies.
- Socket.IO Redis adapter: fan-out degrades if Redis is down (single replica is OK).
- Startup: Redis is **required** when `NODE_ENV=production` — process exits if Redis is unhealthy.

## Monitoring

```bash
docker compose -f docker/compose.production.yml --env-file .env.production exec -T redis \
  sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli INFO memory'
docker compose -f docker/compose.production.yml --env-file .env.production exec -T redis \
  sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli INFO stats | grep -E "evicted_keys|rejected_connections"'
```

Alert if `used_memory` approaches `maxmemory`, or `evicted_keys` grows rapidly during peak dispatch.
