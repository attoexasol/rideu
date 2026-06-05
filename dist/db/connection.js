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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryClient = exports.db = void 0;
exports.testConnection = testConnection;
exports.closeConnection = closeConnection;
exports.healthCheck = healthCheck;
const postgres_js_1 = require("drizzle-orm/postgres-js");
const postgres_1 = __importDefault(require("postgres"));
const schema = __importStar(require("./schema"));
/**
 * Database connection configuration with connection pooling
 * Uses postgres-js for efficient connection management
 */
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/drivewize';
// Configure PostgreSQL connection with pooling
const queryClient = (0, postgres_1.default)(DATABASE_URL, {
    max: 20, // Maximum number of connections in the pool
    idle_timeout: 20, // Close idle connections after 20 seconds
    connect_timeout: 10, // Connection timeout in seconds
    max_lifetime: 60 * 30, // Maximum lifetime of a connection (30 minutes)
});
exports.queryClient = queryClient;
// Create Drizzle ORM instance with schema
exports.db = (0, postgres_js_1.drizzle)(queryClient, { schema });
/**
 * Test database connection
 * @returns Promise that resolves if connection is successful
 */
async function testConnection() {
    try {
        await queryClient `SELECT 1`;
        console.log('✓ Database connection successful');
        return true;
    }
    catch (error) {
        console.error('✗ Database connection failed:', error);
        return false;
    }
}
/**
 * Close database connection
 * Should be called when shutting down the application
 */
async function closeConnection() {
    try {
        await queryClient.end();
        console.log('✓ Database connection closed');
    }
    catch (error) {
        console.error('✗ Error closing database connection:', error);
    }
}
/**
 * Health check for database
 * @returns Object with health status and latency
 */
async function healthCheck() {
    const start = Date.now();
    try {
        await queryClient `SELECT 1`;
        const latency = Date.now() - start;
        return { healthy: true, latency };
    }
    catch (error) {
        return {
            healthy: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}
//# sourceMappingURL=connection.js.map