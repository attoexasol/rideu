"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.io = void 0;
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
// Rate Limiting — centralized config with dedicated per-route limiters
const rate_limiters_1 = require("./middleware/rate-limiters");
const server_1 = require("./websocket/server");
const bookingNotify_service_1 = require("./services/bookingNotify.service");
const dispatch_service_1 = require("./services/dispatch.service");
const vehicleExchangeExpiration_service_1 = require("./services/vehicleExchangeExpiration.service");
const logger_1 = require("./middleware/logger");
const passenger_location_timing_1 = require("./middleware/passenger-location-timing");
const error_handler_1 = require("./middleware/error-handler");
const env_validator_1 = require("./config/env-validator");
const startup_checks_1 = require("./utils/startup-checks");
const driver_inactivity_checker_1 = require("./services/driver-inactivity-checker");
const rideVideoBackground_service_1 = require("./services/rideVideoBackground.service");
const redis_1 = require("./config/redis");
const connection_1 = require("./db/connection");
// Import all route handlers
const auth_1 = __importDefault(require("./routes/auth"));
const drivers_1 = __importDefault(require("./routes/drivers"));
const locations_1 = __importDefault(require("./routes/locations"));
const trips_1 = __importDefault(require("./routes/trips"));
const reports_1 = __importDefault(require("./routes/reports"));
const admin_1 = __importDefault(require("./routes/admin"));
const vehicles_1 = __importDefault(require("./routes/vehicles"));
const company_1 = __importDefault(require("./routes/company"));
const videos_1 = __importDefault(require("./routes/videos"));
const v1_1 = __importDefault(require("./routes/v1"));
const path_1 = __importDefault(require("path"));
const video_storage_service_1 = require("./services/video-storage.service");
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
let offerExpirationInterval;
let vehicleExchangeExpirationInterval;
try {
    inactivityCheckerInterval = (0, driver_inactivity_checker_1.startInactivityChecker)();
    offerExpirationInterval = setInterval(() => {
        (0, dispatch_service_1.processExpiredOffers)().catch((err) => console.error('[OfferExpiration] Failed to process expired offers:', err));
    }, 15_000);
    vehicleExchangeExpirationInterval = (0, vehicleExchangeExpiration_service_1.startVehicleExchangeExpirationPoller)();
    (0, rideVideoBackground_service_1.startRideVideoBackgroundJobs)();
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
    origin: process.env.CORS_ORIGIN?.split(',') || [
        'http://localhost:5173',
        'http://localhost:8081',
    ],
    credentials: true,
}));
app.use(rate_limiters_1.globalRateLimiter);
// Body parsing middleware
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
// Local video file serving (v1 storage)
app.use('/uploads', express_1.default.static(path_1.default.resolve(process.cwd(), 'uploads')));
(0, video_storage_service_1.ensureUploadDirectories)().catch((err) => {
    console.error('Failed to create upload directories:', err);
});
// Request logging middleware
app.use(logger_1.requestLogger);
app.use(passenger_location_timing_1.passengerLocationTiming);
// Health check endpoints
app.get('/health', (0, startup_checks_1.createHealthCheckHandler)());
app.get('/api/health', (0, startup_checks_1.createApiHealthCheckHandler)());
// Basic route
app.get('/', (_req, res) => {
    res.json({
        message: 'DriveWize Backend API',
        version: '1.0.0',
        websocket: 'Socket.IO enabled',
        endpoints: {
            health: '/health',
            apiHealth: '/api/health',
            api: '/api',
        },
    });
});
// API Routes
app.use('/api/auth', auth_1.default);
app.use('/api/drivers', drivers_1.default);
app.use('/api/vehicles', vehicles_1.default);
app.use('/api/company', company_1.default);
app.use('/api/locations', locations_1.default);
app.use('/api/trips', trips_1.default);
app.use('/api/reports', reports_1.default);
app.use('/api/admin', admin_1.default);
app.use('/api/videos', videos_1.default);
app.use('/api/v1', v1_1.default);
// Setup WebSocket server with Redis adapter
exports.io = (0, server_1.setupWebSocketServer)(httpServer);
(0, bookingNotify_service_1.setupBookingEventSubscriber)(exports.io);
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
    if (offerExpirationInterval) {
        clearInterval(offerExpirationInterval);
        console.log('Offer expiration checker stopped');
    }
    if (vehicleExchangeExpirationInterval) {
        clearInterval(vehicleExchangeExpirationInterval);
        console.log('Vehicle exchange expiration checker stopped');
    }
    (0, rideVideoBackground_service_1.stopRideVideoBackgroundJobs)();
    httpServer.close(async () => {
        console.log('HTTP server closed');
        await Promise.allSettled([(0, redis_1.closeRedisConnections)(), (0, connection_1.closeConnection)()]);
        process.exit(0);
    });
    // Force exit if close hangs (e.g. open WebSocket connections during tsx reload)
    setTimeout(() => {
        console.warn('Forced shutdown after timeout');
        process.exit(0);
    }, 3000).unref();
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
// Safety net: log unhandled rejections without crashing
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
});
// Start server - Listen on all network interfaces (0.0.0.0) for mobile device access
const HOST = '0.0.0.0';
httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error('');
        console.error(`❌ Port ${PORT} is already in use.`);
        console.error('   Another server instance is still running (common after tsx watch reload).');
        console.error('');
        console.error('   Fix: run   npm run stop:dev');
        console.error('   Then:     npm run dev');
        console.error('');
        process.exit(1);
    }
    console.error('HTTP server error:', err);
    process.exit(1);
});
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