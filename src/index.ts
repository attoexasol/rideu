import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { setupWebSocketServer } from './websocket/server';
import { requestLogger } from './middleware/logger';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { validateEnvironment, printEnvironmentInfo } from './config/env-validator';
import { verifyCriticalServices, createHealthCheckHandler } from './utils/startup-checks';
import { startInactivityChecker } from './services/driver-inactivity-checker';
import { closeRedisConnections } from './config/redis';
import { closeConnection } from './db/connection';

// Import all route handlers
import authRoutes from './routes/auth';
import driverRoutes from './routes/drivers';
import locationRoutes from './routes/locations';
import tripRoutes from './routes/trips';
import reportRoutes from './routes/reports';
import adminRoutes from './routes/admin';

// Validate environment variables on startup
try {
  validateEnvironment();
  printEnvironmentInfo();
} catch (error) {
  console.error('❌ Environment validation failed:', error);
  process.exit(1);
}

// Run startup health checks
(async () => {
  try {
    await verifyCriticalServices();
  } catch (error) {
    console.error('❌ Startup health checks failed:', error);
    process.exit(1);
  }
})();

// Start background jobs
let inactivityCheckerInterval: NodeJS.Timeout;
try {
  inactivityCheckerInterval = startInactivityChecker();
} catch (error) {
  console.error('⚠️  Failed to start inactivity checker:', error);
  // Non-fatal - server can continue without this background job
}

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3000;

// Trust proxy - Railway and cloud platforms use a single reverse proxy
// Setting to 1 trusts the first proxy only (secure for Railway/similar platforms)
app.set('trust proxy', 1);

// Security & CORS Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5173', 'http://localhost:8081'],
  credentials: true,
}));

// Rate Limiting (always enabled but with different limits)
const isDevelopment = process.env.NODE_ENV === 'development';
const limiter = rateLimit({
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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use(requestLogger);

// Health check endpoint with comprehensive service checks
app.get('/health', createHealthCheckHandler());

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
app.use('/api/auth', authRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/admin', adminRoutes);

// Setup WebSocket server with Redis adapter
export const io = setupWebSocketServer(httpServer);

// 404 handler - must be after all routes
app.use(notFoundHandler);

// Global error handler - must be last
app.use(errorHandler);

// Graceful shutdown
async function gracefulShutdown(signal: string) {
  console.log(`${signal} signal received: closing HTTP server`);
  if (inactivityCheckerInterval) {
    clearInterval(inactivityCheckerInterval);
    console.log('Inactivity checker stopped');
  }
  httpServer.close(async () => {
    console.log('HTTP server closed');
    await Promise.allSettled([
      closeRedisConnections(),
      closeConnection(),
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
