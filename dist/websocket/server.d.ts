/**
 * WebSocket Server Setup
 * Configures Socket.IO with Redis adapter for scalability
 * Handles real-time bidirectional communication for GPS tracking
 */
import { Server as HTTPServer } from 'http';
import { Server } from 'socket.io';
import { ConnectionStateManager } from './connection-state';
import { MessageBuffer } from './message-buffer';
/**
 * Connection state manager (in-memory tracking)
 */
export declare const connectionStateManager: ConnectionStateManager;
/**
 * Message buffer for offline clients
 */
export declare const messageBuffer: MessageBuffer;
/**
 * Setup and configure Socket.IO WebSocket server
 * @param httpServer - Express HTTP server instance
 * @returns Configured Socket.IO server instance
 */
export declare function setupWebSocketServer(httpServer: HTTPServer): Server;
//# sourceMappingURL=server.d.ts.map