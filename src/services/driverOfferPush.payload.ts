import { DISPATCH_OFFER_TTL_SECONDS } from '../constants/bookingStatus';
import { isOfferExpiredAt } from '../utils/offerTimestamps';
import { FCM_COLLAPSE_KEY_PREFIX, FCM_OFFER_PUSH_TYPE } from '../config/fcm';

export type OfferPushDataPayload = {
  type: string;
  offerId: string;
  bookingId: string;
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
  bookingId: string;
}): OfferPushDataPayload {
  return {
    type: FCM_OFFER_PUSH_TYPE,
    offerId: String(input.offerId),
    bookingId: String(input.bookingId),
  };
}

export function offerPushCollapseKey(offerId: string): string {
  return `${FCM_COLLAPSE_KEY_PREFIX}:${offerId}`;
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

/** firebase-admin AndroidConfig.ttl is milliseconds. */
export function buildAndroidOfferFcmMessage(input: {
  token: string;
  offerId: string;
  bookingId: string;
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
