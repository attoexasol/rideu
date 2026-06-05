"use strict";
/**
 * Message Buffer
 * Buffers messages for offline clients (primarily for admins)
 * Stores last N messages per user and delivers when they reconnect
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageBuffer = void 0;
class MessageBuffer {
    buffers;
    maxBufferSize;
    constructor(maxBufferSize = 50) {
        this.buffers = new Map();
        this.maxBufferSize = maxBufferSize;
    }
    /**
     * Add a message to the buffer for a specific user
     * @param userId - User ID to buffer message for
     * @param event - Event name
     * @param data - Event data payload
     */
    addMessage(userId, event, data) {
        if (!this.buffers.has(userId)) {
            this.buffers.set(userId, []);
        }
        const buffer = this.buffers.get(userId);
        // Add new message
        buffer.push({
            event,
            data,
            timestamp: new Date(),
        });
        // Keep only last N messages (FIFO)
        if (buffer.length > this.maxBufferSize) {
            buffer.shift(); // Remove oldest message
        }
    }
    /**
     * Buffer a message for all admin users
     * Useful when broadcasting location updates while admins are offline
     * @param adminUserIds - Array of admin user IDs
     * @param event - Event name
     * @param data - Event data payload
     */
    addMessageForAdmins(adminUserIds, event, data) {
        adminUserIds.forEach((userId) => {
            this.addMessage(userId, event, data);
        });
    }
    /**
     * Get all buffered messages for a user
     * @param userId - User ID
     * @returns Array of buffered messages
     */
    getMessages(userId) {
        return this.buffers.get(userId) || [];
    }
    /**
     * Get number of buffered messages for a user
     * @param userId - User ID
     * @returns Number of buffered messages
     */
    getMessageCount(userId) {
        return this.buffers.get(userId)?.length || 0;
    }
    /**
     * Clear all messages for a specific user
     * @param userId - User ID
     */
    clearMessages(userId) {
        this.buffers.delete(userId);
    }
    /**
     * Clear old messages (older than specified time)
     * @param maxAge - Maximum age in milliseconds (default: 1 hour)
     */
    clearOldMessages(maxAge = 3600000) {
        const now = new Date();
        this.buffers.forEach((messages, userId) => {
            const filtered = messages.filter((msg) => {
                const age = now.getTime() - msg.timestamp.getTime();
                return age < maxAge;
            });
            if (filtered.length === 0) {
                this.buffers.delete(userId);
            }
            else {
                this.buffers.set(userId, filtered);
            }
        });
    }
    /**
     * Clear all buffers (useful for testing)
     */
    clearAll() {
        this.buffers.clear();
    }
    /**
     * Get total number of users with buffered messages
     */
    getUserCount() {
        return this.buffers.size;
    }
}
exports.MessageBuffer = MessageBuffer;
//# sourceMappingURL=message-buffer.js.map