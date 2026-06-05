"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const connection_1 = require("./connection");
const redis_1 = require("../config/redis");
const dotenv = __importStar(require("dotenv"));
// Load environment variables
dotenv.config();
/**
 * Test database and Redis connections
 */
async function testConnections() {
    console.log('🔧 Testing Database and Redis Connections...\n');
    // Test PostgreSQL
    console.log('📦 Testing PostgreSQL connection...');
    const dbConnected = await (0, connection_1.testConnection)();
    if (dbConnected) {
        const dbHealth = await (0, connection_1.healthCheck)();
        console.log(`   ✓ PostgreSQL is healthy (latency: ${dbHealth.latency}ms)\n`);
    }
    else {
        console.log('   ✗ PostgreSQL connection failed\n');
        process.exit(1);
    }
    // Test Redis
    console.log('📦 Testing Redis connection...');
    const redisConnected = await (0, redis_1.testRedisConnection)();
    if (redisConnected) {
        const redisHealth = await (0, redis_1.redisHealthCheck)();
        console.log(`   ✓ Redis is healthy (latency: ${redisHealth.latency}ms)\n`);
    }
    else {
        console.log('   ✗ Redis connection failed\n');
        process.exit(1);
    }
    console.log('✅ All connections successful!');
    // Cleanup
    await (0, connection_1.closeConnection)();
    await (0, redis_1.closeRedisConnections)();
    process.exit(0);
}
testConnections();
//# sourceMappingURL=test-connection.js.map