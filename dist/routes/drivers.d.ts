/**
 * Driver Routes
 *
 * GET /api/drivers - List all drivers (with pagination, filters, search)
 * GET /api/drivers/:id - Get single driver with current location
 * POST /api/drivers - Create new driver
 * PUT /api/drivers/:id - Update driver
 * DELETE /api/drivers/:id - Delete driver
 * PATCH /api/drivers/:id/cab-identifier - Update cab number or licence only
 * PATCH /api/drivers/:id/status - Update driver status
 * GET /api/drivers/qr/:qrCode - Lookup driver by QR code value
 * GET /api/drivers/:id/qrcode - Generate QR code image (PNG or base64)
 * POST /api/drivers/scan-vehicle - Assign vehicle via QR scan
 * POST /api/drivers/check-in - Company check-in
 * POST /api/drivers/check-out - Company check-out
 * GET /api/drivers/:driverId/assignment - Active vehicle assignment
 * GET /api/drivers/:driverId/attendance - Attendance status
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=drivers.d.ts.map