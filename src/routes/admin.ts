/**
 * Admin Routes
 *
 * Main admin router that combines all admin-related routes
 */

import express from 'express';

// Import sub-routers
import userManagementRoutes from './admin/users';

const router = express.Router();

// Mount user management routes (includes Auth0 integration, search, pagination, filtering)
router.use('/users', userManagementRoutes);

export default router;
