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

import { Response } from 'express';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  metadata?: {
    pagination?: PaginationMetadata;
  };
}

export interface PaginationMetadata {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Send a successful response
 */
export const sendSuccess = <T = any>(
  res: Response,
  data: T,
  statusCode: number = 200,
  metadata?: { pagination?: PaginationMetadata }
): Response => {
  const response: ApiResponse<T> = {
    success: true,
    data,
  };

  if (metadata) {
    response.metadata = metadata;
  }

  return res.status(statusCode).json(response);
};

/**
 * Send an error response
 */
export const sendError = (
  res: Response,
  code: string,
  message: string,
  statusCode: number = 500,
  details?: any
): Response => {
  const response: ApiResponse = {
    success: false,
    error: {
      code,
      message,
      details,
    },
  };

  return res.status(statusCode).json(response);
};

/**
 * Send a validation error response
 */
export const sendValidationError = (res: Response, errors: any): Response => {
  return sendError(res, 'VALIDATION_ERROR', 'Request validation failed', 400, errors);
};

/**
 * Send a not found error response
 */
export const sendNotFound = (res: Response, resource: string = 'Resource'): Response => {
  return sendError(res, 'NOT_FOUND', `${resource} not found`, 404);
};

/**
 * Send an unauthorized error response
 */
export const sendUnauthorized = (res: Response, message: string = 'Unauthorized'): Response => {
  return sendError(res, 'UNAUTHORIZED', message, 403);
};

/**
 * Send an authentication failed error response
 */
export const sendAuthFailed = (
  res: Response,
  message: string = 'Authentication failed'
): Response => {
  return sendError(res, 'AUTH_FAILED', message, 401);
};

/**
 * Calculate pagination metadata
 */
export const calculatePagination = (
  total: number,
  page: number,
  limit: number
): PaginationMetadata => {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
};
