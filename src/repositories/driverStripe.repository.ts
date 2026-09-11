import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/connection';
import { drivers, type Driver } from '../db/schema/drivers';
import type { StripeConnectAccountStatusType } from '../constants/stripeConnect';

export async function findDriverById(driverId: string): Promise<Driver | null> {
  const rows = await db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1);
  return rows[0] ?? null;
}

export async function findDriverByStripeAccountId(
  stripeAccountId: string
): Promise<Driver | null> {
  const rows = await db
    .select()
    .from(drivers)
    .where(eq(drivers.stripeAccountId, stripeAccountId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Persist stripe_account_id only when the driver does not already have one.
 * Never overwrite an existing connected-account id.
 */
export async function claimDriverStripeAccountId(
  driverId: string,
  stripeAccountId: string,
  country: string
): Promise<{ claimed: boolean; accountId: string }> {
  const [updated] = await db
    .update(drivers)
    .set({
      stripeAccountId,
      stripeAccountCountry: country,
      updatedAt: new Date(),
    })
    .where(and(eq(drivers.id, driverId), isNull(drivers.stripeAccountId)))
    .returning({ stripeAccountId: drivers.stripeAccountId });

  if (updated?.stripeAccountId) {
    return { claimed: true, accountId: updated.stripeAccountId };
  }

  const existing = await findDriverById(driverId);
  if (!existing?.stripeAccountId) {
    throw new Error('Failed to persist Stripe connected account id');
  }
  return { claimed: false, accountId: existing.stripeAccountId };
}

export type DriverStripeSyncFields = {
  country: string | null;
  status: StripeConnectAccountStatusType;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  currentlyDue: string[];
  eventuallyDue: string[];
};

export async function persistDriverStripeAccountSync(
  driverId: string,
  fields: DriverStripeSyncFields
): Promise<void> {
  const existing = await findDriverById(driverId);
  const alreadyCompleted = existing?.stripeOnboardingCompletedAt ?? null;
  const onboardingCompletedAt =
    fields.status === 'ready' ? alreadyCompleted ?? new Date() : alreadyCompleted;

  await db
    .update(drivers)
    .set({
      stripeAccountCountry: fields.country,
      stripeAccountStatus: fields.status,
      stripeDetailsSubmitted: fields.detailsSubmitted,
      stripeChargesEnabled: fields.chargesEnabled,
      stripePayoutsEnabled: fields.payoutsEnabled,
      stripeRequirementsCurrentlyDue: fields.currentlyDue,
      stripeRequirementsEventuallyDue: fields.eventuallyDue,
      stripeOnboardingCompletedAt: onboardingCompletedAt,
      stripeLastSyncedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(drivers.id, driverId));
}
