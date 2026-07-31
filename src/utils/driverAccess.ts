import { AuthenticatedRequest } from '../middleware/auth';
import { db } from '../db/connection';
import { drivers } from '../db/schema/drivers';
import { eq } from 'drizzle-orm';
import { isAdmin } from '../middleware/rbac';

export async function canActOnDriver(
  req: AuthenticatedRequest,
  driverId: string
): Promise<{ allowed: boolean; driver: typeof drivers.$inferSelect | null }> {
  const user = (req as any).user;
  if (!user) {
    return { allowed: false, driver: null };
  }

  const driver = await db.query.drivers.findFirst({
    where: eq(drivers.id, driverId),
  });

  if (!driver) {
    return { allowed: false, driver: null };
  }

  if (isAdmin(user.role)) {
    return { allowed: true, driver };
  }

  if (user.role === 'driver' && (user.userId === driverId || user.auth0Id === driver.auth0Id)) {
    return { allowed: true, driver };
  }

  return { allowed: false, driver };
}
