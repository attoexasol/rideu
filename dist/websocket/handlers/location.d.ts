/**
 * Location Event Handler
 * Handles location update events from drivers
 * Stores location in database and broadcasts to admins
 */
import { Server, Socket } from 'socket.io';
/**
 * Setup location event handlers
 * @param io - Socket.IO server instance
 * @param socket - Connected socket instance
 */
export declare function setupLocationHandler(io: Server, socket: Socket): void;
//# sourceMappingURL=location.d.ts.map