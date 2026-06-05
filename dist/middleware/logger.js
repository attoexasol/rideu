"use strict";
/**
 * Request Logging Middleware
 *
 * Logs all incoming requests with pino logger
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestLogger = exports.logger = void 0;
const pino_1 = __importDefault(require("pino"));
// Create pino logger instance
exports.logger = (0, pino_1.default)({
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'development'
        ? {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'HH:MM:ss Z',
                ignore: 'pid,hostname',
            },
        }
        : undefined,
});
/**
 * Request logging middleware
 *
 * Logs request method, URL, status code, and response time
 */
const requestLogger = (req, res, next) => {
    const start = Date.now();
    // Log request
    exports.logger.info({
        type: 'request',
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('user-agent'),
    });
    // Log response when finished
    res.on('finish', () => {
        const duration = Date.now() - start;
        exports.logger.info({
            type: 'response',
            method: req.method,
            url: req.url,
            status: res.statusCode,
            duration: `${duration}ms`,
        });
    });
    next();
};
exports.requestLogger = requestLogger;
//# sourceMappingURL=logger.js.map