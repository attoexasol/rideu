/**
 * Environment Variable Validator
 * Validates required environment variables on startup
 */

import {
  areStripeKeyModesAligned,
  describeStripeConfig,
  getStripePublishableKey,
  isStripeSecretConfigured,
} from './stripe';

interface EnvConfig {
  required: string[];
  optional?: string[];
}

const envConfigs: Record<string, EnvConfig> = {
  production: {
    required: [
      'NODE_ENV',
      'PORT',
      'DATABASE_URL',
      'REDIS_URL',
      'AUTH0_DOMAIN',
      'AUTH0_API_IDENTIFIER',
      'AUTH0_CLIENT_ID',
      'AUTH0_CLIENT_SECRET',
      'AUTH0_PASSENGER_CLIENT_ID',
      'JWT_SECRET',
      'CORS_ORIGIN',
      'MAPBOX_ACCESS_TOKEN',
      'GOOGLE_MAPS_API_KEY',
    ],
    optional: [
      'AUTH0_AUDIENCE',
      'AUTH0_ALGORITHM',
      'SENTRY_DSN',
      'RATE_LIMIT_WINDOW_MS',
      'RATE_LIMIT_MAX_REQUESTS',
      'RATE_LIMIT_ENABLED',
      'RATE_LIMIT_USE_REDIS',
      'AUTH_RATE_LIMIT_MAX',
      'PASSENGER_MAPS_RATE_LIMIT_WINDOW_MS',
      'PASSENGER_MAPS_RATE_LIMIT_MAX',
      'PASSENGER_RATE_LIMIT_MAX',
      'BOOKING_RATE_LIMIT_MAX',
      'PASSENGER_CANCEL_RATE_LIMIT_WINDOW_MS',
      'PASSENGER_CANCEL_RATE_LIMIT_MAX',
      'DRIVER_RATE_LIMIT_MAX',
      'DRIVER_LOCATION_RATE_LIMIT_WINDOW_MS',
      'DRIVER_LOCATION_RATE_LIMIT_MAX',
      'DRIVER_OFFER_RATE_LIMIT_MAX',
      'DRIVER_RECOVERY_RATE_LIMIT_MAX',
      'VIDEO_UPLOAD_RATE_LIMIT_MAX',
      'LOG_LEVEL',
      'GOOGLE_MAPS_REGION',
      'GOOGLE_MAPS_LANGUAGE',
      'GOOGLE_MAPS_DEFAULT_COUNTRY',
      'GOOGLE_MAPS_REQUEST_TIMEOUT_MS',
      'GOOGLE_MAPS_CACHE_TTL_SECONDS',
      'DRIVER_LOCATION_STALE_SECONDS',
      'DISPATCH_RADIUS_KM',
      'DISPATCH_BATCH_SIZE',
      'DISPATCH_OFFER_TIMEOUT_SECONDS',
      'DISPATCH_MAX_BATCHES',
      'VIDEO_RECORDING_ENABLED',
      'VIDEO_RECORDING_CONSENT_REQUIRED',
      'VIDEO_SEGMENT_DURATION_SECONDS',
      'VIDEO_MAX_SEGMENT_SIZE_BYTES',
      'VIDEO_UPLOAD_URL_TTL_SECONDS',
      'VIDEO_READ_URL_TTL_SECONDS',
      'VIDEO_RETENTION_DAYS',
      'VIDEO_STORAGE_CONTAINER',
      'VIDEO_STORAGE_ROOT',
      'VIDEO_SIGNING_SECRET',
      'QR_DUTY_REQUIRED',
      'FCM_ENABLED',
      'GOOGLE_APPLICATION_CREDENTIALS',
      'FIREBASE_SERVICE_ACCOUNT_JSON',
      'FIREBASE_PROJECT_ID',
    ],
  },
  staging: {
    required: [
      'NODE_ENV',
      'PORT',
      'DATABASE_URL',
      'REDIS_URL',
      'AUTH0_DOMAIN',
      'AUTH0_API_IDENTIFIER',
      'AUTH0_CLIENT_ID',
      'AUTH0_CLIENT_SECRET',
      'AUTH0_PASSENGER_CLIENT_ID',
      'JWT_SECRET',
      'CORS_ORIGIN',
    ],
    optional: [
      'AUTH0_AUDIENCE',
      'AUTH0_ALGORITHM',
      'MAPBOX_ACCESS_TOKEN',
      'GOOGLE_MAPS_API_KEY',
      'GOOGLE_MAPS_REGION',
      'GOOGLE_MAPS_LANGUAGE',
      'GOOGLE_MAPS_DEFAULT_COUNTRY',
      'GOOGLE_MAPS_REQUEST_TIMEOUT_MS',
      'GOOGLE_MAPS_CACHE_TTL_SECONDS',
      'RATE_LIMIT_WINDOW_MS',
      'RATE_LIMIT_MAX_REQUESTS',
      'RATE_LIMIT_ENABLED',
      'RATE_LIMIT_USE_REDIS',
      'AUTH_RATE_LIMIT_MAX',
      'PASSENGER_MAPS_RATE_LIMIT_MAX',
      'BOOKING_RATE_LIMIT_MAX',
      'DRIVER_LOCATION_RATE_LIMIT_MAX',
      'DRIVER_OFFER_RATE_LIMIT_MAX',
      'VIDEO_RECORDING_ENABLED',
      'VIDEO_RECORDING_CONSENT_REQUIRED',
      'VIDEO_SEGMENT_DURATION_SECONDS',
      'VIDEO_MAX_SEGMENT_SIZE_BYTES',
      'VIDEO_UPLOAD_URL_TTL_SECONDS',
      'VIDEO_READ_URL_TTL_SECONDS',
      'VIDEO_RETENTION_DAYS',
      'VIDEO_STORAGE_CONTAINER',
      'VIDEO_STORAGE_ROOT',
      'VIDEO_SIGNING_SECRET',
      'LOG_LEVEL',
      'FCM_ENABLED',
      'GOOGLE_APPLICATION_CREDENTIALS',
      'FIREBASE_SERVICE_ACCOUNT_JSON',
      'FIREBASE_PROJECT_ID',
    ],
  },
  development: {
    required: ['PORT', 'DATABASE_URL'],
    optional: [
      'NODE_ENV',
      'REDIS_URL',
      'REDIS_HOST',
      'REDIS_PORT',
      'AUTH0_DOMAIN',
      'AUTH0_API_IDENTIFIER',
      'AUTH0_AUDIENCE',
      'AUTH0_ALGORITHM',
      'AUTH0_CLIENT_ID',
      'AUTH0_CLIENT_SECRET',
      'AUTH0_PASSENGER_CLIENT_ID',
      'JWT_SECRET',
      'CORS_ORIGIN',
      'BYPASS_AUTH',
      'MAPBOX_ACCESS_TOKEN',
      'GOOGLE_MAPS_API_KEY',
      'GOOGLE_MAPS_REGION',
      'GOOGLE_MAPS_LANGUAGE',
      'GOOGLE_MAPS_DEFAULT_COUNTRY',
      'GOOGLE_MAPS_REQUEST_TIMEOUT_MS',
      'GOOGLE_MAPS_CACHE_TTL_SECONDS',
      'RATE_LIMIT_WINDOW_MS',
      'RATE_LIMIT_MAX_REQUESTS',
      'RATE_LIMIT_ENABLED',
      'RATE_LIMIT_USE_REDIS',
      'AUTH_RATE_LIMIT_MAX',
      'PASSENGER_MAPS_RATE_LIMIT_MAX',
      'BOOKING_RATE_LIMIT_MAX',
      'DRIVER_LOCATION_RATE_LIMIT_MAX',
      'DRIVER_OFFER_RATE_LIMIT_MAX',
      'LOG_LEVEL',
      'DRIVER_LOCATION_STALE_SECONDS',
      'DISPATCH_RADIUS_KM',
      'DISPATCH_BATCH_SIZE',
      'DISPATCH_OFFER_TIMEOUT_SECONDS',
      'DISPATCH_MAX_BATCHES',
      'VIDEO_RECORDING_ENABLED',
      'VIDEO_RECORDING_CONSENT_REQUIRED',
      'VIDEO_SEGMENT_DURATION_SECONDS',
      'VIDEO_MAX_SEGMENT_SIZE_BYTES',
      'VIDEO_UPLOAD_URL_TTL_SECONDS',
      'VIDEO_READ_URL_TTL_SECONDS',
      'VIDEO_RETENTION_DAYS',
      'VIDEO_STORAGE_CONTAINER',
      'VIDEO_STORAGE_ROOT',
      'VIDEO_SIGNING_SECRET',
      'FCM_ENABLED',
      'GOOGLE_APPLICATION_CREDENTIALS',
      'FIREBASE_SERVICE_ACCOUNT_JSON',
      'FIREBASE_PROJECT_ID',
    ],
  },
  test: {
    required: [],
    optional: ['NODE_ENV', 'PORT', 'DATABASE_URL', 'REDIS_URL', 'BYPASS_AUTH'],
  },
};

/**
 * Validates environment variables based on NODE_ENV
 * @throws Error if required variables are missing
 */
export function validateEnvironment(): void {
  const nodeEnv = process.env.NODE_ENV?.trim() || 'development';
  const config = envConfigs[nodeEnv] || envConfigs.development;

  console.log(`\n🔍 Validating environment variables for ${nodeEnv} mode...`);

  const missing: string[] = [];
  const warnings: string[] = [];

  // Check required variables
  for (const key of config.required) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  // Check optional variables and warn if missing
  if (config.optional) {
    for (const key of config.optional) {
      if (!process.env[key]) {
        warnings.push(key);
      }
    }
  }

  // Validate specific variable formats
  if (process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith('postgresql://')) {
    throw new Error('DATABASE_URL must start with postgresql://');
  }

  if (process.env.REDIS_URL && !process.env.REDIS_URL.match(/^redis:\/\//)) {
    throw new Error('REDIS_URL must start with redis://');
  }

  if (process.env.PORT && isNaN(Number(process.env.PORT))) {
    throw new Error('PORT must be a valid number');
  }

  if (process.env.AUTH0_DOMAIN && process.env.AUTH0_DOMAIN.startsWith('https://')) {
    throw new Error('AUTH0_DOMAIN should not include https:// prefix');
  }

  const videoRecordingEnabled = process.env.VIDEO_RECORDING_ENABLED?.toLowerCase() === 'true';
  if (videoRecordingEnabled) {
    const numericVideoVariables = [
      'VIDEO_SEGMENT_DURATION_SECONDS',
      'VIDEO_MAX_SEGMENT_SIZE_BYTES',
      'VIDEO_UPLOAD_URL_TTL_SECONDS',
      'VIDEO_READ_URL_TTL_SECONDS',
      'VIDEO_RETENTION_DAYS',
    ];
    for (const key of numericVideoVariables) {
      const value = Number(process.env[key]);
      if (!process.env[key] || !Number.isFinite(value) || value <= 0) {
        throw new Error(`${key} must be a positive number when video recording is enabled`);
      }
    }

    if (nodeEnv === 'production') {
      for (const key of ['VIDEO_STORAGE_CONTAINER', 'VIDEO_STORAGE_ROOT', 'VIDEO_SIGNING_SECRET']) {
        if (!process.env[key]) missing.push(key);
      }
      if ((process.env.VIDEO_SIGNING_SECRET?.length ?? 0) < 32) {
        throw new Error('VIDEO_SIGNING_SECRET must be at least 32 characters in production');
      }
    }
  }

  // Security checks for production
  if (nodeEnv === 'production') {
    if (process.env.BYPASS_AUTH === 'true') {
      throw new Error('BYPASS_AUTH cannot be true in production');
    }

    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters in production');
    }

    if (process.env.CORS_ORIGIN?.includes('localhost')) {
      console.warn('⚠️  WARNING: CORS_ORIGIN includes localhost in production');
    }
  }

  // Report results
  if (missing.length > 0) {
    console.error('\n❌ Missing required environment variables:');
    missing.forEach((key) => console.error(`  - ${key}`));
    console.error('\nPlease check your .env file or environment configuration.');
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if (warnings.length > 0) {
    console.warn('\n⚠️  Missing optional environment variables:');
    warnings.forEach((key) => console.warn(`  - ${key}`));
    console.warn('  These variables are optional but recommended.');
  }

  if (isStripeSecretConfigured() && getStripePublishableKey() && !areStripeKeyModesAligned()) {
    throw new Error(
      'STRIPE_MODE_MISMATCH: Stripe secret and publishable keys must both be test or both be live. Cash bookings remain available if Stripe keys are removed.'
    );
  }

  if (process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_WEBHOOK_SECRET) {
    console.warn(
      '⚠️  STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is not. Card webhooks will fail until the webhook secret is set. Cash bookings still work.'
    );
  }

  if (process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_CONNECT_DEFAULT_COUNTRY && !process.env.CONNECT_DEFAULT_COUNTRY) {
    console.warn(
      '⚠️  STRIPE_SECRET_KEY is set but STRIPE_CONNECT_DEFAULT_COUNTRY is not. Driver Connect onboarding will return STRIPE_CONNECT_COUNTRY_REQUIRED. Do not assume BD from BDT fares. Cash bookings still work.'
    );
  }

  if (
    process.env.STRIPE_SECRET_KEY &&
    (!process.env.STRIPE_CONNECT_RETURN_URL || !process.env.STRIPE_CONNECT_REFRESH_URL)
  ) {
    console.warn(
      '⚠️  Stripe Connect return/refresh URLs are not fully set. Driver onboarding links will fail until STRIPE_CONNECT_RETURN_URL and STRIPE_CONNECT_REFRESH_URL are configured. Cash bookings still work.'
    );
  }

  console.log('✅ Environment validation passed\n');
}

/**
 * Get validated environment variable or throw error
 * @param key - Environment variable key
 * @param defaultValue - Optional default value
 * @returns Environment variable value
 */
export function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key] || defaultValue;
  if (!value) {
    throw new Error(`Environment variable ${key} is not set`);
  }
  return value;
}

/**
 * Get validated numeric environment variable
 * @param key - Environment variable key
 * @param defaultValue - Optional default value
 * @returns Numeric environment variable value
 */
export function getEnvVarAsNumber(key: string, defaultValue?: number): number {
  const value = process.env[key];
  if (!value) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Environment variable ${key} is not set`);
  }
  const num = Number(value);
  if (isNaN(num)) {
    throw new Error(`Environment variable ${key} must be a number`);
  }
  return num;
}

/**
 * Get validated boolean environment variable
 * @param key - Environment variable key
 * @param defaultValue - Optional default value
 * @returns Boolean environment variable value
 */
export function getEnvVarAsBoolean(key: string, defaultValue = false): boolean {
  const value = process.env[key];
  if (!value) {
    return defaultValue;
  }
  return value.toLowerCase() === 'true';
}

/**
 * Print current environment configuration (redacted)
 */
export function printEnvironmentInfo(): void {
  const nodeEnv = process.env.NODE_ENV || 'development';

  console.log('📋 Environment Configuration:');
  console.log(`  - NODE_ENV: ${nodeEnv}`);
  console.log(`  - PORT: ${process.env.PORT || '3000'}`);
  console.log(`  - DATABASE_URL: ${process.env.DATABASE_URL ? '[SET]' : '[NOT SET]'}`);
  console.log(`  - REDIS_URL: ${process.env.REDIS_URL ? '[SET]' : '[NOT SET]'}`);
  console.log(`  - AUTH0_DOMAIN: ${process.env.AUTH0_DOMAIN || '[NOT SET]'}`);
  console.log(`  - CORS_ORIGIN: ${process.env.CORS_ORIGIN || '[NOT SET]'}`);
  console.log(`  - BYPASS_AUTH: ${process.env.BYPASS_AUTH || 'false'}`);
  console.log(
    `  - MAPBOX_ACCESS_TOKEN: ${process.env.MAPBOX_ACCESS_TOKEN ? '[SET] (admin map)' : '[NOT SET]'}`
  );
  console.log(
    `  - GOOGLE_MAPS_API_KEY: ${process.env.GOOGLE_MAPS_API_KEY ? '[SET] (passenger app)' : '[NOT SET]'}`
  );
  console.log(`  - GOOGLE_MAPS_REGION: ${process.env.GOOGLE_MAPS_REGION || 'BD (default)'}`);
  console.log(
    `  - GOOGLE_MAPS_DEFAULT_COUNTRY: ${process.env.GOOGLE_MAPS_DEFAULT_COUNTRY || 'BD (default)'}`
  );
  console.log(
    `  - AUTH0_PASSENGER_CLIENT_ID: ${process.env.AUTH0_PASSENGER_CLIENT_ID ? '[SET] (forgot-password emails)' : '[NOT SET — uses AUTH0_CLIENT_ID]'}`
  );
  console.log(`  - LOG_LEVEL: ${process.env.LOG_LEVEL || 'info'}`);
  console.log(`  - FCM_ENABLED: ${process.env.FCM_ENABLED || 'false'}`);
  console.log(
    `  - FIREBASE_CREDENTIALS: ${
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON
        ? '[SET] (FIREBASE_SERVICE_ACCOUNT_JSON)'
        : process.env.GOOGLE_APPLICATION_CREDENTIALS
          ? '[SET] (GOOGLE_APPLICATION_CREDENTIALS)'
          : '[NOT SET]'
    }`
  );
  const stripeInfo = describeStripeConfig();
  console.log(`  - STRIPE_SECRET_KEY: [${stripeInfo.secretKey}]`);
  console.log(`  - STRIPE_WEBHOOK_SECRET: [${stripeInfo.webhookSecret}]`);
  console.log(`  - STRIPE_PUBLISHABLE_KEY: [${stripeInfo.publishableKey}]`);
  console.log(`  - STRIPE_MODE: ${stripeInfo.mode}`);
  console.log(`  - STRIPE_CONNECT_DEFAULT_COUNTRY: [${stripeInfo.connectDefaultCountry}]`);
  console.log(`  - STRIPE_CONNECT_RETURN_URL: [${stripeInfo.connectReturnUrl}]`);
  console.log(`  - STRIPE_CONNECT_REFRESH_URL: [${stripeInfo.connectRefreshUrl}]`);

  if (nodeEnv === 'production') {
    console.log(`  - SENTRY_DSN: ${process.env.SENTRY_DSN ? '[SET]' : '[NOT SET]'}`);
  }
}
