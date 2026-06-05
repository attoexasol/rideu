import { testConnection, healthCheck, closeConnection } from './connection';
import { testRedisConnection, redisHealthCheck, closeRedisConnections } from '../config/redis';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Test database and Redis connections
 */
async function testConnections() {
  console.log('🔧 Testing Database and Redis Connections...\n');

  // Test PostgreSQL
  console.log('📦 Testing PostgreSQL connection...');
  const dbConnected = await testConnection();

  if (dbConnected) {
    const dbHealth = await healthCheck();
    console.log(`   ✓ PostgreSQL is healthy (latency: ${dbHealth.latency}ms)\n`);
  } else {
    console.log('   ✗ PostgreSQL connection failed\n');
    process.exit(1);
  }

  // Test Redis
  console.log('📦 Testing Redis connection...');
  const redisConnected = await testRedisConnection();

  if (redisConnected) {
    const redisHealth = await redisHealthCheck();
    console.log(`   ✓ Redis is healthy (latency: ${redisHealth.latency}ms)\n`);
  } else {
    console.log('   ✗ Redis connection failed\n');
    process.exit(1);
  }

  console.log('✅ All connections successful!');

  // Cleanup
  await closeConnection();
  await closeRedisConnections();

  process.exit(0);
}

testConnections();
