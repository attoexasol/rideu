import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

/**
 * Resolve migrations folder for local (src/) and container layouts.
 * Override with MIGRATIONS_FOLDER when needed.
 */
function resolveMigrationsFolder(): string {
  const configured = process.env.MIGRATIONS_FOLDER?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  const candidates = [
    path.resolve(process.cwd(), 'src/db/migrations'),
    path.resolve(__dirname, 'migrations'),
    path.resolve(process.cwd(), 'migrations'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

/**
 * Database migration runner.
 * Applies pending Drizzle migrations only. Does not seed or reset data.
 */
async function runMigrations() {
  const DATABASE_URL =
    process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/drivewize';
  const migrationsFolder = resolveMigrationsFolder();

  console.log('🔄 Starting database migrations...');
  console.log(`📍 Database: ${DATABASE_URL.replace(/:[^:@]+@/, ':****@')}`);
  console.log(`📁 Migrations folder: ${migrationsFolder}`);

  if (!fs.existsSync(migrationsFolder)) {
    console.error(`❌ Migrations folder not found: ${migrationsFolder}`);
    process.exit(1);
  }

  const migrationClient = postgres(DATABASE_URL, { max: 1, connect_timeout: 15 });
  const db = drizzle(migrationClient);

  try {
    console.log('🔌 Verifying database connectivity...');
    await migrationClient`SELECT 1 AS ok`;
    console.log('✓ Database reachable');

    await migrate(db, { migrationsFolder });
    console.log('✅ Migrations completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await migrationClient.end({ timeout: 5 });
  }
}

runMigrations();
