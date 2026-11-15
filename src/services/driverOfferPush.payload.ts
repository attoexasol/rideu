import { DISPATCH_OFFER_TTL_SECONDS } from '../constants/bookingStatus';
import { isOfferExpiredAt } from '../utils/offerTimestamps';
import {
  DRIVER_OFFER_NOTIFICATION_BODY,
  DRIVER_OFFER_NOTIFICATION_TITLE,
  FCM_COLLAPSE_KEY_PREFIX,
  FCM_OFFER_PUSH_TYPE,
} from '../config/fcm';

export type OfferPushDataPayload = {
  type: string;
  offerId: string;
  bookingId?: string;
};

export function remainingOfferTtlSeconds(
  expiresAt: Date,
  now: Date = new Date(),
  maxTtlSeconds: number = DISPATCH_OFFER_TTL_SECONDS
): number {
  const remaining = Math.floor((expiresAt.getTime() - now.getTime()) / 1000);
  if (remaining <= 0) return 0;
  const cap = Number.isFinite(maxTtlSeconds) && maxTtlSeconds > 0 ? maxTtlSeconds : remaining;
  return Math.min(remaining, cap);
}

export function shouldSendOfferPush(expiresAt: Date, now: Date = new Date()): boolean {
  return !isOfferExpiredAt(expiresAt, now) && remainingOfferTtlSeconds(expiresAt, now) > 0;
}

export function buildOfferPushDataPayload(input: {
  offerId: string;
  bookingId?: string | null;
}): OfferPushDataPayload {
  const data: OfferPushDataPayload = {
    type: FCM_OFFER_PUSH_TYPE,
    offerId: String(input.offerId),
  };
  if (input.bookingId != null && String(input.bookingId).trim() !== '') {
    data.bookingId = String(input.bookingId);
  }
  return data;
}

export function offerPushCollapseKey(offerId: string): string {
  return `${FCM_COLLAPSE_KEY_PREFIX}:${offerId}`;
}

/** Last 4 chars only. Never log the full FCM token. */
export function fcmTokenSuffix(token: string): string {
  const value = token.trim();
  if (value.length < 16) return '****';
  return value.slice(-4);
}

export type AndroidOfferFcmMessage = {
  token: string;
  data: OfferPushDataPayload;
  android: {
    priority: 'high';
    ttl: number;
    collapseKey: string;
  };
};

export type DriverOfferApnsConfig = {
  headers: {
    'apns-push-type': 'alert';
    'apns-priority': '10';
    'apns-expiration': string;
    'apns-collapse-id': string;
  };
  payload: {
    aps: {
      alert: {
        title: string;
        body: string;
      };
      sound: 'default';
    };
  };
};

export type DriverOfferFcmMessage = AndroidOfferFcmMessage & {
  apns: DriverOfferApnsConfig;
};

export function offerPushNotificationCopy(): { title: string; body: string } {
  return {
    title: DRIVER_OFFER_NOTIFICATION_TITLE,
    body: DRIVER_OFFER_NOTIFICATION_BODY,
  };
}

export function buildApnsOfferConfig(input: {
  offerId: string;
  ttlSeconds: number;
  now?: Date;
}): DriverOfferApnsConfig {
  const ttlSeconds = Math.max(0, Math.floor(input.ttlSeconds));
  const now = input.now ?? new Date();
  const expirationUnix = Math.floor(now.getTime() / 1000) + ttlSeconds;
  const copy = offerPushNotificationCopy();
  return {
    headers: {
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-expiration': String(expirationUnix),
      'apns-collapse-id': offerPushCollapseKey(input.offerId),
    },
    payload: {
      aps: {
        alert: {
          title: copy.title,
          body: copy.body,
        },
        sound: 'default',
      },
    },
  };
}

/** firebase-admin AndroidConfig.ttl is milliseconds. Data-only for Android. */
export function buildAndroidOfferFcmMessage(input: {
  token: string;
  offerId: string;
  bookingId?: string | null;
  ttlSeconds: number;
}): AndroidOfferFcmMessage {
  const ttlSeconds = Math.max(0, Math.floor(input.ttlSeconds));
  return {
    token: input.token,
    data: buildOfferPushDataPayload({ offerId: input.offerId, bookingId: input.bookingId }),
    android: {
      priority: 'high',
      ttl: ttlSeconds * 1000,
      collapseKey: offerPushCollapseKey(input.offerId),
    },
  };
}

/**
 * Common FCM data + Android data-only options + iOS APNs user-visible alert.
 * No top-level `notification` so Android stays data-only.
 */
export function buildDriverOfferFcmMessage(input: {
  token: string;
  offerId: string;
  bookingId?: string | null;
  ttlSeconds: number;
  now?: Date;
}): DriverOfferFcmMessage {
  const androidMessage = buildAndroidOfferFcmMessage(input);
  return {
    ...androidMessage,
    apns: buildApnsOfferConfig({
      offerId: input.offerId,
      ttlSeconds: input.ttlSeconds,
      now: input.now,
    }),
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
  if (message.includes('mismatched-credential')) {
    return 'messaging/mismatched-credential';
  }
  if (message.includes('third-party-auth') || message.includes('third_party_auth')) {
    return 'messaging/third-party-auth-error';
  }
  if (message.includes('invalid-argument') || message.includes('invalid argument')) {
    return 'messaging/invalid-argument';
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
