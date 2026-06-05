"use strict";
/**
 * Admin Routes
 *
 * Main admin router that combines all admin-related routes
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
// Import sub-routers
const users_1 = __importDefault(require("./admin/users"));
const router = express_1.default.Router();
// Mount user management routes (includes Auth0 integration, search, pagination, filtering)
router.use('/users', users_1.default);
exports.default = router;
//# sourceMappingURL=admin.js.map