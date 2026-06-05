/**
 * Driver Status Event Handler
 * Handles driver status change events (online, offline)
 * Updates database and broadcasts to admins
 */

import { Server, Socket } from 'socket.io';
import { db } from '../../db/connection';
import { drivers } from '../../db/schema/drivers';
import { eq } from 'drizzle-orm';
import { SocketData, DriverStatusPayload, DriverStatusChangeBroadcast } from '../types';
import { realtimeCache, redisPub, PubSubChannels } from '../../config/redis';

/**
 * Setup driver status event handlers
 * @param io - Socket.IO server instance
 * @param socket - Connected socket instance
 */
export function setupDriverStatusHandler(io: Server, socket: Socket): void {
  const socketData = socket.data as SocketData;

  /**
   * Handle driver status update
   * Flow: Driver/Admin sends status → Update DB → Broadcast to admins → Acknowledge
   */
  socket.on('driver:status', async (payload: DriverStatusPayload, callback) => {
    try {
      // Validate status value
      const validStatuses = ['online', 'offline'];
      if (!validStatuses.includes(payload.status)) {
        const error = {
          code: 'VALIDATION_ERROR',
          message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
        };
        socket.emit('error', error);
        if (callback) callback({ success: false, error });
        return;
      }

      let driverId: string;
      let driverName: string;

      // If driver is updating their own status
      if (socketData.userType === 'driver') {
        // Get driver from database
        const driver = await db
          .select()
          .from(drivers)
          .where(eq(drivers.auth0Id, socketData.auth0Id))
          .limit(1);

        if (!driver || driver.length === 0) {
          const error = {
            code: 'DRIVER_NOT_FOUND',
            message: 'Driver not found in database',
          };
          socket.emit('error', error);
          if (callback) callback({ success: false, error });
          return;
        }

        driverId = driver[0].id;
        driverName = driver[0].name;
      }
      // If admin is updating a driver's status (future feature)
      else if (socketData.userType === 'admin') {
        // For now, admins cannot update driver status remotely
        // This can be extended later if needed
        const error = {
          code: 'UNAUTHORIZED',
          message: 'Admins cannot update driver status remotely (not implemented)',
        };
        socket.emit('error', error);
        if (callback) callback({ success: false, error });
        return;
      } else {
        const error = {
          code: 'UNAUTHORIZED',
          message: 'Invalid user type for status update',
        };
        socket.emit('error', error);
        if (callback) callback({ success: false, error });
        return;
      }

      // Update driver status in database
      await db
        .update(drivers)
        .set({
          status: payload.status,
          lastSeen: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(drivers.id, driverId));

      console.log(`  🔄 Driver status changed: ${driverName} → ${payload.status}`);

      // Update status in Redis cache
      await realtimeCache.setDriverStatus(driverId, payload.status);

      // Prepare broadcast payload for admins
      const broadcastPayload: DriverStatusChangeBroadcast = {
        driverId,
        driverName,
        status: payload.status,
        timestamp: new Date().toISOString(),
      };

      // Broadcast status change to all admins
      io.to('admin').emit('driver:status_change', broadcastPayload);

      // Publish to Redis Pub/Sub for multi-server scalability
      await redisPub.publish(
        PubSubChannels.DRIVER_STATUS,
        JSON.stringify(broadcastPayload)
      );

      // Send acknowledgment
      if (callback) {
        callback({
          success: true,
          data: {
            driverId,
            status: payload.status,
            timestamp: new Date().toISOString(),
          },
        });
      }
    } catch (error) {
      console.error('Driver status update error:', error);

      const errorPayload = {
        code: 'STATUS_UPDATE_ERROR',
        message: 'Failed to update driver status',
        details: error instanceof Error ? error.message : 'Unknown error',
      };

      socket.emit('error', errorPayload);

      if (callback) {
        callback({ success: false, error: errorPayload });
      }
    }
  });

  /**
   * Handle driver going online (auto-triggered on connection)
   */
  socket.on('driver:go_online', async (callback) => {
    try {
      // Only drivers can go online
      if (socketData.userType !== 'driver') {
        const error = {
          code: 'UNAUTHORIZED',
          message: 'Only drivers can go online',
        };
        socket.emit('error', error);
        if (callback) callback({ success: false, error });
        return;
      }

      // Get driver from database
      const driver = await db
        .select()
        .from(drivers)
        .where(eq(drivers.auth0Id, socketData.auth0Id))
        .limit(1);

      if (!driver || driver.length === 0) {
        const error = {
          code: 'DRIVER_NOT_FOUND',
          message: 'Driver not found in database',
        };
        socket.emit('error', error);
        if (callback) callback({ success: false, error });
        return;
      }

      const driverId = driver[0].id;
      const driverName = driver[0].name;

      // Update status to online
      await db
        .update(drivers)
        .set({
          status: 'online',
          lastSeen: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(drivers.id, driverId));

      await realtimeCache.setDriverStatus(driverId, 'online');

      console.log(`  ✓ Driver went online: ${driverName}`);

      // Notify admins
      const notification = {
        driverId,
        driverName,
        timestamp: new Date().toISOString(),
      };

      io.to('admin').emit('driver:online', notification);

      // Publish to Redis
      await redisPub.publish(
        PubSubChannels.DRIVER_ONLINE,
        JSON.stringify(notification)
      );

      if (callback) {
        callback({
          success: true,
          data: notification,
        });
      }
    } catch (error) {
      console.error('Driver go online error:', error);

      const errorPayload = {
        code: 'GO_ONLINE_ERROR',
        message: 'Failed to set driver online',
        details: error instanceof Error ? error.message : 'Unknown error',
      };

      if (callback) {
        callback({ success: false, error: errorPayload });
      }
    }
  });

  /**
   * Handle driver going offline (auto-triggered on disconnect)
   */
  socket.on('driver:go_offline', async (callback) => {
    try {
      // Only drivers can go offline
      if (socketData.userType !== 'driver') {
        const error = {
          code: 'UNAUTHORIZED',
          message: 'Only drivers can go offline',
        };
        socket.emit('error', error);
        if (callback) callback({ success: false, error });
        return;
      }

      // Get driver from database
      const driver = await db
        .select()
        .from(drivers)
        .where(eq(drivers.auth0Id, socketData.auth0Id))
        .limit(1);

      if (!driver || driver.length === 0) {
        const error = {
          code: 'DRIVER_NOT_FOUND',
          message: 'Driver not found in database',
        };
        socket.emit('error', error);
        if (callback) callback({ success: false, error });
        return;
      }

      const driverId = driver[0].id;
      const driverName = driver[0].name;

      // Update status to offline
      await db
        .update(drivers)
        .set({
          status: 'offline',
          lastSeen: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(drivers.id, driverId));

      await realtimeCache.setDriverStatus(driverId, 'offline');

      console.log(`  ✗ Driver went offline: ${driverName}`);

      // Notify admins
      const notification = {
        driverId,
        driverName,
        timestamp: new Date().toISOString(),
      };

      io.to('admin').emit('driver:offline', notification);

      // Publish to Redis
      await redisPub.publish(
        PubSubChannels.DRIVER_OFFLINE,
        JSON.stringify(notification)
      );

      if (callback) {
        callback({
          success: true,
          data: notification,
        });
      }
    } catch (error) {
      console.error('Driver go offline error:', error);

      const errorPayload = {
        code: 'GO_OFFLINE_ERROR',
        message: 'Failed to set driver offline',
        details: error instanceof Error ? error.message : 'Unknown error',
      };

      if (callback) {
        callback({ success: false, error: errorPayload });
      }
    }
  });
}
