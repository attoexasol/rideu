import { getEnvVarAsBoolean } from './env-validator';

export const FCM_COLLAPSE_KEY_PREFIX = 'booking_offer';
export const FCM_OFFER_PUSH_TYPE = 'booking_offer';
export const FCM_RIDE_EVENT_TYPE = 'ride_event';
export const FCM_RIDE_EVENT_COLLAPSE_PREFIX = 'ride_event';
export const FCM_RIDE_UPDATES_CHANNEL_ID = 'ride_updates';
export const FCM_TRANSIENT_MAX_ATTEMPTS = 2;
export const FCM_TRANSIENT_RETRY_DELAY_MS = 150;

export function isFcmEnabled(): boolean {
  return getEnvVarAsBoolean('FCM_ENABLED', false);
}

export function getFirebaseProjectId(): string | undefined {
  const value = process.env.FIREBASE_PROJECT_ID?.trim();
  return value || undefined;
}

/**
 * Inline service-account JSON from a secret manager / env var.
 * Never log the returned string.
 */
export function getFirebaseServiceAccountJson(): string | undefined {
  const value = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  return value || undefined;
}

export function getGoogleApplicationCredentialsPath(): string | undefined {
  const value = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  return value || undefined;
}

export function hasFcmCredentialConfig(): boolean {
  return Boolean(getFirebaseServiceAccountJson() || getGoogleApplicationCredentialsPath());
}
