"use strict";
/**
 * WebSocket Server Setup
 * Configures Socket.IO with Redis adapter for scalability
 * Handles real-time bidirectional communication for GPS tracking
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.messageBuffer = exports.connectionStateManager = void 0;
exports.setupWebSocketServer = setupWebSocketServer;
const socket_io_1 = require("socket.io");
const redis_adapter_1 = require("@socket.io/redis-adapter");
const redis_1 = require("../config/redis");
const authentication_1 = require("./handlers/authentication");
const location_1 = require("./handlers/location");
const driver_status_1 = require("./handlers/driver-status");
const booking_1 = require("./handlers/booking");
const connection_1 = require("./handlers/connection");
const connection_state_1 = require("./connection-state");
const message_buffer_1 = require("./message-buffer");
const jwt_verifier_1 = require("../utils/jwt-verifier");
const connection_2 = require("../db/connection");
const drivers_1 = require("../db/schema/drivers");
const drizzle_orm_1 = require("drizzle-orm");
/**
 * Connection state manager (in-memory tracking)
 */
exports.connectionStateManager = new connection_state_1.ConnectionStateManager();
/**
 * Message buffer for offline clients
 */
exports.messageBuffer = new message_buffer_1.MessageBuffer();
/**
 * Setup and configure Socket.IO WebSocket server
 * @param httpServer - Express HTTP server instance
 * @returns Configured Socket.IO server instance
 */
function setupWebSocketServer(httpServer) {
    // Initialize Socket.IO server with CORS configuration
    const io = new socket_io_1.Server(httpServer, {
        cors: {
            origin: process.env.CORS_ORIGIN?.split(',') || [
                'http://localhost:5173',
                'http://localhost:8081',
            ],
            credentials: true,
            methods: ['GET', 'POST'],
        },
        pingTimeout: 10000, // 10 seconds - detect dead connections quickly
        pingInterval: 5000, // 5 seconds - frequent heartbeat to detect app quit
        transports: ['websocket', 'polling'],
    });
    // Redis adapter only when pub/sub is enabled (multi-server / USE_REDIS=true)
    if ((0, redis_1.isRedisPubSubEnabled)()) {
        io.adapter((0, redis_adapter_1.createAdapter)(redis_1.redisPub, redis_1.redisSub));
        console.log('✓ Socket.IO server initialized with Redis adapter');
    }
    else {
        console.log('✓ Socket.IO server initialized (in-memory adapter, USE_REDIS=false)');
    }
    // Authentication middleware
    io.use(async (socket, next) => {
        try {
            // Extract token from handshake auth or query params
            const token = socket.handshake.auth.token || socket.handshake.query.token;
            const bypassAuth = process.env.BYPASS_AUTH === 'true';
            const isDevelopment = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
            if ((bypassAuth || isDevelopment) && !token) {
                // Mock admin user for development (only when no token provided)
                console.log('⚠️  Development mode: Using mock admin user (no token provided)');
                socket.data = {
                    userId: 'dev-admin-1',
                    auth0Id: 'dev-admin-1',
                    email: 'admin@drivewize.com',
                    name: 'Dev Admin',
                    role: 'super_admin',
                    userType: 'admin',
                    authenticated: true,
                };
                return next();
            }
            // Token-based authentication (production or development with token)
            if (!token) {
                return next(new Error('Authentication token required'));
            }
            // Verify JWT — Auth0 RS256 (JWKS) or backend HS256 session token
            const decoded = (await (0, jwt_verifier_1.verifyBearerToken)(token));
            if (!decoded) {
                return next(new Error('Invalid authentication token'));
            }
            // Extract user information from token
            // Support both standard JWT (sub) and backend tokens (auth0Id)
            const auth0Id = decoded.auth0Id || decoded.sub;
            const email = decoded.email || decoded['https://drivewize.com/email'];
            const name = decoded.name || decoded['https://drivewize.com/name'];
            let role = decoded.role || decoded['https://drivewize.com/role'] || decoded['https://rydu.com/role'];
            if (!role && decoded['https://drivewize.com/roles']) {
                role = Array.isArray(decoded['https://drivewize.com/roles'])
                    ? decoded['https://drivewize.com/roles'][0]
                    : decoded['https://drivewize.com/roles'];
            }
            const userType = role === 'driver' ? 'driver' : role === 'customer' ? 'customer' : 'admin';
            // DEBUG: Log token parsing in development
            if (isDevelopment) {
                console.log('🔍 [DEBUG] Token parsed:', {
                    auth0Id,
                    email,
                    name,
                    role,
                    userType,
                    tokenClaims: {
                        'decoded.role': decoded.role,
                        'decoded[https://drivewize.com/role]': decoded['https://drivewize.com/role'],
                        'decoded[https://drivewize.com/roles]': decoded['https://drivewize.com/roles'],
                    },
                });
            }
            // Attach user data to socket
            socket.data = {
                userId: decoded.user_id || decoded.userId || auth0Id,
                auth0Id,
                email,
                name,
                role,
                userType,
                authenticated: true,
            };
            next();
        }
        catch (error) {
            console.error('WebSocket authentication error:', error);
            next(new Error('Authentication failed'));
        }
    });
    // Main connection handler
    io.on('connection', async (socket) => {
        const socketData = socket.data;
        if (socketData.userType === 'driver' && socketData.auth0Id) {
            const driver = await connection_2.db.query.drivers.findFirst({
                where: (0, drizzle_orm_1.eq)(drivers_1.drivers.auth0Id, socketData.auth0Id),
            });
            if (driver) {
                socketData.userId = driver.id;
                socket.data = socketData;
                console.info('[Socket] driver authenticated', {
                    auth0Id: socketData.auth0Id,
                    driverId: driver.id,
                    socketId: socket.id,
                });
            }
            else {
                console.warn('[Socket] driver auth0Id not resolved to DB UUID', {
                    auth0Id: socketData.auth0Id,
                    socketId: socket.id,
                });
            }
        }
        console.log(`✓ Client connected: ${socket.id} (${socketData.userType}: ${socketData.name})`);
        console.log(`  → User details: role=${socketData.role}, userType=${socketData.userType}, userId=${socketData.userId}`);
        // Add to connection state manager
        exports.connectionStateManager.addConnection(socket.id, {
            socketId: socket.id,
            userId: socketData.userId,
            userType: socketData.userType,
            connectedAt: new Date(),
            lastHeartbeat: new Date(),
        });
        // Join appropriate rooms based on user type
        if (socketData.userType === 'admin') {
            socket.join('admin');
            const adminCount = io.sockets.adapter.rooms.get('admin')?.size || 0;
            console.log(`  → Admin ${socketData.name} joined 'admin' room (${adminCount} total admins)`);
        }
        else if (socketData.userType === 'driver') {
            // Only join driver-{uuid} when Auth0 identity resolved to a DB driver row
            const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(socketData.userId);
            if (looksLikeUuid) {
                const room = `driver-${socketData.userId}`;
                socket.join(room);
                const roomSize = io.sockets.adapter.rooms.get(room)?.size || 0;
                console.info('[Socket] driver room joined', {
                    driverId: socketData.userId,
                    room,
                    roomSize,
                    socketId: socket.id,
                });
                console.log(`  → Driver ${socketData.name} joined '${room}' room (resolved driver UUID, size=${roomSize})`);
            }
            else {
                console.warn('[Socket] refusing driver room join — userId is not a driver UUID', {
                    userId: socketData.userId,
                    auth0Id: socketData.auth0Id,
                    socketId: socket.id,
                });
            }
        }
        else if (socketData.userType === 'customer') {
            socket.join(`customer-${socketData.userId}`);
            console.log(`  → Customer ${socketData.name} joined 'customer-${socketData.userId}' room`);
        }
        else {
            console.warn(`  ⚠️  Unknown userType: ${socketData.userType}`);
        }
        // Setup event handlers
        (0, authentication_1.setupAuthenticationHandler)(io, socket);
        (0, location_1.setupLocationHandler)(io, socket);
        (0, driver_status_1.setupDriverStatusHandler)(io, socket);
        (0, booking_1.setupBookingHandler)(io, socket);
        (0, connection_1.setupConnectionHandler)(io, socket);
        // Send any buffered messages if admin reconnects
        if (socketData.userType === 'admin') {
            const bufferedMessages = exports.messageBuffer.getMessages(socketData.userId);
            if (bufferedMessages.length > 0) {
                console.log(`  → Sending ${bufferedMessages.length} buffered messages to admin ${socketData.name}`);
                bufferedMessages.forEach((msg) => {
                    socket.emit(msg.event, msg.data);
                });
                exports.messageBuffer.clearMessages(socketData.userId);
            }
        }
        // Emit authenticated event
        socket.emit('authenticated', {
            userId: socketData.userId,
            userType: socketData.userType,
            role: socketData.role,
            rooms: Array.from(socket.rooms),
        });
        if (socketData.userType === 'driver') {
            const room = `driver-${socketData.userId}`;
            console.info('[Socket] driver authenticated', {
                auth0Id: socketData.auth0Id,
                driverId: socketData.userId,
                room,
                rooms: Array.from(socket.rooms),
            });
        }
        // Handle heartbeat
        socket.on('ping', () => {
            exports.connectionStateManager.updateHeartbeat(socket.id);
            socket.emit('pong', { timestamp: new Date().toISOString() });
        });
        // Handle disconnection
        socket.on('disconnect', (reason) => {
            console.log(`✗ Client disconnected: ${socket.id} (${socketData.name}) - Reason: ${reason}`);
            // Remove from connection state
            exports.connectionStateManager.removeConnection(socket.id);
            // If driver disconnects, broadcast offline status
            if (socketData.userType === 'driver') {
                io.to('admin').emit('driver:offline', {
                    driverId: socketData.userId,
                    driverName: socketData.name,
                    timestamp: new Date().toISOString(),
                });
            }
        });
    });
    // Timeout detection - check for stale connections
    // Only disconnect truly dead connections (5 minutes for admins, 2 minutes for drivers)
    setInterval(() => {
        const staleConnections = exports.connectionStateManager.getStaleConnections(300000); // 5 minutes
        staleConnections.forEach((conn) => {
            const socket = io.sockets.sockets.get(conn.socketId);
            // Skip if socket is still connected (Socket.IO maintains its own heartbeat)
            if (socket?.connected) {
                // Update heartbeat since socket is still connected
                exports.connectionStateManager.updateHeartbeat(conn.socketId);
                return;
            }
            console.log(`⚠ Stale connection detected: ${conn.socketId} (${conn.userId})`);
            if (socket) {
                socket.disconnect(true);
            }
            exports.connectionStateManager.removeConnection(conn.socketId);
        });
    }, 60000); // Check every 60 seconds
    console.log('✓ WebSocket event handlers configured');
    return io;
}
//# sourceMappingURL=server.js.map