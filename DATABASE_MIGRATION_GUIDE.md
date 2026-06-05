# Database Migration and Redis Strategy - DriveWize

## Table of Contents
1. [Database Migration Strategy](#database-migration-strategy)
2. [Drizzle ORM Migration Setup](#drizzle-orm-migration-setup)
3. [Production Migration Workflow](#production-migration-workflow)
4. [Redis Configuration for Production](#redis-configuration-for-production)
5. [Database Backup Strategy](#database-backup-strategy)
6. [Rollback Procedures](#rollback-procedures)

---

## Database Migration Strategy

### Overview
DriveWize uses Drizzle ORM for database schema management and migrations. All schema changes are version-controlled and applied through migration files.

### Migration Principles
1. **Forward-only migrations**: Never modify existing migration files
2. **Atomic changes**: Each migration should be a single logical change
3. **Reversible**: Always consider rollback scenarios
4. **Tested**: Test migrations on staging before production
5. **Documented**: Include comments explaining complex changes

---

## Drizzle ORM Migration Setup

### Directory Structure
```
backend/
├── src/
│   └── db/
│       ├── schema/
│       │   ├── drivers.ts
│       │   ├── locations.ts
│       │   ├── trips.ts
│       │   ├── vehicles.ts
│       │   ├── admin-users.ts
│       │   └── index.ts
│       ├── migrations/
│       │   ├── 0001_create_drivers_table.sql
│       │   ├── 0002_create_locations_table.sql
│       │   └── ...
│       └── index.ts
└── drizzle.config.ts
```

### Drizzle Configuration (drizzle.config.ts)
```typescript
import type { Config } from 'drizzle-kit';
import * as dotenv from 'dotenv';

dotenv.config();

export default {
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  driver: 'pg',
  dbCredentials: {
    connectionString: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
} satisfies Config;
```

### Creating Migrations

#### 1. Modify Schema Files
Update your schema definitions in `src/db/schema/`:

```typescript
// Example: src/db/schema/drivers.ts
import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';

export const drivers = pgTable('drivers', {
  id: uuid('id').primaryKey().defaultRandom(),
  auth0Id: varchar('auth0_id', { length: 255 }).notNull().unique(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }),
  status: varchar('status', { length: 50 }).default('offline'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
```

#### 2. Generate Migration
```bash
npm run db:generate
# or
npx drizzle-kit generate:pg
```

This creates a new SQL file in `src/db/migrations/` with the schema changes.

#### 3. Review Generated SQL
Always review the generated SQL before applying:
```bash
cat src/db/migrations/0003_new_migration.sql
```

#### 4. Apply Migration (Development)
```bash
npm run db:migrate
# or
npx drizzle-kit push:pg
```

---

## Production Migration Workflow

### Pre-Migration Checklist
- [ ] Migration tested in development environment
- [ ] Migration tested in staging environment
- [ ] Database backup completed
- [ ] Rollback plan documented
- [ ] Maintenance window scheduled (if needed)
- [ ] Team notified of deployment

### Step-by-Step Production Migration

#### Step 1: Backup Database
```bash
# Automated backup (recommended)
pg_dump -h your-db-host -U username -d drivewize -F c -b -v -f backup_$(date +%Y%m%d_%H%M%S).dump

# Or use your hosting provider's backup tool
# Railway: Automatic daily backups
# Supabase: Dashboard > Database > Backups
```

#### Step 2: Run Migrations During Deployment

**Option A: Via CI/CD (Recommended)**
Migrations run automatically in GitHub Actions before starting the new application version.

**Option B: Manual Migration**
```bash
# SSH or access your production environment
cd /app/backend

# Run migrations
npm run db:migrate

# Or using Drizzle directly
npx drizzle-kit push:pg --config=drizzle.config.ts
```

#### Step 3: Verify Migration
```bash
# Check tables and schema
psql $DATABASE_URL -c "\dt"
psql $DATABASE_URL -c "\d drivers"

# Test basic queries
psql $DATABASE_URL -c "SELECT COUNT(*) FROM drivers;"
```

#### Step 4: Deploy Application
After successful migration, deploy the new application version that uses the updated schema.

### Zero-Downtime Migration Strategy

For critical tables with active traffic:

1. **Additive Changes First**
   - Add new columns with default values
   - Add new tables
   - Add new indexes (using `CONCURRENTLY` in PostgreSQL)

2. **Deploy Application (backward compatible)**
   - Application reads from old and new columns
   - Application writes to both old and new columns

3. **Data Migration**
   - Migrate data from old to new columns (in batches)
   - Use background jobs to avoid locking

4. **Deploy Application (new version)**
   - Application uses only new columns/tables

5. **Cleanup**
   - Remove old columns (after verification period)

**Example: Adding a new column**
```sql
-- Step 1: Add column with default
ALTER TABLE drivers ADD COLUMN vehicle_id UUID;

-- Step 2: Migrate data (if needed)
UPDATE drivers SET vehicle_id = old_vehicle_id WHERE vehicle_id IS NULL;

-- Step 3: Add constraint (after data is migrated)
ALTER TABLE drivers ADD CONSTRAINT fk_vehicle
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id);
```

---

## Redis Configuration for Production

### Redis Use Cases in DriveWize
1. **Session Storage**: User sessions and JWT tokens
2. **Real-time Data Cache**: Latest driver locations
3. **Pub/Sub**: WebSocket event broadcasting
4. **Rate Limiting**: API request throttling
5. **Queue Management**: Background jobs (if implemented)

### Production Redis Setup

#### Environment Variables
```bash
REDIS_URL=redis://default:password@your-redis-host:6379
REDIS_PASSWORD=your-secure-password
```

#### Redis Connection Configuration
```typescript
// src/config/redis.ts
import Redis from 'ioredis';

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,

  // Production settings
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  enableOfflineQueue: true,

  // Connection pool
  lazyConnect: false,
  keepAlive: 30000,

  // Reconnection strategy
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },

  // TLS for production
  tls: process.env.NODE_ENV === 'production' ? {} : undefined,
};

export const redisClient = new Redis(redisConfig);

// Health check
redisClient.on('connect', () => {
  console.log('Redis connected');
});

redisClient.on('error', (err) => {
  console.error('Redis error:', err);
});
```

### Redis Data Structures

#### 1. Session Storage
```typescript
// Store session
await redis.setex(`session:${userId}`, 86400, JSON.stringify(sessionData));

// Retrieve session
const session = await redis.get(`session:${userId}`);
```

#### 2. Latest Location Cache
```typescript
// Store latest location (with 5-minute TTL)
await redis.setex(
  `location:${driverId}`,
  300,
  JSON.stringify({ lat, lng, timestamp })
);

// Get all active driver locations
const keys = await redis.keys('location:*');
const locations = await redis.mget(keys);
```

#### 3. Pub/Sub for WebSocket
```typescript
// Publisher (when location received)
await redis.publish('location-updates', JSON.stringify({
  driverId,
  latitude,
  longitude,
  timestamp,
}));

// Subscriber (in WebSocket server)
const subscriber = redis.duplicate();
subscriber.subscribe('location-updates');
subscriber.on('message', (channel, message) => {
  const data = JSON.parse(message);
  io.to('admin-room').emit('location:broadcast', data);
});
```

#### 4. Rate Limiting
```typescript
// Check rate limit
const key = `rate-limit:${userId}:${endpoint}`;
const count = await redis.incr(key);

if (count === 1) {
  await redis.expire(key, windowMs / 1000);
}

if (count > maxRequests) {
  throw new Error('Rate limit exceeded');
}
```

### Redis Persistence Configuration

For production, configure Redis persistence:

**redis.conf settings:**
```conf
# RDB persistence (snapshots)
save 900 1      # Save after 900 sec if at least 1 key changed
save 300 10     # Save after 300 sec if at least 10 keys changed
save 60 10000   # Save after 60 sec if at least 10000 keys changed

# AOF persistence (append-only file)
appendonly yes
appendfsync everysec
```

### Redis Memory Management
```conf
# Set max memory (e.g., 256MB)
maxmemory 256mb

# Eviction policy (LRU for cache)
maxmemory-policy allkeys-lru
```

---

## Database Backup Strategy

### Automated Backups

#### 1. Hosting Provider Backups
- **Railway**: Automatic daily backups (last 7 days on Pro plan)
- **Supabase**: Daily backups (configurable retention)
- **Render**: Automated backups based on plan

#### 2. Custom Backup Script
```bash
#!/bin/bash
# backup-database.sh

# Configuration
BACKUP_DIR="/backups/postgres"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="drivewize_backup_${TIMESTAMP}.dump"
RETENTION_DAYS=30

# Create backup directory
mkdir -p $BACKUP_DIR

# Perform backup
pg_dump $DATABASE_URL -F c -b -v -f "${BACKUP_DIR}/${BACKUP_FILE}"

# Compress backup
gzip "${BACKUP_DIR}/${BACKUP_FILE}"

# Upload to S3 (optional)
aws s3 cp "${BACKUP_DIR}/${BACKUP_FILE}.gz" "s3://drivewize-backups/postgres/"

# Remove old backups (older than 30 days)
find $BACKUP_DIR -name "*.dump.gz" -mtime +$RETENTION_DAYS -delete

echo "Backup completed: ${BACKUP_FILE}.gz"
```

#### 3. Schedule with Cron
```bash
# Run daily at 2 AM UTC
0 2 * * * /path/to/backup-database.sh >> /var/log/backup.log 2>&1
```

### Backup Verification
```bash
# Test restore to verify backup integrity
pg_restore -h localhost -U postgres -d drivewize_test backup.dump

# Verify data
psql -h localhost -U postgres -d drivewize_test -c "SELECT COUNT(*) FROM drivers;"
```

---

## Rollback Procedures

### Database Rollback

#### Scenario 1: Migration Failed
```bash
# If migration failed mid-way, restore from backup
pg_restore -h your-db-host -U username -d drivewize -c backup.dump

# Or use hosting provider's backup restore feature
```

#### Scenario 2: Migration Succeeded but Application Broken
1. **Quick Fix**: Revert application deployment (rollback to previous version)
2. **Database Revert**: Restore from pre-migration backup if schema change is incompatible

#### Creating Reversible Migrations
```typescript
// migrations/0003_add_vehicle_column.ts
export const up = async (db: Database) => {
  await db.execute(`ALTER TABLE drivers ADD COLUMN vehicle_id UUID;`);
};

export const down = async (db: Database) => {
  await db.execute(`ALTER TABLE drivers DROP COLUMN vehicle_id;`);
};
```

### Application Rollback

#### Using Docker/Kubernetes
```bash
# Rollback to previous Docker image tag
docker pull drivewize-backend:v1.2.3
docker stop drivewize-backend
docker run -d --name drivewize-backend drivewize-backend:v1.2.3

# Or with Kubernetes
kubectl rollout undo deployment/drivewize-backend
```

#### Using Railway/Render
- Railway: Dashboard > Deployments > Rollback to previous deployment
- Render: Dashboard > Services > Rollback

### Redis Rollback
Redis data is cache/ephemeral:
- No rollback needed for most cases
- If data corruption occurs, flush and rebuild:
```bash
redis-cli FLUSHDB  # Clear current database
# Application will repopulate cache from PostgreSQL
```

---

## Emergency Procedures

### Database Connection Issues
```bash
# Check database status
pg_isready -h your-db-host -p 5432

# Check connection pool
psql $DATABASE_URL -c "SELECT * FROM pg_stat_activity WHERE datname = 'drivewize';"

# Kill long-running queries
psql $DATABASE_URL -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle in transaction';"
```

### Redis Connection Issues
```bash
# Check Redis status
redis-cli ping

# Check memory usage
redis-cli INFO memory

# Clear cache if needed
redis-cli FLUSHDB
```

### High Database Load
```sql
-- Identify slow queries
SELECT pid, now() - pg_stat_activity.query_start AS duration, query
FROM pg_stat_activity
WHERE state != 'idle'
ORDER BY duration DESC;

-- Add missing indexes
CREATE INDEX CONCURRENTLY idx_locations_driver_timestamp
ON locations(driver_id, timestamp DESC);
```

---

## Monitoring and Alerts

### Key Metrics to Monitor
1. **Database**
   - Connection pool usage
   - Query performance
   - Disk space
   - Replication lag (if applicable)

2. **Redis**
   - Memory usage
   - Hit/miss ratio
   - Connection count
   - Eviction rate

3. **Migrations**
   - Migration duration
   - Migration success/failure rate
   - Schema version

### Health Checks
```typescript
// src/routes/health.ts
export const healthCheck = async (req, res) => {
  try {
    // Check database
    await db.execute('SELECT 1');

    // Check Redis
    await redis.ping();

    res.json({
      status: 'healthy',
      database: 'connected',
      redis: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
    });
  }
};
```

---

## Best Practices

### Do's ✅
- ✅ Always backup before migrations
- ✅ Test migrations in staging first
- ✅ Use transactions for complex migrations
- ✅ Monitor migration performance
- ✅ Document schema changes in migration files
- ✅ Use connection pooling
- ✅ Set appropriate Redis TTLs
- ✅ Version control all schema files

### Don'ts ❌
- ❌ Never run migrations directly on production without testing
- ❌ Don't modify existing migration files
- ❌ Avoid long-running migrations during peak hours
- ❌ Don't store critical data only in Redis
- ❌ Don't skip backups
- ❌ Don't use SELECT * in production queries
- ❌ Avoid N+1 query problems

---

## Troubleshooting

### Migration Fails with "Column Already Exists"
```sql
-- Use IF NOT EXISTS
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS vehicle_id UUID;
```

### Redis Connection Timeouts
```typescript
// Increase timeout
const redis = new Redis({
  connectTimeout: 10000,
  commandTimeout: 5000,
});
```

### Database Locks During Migration
```sql
-- Check for locks
SELECT * FROM pg_locks WHERE NOT granted;

-- Kill blocking queries
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid IN (SELECT blocking_pids);
```

---

## Additional Resources

- [Drizzle ORM Documentation](https://orm.drizzle.team/)
- [PostgreSQL Migration Best Practices](https://www.postgresql.org/docs/current/ddl-alter.html)
- [Redis Best Practices](https://redis.io/docs/manual/patterns/)
- [Zero-Downtime Migrations](https://blog.codeship.com/zero-downtime-database-migrations/)

---

**Last Updated**: 2025-10-13
**Maintained By**: DevOps Team
