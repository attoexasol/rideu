/**
 * Request Logging Middleware
 *
 * Logs all incoming requests with pino logger
 */
import { Request, Response, NextFunction } from 'express';
export declare const logger: import("pino").Logger<never>;
/**
 * Request logging middleware
 *
 * Logs request method, URL, status code, and response time
 */
export declare const requestLogger: (req: Request, res: Response, next: NextFunction) => void;
//# sourceMappingURL=logger.d.ts.map