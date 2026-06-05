"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logs = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
/**
 * Logs table schema
 * Stores system and user activity logs with metadata
 */
exports.logs = (0, pg_core_1.pgTable)('logs', {
    id: (0, pg_core_1.uuid)('id').defaultRandom().primaryKey(),
    eventType: (0, pg_core_1.varchar)('event_type', { length: 100 }).notNull(),
    userId: (0, pg_core_1.uuid)('user_id'),
    userType: (0, pg_core_1.varchar)('user_type', { length: 50 }),
    message: (0, pg_core_1.text)('message'),
    metadata: (0, pg_core_1.jsonb)('metadata'),
    timestamp: (0, pg_core_1.timestamp)('timestamp').defaultNow().notNull(),
}, (table) => ({
    eventTypeIdx: (0, pg_core_1.index)('idx_logs_event_type').on(table.eventType),
    timestampIdx: (0, pg_core_1.index)('idx_logs_timestamp').on(table.timestamp.desc()),
}));
//# sourceMappingURL=logs.js.map