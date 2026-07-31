/**
 * Trip Routes
 *
 * POST /api/trips - Start new trip
 * PUT /api/trips/:id - Update/end trip
 * GET /api/trips/current - Get authenticated driver's active trip
 * GET /api/trips/:driverId - Get trip history for driver
 * POST /api/trips/:tripId/generate-qr - Generate passenger pickup QR (admin)
 * GET /api/trips/:tripId/qrcode - Passenger QR image PNG/base64 (admin)
 * POST /api/trips/scan-passenger - Driver verifies passenger pickup QR
 * GET /api/trips/:tripId/videos - List videos for a trip
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=trips.d.ts.map