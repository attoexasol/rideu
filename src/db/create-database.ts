import postgres from 'postgres';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Create the database if it doesn't exist
 */
async function createDatabase() {
  console.log('🔧 Creating database...\n');

  // Connect to the default postgres database
  const sql = postgres({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: 'postgres', // Connect to default database
    username: process.env.DB_USER || 'user',
    password: process.env.DB_PASSWORD || 'password',
    max: 1,
  });

  try {
    // Check if database exists
    const result = await sql`
      SELECT 1 FROM pg_database WHERE datname = 'drivewize'
    `;

    if (result.length === 0) {
      // Create database
      console.log('📦 Creating drivewize database...');
      await sql.unsafe('CREATE DATABASE drivewize');
      console.log('✅ Database created successfully!');
    } else {
      console.log('ℹ️  Database already exists');
    }
  } catch (error) {
    console.error('❌ Failed to create database:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }

  process.exit(0);
}

createDatabase();
