import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Database connection configuration with connection pooling
 * Uses postgres-js for efficient connection management
 */

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/drivewize';

// Configure PostgreSQL connection with pooling
const queryClient = postgres(DATABASE_URL, {
  max: 20, // Maximum number of connections in the pool
  idle_timeout: 20, // Close idle connections after 20 seconds
  connect_timeout: 10, // Connection timeout in seconds
  max_lifetime: 60 * 30, // Maximum lifetime of a connection (30 minutes)
});

// Create Drizzle ORM instance with schema
export const db = drizzle(queryClient, { schema });

/**
 * Test database connection
 * @returns Promise that resolves if connection is successful
 */
export async function testConnection(): Promise<boolean> {
  try {
    await queryClient`SELECT 1`;
    console.log('✓ Database connection successful');
    return true;
  } catch (error) {
    console.error('✗ Database connection failed:', error);
    return false;
  }
}

/**
 * Close database connection
 * Should be called when shutting down the application
 */
export async function closeConnection(): Promise<void> {
  try {
    await queryClient.end();
    console.log('✓ Database connection closed');
  } catch (error) {
    console.error('✗ Error closing database connection:', error);
  }
}

/**
 * Health check for database
 * @returns Object with health status and latency
 */
export async function healthCheck(): Promise<{ healthy: boolean; latency?: number; error?: string }> {
  const start = Date.now();
  try {
    await queryClient`SELECT 1`;
    const latency = Date.now() - start;
    return { healthy: true, latency };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Export the query client for direct SQL queries if needed
export { queryClient };
