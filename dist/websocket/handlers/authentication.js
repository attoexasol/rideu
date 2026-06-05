"use strict";
/**
 * Authentication Event Handler
 * Handles socket authentication events and room management
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupAuthenticationHandler = setupAuthenticationHandler;
/**
 * Setup authentication event handlers
 * @param _io - Socket.IO server instance (unused but kept for consistency)
 * @param socket - Connected socket instance
 */
function setupAuthenticationHandler(_io, socket) {
    const socketData = socket.data;
    /**
     * Handle re-authentication event (if client wants to switch users or refresh)
     * This is optional - authentication is already done in middleware
     */
    socket.on('authenticate', (_payload, callback) => {
        try {
            // Socket is already authenticated via middleware
            // This event can be used to confirm authentication status
            if (!socketData.authenticated) {
                const error = {
                    code: 'AUTH_FAILED',
                    message: 'Socket is not authenticated',
                };
                socket.emit('error', error);
                if (callback)
                    callback({ success: false, error });
                return;
            }
            // Send authenticated confirmation
            const response = {
                userId: socketData.userId,
                userType: socketData.userType,
                role: socketData.role,
                rooms: Array.from(socket.rooms),
            };
            socket.emit('authenticated', response);
            if (callback) {
                callback({ success: true, data: response });
            }
            console.log(`  ✓ Re-authenticated: ${socketData.name} (${socketData.userType})`);
        }
        catch (error) {
            console.error('Authentication event error:', error);
            const errorPayload = {
                code: 'AUTH_ERROR',
                message: 'Authentication processing error',
                details: error instanceof Error ? error.message : 'Unknown error',
            };
            socket.emit('error', errorPayload);
            if (callback) {
                callback({ success: false, error: errorPayload });
            }
        }
    });
    /**
     * Handle authentication status check
     */
    socket.on('auth:status', (callback) => {
        try {
            const response = {
                userId: socketData.userId,
                userType: socketData.userType,
                role: socketData.role,
                rooms: Array.from(socket.rooms),
            };
            if (callback) {
                callback({ success: true, data: response });
            }
            else {
                socket.emit('auth:status_response', response);
            }
        }
        catch (error) {
            console.error('Auth status check error:', error);
            const errorPayload = {
                code: 'AUTH_STATUS_ERROR',
                message: 'Failed to get authentication status',
            };
            if (callback) {
                callback({ success: false, error: errorPayload });
            }
            else {
                socket.emit('error', errorPayload);
            }
        }
    });
}
//# sourceMappingURL=authentication.js.map