/**
 * Connection State Manager
 * Tracks active WebSocket connections in memory
 * Manages heartbeat tracking and timeout detection
 */
import { ConnectionState } from './types';
export declare class ConnectionStateManager {
    private connections;
    constructor();
    /**
     * Add a new connection to the state manager
     */
    addConnection(socketId: string, state: ConnectionState): void;
    /**
     * Remove a connection from the state manager
     */
    removeConnection(socketId: string): void;
    /**
     * Update the last heartbeat timestamp for a connection
     */
    updateHeartbeat(socketId: string): void;
    /**
     * Get connection state by socket ID
     */
    getConnection(socketId: string): ConnectionState | undefined;
    /**
     * Get all connections for a specific user
     */
    getUserConnections(userId: string): ConnectionState[];
    /**
     * Get all active connections
     */
    getAllConnections(): ConnectionState[];
    /**
     * Get connections by user type (driver or admin)
     */
    getConnectionsByType(userType: 'driver' | 'admin'): ConnectionState[];
    /**
     * Get stale connections (no heartbeat within timeout period)
     * @param timeoutMs - Timeout in milliseconds (default: 2 minutes)
     */
    getStaleConnections(timeoutMs?: number): ConnectionState[];
    /**
     * Get total number of active connections
     */
    getConnectionCount(): number;
    /**
     * Check if a user is currently connected
     */
    isUserConnected(userId: string): boolean;
    /**
     * Clear all connections (useful for testing)
     */
    clear(): void;
}
//# sourceMappingURL=connection-state.d.ts.map