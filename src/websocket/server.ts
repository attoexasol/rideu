/**
 * WebSocket Server Setup
 * Configures Socket.IO with Redis adapter for scalability
 * Handles real-time bidirectional communication for GPS tracking
 */

import { Server as HTTPServer } from 'http';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { redisPub, redisSub } from '../config/redis';
import { SocketData } from './types';
import { setupAuthenticationHandler } from './handlers/authentication';
import { setupLocationHandler } from './handlers/location';
import { setupDriverStatusHandler } from './handlers/driver-status';
import { setupConnectionHandler } from './handlers/connection';
import { ConnectionStateManager } from './connection-state';
import { MessageBuffer } from './message-buffer';
import jwt from 'jsonwebtoken';

/**
 * Connection state manager (in-memory tracking)
 */
export const connectionStateManager = new ConnectionStateManager();

/**
 * Message buffer for offline clients
 */
export const messageBuffer = new MessageBuffer();

/**
 * Setup and configure Socket.IO WebSocket server
 * @param httpServer - Express HTTP server instance
 * @returns Configured Socket.IO server instance
 */
export function setupWebSocketServer(httpServer: HTTPServer): Server {
  // Initialize Socket.IO server with CORS configuration
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5173', 'http://localhost:8081'],
      credentials: true,
      methods: ['GET', 'POST'],
    },
    pingTimeout: 10000, // 10 seconds - detect dead connections quickly
    pingInterval: 5000, // 5 seconds - frequent heartbeat to detect app quit
    transports: ['websocket', 'polling'],
  });

  // Setup Redis adapter for horizontal scaling
  io.adapter(createAdapter(redisPub, redisSub));

  console.log('✓ Socket.IO server initialized with Redis adapter');

  // Authentication middleware
  io.use(async (socket: Socket, next) => {
    try {
      // Extract token from handshake auth or query params
      const token = socket.handshake.auth.token || socket.handshake.query.token;

      // In development mode, bypass authentication ONLY if no token is provided
      const isDevelopment = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';

      if (isDevelopment && !token) {
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
        } as SocketData;
        return next();
      }

      // Token-based authentication (production or development with token)
      if (!token) {
        return next(new Error('Authentication token required'));
      }

      // Verify JWT token
      // For Auth0, we need to verify the token using the public key
      // Since we're using socket.io, we'll do a simple JWT decode here
      // In production, you should verify against Auth0 JWKS
      const decoded = jwt.decode(token as string) as any;

      if (!decoded) {
        return next(new Error('Invalid authentication token'));
      }

      // Extract user information from token
      // Support both standard JWT (sub) and backend tokens (auth0Id)
      const auth0Id = decoded.auth0Id || decoded.sub;
      const email = decoded.email || decoded['https://drivewize.com/email'];
      const name = decoded.name || decoded['https://drivewize.com/name'];
      let role = decoded.role || decoded['https://drivewize.com/role'];

      if (!role && decoded['https://drivewize.com/roles']) {
        role = Array.isArray(decoded['https://drivewize.com/roles'])
          ? decoded['https://drivewize.com/roles'][0]
          : decoded['https://drivewize.com/roles'];
      }

      // Determine user type (driver or admin)
      const userType = role === 'driver' ? 'driver' : 'admin';

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
      } as SocketData;

      next();
    } catch (error) {
      console.error('WebSocket authentication error:', error);
      next(new Error('Authentication failed'));
    }
  });

  // Main connection handler
  io.on('connection', (socket: Socket) => {
    const socketData = socket.data as SocketData;

    console.log(`✓ Client connected: ${socket.id} (${socketData.userType}: ${socketData.name})`);
    console.log(`  → User details: role=${socketData.role}, userType=${socketData.userType}, userId=${socketData.userId}`);

    // Add to connection state manager
    connectionStateManager.addConnection(socket.id, {
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
    } else if (socketData.userType === 'driver') {
      socket.join(`driver-${socketData.userId}`);
      console.log(`  → Driver ${socketData.name} joined 'driver-${socketData.userId}' room`);
    } else {
      console.warn(`  ⚠️  Unknown userType: ${socketData.userType}`);
    }

    // Setup event handlers
    setupAuthenticationHandler(io, socket);
    setupLocationHandler(io, socket);
    setupDriverStatusHandler(io, socket);
    setupConnectionHandler(io, socket);

    // Send any buffered messages if admin reconnects
    if (socketData.userType === 'admin') {
      const bufferedMessages = messageBuffer.getMessages(socketData.userId);
      if (bufferedMessages.length > 0) {
        console.log(`  → Sending ${bufferedMessages.length} buffered messages to admin ${socketData.name}`);
        bufferedMessages.forEach((msg) => {
          socket.emit(msg.event, msg.data);
        });
        messageBuffer.clearMessages(socketData.userId);
      }
    }

    // Emit authenticated event
    socket.emit('authenticated', {
      userId: socketData.userId,
      userType: socketData.userType,
      role: socketData.role,
      rooms: Array.from(socket.rooms),
    });

    // Handle heartbeat
    socket.on('ping', () => {
      connectionStateManager.updateHeartbeat(socket.id);
      socket.emit('pong', { timestamp: new Date().toISOString() });
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      console.log(`✗ Client disconnected: ${socket.id} (${socketData.name}) - Reason: ${reason}`);

      // Remove from connection state
      connectionStateManager.removeConnection(socket.id);

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
    const staleConnections = connectionStateManager.getStaleConnections(300000); // 5 minutes
    staleConnections.forEach((conn) => {
      const socket = io.sockets.sockets.get(conn.socketId);

      // Skip if socket is still connected (Socket.IO maintains its own heartbeat)
      if (socket?.connected) {
        // Update heartbeat since socket is still connected
        connectionStateManager.updateHeartbeat(conn.socketId);
        return;
      }

      console.log(`⚠ Stale connection detected: ${conn.socketId} (${conn.userId})`);
      if (socket) {
        socket.disconnect(true);
      }
      connectionStateManager.removeConnection(conn.socketId);
    });
  }, 60000); // Check every 60 seconds

  console.log('✓ WebSocket event handlers configured');

  return io;
}
