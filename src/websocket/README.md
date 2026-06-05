# WebSocket Server Implementation

## Overview
This directory contains the Socket.IO WebSocket server implementation for the DriveWize GPS Tracking System. It provides real-time bidirectional communication for GPS location tracking, driver status updates, and admin monitoring.

## Architecture

### Core Components

1. **server.ts** - Main WebSocket server setup
   - Socket.IO configuration with Redis adapter
   - Authentication middleware using JWT tokens
   - Connection state management
   - Room-based broadcasting
   - Heartbeat/timeout detection

2. **types.ts** - TypeScript type definitions
   - Event payload interfaces
   - Socket data structures
   - Connection state types

3. **connection-state.ts** - Connection state manager
   - In-memory tracking of active connections
   - Heartbeat monitoring
   - Stale connection detection

4. **message-buffer.ts** - Message buffer for offline clients
   - Buffers location updates for disconnected admins
   - FIFO queue with configurable size (default: 50 messages)
   - Auto-delivery on reconnection

### Event Handlers

Located in `handlers/` directory:

1. **authentication.ts**
   - Handles re-authentication events
   - Authentication status checks
   - Room management based on user role

2. **location.ts**
   - Receives location updates from drivers
   - Validates GPS coordinates
   - Stores location in PostgreSQL database
   - Caches location in Redis
   - Broadcasts to all admins in 'admin' room
   - Publishes to Redis Pub/Sub for multi-server scalability
   - Sends acknowledgment to driver

3. **driver-status.ts**
   - Handles driver status changes (online, offline)
   - Updates database and Redis cache
   - Broadcasts status changes to admins
   - Manages driver:online and driver:offline events

4. **connection.ts**
   - Handles connection lifecycle events
   - Auto-sets driver status to online on connect
   - Handles explicit disconnect requests
   - Updates last_seen timestamps

## WebSocket Events

### Connection Events
- `connect` - Client connects (auto-triggered by Socket.IO)
- `authenticated` - Server confirms successful authentication
- `connection:established` - Client confirms ready state
- `disconnect` - Client disconnects (auto-triggered)
- `ping` / `pong` - Heartbeat mechanism

### Location Events
- `location:update` (Driver → Server) - Driver sends GPS coordinates
- `location:ack` (Server → Driver) - Server acknowledges receipt
- `location:broadcast` (Server → Admins) - Real-time location broadcast
- `location:get` (Admin → Server) - Request driver's latest location

### Status Events
- `driver:status` - Update driver status
- `driver:status_change` - Broadcast status change to admins
- `driver:online` - Notify admins when driver comes online
- `driver:offline` - Notify admins when driver goes offline
- `driver:go_online` - Driver explicitly goes online
- `driver:go_offline` - Driver explicitly goes offline

### Authentication Events
- `authenticate` - Re-authenticate or confirm auth status
- `auth:status` - Check current authentication status

### Error Events
- `error` - Server sends error to client with code and message

## Room Architecture

### Admin Room
- All authenticated admin users join the `admin` room
- Receives all location broadcasts
- Receives all driver status changes
- Receives driver online/offline notifications

### Driver Rooms
- Each driver joins their own room: `driver-{driverId}`
- Can be used for targeted messages to specific drivers
- Future: Can be used for dispatch messages

## Redis Integration

### Redis Adapter
- Uses `@socket.io/redis-adapter` for horizontal scaling
- Allows multiple WebSocket server instances
- Synchronizes events across all server instances

### Redis Pub/Sub Channels
- `location:update` - Location updates
- `driver:status` - Status changes
- `driver:online` - Driver online events
- `driver:offline` - Driver offline events
- `trip:update` - Trip updates (future)

### Redis Caching
- Driver locations cached with 5-minute TTL
- Driver status cached with 10-minute TTL
- Fast retrieval without database queries

## Authentication Flow

1. Client connects to WebSocket server
2. Client provides JWT token via `handshake.auth.token` or `handshake.query.token`
3. Server decodes and verifies JWT token
4. Server extracts user information (userId, role, email, name)
5. Server attaches user data to `socket.data`
6. Server joins user to appropriate rooms
7. Server emits `authenticated` event with user info
8. Server delivers any buffered messages (for admins)

## Connection Management

### Heartbeat
- Client sends `ping` every 30 seconds
- Server responds with `pong` and updates heartbeat timestamp
- Configurable via Socket.IO `pingInterval` (default: 30s)

### Timeout Detection
- Server checks for stale connections every 60 seconds
- Connections with no heartbeat for 2 minutes are considered stale
- Stale connections are forcefully disconnected
- Driver status automatically set to offline on disconnect

### Reconnection
- Socket.IO handles automatic reconnection on client side
- Exponential backoff: 1s, 2s, 4s, 8s, max 30s
- Server handles duplicate connections gracefully
- Buffered messages delivered on reconnection

## Message Buffering

### Purpose
- Prevents loss of location updates when admins are offline
- Ensures admins see recent updates when they reconnect

### Configuration
- Buffer size: 50 messages per admin (configurable)
- FIFO queue: oldest messages dropped when buffer is full
- Auto-cleanup: messages older than 1 hour are removed

### Behavior
- Only buffers for admin users
- Buffers `location:broadcast` events
- Delivers all buffered messages on reconnection
- Clears buffer after successful delivery

## Database Integration

### Location Storage
- Every location update is stored in `locations` table
- Includes: latitude, longitude, accuracy, speed, heading, timestamp
- Indexed by driver_id and timestamp for fast queries
- Cascade deletes when driver is deleted

### Driver Status Updates
- Updates `drivers.status` field
- Updates `drivers.last_seen` timestamp
- Updates `drivers.updated_at` timestamp

## Error Handling

### Validation Errors
- Invalid GPS coordinates (lat/lng out of range)
- Missing required fields
- Invalid status values

### Authentication Errors
- Missing token
- Invalid token
- Expired token

### Authorization Errors
- Non-drivers trying to send location updates
- Non-admins trying to access location data

### Database Errors
- Driver not found
- Database connection failures
- Transaction failures

All errors are sent via `error` event with structured format:
```json
{
  "code": "ERROR_CODE",
  "message": "Human-readable error message",
  "details": "Additional error details (optional)"
}
```

## Performance Considerations

### Scalability
- Redis adapter enables horizontal scaling
- Multiple WebSocket server instances supported
- Room-based broadcasting reduces message overhead
- Connection state managed in memory for speed

### Efficiency
- Redis caching reduces database queries
- Connection pooling for database
- Message buffering prevents data loss
- Heartbeat mechanism detects dead connections

### Optimization
- Only broadcast to necessary rooms
- Use Redis Pub/Sub for multi-server events
- Cache frequently accessed data
- Clean up stale connections proactively

## Testing

### Manual Testing with Socket.IO Client
```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  auth: {
    token: 'your-jwt-token-here'
  }
});

socket.on('connect', () => {
  console.log('Connected:', socket.id);
});

socket.on('authenticated', (data) => {
  console.log('Authenticated:', data);
});

// Test location update (as driver)
socket.emit('location:update', {
  latitude: 40.7128,
  longitude: -74.0060,
  accuracy: 10,
  speed: 25.5,
  heading: 180,
  timestamp: new Date().toISOString()
}, (response) => {
  console.log('Location update response:', response);
});

// Listen for location broadcasts (as admin)
socket.on('location:broadcast', (data) => {
  console.log('Location broadcast:', data);
});

// Listen for driver status changes (as admin)
socket.on('driver:status_change', (data) => {
  console.log('Driver status changed:', data);
});
```

## Acceptance Criteria Status

✅ Socket.IO server integrated with Express
✅ All connection events working (connect, authenticate, disconnect)
✅ Location update flow functional: driver → server → database → broadcast to admins
✅ Driver status updates broadcast to admins
✅ Room-based broadcasting working (admin room, driver rooms)
✅ Authentication middleware verifies JWT tokens
✅ Redis Pub/Sub integration for scalability
✅ Heartbeat and timeout detection functional
✅ Reconnection handling implemented
✅ Error handling for all events
✅ WebSocket server starts with Express on port 3000
✅ Can test with Socket.IO client
✅ Message buffering for offline clients implemented

## Future Enhancements

1. **Geofencing**: Alert when driver enters/exits predefined areas
2. **Trip tracking**: Real-time trip progress updates
3. **Dispatch messages**: Send messages from admins to specific drivers
4. **Driver-to-driver**: P2P communication for collaborative operations
5. **Historical playback**: Replay driver routes in real-time
6. **Alert system**: Critical alerts for speeding, harsh braking, etc.
7. **Performance metrics**: Track WebSocket server performance and latency
8. **Load balancing**: Automatic scaling based on connection count

## Dependencies

- `socket.io`: ^4.6.1
- `@socket.io/redis-adapter`: ^8.3.0
- `ioredis`: ^5.3.2
- `jsonwebtoken`: ^9.0.2
- `drizzle-orm`: ^0.44.6
- `express`: ^4.18.2

## Configuration

Environment variables:
- `CORS_ORIGIN`: Comma-separated list of allowed origins
- `REDIS_URL` or `REDIS_HOST`/`REDIS_PORT`: Redis connection
- JWT tokens configured via Auth0 settings

## Troubleshooting

### Connection Issues
- Check CORS configuration
- Verify JWT token is valid
- Ensure Redis is running and accessible
- Check firewall rules for WebSocket port

### Authentication Failures
- Verify Auth0 configuration
- Check JWT token format and claims
- Ensure token hasn't expired

### Broadcasting Issues
- Verify room membership
- Check Redis Pub/Sub connection
- Ensure Redis adapter is configured correctly

### Performance Issues
- Monitor connection count
- Check Redis latency
- Verify database query performance
- Consider horizontal scaling with multiple servers
