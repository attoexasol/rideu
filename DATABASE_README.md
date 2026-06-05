# Database Schema Documentation

## Overview
Complete PostgreSQL database schema for DriveWize GPS Tracking System using Drizzle ORM.

## Schema Files
All schemas are located in `src/db/schema/`:

### 1. **vehicles.ts**
- Vehicle fleet information
- Fields: make, model, year, plate_number, vin
- Index: plate_number

### 2. **drivers.ts**
- Driver accounts and status
- Fields: auth0_id, email, name, phone, status, vehicle_id, last_seen
- Indexes: status, auth0_id
- References: vehicles

### 3. **locations.ts**
- GPS location data with high precision
- Fields: driver_id, latitude (DECIMAL 10,8), longitude (DECIMAL 11,8), accuracy, speed, heading, timestamp
- Indexes: driver_id, timestamp DESC, composite (driver_id + timestamp DESC)
- References: drivers (CASCADE delete)

### 4. **trips.ts**
- Trip tracking and history
- Fields: driver_id, start_time, end_time, distance, status, start_location_id, end_location_id
- Indexes: driver_id, status, start_time DESC
- References: drivers (CASCADE), locations (start/end)

### 5. **admin_users.ts**
- Administrative user accounts
- Fields: auth0_id, email, name, role
- Index: auth0_id

### 6. **sessions.ts**
- User session management
- Fields: user_id, user_type, token, expires_at
- Indexes: token, user_id, expires_at

### 7. **logs.ts**
- System and user activity logs
- Fields: event_type, user_id, user_type, message, metadata (JSONB)
- Indexes: event_type, timestamp DESC

## Database Connection
**File:** `src/db/connection.ts`

Features:
- Connection pooling (max 20 connections)
- Health check endpoint
- Automatic reconnection with timeout handling
- Graceful shutdown support

## Redis Configuration
**File:** `src/config/redis.ts`

Features:
- Session caching with TTL
- Real-time driver location caching
- Pub/Sub channels for WebSocket broadcasting
- Three Redis clients: main, publisher, subscriber
- Helper functions for session and location caching

### Pub/Sub Channels:
- `location:update` - Location broadcasts
- `driver:status` - Status changes
- `driver:online` - Driver connected
- `driver:offline` - Driver disconnected
- `trip:update` - Trip updates

## Database Utilities
**File:** `src/db/utils.ts`

Comprehensive helper functions for:
- **Driver operations**: findByAuth0Id, findByEmail, updateStatus, findByStatus
- **Location operations**: getLatestForDriver, getHistoryForDriver, getActiveDriverLocations
- **Trip operations**: getForDriver, getActiveForDriver, start, end, getStatsForDriver
- **Admin operations**: findByAuth0Id, findByEmail, findByRole
- **Session operations**: create, findByToken, deleteByToken, deleteExpired
- **Maintenance**: cleanupOldLocations, cleanupOldTrips, getStats

## Scripts

### Database Setup
```bash
# Create database (run once)
npx tsx src/db/create-database.ts

# Run migrations
npm run db:migrate

# Seed with test data
npm run db:seed
```

### Testing
```bash
# Test connections
npx tsx src/db/test-connection.ts

# Verify schema
npx tsx src/db/verify-schema.ts
```

### Development
```bash
# Generate new migrations after schema changes
npm run db:generate

# Open Drizzle Studio (GUI)
npm run db:studio
```

## Migrations
Migrations are stored in `src/db/migrations/` and managed by Drizzle Kit.

Current migration: `0000_redundant_deathbird.sql`
- Creates all 7 tables
- Adds all foreign key constraints
- Creates all performance indexes

## Test Data
Seeded data includes:
- 3 vehicles (Ford F-150, Chevrolet Silverado, Ram 1500)
- 5 drivers (various statuses: online, active, idle, offline)
- 3 admin users (admin, super_admin roles)
- 6 location records (San Francisco, Los Angeles, San Diego)
- 4 trips (completed, in_progress, cancelled)

## Environment Variables
Required in `.env`:
```bash
DATABASE_URL=postgresql://user:password@localhost:5432/drivewize
DB_HOST=localhost
DB_PORT=5432
DB_NAME=drivewize
DB_USER=user
DB_PASSWORD=password

REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379
```

## Performance Optimizations

### Indexes Created:
- **drivers**: status, auth0_id
- **locations**: driver_id, timestamp DESC, (driver_id + timestamp DESC) composite
- **trips**: driver_id, status, start_time DESC
- **admin_users**: auth0_id
- **sessions**: token, user_id, expires_at
- **vehicles**: plate_number
- **logs**: event_type, timestamp DESC

### Cascade Deletes:
- Deleting a driver cascades to locations and trips
- Protects referential integrity

## Type Safety
All schemas export TypeScript types:
```typescript
import { Driver, NewDriver } from './schema/drivers';
import { Location, NewLocation } from './schema/locations';
// etc.
```

Types are automatically inferred from Drizzle schemas.

## Integration Points

### For API Endpoints Agent:
- Import `db` from `src/db/connection.ts`
- Use utility functions from `src/db/utils.ts`
- Import types from `src/db/schema/`

### For WebSocket Server Agent:
- Import Redis clients from `src/config/redis.ts`
- Use `PubSubChannels` constants
- Use `realtimeCache` helpers for driver locations

### Example Usage:
```typescript
import { db } from './db/connection';
import { driverUtils, locationUtils } from './db/utils';
import { realtimeCache, PubSubChannels, redisPub } from './config/redis';

// Find driver
const driver = await driverUtils.findByAuth0Id(auth0Id);

// Get latest location
const location = await locationUtils.getLatestForDriver(driverId);

// Cache location in Redis
await realtimeCache.setDriverLocation(driverId, location);

// Broadcast location update
await redisPub.publish(
  PubSubChannels.LOCATION_UPDATE,
  JSON.stringify({ driverId, location })
);
```

## Acceptance Criteria Status
✅ All 7 tables defined with Drizzle ORM schemas
✅ All indexes created as specified
✅ Database connection with pooling configured
✅ Migration files generated and tested
✅ Seed data script functional
✅ Redis client configured and tested
✅ TypeScript types exported from schemas
✅ Can run: npm run db:migrate, npm run db:seed
✅ Database can be connected to from backend
✅ No errors when running migrations

## Next Steps for Other Agents
1. **api_endpoints**: Import db connection and utilities for route handlers
2. **websocket_server**: Use Redis Pub/Sub for real-time broadcasting
3. Both agents can start immediately - all database infrastructure is ready
