import { PubSubChannels, redisSub, isRedisPubSubEnabled, safeRedisPublish } from '../config/redis';
import type { Server } from 'socket.io';

export interface BookingWsPayload {
  bookingId: string;
  status: string;
  [key: string]: unknown;
}

interface BookingPubSubMessage {
  target: 'customer' | 'driver' | 'admin';
  customerId?: string;
  driverId?: string;
  event: string;
  data: unknown;
}

let ioRef: Server | null = null;
let subscriberInitialized = false;

export function setupBookingEventSubscriber(io: Server): void {
  if (subscriberInitialized) return;
  ioRef = io;
  subscriberInitialized = true;

  if (!isRedisPubSubEnabled()) return;

  redisSub.subscribe(PubSubChannels.BOOKING_UPDATE).catch((err: Error) => {
    console.error('Failed to subscribe to booking updates:', err);
  });

  redisSub.on('message', (channel: string, message: string) => {
    if (channel !== PubSubChannels.BOOKING_UPDATE || !ioRef) return;
    try {
      const parsed = JSON.parse(message) as BookingPubSubMessage;
      if (parsed.target === 'customer' && parsed.customerId) {
        ioRef.to(`customer-${parsed.customerId}`).emit(parsed.event, parsed.data);
      } else if (parsed.target === 'driver' && parsed.driverId) {
        ioRef.to(`driver-${parsed.driverId}`).emit(parsed.event, parsed.data);
      } else if (parsed.target === 'admin') {
        ioRef.to('admin').emit(parsed.event, parsed.data);
      }
    } catch (err) {
      console.error('Booking pub/sub handler error:', err);
    }
  });
}

async function publishBookingEvent(message: BookingPubSubMessage): Promise<void> {
  if (!isRedisPubSubEnabled()) {
    if (!ioRef) return;
    if (message.target === 'customer' && message.customerId) {
      ioRef.to(`customer-${message.customerId}`).emit(message.event, message.data);
    } else if (message.target === 'driver' && message.driverId) {
      ioRef.to(`driver-${message.driverId}`).emit(message.event, message.data);
    } else if (message.target === 'admin') {
      ioRef.to('admin').emit(message.event, message.data);
    }
    return;
  }
  await safeRedisPublish(PubSubChannels.BOOKING_UPDATE, JSON.stringify(message));
}

export async function emitToCustomer(
  customerId: string,
  event: string,
  data: unknown
): Promise<void> {
  await publishBookingEvent({ target: 'customer', customerId, event, data });
}

export async function emitToDriver(driverId: string, event: string, data: unknown): Promise<void> {
  await publishBookingEvent({ target: 'driver', driverId, event, data });

  const room = `driver-${driverId}`;
  const roomSize = ioRef?.sockets.adapter.rooms.get(room)?.size ?? 0;
  const payload = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  console.info('[BookingNotify] emit to driver room', {
    event,
    driverId,
    room,
    roomSize,
    offerId: typeof payload.offerId === 'string' ? payload.offerId : undefined,
    bookingId: typeof payload.bookingId === 'string' ? payload.bookingId : undefined,
  });
}

export async function emitToAdmins(event: string, data: unknown): Promise<void> {
  await publishBookingEvent({ target: 'admin', event, data });
}

export async function emitOfferCancelled(
  driverId: string,
  payload: { bookingId: string; offerId: string; reason: string }
): Promise<void> {
  await emitToDriver(driverId, 'booking:offer:cancelled', payload);
}

export async function emitBookingStatus(
  bookingId: string,
  customerId: string,
  driverId: string | null,
  status: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const payload = { bookingId, status, timestamp: new Date().toISOString(), ...extra };
  await emitToCustomer(customerId, 'booking:status', payload);
  if (driverId) {
    await emitToDriver(driverId, 'booking:status', payload);
  }
  await emitToAdmins('booking:status', payload);
}

export async function emitDriverLocationToCustomer(
  customerId: string,
  location: {
    driverId: string;
    bookingId: string;
    latitude: number;
    longitude: number;
    heading?: number | null;
    speedKph?: number | null;
    accuracyMeters?: number | null;
    timestamp: string;
  }
): Promise<void> {
  await emitToCustomer(customerId, 'driver:location', location);
}

export async function emitRecordingConsent(
  driverId: string,
  payload: { bookingId: string; consented: boolean; recordingConsentedAt: string }
): Promise<void> {
  await emitToDriver(driverId, 'booking:recording-consent', payload);
}

export async function emitLiveVideoSegment(
  customerId: string,
  bookingId: string,
  segment: {
    sessionId: string;
    segmentIndex: number;
    videoUrl: string;
    timestamp: string;
  }
): Promise<void> {
  const payload = { bookingId, ...segment };
  await emitToCustomer(customerId, 'video:live-segment', payload);
  await emitToAdmins('video:live-segment', payload);
}
