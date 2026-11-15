import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
// Rate Limiting — centralized config with dedicated per-route limiters
import { globalRateLimiter } from './middleware/rate-limiters';
import { rateLimitRequestCounter } from './middleware/rate-limit-debug';
import { attachRateLimitIdentity } from './middleware/rate-limit-identity';
import { setupWebSocketServer } from './websocket/server';
import { setupBookingEventSubscriber } from './services/bookingNotify.service';
import { processExpiredOffers } from './services/dispatch.service';
import { startVehicleExchangeExpirationPoller } from './services/vehicleExchangeExpiration.service';
import { requestLogger } from './middleware/logger';
import { passengerLocationTiming } from './middleware/passenger-location-timing';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { validateEnvironment, printEnvironmentInfo } from './config/env-validator';
import { logFcmStartupState } from './services/fcmAdmin.service';
import { verifyCriticalServices, createHealthCheckHandler, createApiHealthCheckHandler } from './utils/startup-checks';
import { startInactivityChecker } from './services/driver-inactivity-checker';
import { startRideVideoBackgroundJobs, stopRideVideoBackgroundJobs } from './services/rideVideoBackground.service';
import { closeRedisConnections } from './config/redis';
import { closeConnection } from './db/connection';

// Import all route handlers
import authRoutes from './routes/auth';
import driverRoutes from './routes/drivers';
import locationRoutes from './routes/locations';
import tripRoutes from './routes/trips';
import reportRoutes from './routes/reports';
import adminRoutes from './routes/admin';
import vehicleRoutes from './routes/vehicles';
import companyRoutes from './routes/company';
import videoRoutes from './routes/videos';
import v1Routes from './routes/v1';
import stripeWebhookRoutes from './routes/v1/webhooks/stripe';
import path from 'path';
import { ensureUploadDirectories } from './services/video-storage.service';
import { ensureAvatarDirectories } from './services/avatar-storage.service';
import { ensureDriverDocumentDirectories } from './services/driver-document-storage.service';

// Validate environment variables on startup
try {
  validateEnvironment();
  printEnvironmentInfo();
  logFcmStartupState();
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
let offerExpirationInterval: NodeJS.Timeout;
let vehicleExchangeExpirationInterval: NodeJS.Timeout;
try {
  inactivityCheckerInterval = startInactivityChecker();
  offerExpirationInterval = setInterval(() => {
    processExpiredOffers().catch((err) =>
      console.error('[OfferExpiration] Failed to process expired offers:', err)
    );
  }, 15_000);
  vehicleExchangeExpirationInterval = startVehicleExchangeExpirationPoller();
  startRideVideoBackgroundJobs();
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
app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(',') || [
      'http://localhost:5173',
      'http://localhost:8081',
    ],
    credentials: true,
  })
);

// Best-effort JWT identity for rate-limit keys (does not enforce auth).
app.use(attachRateLimitIdentity);
app.use(rateLimitRequestCounter);
app.use(globalRateLimiter);

// Stripe webhook must receive the raw body for signature verification.
// Mount before express.json() so JSON parsing does not consume the payload.
app.use('/api/v1/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookRoutes);

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Local video file serving (v1 storage)
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));
ensureUploadDirectories().catch((err) => {
  console.error('Failed to create upload directories:', err);
});
ensureAvatarDirectories().catch((err) => {
  console.error('Failed to create avatar directories:', err);
});
ensureDriverDocumentDirectories().catch((err) => {
  console.error('Failed to create driver document directories:', err);
});

// Request logging middleware
app.use(requestLogger);
app.use(passengerLocationTiming);

// Health check endpoints
app.get('/health', createHealthCheckHandler());
app.get('/api/health', createApiHealthCheckHandler());

// Soft Meter Checkout browser return pages.
// These do not mark a ride paid. Stripe webhooks confirm payment.
function meterCheckoutReturnPage(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${title}</title></head><body style="font-family:system-ui,sans-serif;padding:2rem;max-width:32rem"><h1>${title}</h1><p>${body}</p><p>Return to the DriveWize app. Status updates after the Stripe webhook is verified.</p></body></html>`;
}
app.get('/meter/payment/return', (_req, res) => {
  res
    .status(200)
    .type('html')
    .send(
      meterCheckoutReturnPage(
        'Payment submitted',
        'Your Soft Meter Checkout was submitted. This page does not confirm Paid.'
      )
    );
});
app.get('/meter/payment/cancel', (_req, res) => {
  res
    .status(200)
    .type('html')
    .send(
      meterCheckoutReturnPage(
        'Payment cancelled',
        'Checkout was cancelled. The ride stays unpaid until a verified webhook marks it Paid.'
      )
    );
});

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
      meterPaymentReturn: '/meter/payment/return',
      meterPaymentCancel: '/meter/payment/cancel',
    },
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/company', companyRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/v1', v1Routes);

// Setup WebSocket server with Redis adapter
export const io = setupWebSocketServer(httpServer);
setupBookingEventSubscriber(io);

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
  if (offerExpirationInterval) {
    clearInterval(offerExpirationInterval);
    console.log('Offer expiration checker stopped');
  }
  if (vehicleExchangeExpirationInterval) {
    clearInterval(vehicleExchangeExpirationInterval);
    console.log('Vehicle exchange expiration checker stopped');
  }
  stopRideVideoBackgroundJobs();
  httpServer.close(async () => {
    console.log('HTTP server closed');
    await Promise.allSettled([closeRedisConnections(), closeConnection()]);
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

httpServer.on('error', (err: NodeJS.ErrnoException) => {
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
