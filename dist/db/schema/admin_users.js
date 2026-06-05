"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminUsers = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
/**
 * Admin Users table schema
 * Stores administrative user accounts with role-based access
 */
exports.adminUsers = (0, pg_core_1.pgTable)('admin_users', {
    id: (0, pg_core_1.uuid)('id').defaultRandom().primaryKey(),
    auth0Id: (0, pg_core_1.varchar)('auth0_id', { length: 255 }).notNull().unique(),
    email: (0, pg_core_1.varchar)('email', { length: 255 }).notNull().unique(),
    name: (0, pg_core_1.varchar)('name', { length: 255 }).notNull(),
    role: (0, pg_core_1.varchar)('role', { length: 50 }).default('admin').notNull(),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow().notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at').defaultNow().notNull(),
}, (table) => ({
    auth0IdIdx: (0, pg_core_1.index)('idx_admin_users_auth0_id').on(table.auth0Id),
}));
//# sourceMappingURL=admin_users.js.map