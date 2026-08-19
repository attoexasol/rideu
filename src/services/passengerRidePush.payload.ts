import {
  FCM_RIDE_EVENT_COLLAPSE_PREFIX,
  FCM_RIDE_EVENT_TYPE,
  FCM_RIDE_UPDATES_CHANNEL_ID,
} from '../config/fcm';

export const PASSENGER_RIDE_PUSH_EVENTS = [
  'driver_en_route',
  'arrived',
  'in_progress',
  'completed',
  'cancelled',
  'no_drivers',
] as const;

export type PassengerRidePushEvent = (typeof PASSENGER_RIDE_PUSH_EVENTS)[number];

export type PassengerRidePushDataPayload = {
  type: string;
  bookingId: string;
  event: string;
  cancelledBy?: string;
};

export type PassengerRidePushPriority = 'high' | 'normal';

const EVENT_TITLES: Record<PassengerRidePushEvent, string> = {
  driver_en_route: 'Your driver accepted the ride',
  arrived: 'Your driver has arrived',
  in_progress: 'Your ride has started',
  completed: 'Ride completed',
  cancelled: 'Ride cancelled',
  no_drivers: 'No driver found',
};

const GENERIC_NOTIFICATION_BODY = 'Open the app to view ride details.';

export function isPassengerRidePushEvent(value: string): value is PassengerRidePushEvent {
  return (PASSENGER_RIDE_PUSH_EVENTS as readonly string[]).includes(value);
}

export function shouldSendPassengerRidePush(event: string): boolean {
  return isPassengerRidePushEvent(event);
}

export function passengerRidePushTtlSeconds(event: PassengerRidePushEvent): number {
  switch (event) {
    case 'driver_en_route':
      return 180;
    case 'arrived':
      return 90;
    case 'in_progress':
      return 120;
    case 'cancelled':
      return 300;
    case 'no_drivers':
      return 600;
    case 'completed':
      return 1800;
    default:
      return 180;
  }
}

export function passengerRidePushPriority(event: PassengerRidePushEvent): PassengerRidePushPriority {
  switch (event) {
    case 'driver_en_route':
    case 'arrived':
    case 'in_progress':
    case 'cancelled':
      return 'high';
    case 'no_drivers':
    case 'completed':
      return 'normal';
    default:
      return 'normal';
  }
}

export function passengerRidePushCollapseKey(bookingId: string): string {
  return `${FCM_RIDE_EVENT_COLLAPSE_PREFIX}:${bookingId}`;
}

export function passengerRideNotificationCopy(event: PassengerRidePushEvent): {
  title: string;
  body: string;
} {
  return {
    title: EVENT_TITLES[event],
    body: GENERIC_NOTIFICATION_BODY,
  };
}

export function buildPassengerRidePushDataPayload(input: {
  bookingId: string;
  event: PassengerRidePushEvent;
  cancelledBy?: string | null;
}): PassengerRidePushDataPayload {
  const data: PassengerRidePushDataPayload = {
    type: FCM_RIDE_EVENT_TYPE,
    bookingId: String(input.bookingId),
    event: input.event,
  };
  if (input.event === 'cancelled' && input.cancelledBy) {
    data.cancelledBy = String(input.cancelledBy);
  }
  return data;
}

export type AndroidPassengerRideFcmMessage = {
  token: string;
  notification: { title: string; body: string };
  data: PassengerRidePushDataPayload;
  android: {
    priority: PassengerRidePushPriority;
    ttl: number;
    collapseKey: string;
    notification: { channelId: string };
  };
};

export function buildAndroidPassengerRideFcmMessage(input: {
  token: string;
  bookingId: string;
  event: PassengerRidePushEvent;
  cancelledBy?: string | null;
}): AndroidPassengerRideFcmMessage {
  const copy = passengerRideNotificationCopy(input.event);
  return {
    token: input.token,
    notification: copy,
    data: buildPassengerRidePushDataPayload(input),
    android: {
      priority: passengerRidePushPriority(input.event),
      ttl: passengerRidePushTtlSeconds(input.event) * 1000,
      collapseKey: passengerRidePushCollapseKey(input.bookingId),
      notification: {
        channelId: FCM_RIDE_UPDATES_CHANNEL_ID,
      },
    },
  };
}

export type FcmFailureClass = 'permanent_token' | 'transient' | 'other';

const PERMANENT_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/unregistered',
  'UNREGISTERED',
]);

const TRANSIENT_CODES = new Set([
  'messaging/unavailable',
  'messaging/internal-error',
  'messaging/server-unavailable',
  'messaging/timeout',
  'UNAVAILABLE',
  'INTERNAL',
  'TIMEOUT',
]);

export function getFcmErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'UNKNOWN';
  const record = error as {
    code?: string;
    errorInfo?: { code?: string };
    message?: string;
  };
  const code = record.errorInfo?.code || record.code;
  if (typeof code === 'string' && code.trim()) return code;
  const message = typeof record.message === 'string' ? record.message.toLowerCase() : '';
  if (message.includes('registration-token-not-registered') || message.includes('unregistered')) {
    return 'messaging/registration-token-not-registered';
  }
  if (message.includes('invalid-registration-token') || message.includes('invalid registration')) {
    return 'messaging/invalid-registration-token';
  }
  if (message.includes('sender-id-mismatch') || message.includes('senderidmismatch')) {
    return 'messaging/mismatched-credential';
  }
  if (message.includes('third-party-auth') || message.includes('third_party_auth')) {
    return 'messaging/third-party-auth-error';
  }
  if (message.includes('unavailable')) return 'messaging/unavailable';
  if (message.includes('timeout')) return 'messaging/timeout';
  return 'UNKNOWN';
}

export function classifyFcmError(error: unknown): FcmFailureClass {
  const code = getFcmErrorCode(error);
  const normalized = code.toLowerCase();
  if (
    PERMANENT_TOKEN_CODES.has(code) ||
    normalized.includes('unregistered') ||
    normalized.includes('registration-token-not-registered') ||
    normalized.includes('invalid-registration-token') ||
    (normalized.includes('invalid-argument') && normalized.includes('token'))
  ) {
    return 'permanent_token';
  }
  if (TRANSIENT_CODES.has(code) || normalized.includes('unavailable') || normalized.includes('timeout')) {
    return 'transient';
  }
  return 'other';
}

export function mapPassengerPushFailureCode(rawCode: string | null): string {
  if (!rawCode) return 'UNKNOWN';
  const normalized = rawCode.toLowerCase();
  if (
    normalized.includes('unregistered') ||
    normalized.includes('registration-token-not-registered')
  ) {
    return 'UNREGISTERED';
  }
  if (normalized.includes('invalid-registration-token') || normalized.includes('invalid-argument')) {
    return 'INVALID_ARGUMENT';
  }
  if (normalized.includes('sender-id') || normalized.includes('mismatched-credential')) {
    return 'SENDER_ID_MISMATCH';
  }
  if (normalized.includes('third-party-auth')) {
    return 'THIRD_PARTY_AUTH_ERROR';
  }
  if (normalized.includes('unavailable') || normalized.includes('timeout') || normalized.includes('internal')) {
    return 'UNAVAILABLE';
  }
  return rawCode;
}
