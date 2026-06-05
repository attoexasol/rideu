/**
 * Message Buffer
 * Buffers messages for offline clients (primarily for admins)
 * Stores last N messages per user and delivers when they reconnect
 */
import { BufferedMessage } from './types';
export declare class MessageBuffer {
    private buffers;
    private maxBufferSize;
    constructor(maxBufferSize?: number);
    /**
     * Add a message to the buffer for a specific user
     * @param userId - User ID to buffer message for
     * @param event - Event name
     * @param data - Event data payload
     */
    addMessage(userId: string, event: string, data: any): void;
    /**
     * Buffer a message for all admin users
     * Useful when broadcasting location updates while admins are offline
     * @param adminUserIds - Array of admin user IDs
     * @param event - Event name
     * @param data - Event data payload
     */
    addMessageForAdmins(adminUserIds: string[], event: string, data: any): void;
    /**
     * Get all buffered messages for a user
     * @param userId - User ID
     * @returns Array of buffered messages
     */
    getMessages(userId: string): BufferedMessage[];
    /**
     * Get number of buffered messages for a user
     * @param userId - User ID
     * @returns Number of buffered messages
     */
    getMessageCount(userId: string): number;
    /**
     * Clear all messages for a specific user
     * @param userId - User ID
     */
    clearMessages(userId: string): void;
    /**
     * Clear old messages (older than specified time)
     * @param maxAge - Maximum age in milliseconds (default: 1 hour)
     */
    clearOldMessages(maxAge?: number): void;
    /**
     * Clear all buffers (useful for testing)
     */
    clearAll(): void;
    /**
     * Get total number of users with buffered messages
     */
    getUserCount(): number;
}
//# sourceMappingURL=message-buffer.d.ts.map