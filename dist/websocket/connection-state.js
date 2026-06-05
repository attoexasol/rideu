"use strict";
/**
 * Connection State Manager
 * Tracks active WebSocket connections in memory
 * Manages heartbeat tracking and timeout detection
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectionStateManager = void 0;
class ConnectionStateManager {
    connections;
    constructor() {
        this.connections = new Map();
    }
    /**
     * Add a new connection to the state manager
     */
    addConnection(socketId, state) {
        this.connections.set(socketId, state);
    }
    /**
     * Remove a connection from the state manager
     */
    removeConnection(socketId) {
        this.connections.delete(socketId);
    }
    /**
     * Update the last heartbeat timestamp for a connection
     */
    updateHeartbeat(socketId) {
        const connection = this.connections.get(socketId);
        if (connection) {
            connection.lastHeartbeat = new Date();
        }
    }
    /**
     * Get connection state by socket ID
     */
    getConnection(socketId) {
        return this.connections.get(socketId);
    }
    /**
     * Get all connections for a specific user
     */
    getUserConnections(userId) {
        return Array.from(this.connections.values()).filter((conn) => conn.userId === userId);
    }
    /**
     * Get all active connections
     */
    getAllConnections() {
        return Array.from(this.connections.values());
    }
    /**
     * Get connections by user type (driver or admin)
     */
    getConnectionsByType(userType) {
        return Array.from(this.connections.values()).filter((conn) => conn.userType === userType);
    }
    /**
     * Get stale connections (no heartbeat within timeout period)
     * @param timeoutMs - Timeout in milliseconds (default: 2 minutes)
     */
    getStaleConnections(timeoutMs = 120000) {
        const now = new Date();
        return Array.from(this.connections.values()).filter((conn) => {
            const timeSinceHeartbeat = now.getTime() - conn.lastHeartbeat.getTime();
            return timeSinceHeartbeat > timeoutMs;
        });
    }
    /**
     * Get total number of active connections
     */
    getConnectionCount() {
        return this.connections.size;
    }
    /**
     * Check if a user is currently connected
     */
    isUserConnected(userId) {
        return this.getUserConnections(userId).length > 0;
    }
    /**
     * Clear all connections (useful for testing)
     */
    clear() {
        this.connections.clear();
    }
}
exports.ConnectionStateManager = ConnectionStateManager;
//# sourceMappingURL=connection-state.js.map