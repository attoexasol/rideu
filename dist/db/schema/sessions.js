"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessions = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
/**
 * Sessions table schema
 * Stores user session tokens for authentication
 */
exports.sessions = (0, pg_core_1.pgTable)('sessions', {
    id: (0, pg_core_1.uuid)('id').defaultRandom().primaryKey(),
    userId: (0, pg_core_1.uuid)('user_id').notNull(),
    userType: (0, pg_core_1.varchar)('user_type', { length: 50 }).notNull(),
    token: (0, pg_core_1.varchar)('token', { length: 500 }).notNull(),
    expiresAt: (0, pg_core_1.timestamp)('expires_at').notNull(),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
}, (table) => ({
    tokenIdx: (0, pg_core_1.index)('idx_sessions_token').on(table.token),
    userIdIdx: (0, pg_core_1.index)('idx_sessions_user_id').on(table.userId),
    expiresAtIdx: (0, pg_core_1.index)('idx_sessions_expires_at').on(table.expiresAt),
}));
//# sourceMappingURL=sessions.js.map