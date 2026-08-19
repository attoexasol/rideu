/**
 * Admin User Management Routes
 *
 * Endpoints for managing users (drivers and admins)
 * Only accessible by super admins
 *
 * Note: This system uses separate tables for drivers and admin_users
 */

import express, { Request, Response } from 'express';
import { auth0Management } from '../../services/auth0Management';
import { verifyJWT, extractUserInfo, requireSuperAdmin } from '../../middleware/auth';
import { requireAdmin } from '../../middleware/rbac';
import { db } from '../../db/connection';
import { drivers, adminUsers } from '../../db/schema';
import { eq, and, ilike, or, sql } from 'drizzle-orm';
import { asyncHandler } from '../../middleware/error-handler';
import { logAndNormalizeCabIdentifier } from '../../middleware/normalizeCabIdentifier';
import {
  isCabFieldType,
  normalizeCabIdentifierInput,
  resolveCabFieldsForInsert,
} from '../../utils/cabIdentifier';
import { generateUniqueDriverQrCode } from '../../services/driverQrCode.service';
import { ensureDriverVehicleQrCode } from '../../services/vehicleQrCode.service';

const router = express.Router();

/**
 * GET /api/admin/users
 * Get all users (drivers + admins combined)
 * Accessible by both admins and super admins
 */
router.get(
  '/',
  verifyJWT,
  extractUserInfo,
  requireAdmin, // Changed from requireSuperAdmin - admins can now view all users
  asyncHandler(async (req: Request, res: Response) => {
    // Get pagination parameters
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = (page - 1) * limit;

    // Get role filter and search query
    const roleFilter = req.query.role as string | undefined;
    const search = ((req.query.search as string) || '').trim();
    const searchPattern = search ? `%${search}%` : null;

    let allUsers: any[] = [];
    let total = 0;

    // Build search conditions
    const driverSearchCondition = searchPattern
      ? or(ilike(drivers.name, searchPattern), ilike(drivers.email, searchPattern))
      : undefined;

    const adminSearchCondition = searchPattern
      ? or(ilike(adminUsers.name, searchPattern), ilike(adminUsers.email, searchPattern))
      : undefined;

    // Helper: build admin role filter condition
    const adminRoleCondition =
      roleFilter === 'admin' || roleFilter === 'super_admin'
        ? eq(adminUsers.role, roleFilter)
        : undefined;

    // Combine admin conditions (search + role)
    const adminWhereCondition =
      adminRoleCondition && adminSearchCondition
        ? and(adminRoleCondition, adminSearchCondition)
        : adminRoleCondition || adminSearchCondition || undefined;

    const mapDriver = (d: any) => ({
      id: d.id,
      auth0Id: d.auth0Id,
      email: d.email,
      name: d.name,
      role: 'driver' as const,
      phone: d.phone,
      status: d.status,
      cabName: d.cabName,
      cabNumber: d.cabNumber,
      cabLicence: d.cabLicence,
      qrCode: d.qrCode,
      vehicleMake: d.vehicleMake,
      vehicleModel: d.vehicleModel,
      vehicleYear: d.vehicleYear,
      vehicleColor: d.vehicleColor,
      profileImageUrl: d.profileImageUrl,
      accountStatus: d.accountStatus,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    });

    const mapAdmin = (a: any) => ({
      id: a.id,
      auth0Id: a.auth0Id,
      email: a.email,
      name: a.name,
      role: a.role,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    });

    const includeDrivers = !roleFilter || roleFilter === 'driver';
    const includeAdmins = !roleFilter || roleFilter === 'admin' || roleFilter === 'super_admin';

    // Helper to query drivers with optional search filter
    const queryDrivers = (lim: number, off: number) =>
      driverSearchCondition
        ? db.select().from(drivers).where(driverSearchCondition).limit(lim).offset(off)
        : db.select().from(drivers).limit(lim).offset(off);

    const countDrivers = () =>
      driverSearchCondition
        ? db
            .select({ count: sql<number>`count(*)` })
            .from(drivers)
            .where(driverSearchCondition)
        : db.select({ count: sql<number>`count(*)` }).from(drivers);

    // Helper to query admins with optional search + role filter
    const queryAdmins = (lim: number, off: number) =>
      adminWhereCondition
        ? db.select().from(adminUsers).where(adminWhereCondition).limit(lim).offset(off)
        : db.select().from(adminUsers).limit(lim).offset(off);

    const countAdmins = () =>
      adminWhereCondition
        ? db
            .select({ count: sql<number>`count(*)` })
            .from(adminUsers)
            .where(adminWhereCondition)
        : db.select({ count: sql<number>`count(*)` }).from(adminUsers);

    // Debug logging
    console.log(
      `[GET /admin/users] role=${roleFilter}, search=${search}, page=${page}, limit=${limit}`
    );
    console.log(
      `[GET /admin/users] includeDrivers=${includeDrivers}, includeAdmins=${includeAdmins}`
    );

    // Get counts first (needed for correct cross-table pagination)
    let driverTotal = 0;
    let adminTotal = 0;

    if (includeDrivers) {
      const [result] = await countDrivers();
      driverTotal = Number(result.count);
      console.log(`[GET /admin/users] driverTotal=${driverTotal}`);
    }
    if (includeAdmins) {
      const [result] = await countAdmins();
      adminTotal = Number(result.count);
      console.log(`[GET /admin/users] adminTotal=${adminTotal}`);
    }
    total = driverTotal + adminTotal;

    if (includeDrivers && includeAdmins) {
      // Both tables: paginate across the combined set (drivers first, then admins)
      if (offset < driverTotal) {
        const driverLimit = Math.min(limit, driverTotal - offset);
        const driversList = await queryDrivers(driverLimit, offset);
        allUsers.push(...driversList.map(mapDriver));

        // Fill remaining slots with admins from the start
        const remaining = limit - driversList.length;
        if (remaining > 0) {
          const adminsList = await queryAdmins(remaining, 0);
          allUsers.push(...adminsList.map(mapAdmin));
        }
      } else {
        // Offset is past all drivers, fetch only from admins
        const adminOffset = offset - driverTotal;
        const adminsList = await queryAdmins(limit, adminOffset);
        allUsers.push(...adminsList.map(mapAdmin));
      }
    } else if (includeDrivers) {
      const driversList = await queryDrivers(limit, offset);
      allUsers.push(...driversList.map(mapDriver));
    } else if (includeAdmins) {
      const adminsList = await queryAdmins(limit, offset);
      allUsers.push(...adminsList.map(mapAdmin));
    }

    const responseBody = {
      status: 'success',
      data: {
        users: allUsers,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    };
    console.log(`[GET /admin/users] Returning ${allUsers.length} users, total=${total}`);
    return res.json(responseBody);
  })
);

/**
 * POST /api/admin/users
 * Create a new user (driver or admin)
 * Admins can only create drivers, super admins can create anyone
 */
router.post(
  '/',
  verifyJWT,
  extractUserInfo,
  requireAdmin,
  logAndNormalizeCabIdentifier,
  asyncHandler(async (req: Request, res: Response) => {
    console.log('REQUEST BODY (admin create):', req.body);

    const {
      email,
      password,
      role,
      name,
      phone,
      cabName,
      vehicleMake,
      vehicleModel,
      vehicleYear,
      vehicleColor,
    } = req.body;
    const userRole = (req as any).user?.role;

    const cabNormalized = normalizeCabIdentifierInput(req.body);

    // Validate cab identifier when any cab-related field was sent
    const hasCabPayload = Boolean(
      req.body.cabFieldType ||
        req.body.cabValue !== undefined ||
        req.body.cabLicence ||
        req.body.cab_licence ||
        req.body.cabNumber ||
        req.body.cab_number ||
        req.body.fieldType ||
        req.body.value
    );

    if (hasCabPayload) {
      if (!cabNormalized.cabFieldType || !cabNormalized.cabValue) {
        return res.status(400).json({
          status: 'error',
          message:
            'Invalid cab identifier. Use cabFieldType + cabValue, or cabLicence, or cabNumber.',
        });
      }
      if (!isCabFieldType(cabNormalized.cabFieldType)) {
        return res.status(400).json({
          status: 'error',
          message: 'cabFieldType must be cab_number or cab_licence',
        });
      }
      if (cabNormalized.cabValue.length > 100) {
        return res.status(400).json({
          status: 'error',
          message: 'Cab value must be 100 characters or less',
        });
      }
    }

    // Validate required fields
    if (!email || !password || !role || !name) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields: email, password, role, name',
      });
    }

    // Validate role
    if (!['driver', 'admin', 'super_admin'].includes(role)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid role. Must be: driver, admin, or super_admin',
      });
    }

    // Permission check: Admins can only create drivers
    if (userRole === 'admin' && role !== 'driver') {
      return res.status(403).json({
        status: 'error',
        message:
          'Admins can only create driver accounts. Contact a super admin to create admin accounts.',
      });
    }

    // Validate password strength (basic)
    if (password.length < 8) {
      return res.status(400).json({
        status: 'error',
        message: 'Password must be at least 8 characters long',
      });
    }

    try {
      // Create user in Auth0
      let auth0UserId: string;

      if (auth0Management.isConfigured()) {
        console.log(`Creating ${role} user in Auth0: ${email}`);
        const auth0User = await auth0Management.createUser({
          email,
          password,
          role,
          name,
        });
        auth0UserId = auth0User.user_id;
        console.log(`✓ Auth0 user created: ${auth0UserId}`);
      } else {
        // Check if in production - this is a critical configuration issue
        if (process.env.NODE_ENV === 'production') {
          console.error('❌ Auth0 Management API not configured in production!');
          console.error('Required environment variables:');
          console.error('  - AUTH0_MANAGEMENT_CLIENT_ID');
          console.error('  - AUTH0_MANAGEMENT_CLIENT_SECRET');

          return res.status(500).json({
            status: 'error',
            message:
              'Auth0 Management API is not configured. Please contact your administrator to set up AUTH0_MANAGEMENT_CLIENT_ID and AUTH0_MANAGEMENT_CLIENT_SECRET.',
          });
        }

        // Development/staging fallback - create local-only user
        auth0UserId = `local|${Date.now()}`;
        console.warn('⚠️  Auth0 Management API not configured - creating local-only user');
        console.warn('To enable Auth0 user creation, configure:');
        console.warn('  - AUTH0_MANAGEMENT_CLIENT_ID');
        console.warn('  - AUTH0_MANAGEMENT_CLIENT_SECRET');
      }

      // Create user in appropriate database table
      let dbUser: any;

      if (role === 'driver') {
        const { cabNumber: resolvedCabNumber, cabLicence } = resolveCabFieldsForInsert(req.body);

        const insertValues = {
          auth0Id: auth0UserId,
          email,
          name,
          phone: phone || '',
          status: 'offline' as const,
          cabName: cabName || null,
          cabNumber: resolvedCabNumber,
          cabLicence,
          vehicleMake: vehicleMake || null,
          vehicleModel: vehicleModel || null,
          vehicleYear: vehicleYear || null,
          vehicleColor: vehicleColor || null,
        };

        console.log('INSERT cab fields (admin):', {
          cabFieldType: cabNormalized.cabFieldType,
          cabValue: cabNormalized.cabValue,
          cabNumber: insertValues.cabNumber,
          cabLicence: insertValues.cabLicence,
        });

        const qrCode = await generateUniqueDriverQrCode();

        const [newDriver] = await db
          .insert(drivers)
          .values({ ...insertValues, qrCode })
          .returning();

        await ensureDriverVehicleQrCode(newDriver.id);

        console.log('✅ Driver created (admin):', newDriver.id, {
          cabNumber: newDriver.cabNumber,
          cabLicence: newDriver.cabLicence,
          qrCode: newDriver.qrCode,
        });

        dbUser = {
          id: newDriver.id,
          auth0Id: newDriver.auth0Id,
          email: newDriver.email,
          name: newDriver.name,
          role: 'driver',
        };
      } else {
        // Create in admin_users table
        const [newAdmin] = await db
          .insert(adminUsers)
          .values({
            auth0Id: auth0UserId,
            email,
            name,
            role: role as 'admin' | 'super_admin',
          })
          .returning();

        dbUser = {
          id: newAdmin.id,
          auth0Id: newAdmin.auth0Id,
          email: newAdmin.email,
          name: newAdmin.name,
          role: newAdmin.role,
        };
      }

      console.log(`✓ ${role} user created successfully: ${email}`);
      return res.status(201).json({
        status: 'success',
        data: dbUser,
        message: 'User created successfully',
      });
    } catch (error) {
      console.error('Failed to create user:', error);
      const rawMessage = error instanceof Error ? error.message : 'Failed to create user';
      console.error(`Error details: ${rawMessage}`);

      // Map known Auth0/DB errors to user-friendly messages
      let userMessage = rawMessage;
      let statusCode = 500;

      if (
        rawMessage.includes('PasswordStrengthError') ||
        rawMessage.includes('Password is too weak')
      ) {
        userMessage =
          'Password is too weak. It must be at least 8 characters and contain at least 3 of: lowercase letters, uppercase letters, numbers, and special characters (e.g. !@#$%).';
        statusCode = 400;
      } else if (rawMessage.includes('The user already exists')) {
        userMessage = 'A user with this email address already exists.';
        statusCode = 409;
      } else if (rawMessage.includes('duplicate key') || rawMessage.includes('unique constraint')) {
        userMessage = 'A user with this email address already exists in the system.';
        statusCode = 409;
      } else if (rawMessage.includes('PasswordNoUserInfoError')) {
        userMessage = 'Password must not contain user information such as name or email.';
        statusCode = 400;
      } else if (rawMessage.includes('PasswordDictionaryError')) {
        userMessage = 'Password is too common. Please choose a more unique password.';
        statusCode = 400;
      } else if (rawMessage.includes('PasswordHistoryError')) {
        userMessage = 'This password has been used recently. Please choose a different password.';
        statusCode = 400;
      } else if (rawMessage.includes('invalid_signup')) {
        userMessage =
          'Could not create the account. Please check the email and password and try again.';
        statusCode = 400;
      }

      return res.status(statusCode).json({
        status: 'error',
        message: userMessage,
      });
    }
  })
);

/**
 * PATCH /api/admin/users/:id/role
 * Update user's role (Note: Changing role requires recreating user in different table)
 */
router.patch(
  '/:id/role',
  verifyJWT,
  extractUserInfo,
  requireSuperAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { role } = req.body;

    // Validate role
    if (!['driver', 'admin', 'super_admin'].includes(role)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid role. Must be: driver, admin, or super_admin',
      });
    }

    // Find user in either table
    const [driver] = await db.select().from(drivers).where(eq(drivers.id, id)).limit(1);
    const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);

    const user = driver || admin;

    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
    }

    // If role hasn't changed for admins, just update
    if (!driver && role !== 'driver') {
      const [updatedAdmin] = await db
        .update(adminUsers)
        .set({ role: role as 'admin' | 'super_admin', updatedAt: new Date() })
        .where(eq(adminUsers.id, id))
        .returning();

      // Update Auth0
      if (auth0Management.isConfigured()) {
        await auth0Management.updateUserRole(user.auth0Id, role);
      }

      return res.json({
        status: 'success',
        data: updatedAdmin,
        message: 'User role updated successfully',
      });
    }

    // Changing between driver and admin requires moving between tables
    return res.status(400).json({
      status: 'error',
      message: 'Cannot change between driver and admin roles. Please delete and recreate the user.',
    });
  })
);

/**
 * POST /api/admin/users/:id/reset-password
 * Send password reset email to user
 * Admins can reset driver passwords, super admins can reset anyone
 */
router.post(
  '/:id/reset-password',
  verifyJWT,
  extractUserInfo,
  requireAdmin, // Changed to allow both admins and super admins
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userRole = (req as any).user?.role;

    // Find user in either table
    const [driver] = await db.select().from(drivers).where(eq(drivers.id, id)).limit(1);
    const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);

    const user = driver || admin;
    const targetUserRole = driver ? 'driver' : admin?.role;

    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
    }

    // Permission check: Admins can only reset driver passwords
    if (userRole === 'admin' && targetUserRole !== 'driver') {
      return res.status(403).json({
        status: 'error',
        message: 'Admins can only reset driver passwords',
      });
    }

    try {
      if (auth0Management.isConfigured()) {
        // Send password reset email via Auth0
        await auth0Management.sendPasswordResetEmail(user.email);
        return res.json({
          status: 'success',
          message: 'Password reset email sent successfully',
        });
      } else {
        console.log(`[DEV] Would send password reset email to: ${user.email}`);
        return res.json({
          status: 'success',
          message: 'Development mode: Password reset email logged to console',
        });
      }
    } catch (error) {
      console.error('Failed to send password reset email:', error);
      return res.status(500).json({
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to send password reset email',
      });
    }
  })
);

/**
 * DELETE /api/admin/users/:id
 * Delete a user
 * Admins can only delete drivers, super admins can delete anyone (except last super admin)
 */
router.delete(
  '/:id',
  verifyJWT,
  extractUserInfo,
  requireAdmin, // Changed to allow both admins and super admins
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userRole = (req as any).user?.role;

    // Find user in either table
    const [driver] = await db.select().from(drivers).where(eq(drivers.id, id)).limit(1);
    const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);

    const user = driver || admin;
    const targetUserRole = driver ? 'driver' : admin?.role;

    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
    }

    // Prevent deleting yourself
    const requestUser = (req as any).user;
    if (user.auth0Id === requestUser.auth0Id) {
      return res.status(400).json({
        status: 'error',
        message: 'You cannot delete your own account',
      });
    }

    // Permission check: Admins can only delete drivers
    if (userRole === 'admin' && targetUserRole !== 'driver') {
      return res.status(403).json({
        status: 'error',
        message: 'Admins can only delete driver accounts',
      });
    }

    try {
      // Delete user from Auth0 FIRST
      if (auth0Management.isConfigured()) {
        console.log(`🗑️  Deleting user from Auth0: ${user.auth0Id}`);
        await auth0Management.deleteUser(user.auth0Id);
        console.log(`✓ Auth0 user deleted: ${user.auth0Id}`);
      } else {
        // Auth0 Management API not configured - warn about orphaned user
        console.warn('⚠️  Auth0 Management API not configured!');
        console.warn(`⚠️  User will be deleted from database but NOT from Auth0: ${user.email}`);
        console.warn('⚠️  This will leave an orphaned user in Auth0.');
        console.warn('Configure these environment variables to enable Auth0 deletion:');
        console.warn('  - AUTH0_MANAGEMENT_CLIENT_ID');
        console.warn('  - AUTH0_MANAGEMENT_CLIENT_SECRET');
      }

      // Delete from appropriate database table
      if (driver) {
        await db.delete(drivers).where(eq(drivers.id, id));
        console.log(`✓ Driver deleted from database: ${user.name} (${user.email})`);
      } else {
        await db.delete(adminUsers).where(eq(adminUsers.id, id));
        console.log(`✓ Admin deleted from database: ${user.name} (${user.email})`);
      }

      return res.json({
        status: 'success',
        message: auth0Management.isConfigured()
          ? 'User deleted successfully from both Auth0 and database'
          : 'User deleted from database (Auth0 Management API not configured - user remains in Auth0)',
      });
    } catch (error) {
      console.error('❌ Failed to delete user:', error);
      return res.status(500).json({
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to delete user',
      });
    }
  })
);

export default router;
