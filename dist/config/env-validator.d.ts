/**
 * Environment Variable Validator
 * Validates required environment variables on startup
 */
/**
 * Validates environment variables based on NODE_ENV
 * @throws Error if required variables are missing
 */
export declare function validateEnvironment(): void;
/**
 * Get validated environment variable or throw error
 * @param key - Environment variable key
 * @param defaultValue - Optional default value
 * @returns Environment variable value
 */
export declare function getEnvVar(key: string, defaultValue?: string): string;
/**
 * Get validated numeric environment variable
 * @param key - Environment variable key
 * @param defaultValue - Optional default value
 * @returns Numeric environment variable value
 */
export declare function getEnvVarAsNumber(key: string, defaultValue?: number): number;
/**
 * Get validated boolean environment variable
 * @param key - Environment variable key
 * @param defaultValue - Optional default value
 * @returns Boolean environment variable value
 */
export declare function getEnvVarAsBoolean(key: string, defaultValue?: boolean): boolean;
/**
 * Print current environment configuration (redacted)
 */
export declare function printEnvironmentInfo(): void;
//# sourceMappingURL=env-validator.d.ts.map