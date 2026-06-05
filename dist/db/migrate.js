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
const postgres_js_1 = require("drizzle-orm/postgres-js");
const migrator_1 = require("drizzle-orm/postgres-js/migrator");
const postgres_1 = __importDefault(require("postgres"));
const dotenv = __importStar(require("dotenv"));
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
    const migrationClient = (0, postgres_1.default)(DATABASE_URL, { max: 1 });
    const db = (0, postgres_js_1.drizzle)(migrationClient);
    try {
        await (0, migrator_1.migrate)(db, { migrationsFolder: './src/db/migrations' });
        console.log('✅ Migrations completed successfully!');
        process.exit(0);
    }
    catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
    finally {
        await migrationClient.end();
    }
}
runMigrations();
//# sourceMappingURL=migrate.js.map