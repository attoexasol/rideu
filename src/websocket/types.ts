/**
 * WebSocket Event Type Definitions
 * Defines all Socket.IO event payloads for type safety
 */

/**
 * Location update event payload (Driver → Server)
 */
export interface LocationUpdatePayload {
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  timestamp: string; // ISO timestamp
}

/**
 * Location broadcast event payload (Server → Admins)
 */
export interface LocationBroadcastPayload {
  driverId: string;
  driverName: string;
  latitude: number;
  longitude: number;
  snappedLatitude?: number; // Road-snapped latitude (if available)
  snappedLongitude?: number; // Road-snapped longitude (if available)
  speed?: number;
  heading?: number;
  timestamp: string;
}

/**
 * Driver status update payload
 */
export interface DriverStatusPayload {
  status: 'online' | 'offline';
}

/**
 * Driver status change broadcast (Server → Admins)
 */
export interface DriverStatusChangeBroadcast {
  driverId: string;
  driverName: string;
  status: 'online' | 'offline';
  timestamp: string;
}

/**
 * Authentication payload (Client → Server)
 */
export interface AuthenticatePayload {
  token: string; // JWT token
}

/**
 * Authenticated response (Server → Client)
 */
export interface AuthenticatedResponse {
  userId: string;
  userType: 'driver' | 'admin';
  role: string;
  rooms: string[];
}

/**
 * Location acknowledgment (Server → Driver)
 */
export interface LocationAckPayload {
  received: boolean;
  timestamp: string;
}

/**
 * Driver online/offline event (Server → Admins)
 */
export interface DriverOnlineOfflinePayload {
  driverId: string;
  driverName: string;
  timestamp: string;
}

/**
 * Error event payload
 */
export interface ErrorPayload {
  code: string;
  message: string;
  details?: any;
}

/**
 * Socket data attached to each socket instance
 */
export interface SocketData {
  userId: string;
  auth0Id: string;
  userType: 'driver' | 'admin';
  role: string;
  email: string;
  name: string;
  authenticated: boolean;
}

/**
 * Connection state for tracking active connections
 */
export interface ConnectionState {
  socketId: string;
  userId: string;
  userType: 'driver' | 'admin';
  connectedAt: Date;
  lastHeartbeat: Date;
}

/**
 * Message buffer item for offline clients
 */
export interface BufferedMessage {
  event: string;
  data: any;
  timestamp: Date;
}
