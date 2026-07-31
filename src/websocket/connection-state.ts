/**
 * Connection State Manager
 * Tracks active WebSocket connections in memory
 * Manages heartbeat tracking and timeout detection
 */

import { ConnectionState } from './types';

export class ConnectionStateManager {
  private connections: Map<string, ConnectionState>;

  constructor() {
    this.connections = new Map();
  }

  /**
   * Add a new connection to the state manager
   */
  addConnection(socketId: string, state: ConnectionState): void {
    this.connections.set(socketId, state);
  }

  /**
   * Remove a connection from the state manager
   */
  removeConnection(socketId: string): void {
    this.connections.delete(socketId);
  }

  /**
   * Update the last heartbeat timestamp for a connection
   */
  updateHeartbeat(socketId: string): void {
    const connection = this.connections.get(socketId);
    if (connection) {
      connection.lastHeartbeat = new Date();
    }
  }

  /**
   * Get connection state by socket ID
   */
  getConnection(socketId: string): ConnectionState | undefined {
    return this.connections.get(socketId);
  }

  /**
   * Get all connections for a specific user
   */
  getUserConnections(userId: string): ConnectionState[] {
    return Array.from(this.connections.values()).filter((conn) => conn.userId === userId);
  }

  /**
   * Get all active connections
   */
  getAllConnections(): ConnectionState[] {
    return Array.from(this.connections.values());
  }

  /**
   * Get connections by user type (driver or admin)
   */
  getConnectionsByType(userType: 'driver' | 'admin'): ConnectionState[] {
    return Array.from(this.connections.values()).filter((conn) => conn.userType === userType);
  }

  /**
   * Get stale connections (no heartbeat within timeout period)
   * @param timeoutMs - Timeout in milliseconds (default: 2 minutes)
   */
  getStaleConnections(timeoutMs: number = 120000): ConnectionState[] {
    const now = new Date();
    return Array.from(this.connections.values()).filter((conn) => {
      const timeSinceHeartbeat = now.getTime() - conn.lastHeartbeat.getTime();
      return timeSinceHeartbeat > timeoutMs;
    });
  }

  /**
   * Get total number of active connections
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Check if a user is currently connected
   */
  isUserConnected(userId: string): boolean {
    return this.getUserConnections(userId).length > 0;
  }

  /**
   * Clear all connections (useful for testing)
   */
  clear(): void {
    this.connections.clear();
  }
}
