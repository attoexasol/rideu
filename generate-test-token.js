/**
 * Generate test JWT tokens for backend validation testing
 *
 * Usage: node generate-test-token.js <user-type>
 * Example: node generate-test-token.js driver
 *          node generate-test-token.js admin
 */

const jwt = require('jsonwebtoken');

const JWT_SECRET = 'your-jwt-secret-key';

// Test user data from seed.ts
const testUsers = {
  driver1: {
    sub: 'auth0|test-driver-1',
    email: 'driver1@drivewize.com',
    name: 'John Smith',
    'https://drivewize.com/role': 'driver',
    role: 'driver',
  },
  driver2: {
    sub: 'auth0|test-driver-2',
    email: 'driver2@drivewize.com',
    name: 'Sarah Johnson',
    'https://drivewize.com/role': 'driver',
    role: 'driver',
  },
  admin1: {
    sub: 'auth0|test-admin-1',
    email: 'admin@drivewize.com',
    name: 'Admin User',
    'https://drivewize.com/role': 'admin',
    role: 'admin',
  },
  admin2: {
    sub: 'auth0|test-admin-2',
    email: 'superadmin@drivewize.com',
    name: 'Super Admin',
    'https://drivewize.com/role': 'super_admin',
    role: 'super_admin',
  },
};

function generateAuth0Token(userType) {
  const userData = testUsers[userType];

  if (!userData) {
    console.error(`Unknown user type: ${userType}`);
    console.log('Available types:', Object.keys(testUsers).join(', '));
    process.exit(1);
  }

  // Generate a mock Auth0 token (for login endpoint)
  const auth0Token = jwt.sign(userData, JWT_SECRET, { expiresIn: '24h' });

  return auth0Token;
}

// Get user type from command line
const userType = process.argv[2] || 'driver1';
const token = generateAuth0Token(userType);

console.log(`\n=== Test Token for ${userType} ===\n`);
console.log(token);
console.log('\n=== Usage ===');
console.log(`curl -X POST http://localhost:3000/api/auth/login \\`);
console.log(`  -H "Content-Type: application/json" \\`);
console.log(`  -d '{"auth0Token":"${token}"}'`);
console.log('\n');
