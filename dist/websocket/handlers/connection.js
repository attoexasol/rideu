"use strict";
/**
 * Connection Event Handler
 * Handles connection lifecycle events and broadcasts
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupConnectionHandler = setupConnectionHandler;
const connection_1 = require("../../db/connection");
const drivers_1 = require("../../db/schema/drivers");
const drizzle_orm_1 = require("drizzle-orm");
/**
 * Setup connection event handlers
 * @param io - Socket.IO server instance
 * @param socket - Connected socket instance
 */
function setupConnectionHandler(_io, socket) {
    const socketData = socket.data;
    /**
     * Handle explicit connection established event
     * This is sent by client to confirm connection is ready
     */
    socket.on('connection:established', async (callback) => {
        try {
            console.log(`  ✓ Connection established confirmed by ${socketData.name}`);
            // Just update lastSeen timestamp for drivers, don't change status
            // Status should only change when they explicitly toggle on-duty
            if (socketData.userType === 'driver') {
                const driver = await connection_1.db
                    .select()
                    .from(drivers_1.drivers)
                    .where((0, drizzle_orm_1.eq)(drivers_1.drivers.auth0Id, socketData.auth0Id))
                    .limit(1);
                if (driver && driver.length > 0) {
                    const driverId = driver[0].id;
                    // Only update lastSeen, preserve current status
                    await connection_1.db
                        .update(drivers_1.drivers)
                        .set({
                        lastSeen: new Date(),
                    })
                        .where((0, drizzle_orm_1.eq)(drivers_1.drivers.id, driverId));
                }
            }
            if (callback) {
                callback({
                    success: true,
                    data: {
                        message: 'Connection established',
                        timestamp: new Date().toISOString(),
                    },
                });
            }
        }
        catch (error) {
            console.error('Connection established error:', error);
            const errorPayload = {
                code: 'CONNECTION_ERROR',
                message: 'Failed to process connection established event',
                details: error instanceof Error ? error.message : 'Unknown error',
            };
            if (callback) {
                callback({ success: false, error: errorPayload });
            }
        }
    });
    /**
     * Handle heartbeat/ping from client
     * This is handled in server.ts but can also be handled here for logging
     */
    socket.on('heartbeat', (callback) => {
        if (callback) {
            callback({
                success: true,
                data: {
                    timestamp: new Date().toISOString(),
                },
            });
        }
    });
    /**
     * Handle explicit disconnect request from client
     */
    socket.on('connection:disconnect', async (callback) => {
        try {
            console.log(`  ⚠ Client ${socketData.name} requested disconnect`);
            // Just update lastSeen timestamp for drivers
            // Let the inactivity checker handle setting them offline after 10 minutes
            if (socketData.userType === 'driver') {
                const driver = await connection_1.db
                    .select()
                    .from(drivers_1.drivers)
                    .where((0, drizzle_orm_1.eq)(drivers_1.drivers.auth0Id, socketData.auth0Id))
                    .limit(1);
                if (driver && driver.length > 0) {
                    const driverId = driver[0].id;
                    // Only update lastSeen, preserve current status
                    await connection_1.db
                        .update(drivers_1.drivers)
                        .set({
                        lastSeen: new Date(),
                    })
                        .where((0, drizzle_orm_1.eq)(drivers_1.drivers.id, driverId));
                }
            }
            if (callback) {
                callback({
                    success: true,
                    data: {
                        message: 'Disconnecting',
                    },
                });
            }
            // Disconnect the socket
            socket.disconnect(true);
        }
        catch (error) {
            console.error('Connection disconnect error:', error);
            const errorPayload = {
                code: 'DISCONNECT_ERROR',
                message: 'Failed to process disconnect request',
                details: error instanceof Error ? error.message : 'Unknown error',
            };
            if (callback) {
                callback({ success: false, error: errorPayload });
            }
            // Disconnect anyway
            socket.disconnect(true);
        }
    });
}
//# sourceMappingURL=connection.js.map