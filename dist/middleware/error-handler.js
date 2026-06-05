"use strict";
/**
 * Global Error Handling Middleware
 *
 * Catches all errors and formats them consistently
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.asyncHandler = exports.notFoundHandler = exports.errorHandler = void 0;
const zod_1 = require("zod");
const response_1 = require("../utils/response");
/**
 * Global error handler
 * Must be the last middleware in the chain
 */
const errorHandler = (err, req, res, _next) => {
    // Log error for debugging
    console.error('Error occurred:', {
        message: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
    });
    // Zod validation errors
    if (err instanceof zod_1.ZodError) {
        (0, response_1.sendValidationError)(res, err.errors);
        return;
    }
    // JWT authentication errors (from express-jwt)
    if (err.name === 'UnauthorizedError') {
        (0, response_1.sendError)(res, 'AUTH_FAILED', 'Invalid or expired token', 401, err.message);
        return;
    }
    // Rate limit errors
    if (err.message && err.message.includes('Too many requests')) {
        (0, response_1.sendError)(res, 'RATE_LIMIT_EXCEEDED', 'Too many requests, please try again later', 429);
        return;
    }
    // Database errors
    if (err.message && (err.message.includes('duplicate key') || err.message.includes('unique constraint'))) {
        (0, response_1.sendError)(res, 'DUPLICATE_ERROR', 'Resource already exists', 409, err.message);
        return;
    }
    // Custom status code
    const statusCode = err.status || err.statusCode || 500;
    const errorCode = err.code || 'SERVER_ERROR';
    const message = err.message || 'Internal server error';
    // Don't expose internal errors in production
    const details = process.env.NODE_ENV === 'production'
        ? undefined
        : { stack: err.stack, ...err.details };
    (0, response_1.sendError)(res, errorCode, message, statusCode, details);
};
exports.errorHandler = errorHandler;
/**
 * 404 handler for undefined routes
 */
const notFoundHandler = (req, res) => {
    (0, response_1.sendError)(res, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`, 404);
};
exports.notFoundHandler = notFoundHandler;
/**
 * Async route handler wrapper
 * Catches errors from async functions and passes them to error handler
 *
 * Usage:
 * router.get('/users', asyncHandler(async (req, res) => {
 *   const users = await getUsersFromDB();
 *   res.json(users);
 * }));
 */
const asyncHandler = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};
exports.asyncHandler = asyncHandler;
//# sourceMappingURL=error-handler.js.map