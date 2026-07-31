/**
 * Global Error Handling Middleware
 *
 * Catches all errors and formats them consistently
 */

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { sendError, sendValidationError } from '../utils/response';

/**
 * Express error interface
 */
interface ExpressError extends Error {
  status?: number;
  statusCode?: number;
  code?: string;
  details?: any;
}

/**
 * Global error handler
 * Must be the last middleware in the chain
 */
export const errorHandler = (
  err: ExpressError,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  // Log error for debugging
  console.error('Error occurred:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  // Zod validation errors
  if (err instanceof ZodError) {
    sendValidationError(res, err.errors);
    return;
  }

  // JWT authentication errors (from express-jwt)
  if (err.name === 'UnauthorizedError') {
    sendError(res, 'AUTH_FAILED', 'Invalid or expired token', 401, err.message);
    return;
  }

  // Rate limit errors
  if (err.message && err.message.includes('Too many requests')) {
    sendError(res, 'RATE_LIMIT_EXCEEDED', 'Too many requests, please try again later', 429);
    return;
  }

  // Database errors
  if (
    err.message &&
    (err.message.includes('duplicate key') || err.message.includes('unique constraint'))
  ) {
    sendError(res, 'DUPLICATE_ERROR', 'Resource already exists', 409, err.message);
    return;
  }

  // Custom status code
  const statusCode = err.status || err.statusCode || 500;
  const errorCode = err.code || 'SERVER_ERROR';
  const message = err.message || 'Internal server error';

  // Don't expose internal errors in production
  const details =
    process.env.NODE_ENV === 'production' ? undefined : { stack: err.stack, ...err.details };

  sendError(res, errorCode, message, statusCode, details);
};

/**
 * 404 handler for undefined routes
 */
export const notFoundHandler = (req: Request, res: Response): void => {
  sendError(res, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`, 404);
};

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
export const asyncHandler = (fn: any) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
