/**
 * Location Event Handler
 * Handles location update events from drivers
 * Stores location in database and broadcasts to admins
 */

import { Server, Socket } from 'socket.io';
import { db } from '../../db/connection';
import { locations } from '../../db/schema/locations';
import { drivers } from '../../db/schema/drivers';
import { eq, desc } from 'drizzle-orm';
import {
  SocketData,
  LocationUpdatePayload,
  LocationBroadcastPayload,
  LocationAckPayload,
} from '../types';
import { realtimeCache, redisPub, PubSubChannels } from '../../config/redis';
import { snapToRoadsBatch } from '../../services/mapboxMatching';

const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN || '';

/**
 * Setup location event handlers
 * @param io - Socket.IO server instance
 * @param socket - Connected socket instance
 */
export function setupLocationHandler(io: Server, socket: Socket): void {
  const socketData = socket.data as SocketData;

  /**
   * Handle location update from driver
   * Flow: Driver sends GPS → Store in DB → Broadcast to admins → Acknowledge to driver
   */
  socket.on('location:update', async (payload: LocationUpdatePayload, callback) => {
    try {
      // Only drivers can send location updates
      if (socketData.userType !== 'driver') {
        const error = {
          code: 'UNAUTHORIZED',
          message: 'Only drivers can send location updates',
        };
        socket.emit('error', error);
        if (callback) callback({ success: false, error });
        return;
      }

      // Validate payload
      if (!payload.latitude || !payload.longitude) {
        const error = {
          code: 'VALIDATION_ERROR',
          message: 'Latitude and longitude are required',
        };
        socket.emit('error', error);
        if (callback) callback({ success: false, error });
        return;
      }

      // Validate coordinate ranges
      if (payload.latitude < -90 || payload.latitude > 90) {
        const error = {
          code: 'VALIDATION_ERROR',
          message: 'Latitude must be between -90 and 90',
        };
        socket.emit('error', error);
        if (callback) callback({ success: false, error });
        return;
      }

      if (payload.longitude < -180 || payload.longitude > 180) {
        const error = {
          code: 'VALIDATION_ERROR',
          message: 'Longitude must be between -180 and 180',
        };
        socket.emit('error', error);
        if (callback) callback({ success: false, error });
        return;
      }

      // Filter out low-accuracy points (GPS drift/noise)
      if (payload.accuracy && payload.accuracy > 20) {
        console.log(`  ⚠️  Low accuracy location (${payload.accuracy.toFixed(1)}m) - skipped`);
        if (callback) {
          callback({
            success: true,
            data: {
              skipped: true,
              reason: 'Low accuracy (>20m)',
              accuracy: payload.accuracy,
            },
          });
        }
        return;
      }

      // Get driver from database to get driverId and name
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

      const driverRecord = driver[0];
      const driverId = driverRecord.id;
      const driverName = driverRecord.name;

      // Check distance from last recorded location (server-side distance filter)
      const lastLocation = await db
        .select()
        .from(locations)
        .where(eq(locations.driverId, driverId))
        .orderBy(desc(locations.timestamp))
        .limit(1);

      if (lastLocation.length > 0) {
        const last = lastLocation[0];
        const lastLat = parseFloat(last.latitude);
        const lastLng = parseFloat(last.longitude);

        // Calculate distance using Haversine formula
        const R = 6371e3; // Earth's radius in meters
        const φ1 = (lastLat * Math.PI) / 180;
        const φ2 = (payload.latitude * Math.PI) / 180;
        const Δφ = ((payload.latitude - lastLat) * Math.PI) / 180;
        const Δλ = ((payload.longitude - lastLng) * Math.PI) / 180;

        const a =
          Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
          Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c;

        // Only record if moved more than 50 meters
        if (distance < 50) {
          console.log(`  ⚠️  Too close to last location (${distance.toFixed(1)}m < 50m) - skipped`);
          if (callback) {
            callback({
              success: true,
              data: {
                skipped: true,
                reason: 'Distance too small (<50m)',
                distance: distance,
              },
            });
          }
          return;
        }

        console.log(`  ✓ Moved ${distance.toFixed(1)}m from last location`);
      }

      // Store location in database
      const newLocation = await db
        .insert(locations)
        .values({
          driverId,
          latitude: payload.latitude.toString(),
          longitude: payload.longitude.toString(),
          accuracy: payload.accuracy?.toString(),
          speed: payload.speed?.toString(),
          heading: payload.heading?.toString(),
          timestamp: new Date(payload.timestamp || new Date()),
        })
        .returning();

      console.log(
        `  📍 Location update from ${driverName}: ${payload.latitude}, ${payload.longitude}`
      );

      // Cache location in Redis for fast retrieval
      let snappedLat = payload.latitude;
      let snappedLng = payload.longitude;

      try {
        const previousLocation = await realtimeCache.getDriverLocation(driverId);
        if (previousLocation && MAPBOX_ACCESS_TOKEN) {
          const coordinates = [
            {
              latitude: previousLocation.latitude,
              longitude: previousLocation.longitude,
              timestamp: previousLocation.timestamp,
            },
            {
              latitude: payload.latitude,
              longitude: payload.longitude,
              timestamp: payload.timestamp || new Date().toISOString(),
            },
          ];
          const result = await snapToRoadsBatch(coordinates);
          if (result.matched && result.matched.length > 0) {
            const snappedCurrent = result.matched[result.matched.length - 1];
            snappedLat = snappedCurrent.latitude;
            snappedLng = snappedCurrent.longitude;
          }
        }
      } catch (error) {
        console.log(
          '  ⏭️  Mapbox road snapping skipped for WebSocket broadcast:',
          error instanceof Error ? error.message : 'Unknown error'
        );
      }

      await realtimeCache.setDriverLocation(driverId, {
        latitude: payload.latitude,
        longitude: payload.longitude,
        snappedLatitude: snappedLat,
        snappedLongitude: snappedLng,
        speed: payload.speed,
        heading: payload.heading,
        timestamp: payload.timestamp || new Date().toISOString(),
      });

      // Update driver's last_seen timestamp
      await db.update(drivers).set({ lastSeen: new Date() }).where(eq(drivers.id, driverId));

      // Prepare broadcast payload for admins (Mapbox-snapped coords for admin map)
      const broadcastPayload: LocationBroadcastPayload = {
        driverId,
        driverName,
        latitude: payload.latitude,
        longitude: payload.longitude,
        snappedLatitude: snappedLat,
        snappedLongitude: snappedLng,
        speed: payload.speed,
        heading: payload.heading,
        timestamp: payload.timestamp || new Date().toISOString(),
      };

      // Broadcast to all admins in 'admin' room
      io.to('admin').emit('location:broadcast', broadcastPayload);

      // Also publish to Redis Pub/Sub for multi-server scalability
      await redisPub.publish(PubSubChannels.LOCATION_UPDATE, JSON.stringify(broadcastPayload));

      // Passenger app (Google Maps): raw GPS only — no Mapbox snapping
      const { findActiveBookingByDriver } = await import('../../repositories/booking.repository');
      const activeBooking = await findActiveBookingByDriver(driverId);
      if (activeBooking) {
        io.to(`customer-${activeBooking.customerId}`).emit('driver:location', {
          driverId,
          bookingId: activeBooking.id,
          latitude: payload.latitude,
          longitude: payload.longitude,
          heading: payload.heading ?? null,
          speedKph: payload.speed != null ? payload.speed * 3.6 : null,
          accuracyMeters: payload.accuracy ?? null,
          timestamp: payload.timestamp || new Date().toISOString(),
        });
      }

      // Send acknowledgment back to driver
      const ackPayload: LocationAckPayload = {
        received: true,
        timestamp: new Date().toISOString(),
      };
      socket.emit('location:ack', ackPayload);

      if (callback) {
        callback({
          success: true,
          data: {
            locationId: newLocation[0].id,
            received: true,
            timestamp: new Date().toISOString(),
          },
        });
      }
    } catch (error) {
      console.error('Location update error:', error);

      const errorPayload = {
        code: 'LOCATION_UPDATE_ERROR',
        message: 'Failed to process location update',
        details: error instanceof Error ? error.message : 'Unknown error',
      };

      socket.emit('error', errorPayload);

      if (callback) {
        callback({ success: false, error: errorPayload });
      }
    }
  });

  /**
   * Handle request for latest location of a specific driver (admin only)
   */
  socket.on('location:get', async (data: { driverId: string }, callback) => {
    try {
      // Only admins can request location data
      if (socketData.userType !== 'admin') {
        const error = {
          code: 'UNAUTHORIZED',
          message: 'Only admins can request location data',
        };
        socket.emit('error', error);
        if (callback) callback({ success: false, error });
        return;
      }

      if (!data.driverId) {
        const error = {
          code: 'VALIDATION_ERROR',
          message: 'Driver ID is required',
        };
        socket.emit('error', error);
        if (callback) callback({ success: false, error });
        return;
      }

      // Try to get from Redis cache first
      let location = await realtimeCache.getDriverLocation(data.driverId);

      // If not in cache, get from database
      if (!location) {
        const dbLocation = await db
          .select()
          .from(locations)
          .where(eq(locations.driverId, data.driverId))
          .orderBy(desc(locations.timestamp))
          .limit(1);

        if (dbLocation && dbLocation.length > 0) {
          location = {
            latitude: parseFloat(dbLocation[0].latitude),
            longitude: parseFloat(dbLocation[0].longitude),
            speed: dbLocation[0].speed ? parseFloat(dbLocation[0].speed) : undefined,
            heading: dbLocation[0].heading ? parseFloat(dbLocation[0].heading) : undefined,
            timestamp: dbLocation[0].timestamp.toISOString(),
          };
        }
      }

      if (callback) {
        callback({
          success: true,
          data: location || null,
        });
      }
    } catch (error) {
      console.error('Location get error:', error);

      const errorPayload = {
        code: 'LOCATION_GET_ERROR',
        message: 'Failed to retrieve location',
        details: error instanceof Error ? error.message : 'Unknown error',
      };

      if (callback) {
        callback({ success: false, error: errorPayload });
      }
    }
  });
}
