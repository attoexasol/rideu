"use strict";
/**
 * Standardized API Response Utilities
 *
 * All API responses follow this format:
 * {
 *   success: boolean,
 *   data?: any,
 *   error?: { code: string, message: string, details?: any },
 *   metadata?: { pagination?: {...} }
 * }
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculatePagination = exports.sendAuthFailed = exports.sendUnauthorized = exports.sendNotFound = exports.sendValidationError = exports.sendError = exports.sendSuccess = void 0;
/**
 * Send a successful response
 */
const sendSuccess = (res, data, statusCode = 200, metadata) => {
    const response = {
        success: true,
        data,
    };
    if (metadata) {
        response.metadata = metadata;
    }
    return res.status(statusCode).json(response);
};
exports.sendSuccess = sendSuccess;
/**
 * Send an error response
 */
const sendError = (res, code, message, statusCode = 500, details) => {
    const response = {
        success: false,
        error: {
            code,
            message,
            details,
        },
    };
    return res.status(statusCode).json(response);
};
exports.sendError = sendError;
/**
 * Send a validation error response
 */
const sendValidationError = (res, errors) => {
    return (0, exports.sendError)(res, 'VALIDATION_ERROR', 'Request validation failed', 400, errors);
};
exports.sendValidationError = sendValidationError;
/**
 * Send a not found error response
 */
const sendNotFound = (res, resource = 'Resource') => {
    return (0, exports.sendError)(res, 'NOT_FOUND', `${resource} not found`, 404);
};
exports.sendNotFound = sendNotFound;
/**
 * Send an unauthorized error response
 */
const sendUnauthorized = (res, message = 'Unauthorized') => {
    return (0, exports.sendError)(res, 'UNAUTHORIZED', message, 403);
};
exports.sendUnauthorized = sendUnauthorized;
/**
 * Send an authentication failed error response
 */
const sendAuthFailed = (res, message = 'Authentication failed') => {
    return (0, exports.sendError)(res, 'AUTH_FAILED', message, 401);
};
exports.sendAuthFailed = sendAuthFailed;
/**
 * Calculate pagination metadata
 */
const calculatePagination = (total, page, limit) => {
    return {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
    };
};
exports.calculatePagination = calculatePagination;
//# sourceMappingURL=response.js.map