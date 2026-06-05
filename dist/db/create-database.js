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
const postgres_1 = __importDefault(require("postgres"));
const dotenv = __importStar(require("dotenv"));
// Load environment variables
dotenv.config();
/**
 * Create the database if it doesn't exist
 */
async function createDatabase() {
    console.log('🔧 Creating database...\n');
    // Connect to the default postgres database
    const sql = (0, postgres_1.default)({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: 'postgres', // Connect to default database
        username: process.env.DB_USER || 'user',
        password: process.env.DB_PASSWORD || 'password',
        max: 1,
    });
    try {
        // Check if database exists
        const result = await sql `
      SELECT 1 FROM pg_database WHERE datname = 'drivewize'
    `;
        if (result.length === 0) {
            // Create database
            console.log('📦 Creating drivewize database...');
            await sql.unsafe('CREATE DATABASE drivewize');
            console.log('✅ Database created successfully!');
        }
        else {
            console.log('ℹ️  Database already exists');
        }
    }
    catch (error) {
        console.error('❌ Failed to create database:', error);
        process.exit(1);
    }
    finally {
        await sql.end();
    }
    process.exit(0);
}
createDatabase();
//# sourceMappingURL=create-database.js.map