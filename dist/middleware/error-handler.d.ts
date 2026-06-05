/**
 * Global Error Handling Middleware
 *
 * Catches all errors and formats them consistently
 */
import { Request, Response, NextFunction } from 'express';
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
export declare const errorHandler: (err: ExpressError, req: Request, res: Response, _next: NextFunction) => void;
/**
 * 404 handler for undefined routes
 */
export declare const notFoundHandler: (req: Request, res: Response) => void;
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
export declare const asyncHandler: (fn: any) => (req: Request, res: Response, next: NextFunction) => void;
export {};
//# sourceMappingURL=error-handler.d.ts.map