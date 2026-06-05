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
export declare const sendSuccess: <T = any>(res: Response, data: T, statusCode?: number, metadata?: {
    pagination?: PaginationMetadata;
}) => Response;
/**
 * Send an error response
 */
export declare const sendError: (res: Response, code: string, message: string, statusCode?: number, details?: any) => Response;
/**
 * Send a validation error response
 */
export declare const sendValidationError: (res: Response, errors: any) => Response;
/**
 * Send a not found error response
 */
export declare const sendNotFound: (res: Response, resource?: string) => Response;
/**
 * Send an unauthorized error response
 */
export declare const sendUnauthorized: (res: Response, message?: string) => Response;
/**
 * Send an authentication failed error response
 */
export declare const sendAuthFailed: (res: Response, message?: string) => Response;
/**
 * Calculate pagination metadata
 */
export declare const calculatePagination: (total: number, page: number, limit: number) => PaginationMetadata;
//# sourceMappingURL=response.d.ts.map