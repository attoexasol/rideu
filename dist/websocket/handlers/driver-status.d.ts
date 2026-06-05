/**
 * Driver Status Event Handler
 * Handles driver status change events (online, offline)
 * Updates database and broadcasts to admins
 */
import { Server, Socket } from 'socket.io';
/**
 * Setup driver status event handlers
 * @param io - Socket.IO server instance
 * @param socket - Connected socket instance
 */
export declare function setupDriverStatusHandler(io: Server, socket: Socket): void;
//# sourceMappingURL=driver-status.d.ts.map