"use strict";
/**
 * Environment Variable Validator
 * Validates required environment variables on startup
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateEnvironment = validateEnvironment;
exports.getEnvVar = getEnvVar;
exports.getEnvVarAsNumber = getEnvVarAsNumber;
exports.getEnvVarAsBoolean = getEnvVarAsBoolean;
exports.printEnvironmentInfo = printEnvironmentInfo;
const envConfigs = {
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
            'JWT_SECRET',
            'CORS_ORIGIN',
            'MAPBOX_ACCESS_TOKEN',
        ],
        optional: [
            'SENTRY_DSN',
            'RATE_LIMIT_WINDOW_MS',
            'RATE_LIMIT_MAX_REQUESTS',
            'LOG_LEVEL',
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
            'JWT_SECRET',
            'CORS_ORIGIN',
        ],
        optional: [
            'MAPBOX_ACCESS_TOKEN',
            'RATE_LIMIT_WINDOW_MS',
            'RATE_LIMIT_MAX_REQUESTS',
            'LOG_LEVEL',
        ],
    },
    development: {
        required: [
            'PORT',
            'DATABASE_URL',
        ],
        optional: [
            'NODE_ENV',
            'REDIS_URL',
            'REDIS_HOST',
            'REDIS_PORT',
            'AUTH0_DOMAIN',
            'AUTH0_API_IDENTIFIER',
            'AUTH0_CLIENT_ID',
            'AUTH0_CLIENT_SECRET',
            'JWT_SECRET',
            'CORS_ORIGIN',
            'BYPASS_AUTH',
            'MAPBOX_ACCESS_TOKEN',
            'RATE_LIMIT_WINDOW_MS',
            'RATE_LIMIT_MAX_REQUESTS',
            'LOG_LEVEL',
        ],
    },
    test: {
        required: [],
        optional: [
            'NODE_ENV',
            'PORT',
            'DATABASE_URL',
            'REDIS_URL',
            'BYPASS_AUTH',
        ],
    },
};
/**
 * Validates environment variables based on NODE_ENV
 * @throws Error if required variables are missing
 */
function validateEnvironment() {
    const nodeEnv = process.env.NODE_ENV?.trim() || 'development';
    const config = envConfigs[nodeEnv] || envConfigs.development;
    console.log(`\n🔍 Validating environment variables for ${nodeEnv} mode...`);
    const missing = [];
    const warnings = [];
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
    console.log('✅ Environment validation passed\n');
}
/**
 * Get validated environment variable or throw error
 * @param key - Environment variable key
 * @param defaultValue - Optional default value
 * @returns Environment variable value
 */
function getEnvVar(key, defaultValue) {
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
function getEnvVarAsNumber(key, defaultValue) {
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
function getEnvVarAsBoolean(key, defaultValue = false) {
    const value = process.env[key];
    if (!value) {
        return defaultValue;
    }
    return value.toLowerCase() === 'true';
}
/**
 * Print current environment configuration (redacted)
 */
function printEnvironmentInfo() {
    const nodeEnv = process.env.NODE_ENV || 'development';
    console.log('📋 Environment Configuration:');
    console.log(`  - NODE_ENV: ${nodeEnv}`);
    console.log(`  - PORT: ${process.env.PORT || '3000'}`);
    console.log(`  - DATABASE_URL: ${process.env.DATABASE_URL ? '[SET]' : '[NOT SET]'}`);
    console.log(`  - REDIS_URL: ${process.env.REDIS_URL ? '[SET]' : '[NOT SET]'}`);
    console.log(`  - AUTH0_DOMAIN: ${process.env.AUTH0_DOMAIN || '[NOT SET]'}`);
    console.log(`  - CORS_ORIGIN: ${process.env.CORS_ORIGIN || '[NOT SET]'}`);
    console.log(`  - BYPASS_AUTH: ${process.env.BYPASS_AUTH || 'false'}`);
    console.log(`  - LOG_LEVEL: ${process.env.LOG_LEVEL || 'info'}`);
    if (nodeEnv === 'production') {
        console.log(`  - SENTRY_DSN: ${process.env.SENTRY_DSN ? '[SET]' : '[NOT SET]'}`);
    }
}
//# sourceMappingURL=env-validator.js.map