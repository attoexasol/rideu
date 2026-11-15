import { db } from '../db/connection';
import {
  serviceCategories,
  driverServiceCategories,
  promotions,
  paymentMethods,
} from '../db/schema';
import { eq, and, lte, gte, inArray } from 'drizzle-orm';
import {
  CANONICAL_SERVICE_CODES,
  CANONICAL_SORT_ORDER,
  CANONICAL_DISPLAY_NAMES,
  cleanServiceDisplayName,
  toPublicServiceCode,
  isKnownExactProductCode,
  normalizeServiceCategoryBase,
} from '../utils/serviceCategoryNormalize';

/**
 * Active canonical product categories only
 * (exact codes: economy, executive, suv, van, minivan, ada).
 * Used by passenger quotes and admin vehicle Edit select lists.
 */
export async function listCanonicalActiveServiceCategories() {
  const rows = await db
    .select()
    .from(serviceCategories)
    .where(
      and(
        eq(serviceCategories.isActive, true),
        inArray(serviceCategories.code, [...CANONICAL_SERVICE_CODES])
      )
    );

  const byCode = new Map(rows.map((r) => [r.code.toLowerCase(), r]));
  return CANONICAL_SORT_ORDER.map((code) => byCode.get(code))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => {
      const key = r.code.toLowerCase() as keyof typeof CANONICAL_DISPLAY_NAMES;
      return {
        ...r,
        code: r.code.toLowerCase(),
        name: CANONICAL_DISPLAY_NAMES[key] ?? cleanServiceDisplayName(r.name, r.code),
      };
    });
}

/** List used by quotes/admin — canonical active only. */
export async function listActiveServiceCategories() {
  return listCanonicalActiveServiceCategories();
}

export async function findServiceCategoryById(id: string) {
  const rows = await db
    .select()
    .from(serviceCategories)
    .where(eq(serviceCategories.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function findServiceCategoryByCode(code: string) {
  const normalized = code.trim().toLowerCase();
  const rows = await db
    .select()
    .from(serviceCategories)
    .where(eq(serviceCategories.code, normalized))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Reject creating a category whose code/name collides with a canonical family
 * unless the code is an exact canonical code.
 */
export function assertNoDuplicateServiceCategoryCode(code: string, name?: string): void {
  const baseFromCode = normalizeServiceCategoryBase(code);
  const baseFromName = name ? normalizeServiceCategoryBase(name) : null;
  const base = baseFromCode ?? baseFromName;

  if (base && !isKnownExactProductCode(code)) {
    const err = new Error(
      `Duplicate service category rejected: use exact product code "${base}" instead of "${code}"`
    ) as Error & { code: string };
    err.code = 'DUPLICATE_SERVICE_CATEGORY';
    throw err;
  }
}

export function toPublicCategoryPayload(cat: {
  id: string;
  code: string;
  name: string;
  capacity: number;
  description?: string | null;
  iconKey?: string | null;
}) {
  const code = toPublicServiceCode(cat.code);
  const displayName = cleanServiceDisplayName(cat.name, cat.code);
  return {
    serviceCategoryId: cat.id,
    id: cat.id,
    code,
    name: displayName,
    displayName,
    capacity: cat.capacity,
    description: cat.description ?? null,
    iconKey: cat.iconKey ?? null,
  };
}

export async function listDriverServiceCategoryIds(driverId: string) {
  const rows = await db
    .select({ serviceCategoryId: driverServiceCategories.serviceCategoryId })
    .from(driverServiceCategories)
    .where(eq(driverServiceCategories.driverId, driverId));
  return rows.map((r) => r.serviceCategoryId);
}

export async function assignDriverServiceCategory(
  driverId: string,
  serviceCategoryId: string,
  isPrimary = false
) {
  const [row] = await db
    .insert(driverServiceCategories)
    .values({
      driverId,
      serviceCategoryId,
      isPrimary,
      verifiedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning();
  return row;
}

export async function removeDriverServiceCategory(driverId: string, serviceCategoryId: string) {
  await db
    .delete(driverServiceCategories)
    .where(
      and(
        eq(driverServiceCategories.driverId, driverId),
        eq(driverServiceCategories.serviceCategoryId, serviceCategoryId)
      )
    );
}

export async function listDriverServiceCategories(driverId: string) {
  return db
    .select({
      id: driverServiceCategories.id,
      driverId: driverServiceCategories.driverId,
      serviceCategoryId: driverServiceCategories.serviceCategoryId,
      isPrimary: driverServiceCategories.isPrimary,
      verifiedAt: driverServiceCategories.verifiedAt,
      code: serviceCategories.code,
      name: serviceCategories.name,
    })
    .from(driverServiceCategories)
    .innerJoin(
      serviceCategories,
      eq(driverServiceCategories.serviceCategoryId, serviceCategories.id)
    )
    .where(eq(driverServiceCategories.driverId, driverId));
}

export async function findActivePromotion(serviceCategoryId?: string) {
  const now = new Date();
  const rows = await db
    .select()
    .from(promotions)
    .where(
      and(
        eq(promotions.isActive, true),
        lte(promotions.validFrom, now),
        gte(promotions.validUntil, now)
      )
    )
    .limit(20);

  return (
    rows.find((p) => !p.serviceCategoryId || p.serviceCategoryId === serviceCategoryId) ?? null
  );
}

export async function listActivePromotions() {
  const now = new Date();
  return db
    .select()
    .from(promotions)
    .where(
      and(
        eq(promotions.isActive, true),
        lte(promotions.validFrom, now),
        gte(promotions.validUntil, now)
      )
    );
}

export async function findPaymentMethodByCode(code: string) {
  const rows = await db.select().from(paymentMethods).where(eq(paymentMethods.code, code)).limit(1);
  return rows[0] ?? null;
}

export async function listPaymentMethods() {
  return db.select().from(paymentMethods).where(eq(paymentMethods.isActive, true));
}
