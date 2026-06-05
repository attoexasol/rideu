import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Database migration runner
 * Applies all pending migrations to the database
 */
async function runMigrations() {
  const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/drivewize';

  console.log('🔄 Starting database migrations...');
  console.log(`📍 Database: ${DATABASE_URL.replace(/:[^:@]+@/, ':****@')}`);

  // Create connection for migrations
  const migrationClient = postgres(DATABASE_URL, { max: 1 });
  const db = drizzle(migrationClient);

  try {
    await migrate(db, { migrationsFolder: './src/db/migrations' });
    console.log('✅ Migrations completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await migrationClient.end();
  }
}

runMigrations();
