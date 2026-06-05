"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.io = void 0;
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const dotenv_1 = __importDefault(require("dotenv"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const server_1 = require("./websocket/server");
const logger_1 = require("./middleware/logger");
const error_handler_1 = require("./middleware/error-handler");
const env_validator_1 = require("./config/env-validator");
const startup_checks_1 = require("./utils/startup-checks");
const driver_inactivity_checker_1 = require("./services/driver-inactivity-checker");
const redis_1 = require("./config/redis");
const connection_1 = require("./db/connection");
// Import all route handlers
const auth_1 = __importDefault(require("./routes/auth"));
const drivers_1 = __importDefault(require("./routes/drivers"));
const locations_1 = __importDefault(require("./routes/locations"));
const trips_1 = __importDefault(require("./routes/trips"));
const reports_1 = __importDefault(require("./routes/reports"));
const admin_1 = __importDefault(require("./routes/admin"));
// Load environment variables
dotenv_1.default.config();
// Validate environment variables on startup
try {
    (0, env_validator_1.validateEnvironment)();
    (0, env_validator_1.printEnvironmentInfo)();
}
catch (error) {
    console.error('❌ Environment validation failed:', error);
    process.exit(1);
}
// Run startup health checks
(async () => {
    try {
        await (0, startup_checks_1.verifyCriticalServices)();
    }
    catch (error) {
        console.error('❌ Startup health checks failed:', error);
        process.exit(1);
    }
})();
// Start background jobs
let inactivityCheckerInterval;
try {
    inactivityCheckerInterval = (0, driver_inactivity_checker_1.startInactivityChecker)();
}
catch (error) {
    console.error('⚠️  Failed to start inactivity checker:', error);
    // Non-fatal - server can continue without this background job
}
const app = (0, express_1.default)();
const httpServer = (0, http_1.createServer)(app);
const PORT = process.env.PORT || 3000;
// Trust proxy - Railway and cloud platforms use a single reverse proxy
// Setting to 1 trusts the first proxy only (secure for Railway/similar platforms)
app.set('trust proxy', 1);
// Security & CORS Middleware
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({
    origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5173', 'http://localhost:8081'],
    credentials: true,
}));
// Rate Limiting (always enabled but with different limits)
const isDevelopment = process.env.NODE_ENV === 'development';
const limiter = (0, express_rate_limit_1.default)({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || (isDevelopment ? '10000' : '100')), // Higher limit in dev
    message: {
        success: false,
        error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests, please try again later',
        },
    },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(limiter);
// Body parsing middleware
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
// Request logging middleware
app.use(logger_1.requestLogger);
// Health check endpoint with comprehensive service checks
app.get('/health', (0, startup_checks_1.createHealthCheckHandler)());
// Basic route
app.get('/', (_req, res) => {
    res.json({
        message: 'DriveWize Backend API',
        version: '1.0.0',
        websocket: 'Socket.IO enabled',
        endpoints: {
            health: '/health',
            api: '/api',
        },
    });
});
// API Routes
app.use('/api/auth', auth_1.default);
app.use('/api/drivers', drivers_1.default);
app.use('/api/locations', locations_1.default);
app.use('/api/trips', trips_1.default);
app.use('/api/reports', reports_1.default);
app.use('/api/admin', admin_1.default);
// Setup WebSocket server with Redis adapter
exports.io = (0, server_1.setupWebSocketServer)(httpServer);
// 404 handler - must be after all routes
app.use(error_handler_1.notFoundHandler);
// Global error handler - must be last
app.use(error_handler_1.errorHandler);
// Graceful shutdown
async function gracefulShutdown(signal) {
    console.log(`${signal} signal received: closing HTTP server`);
    if (inactivityCheckerInterval) {
        clearInterval(inactivityCheckerInterval);
        console.log('Inactivity checker stopped');
    }
    httpServer.close(async () => {
        console.log('HTTP server closed');
        await Promise.allSettled([
            (0, redis_1.closeRedisConnections)(),
            (0, connection_1.closeConnection)(),
        ]);
        process.exit(0);
    });
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
// Safety net: log unhandled rejections without crashing
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
});
// Start server - Listen on all network interfaces (0.0.0.0) for mobile device access
const HOST = '0.0.0.0';
httpServer.listen(Number(PORT), HOST, () => {
    console.log('═══════════════════════════════════════════════════════');
    console.log('  DriveWize Backend Server');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  🚀 Server running on port ${PORT}`);
    console.log(`  🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`  📡 WebSocket: Enabled with Redis adapter`);
    console.log(`  🔗 Local: http://localhost:${PORT}`);
    console.log(`  🔗 Network: http://[network_ip]:${PORT}`);
    console.log('═══════════════════════════════════════════════════════');
});
//# sourceMappingURL=index.js.map