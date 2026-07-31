import 'dotenv/config';
import postgres from 'postgres';
import * as schema from './schema';
declare const queryClient: postgres.Sql<{}>;
export declare const db: import("drizzle-orm/postgres-js").PostgresJsDatabase<typeof schema> & {
    $client: postgres.Sql<{}>;
};
/**
 * Test database connection
 * @returns Promise that resolves if connection is successful
 */
export declare function testConnection(): Promise<boolean>;
/**
 * Close database connection
 * Should be called when shutting down the application
 */
export declare function closeConnection(): Promise<void>;
/**
 * Health check for database
 * @returns Object with health status and latency
 */
export declare function healthCheck(): Promise<{
    healthy: boolean;
    latency?: number;
    error?: string;
}>;
export { queryClient };
//# sourceMappingURL=connection.d.ts.map