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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
dotenv.config();
/**
 * Resolve migrations folder for local (src/) and container layouts.
 * Override with MIGRATIONS_FOLDER when needed.
 */
function resolveMigrationsFolder() {
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
    const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/drivewize';
    const migrationsFolder = resolveMigrationsFolder();
    console.log('🔄 Starting database migrations...');
    console.log(`📍 Database: ${DATABASE_URL.replace(/:[^:@]+@/, ':****@')}`);
    console.log(`📁 Migrations folder: ${migrationsFolder}`);
    if (!fs.existsSync(migrationsFolder)) {
        console.error(`❌ Migrations folder not found: ${migrationsFolder}`);
        process.exit(1);
    }
    const migrationClient = (0, postgres_1.default)(DATABASE_URL, { max: 1, connect_timeout: 15 });
    const db = (0, postgres_js_1.drizzle)(migrationClient);
    try {
        console.log('🔌 Verifying database connectivity...');
        await migrationClient `SELECT 1 AS ok`;
        console.log('✓ Database reachable');
        await (0, migrator_1.migrate)(db, { migrationsFolder });
        console.log('✅ Migrations completed successfully!');
        process.exit(0);
    }
    catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
    finally {
        await migrationClient.end({ timeout: 5 });
    }
}
runMigrations();
//# sourceMappingURL=migrate.js.map