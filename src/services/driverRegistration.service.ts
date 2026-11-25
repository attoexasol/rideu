import { sql, eq } from 'drizzle-orm';
import { db } from '../db/connection';
import { adminUsers } from '../db/schema/admin_users';
import { customers } from '../db/schema/customers';
import { drivers } from '../db/schema/drivers';
import { auth0Management } from './auth0Management';
import { generateUniqueDriverQrCode } from './driverQrCode.service';
import { ensureDriverVehicleQrCode } from './vehicleQrCode.service';
import { insertDriverWithFleetMembership, resolvePlatformFleetId } from './defaultFleet.service';

export class DriverRegistrationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = 'DriverRegistrationError';
  }
}

export interface DriverRegistrationResult {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  accountStatus: 'active';
  status: 'offline';
  nextStep: 'login';
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string; cause?: { code?: string } };
  const code = candidate?.code || candidate?.cause?.code;
  if (code === '23505') return true;
  const message = error instanceof Error ? error.message : '';
  return message.includes('duplicate key') || message.includes('unique constraint');
}

function auth0PasswordValidationError(message: string): DriverRegistrationError | null {
  if (message.includes('PasswordStrengthError') || message.includes('Password is too weak')) {
    return new DriverRegistrationError(
      'VALIDATION_ERROR',
      'Password is too weak. It must be at least 8 characters and contain at least 3 of: lowercase letters, uppercase letters, numbers, and special characters (e.g. !@#$%).',
      400
    );
  }
  if (message.includes('PasswordNoUserInfoError')) {
    return new DriverRegistrationError(
      'VALIDATION_ERROR',
      'Password must not contain user information such as name or email.',
      400
    );
  }
  if (message.includes('PasswordDictionaryError')) {
    return new DriverRegistrationError(
      'VALIDATION_ERROR',
      'Password is too common. Please choose a more unique password.',
      400
    );
  }
  if (message.includes('PasswordHistoryError')) {
    return new DriverRegistrationError(
      'VALIDATION_ERROR',
      'This password has been used recently. Please choose a different password.',
      400
    );
  }
  return null;
}

async function emailTaken(email: string): Promise<boolean> {
  const driverHit = await db
    .select({ id: drivers.id })
    .from(drivers)
    .where(sql`lower(${drivers.email}) = ${email}`)
    .limit(1);
  if (driverHit.length > 0) return true;

  const adminHit = await db
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(sql`lower(${adminUsers.email}) = ${email}`)
    .limit(1);
  if (adminHit.length > 0) return true;

  const customerHit = await db
    .select({ id: customers.id })
    .from(customers)
    .where(sql`lower(${customers.email}) = ${email}`)
    .limit(1);
  return customerHit.length > 0;
}

async function driverPhoneTaken(phone: string): Promise<boolean> {
  const rows = await db
    .select({ id: drivers.id })
    .from(drivers)
    .where(sql`trim(${drivers.phone}) = ${phone}`)
    .limit(1);
  return rows.length > 0;
}

async function deleteAuth0User(auth0Id: string): Promise<boolean> {
  try {
    await auth0Management.deleteUser(auth0Id);
    return true;
  } catch (error) {
    console.error('[driver-register] Failed to delete Auth0 user during rollback', {
      auth0Id,
      message: error instanceof Error ? error.message : 'unknown',
    });
    return false;
  }
}

async function deleteDriverRow(driverId: string): Promise<boolean> {
  try {
    await db.delete(drivers).where(eq(drivers.id, driverId));
    return true;
  } catch (error) {
    console.error('[driver-register] Failed to delete driver row during rollback', {
      driverId,
      message: error instanceof Error ? error.message : 'unknown',
    });
    return false;
  }
}

export async function registerDriver(input: {
  name: string;
  email: string;
  phone: string;
  password: string;
}): Promise<DriverRegistrationResult> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const phone = input.phone.trim();
  const password = input.password;

  if (await emailTaken(email)) {
    throw new DriverRegistrationError(
      'DUPLICATE_EMAIL',
      'An account with this email already exists',
      409
    );
  }

  if (await driverPhoneTaken(phone)) {
    throw new DriverRegistrationError(
      'DUPLICATE_PHONE',
      'A driver with this phone number already exists',
      409
    );
  }

  if (!auth0Management.isConfigured()) {
    throw new DriverRegistrationError(
      'AUTH0_NOT_CONFIGURED',
      'Auth0 Management API is not configured',
      503
    );
  }

  let existingAuth0: { user_id: string } | null;
  try {
    existingAuth0 = await auth0Management.findUserByEmail(email);
  } catch (error) {
    console.error('[driver-register] Auth0 email lookup failed', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    throw new DriverRegistrationError('AUTH0_ERROR', 'Unable to verify the email with Auth0', 502);
  }

  if (existingAuth0) {
    throw new DriverRegistrationError(
      'DUPLICATE_EMAIL',
      'An account with this email already exists',
      409
    );
  }

  let fleetId: string;
  try {
    fleetId = await resolvePlatformFleetId();
  } catch (error) {
    console.error('[driver-register] Platform fleet resolution failed', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    throw new DriverRegistrationError('REGISTRATION_FAILED', 'Unable to create the driver account', 500);
  }

  let auth0User: { user_id: string };
  try {
    auth0User = await auth0Management.createUser({
      email,
      password,
      name,
      role: 'driver',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.toLowerCase().includes('already exists')) {
      throw new DriverRegistrationError(
        'DUPLICATE_EMAIL',
        'An account with this email already exists',
        409
      );
    }
    const passwordError = auth0PasswordValidationError(message);
    if (passwordError) {
      console.error('[driver-register] Auth0 rejected the password policy');
      throw passwordError;
    }
    console.error('[driver-register] Auth0 user creation failed');
    throw new DriverRegistrationError('AUTH0_ERROR', 'Unable to create the driver account', 502);
  }

  let qrCode: string;
  try {
    qrCode = await generateUniqueDriverQrCode();
  } catch (error) {
    console.error('[driver-register] Driver QR generation failed', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    await deleteAuth0User(auth0User.user_id);
    throw new DriverRegistrationError('REGISTRATION_FAILED', 'Unable to create the driver account', 500);
  }

  let driver: typeof drivers.$inferSelect;
  try {
    driver = await insertDriverWithFleetMembership(
      {
        auth0Id: auth0User.user_id,
        email,
        name,
        phone,
        status: 'offline',
        accountStatus: 'active',
        qrCode,
      },
      fleetId
    );
  } catch (error) {
    const removed = await deleteAuth0User(auth0User.user_id);
    if (!removed) {
      console.error('[driver-register] Auth0 user remains after failed driver insert', {
        auth0Id: auth0User.user_id,
      });
    }
    if (isUniqueViolation(error)) {
      throw new DriverRegistrationError(
        'DUPLICATE_EMAIL',
        'An account with this email already exists',
        409
      );
    }
    console.error('[driver-register] Driver insert failed', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    throw new DriverRegistrationError('REGISTRATION_FAILED', 'Unable to create the driver account', 500);
  }

  try {
    await ensureDriverVehicleQrCode(driver.id);
  } catch (error) {
    console.error('[driver-register] Vehicle QR identifier generation failed', {
      driverId: driver.id,
      message: error instanceof Error ? error.message : 'unknown',
    });
    const driverRemoved = await deleteDriverRow(driver.id);
    if (driverRemoved) {
      await deleteAuth0User(auth0User.user_id);
    }
    throw new DriverRegistrationError('REGISTRATION_FAILED', 'Unable to create the driver account', 500);
  }

  return {
    id: driver.id,
    name: driver.name,
    email: driver.email,
    phone: driver.phone,
    accountStatus: 'active',
    status: 'offline',
    nextStep: 'login',
  };
}
