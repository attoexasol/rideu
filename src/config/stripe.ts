/**
 * Backend-only Stripe configuration.
 * Secret values must never be logged or returned to clients.
 */

const TEST_SECRET_PREFIX = 'sk_test_';
const LIVE_SECRET_PREFIX = 'sk_live_';
const TEST_PUBLISHABLE_PREFIX = 'pk_test_';
const LIVE_PUBLISHABLE_PREFIX = 'pk_live_';
const TEST_WEBHOOK_PREFIX = 'whsec_';

function trimEnv(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

export function getStripeSecretKey(): string | undefined {
  return trimEnv('STRIPE_SECRET_KEY');
}

export function getStripeWebhookSecret(): string | undefined {
  return trimEnv('STRIPE_WEBHOOK_SECRET');
}

/** Publishable key is client-safe if ever needed. Not served by an endpoint in Phase A. */
export function getStripePublishableKey(): string | undefined {
  return trimEnv('STRIPE_PUBLISHABLE_KEY');
}

export function isStripeSecretConfigured(): boolean {
  return Boolean(getStripeSecretKey());
}

export function isStripeWebhookConfigured(): boolean {
  return Boolean(getStripeWebhookSecret());
}

export function isStripeTestModeSecret(secret: string | undefined = getStripeSecretKey()): boolean {
  return Boolean(secret?.startsWith(TEST_SECRET_PREFIX));
}

export type StripeKeyMode = 'test' | 'live' | 'unknown' | 'not_configured';

export function classifyStripeSecretMode(
  secret: string | undefined = getStripeSecretKey()
): StripeKeyMode {
  if (!secret) return 'not_configured';
  if (secret.startsWith(TEST_SECRET_PREFIX)) return 'test';
  if (secret.startsWith(LIVE_SECRET_PREFIX)) return 'live';
  return 'unknown';
}

export function classifyStripePublishableMode(
  publishable: string | undefined = getStripePublishableKey()
): StripeKeyMode {
  if (!publishable) return 'not_configured';
  if (publishable.startsWith(TEST_PUBLISHABLE_PREFIX)) return 'test';
  if (publishable.startsWith(LIVE_PUBLISHABLE_PREFIX)) return 'live';
  return 'unknown';
}

/** True when secret and publishable keys are both test or both live. */
export function areStripeKeyModesAligned(): boolean {
  const secretMode = classifyStripeSecretMode();
  const publishableMode = classifyStripePublishableMode();
  return (
    (secretMode === 'test' && publishableMode === 'test') ||
    (secretMode === 'live' && publishableMode === 'live')
  );
}

/**
 * Card payments require a secret, a publishable key, and matching test/live modes.
 * Webhook secret is recommended for authorization webhooks but not required to present card
 * because GET payment status can reconcile.
 */
export function areStripeCardPaymentsEnabled(): boolean {
  return (
    isStripeSecretConfigured() &&
    Boolean(getStripePublishableKey()) &&
    areStripeKeyModesAligned()
  );
}

export function getStripeConnectDefaultCountry(): string | undefined {
  const value = trimEnv('STRIPE_CONNECT_DEFAULT_COUNTRY') ?? trimEnv('CONNECT_DEFAULT_COUNTRY');
  return value ? value.toUpperCase() : undefined;
}

export function getStripeConnectReturnUrl(): string | undefined {
  return trimEnv('STRIPE_CONNECT_RETURN_URL');
}

export function getStripeConnectRefreshUrl(): string | undefined {
  return trimEnv('STRIPE_CONNECT_REFRESH_URL');
}

export function describeStripeConfig(): {
  secretKey: 'SET' | 'NOT SET';
  webhookSecret: 'SET' | 'NOT SET';
  publishableKey: 'SET' | 'NOT SET';
  connectDefaultCountry: 'SET' | 'NOT SET';
  connectReturnUrl: 'SET' | 'NOT SET';
  connectRefreshUrl: 'SET' | 'NOT SET';
  mode: 'test' | 'live' | 'unknown' | 'not_configured';
} {
  const secret = getStripeSecretKey();
  const mode = classifyStripeSecretMode(secret);
  return {
    secretKey: secret ? 'SET' : 'NOT SET',
    webhookSecret: getStripeWebhookSecret() ? 'SET' : 'NOT SET',
    publishableKey: getStripePublishableKey() ? 'SET' : 'NOT SET',
    connectDefaultCountry: getStripeConnectDefaultCountry() ? 'SET' : 'NOT SET',
    connectReturnUrl: getStripeConnectReturnUrl() ? 'SET' : 'NOT SET',
    connectRefreshUrl: getStripeConnectRefreshUrl() ? 'SET' : 'NOT SET',
    mode,
  };
}

/** Used only to classify secrets; never log the returned boolean alongside the value. */
export function looksLikeStripeWebhookSecret(value: string): boolean {
  return value.startsWith(TEST_WEBHOOK_PREFIX);
}
